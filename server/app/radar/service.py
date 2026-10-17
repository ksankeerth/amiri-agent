"""Radar runs, stories and their findings.

The tick's `radar` step collects running runs and starts a scheduled one when it's due: once a day
at RADAR_RUN_AT (the institution's local time) with a daily period, otherwise RADAR_EVERY_MINUTES
after the last scheduled run. Only scheduled runs count for that, so Check now never moves the
schedule. "Check now" starts one at once, at most RADAR_RUN_NOW_PER_DAY times per local day. Both
stop once today's BigQuery bytes (the agent's own reports, added up per UTC day) reach
RADAR_DAILY_BYTES_CAP. Each run reads the window since the previous run of either kind.

A run's stories are stored by fingerprint: a story seen again is updated (headlines added, the
latest score and reason kept), not repeated. A story the agent sent becomes a finding (source
radar, kind story) that the investigation takes like any other; a person may also send one the
agent held back. A sent story that continues an earlier one (`development_of`) whose finding is
in an open event joins that event as a development (linked by radar).
"""

import logging
import re
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import ValidationError

from app import settings
from app.alerts import service as alerts
from app.clock import Clock
from app.institutions.service import Institutions
from app.investigation.client import AgentError, RadarClient
from app.monitors import request as mreq
from app.problems import Problem
from app.radar.contract import RadarRunResult

FINISHED = ("completed", "stopped_early")
MAX_REPOSTS = 3
log = logging.getLogger("amiri.radar")
WORLD = "live"


def _day_start(t: datetime) -> datetime:
    return t.replace(hour=0, minute=0, second=0, microsecond=0)


def run_at() -> tuple[int, int] | None:
    """RADAR_RUN_AT as (hour, minute) when it applies: a daily period and a valid HH:MM."""
    m = re.fullmatch(r"([01]?\d|2[0-3]):([0-5]\d)", settings.raw("RADAR_RUN_AT").strip())
    return (int(m.group(1)), int(m.group(2))) if m and settings.integer("RADAR_EVERY_MINUTES") == 1440 else None


def schedule(now: datetime, tz: ZoneInfo, last_tick: datetime | None) -> tuple[bool, datetime]:
    """(due now, the next scheduled start) from the last scheduled run. The first one is due at once."""
    at = run_at()
    if at:
        local = now.astimezone(tz)
        slot = local.replace(hour=at[0], minute=at[1], second=0, microsecond=0)
        if local < slot:
            slot -= timedelta(days=1)  # the latest slot that has come
        if last_tick is None or last_tick < slot:
            return True, now
        return False, slot + timedelta(days=1)
    every = timedelta(minutes=settings.integer("RADAR_EVERY_MINUTES"))
    if last_tick is None or now - last_tick >= every:
        return True, now
    return False, last_tick + every


class Radar:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, client: RadarClient, clock: Clock):
        self.pool, self.institutions, self.client, self.clock = pool, institutions, client, clock

    def _iid(self) -> str:
        return settings.raw("INSTITUTION_ID")

    async def _tz(self) -> ZoneInfo:
        """The institution's time zone (for the daily slot and the Check now day); UTC without a profile."""
        try:
            name = (await self.institutions.state(self._iid())).inst["fields"].get("time_zone") or "UTC"
            return ZoneInfo(name)
        except (Problem, ZoneInfoNotFoundError, KeyError):
            return ZoneInfo("UTC")

    async def _last_tick(self, conn) -> datetime | None:
        cur = await conn.execute("SELECT max(created_at) AS t FROM signals.radar_runs WHERE institution_id = %s "
                                 "AND trigger = 'tick'", (self._iid(),))
        return (await cur.fetchone())["t"]

    async def _run_now_used(self, conn, tz: ZoneInfo) -> int:
        """Check now runs today (local day); a run the agent never took doesn't count."""
        local_midnight = _day_start(self.clock.now().astimezone(tz))
        cur = await conn.execute("SELECT count(*) AS n FROM signals.radar_runs WHERE institution_id = %s "
                                 "AND trigger = 'now' AND status <> 'failed' AND created_at >= %s", (self._iid(), local_midnight))
        return int((await cur.fetchone())["n"])

    # ------------------------------------------------------------ status

    async def _bytes_today(self, conn) -> int:
        cur = await conn.execute("SELECT coalesce(sum(bytes_processed), 0) AS b FROM signals.radar_runs WHERE created_at >= %s",
                                 (_day_start(self.clock.now()),))
        return int((await cur.fetchone())["b"])

    async def status(self) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT run_id, status, trigger, created_at, finished_at, stories, sent, bytes_processed, error,
                          result -> 'considered' AS considered, result -> 'shortlisted' AS shortlisted
                   FROM signals.radar_runs WHERE institution_id = %s ORDER BY created_at DESC LIMIT 1""", (self._iid(),))
            last = await cur.fetchone()
            tz = await self._tz()
            _, next_at = schedule(now, tz, await self._last_tick(conn))
            used = await self._run_now_used(conn, tz)
            spent = await self._bytes_today(conn)
            cur = await conn.execute("SELECT count(*) AS n FROM signals.radar_runs WHERE status = 'running'")
            running = (await cur.fetchone())["n"]
        cap = settings.integer("RADAR_DAILY_BYTES_CAP")
        every = settings.integer("RADAR_EVERY_MINUTES")
        limit = settings.integer("RADAR_RUN_NOW_PER_DAY")
        at = run_at()
        notes = []
        if not self.client.connected():
            notes.append("The Radar agent isn't connected (RADAR_URL); Radar doesn't run.")
        if spent >= cap:
            notes.append("Today's BigQuery budget is spent: scheduled runs wait until midnight UTC.")
        return {"connected": self.client.connected(), "agent_url": self.client.url or None, "every_minutes": every,
                "run_at": f"{at[0]:02d}:{at[1]:02d}" if at else None, "time_zone": tz.key,
                "run_now": {"used": used, "limit": limit, "left": max(0, limit - used)},
                "last_run": last, "running": running,
                "next_run_at": next_at,
                "bytes_today": spent, "bytes_cap": cap, "budget_spent": spent >= cap,
                "limits": {"max_stories": settings.integer("RADAR_MAX_STORIES"),
                           "max_queries": settings.integer("RADAR_MAX_QUERIES"),
                           "max_bytes_per_query": settings.integer("RADAR_MAX_BYTES_PER_QUERY")},
                "notes": notes}

    # ------------------------------------------------------------ the tick and Check now

    async def run_due(self) -> dict:
        step = {"step": "radar", "started": 0, "done": 0, "failed": 0, "stories": 0, "sent": 0, "skipped": []}
        if not self.client.connected():
            step["skipped"].append("RADAR_URL is not set")
            return step
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT run_id FROM signals.radar_runs WHERE status = 'running' AND next_poll_at <= %s",
                                     (self.clock.now(),))
            due = [r["run_id"] for r in await cur.fetchall()]
        for run_id in due:
            await self.collect(run_id, step)
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT 1 FROM signals.radar_runs WHERE status = 'running'")
            if await cur.fetchone():
                return step
            due, _ = schedule(self.clock.now(), await self._tz(), await self._last_tick(conn))
            if not due:
                return step
            if await self._bytes_today(conn) >= settings.integer("RADAR_DAILY_BYTES_CAP"):
                step["skipped"].append("today's BigQuery budget is spent")
                return step
        if await self._start("tick", None, step):
            step["started"] += 1
        return step

    async def run_now(self, actor: str) -> dict:
        if not self.client.connected():
            raise Problem(503, "radar_not_connected", "The Radar agent isn't connected (RADAR_URL is not set).")
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT run_id FROM signals.radar_runs WHERE status = 'running'")
            if await cur.fetchone():
                raise Problem(409, "run_running", "A Radar run is in progress; it is collected shortly.")
            if await self._bytes_today(conn) >= settings.integer("RADAR_DAILY_BYTES_CAP"):
                raise Problem(409, "budget_spent", "Today's BigQuery budget for Radar is spent (RADAR_DAILY_BYTES_CAP); "
                                                   "it resets at midnight UTC.")
            limit = settings.integer("RADAR_RUN_NOW_PER_DAY")
            if await self._run_now_used(conn, await self._tz()) >= limit:
                raise Problem(429, "run_now_limit", f"You've used today's {limit} checks (the prototype's limit); "
                              "they reset at midnight, and the scheduled run still comes.", limit=limit)
        step: dict = {"skipped": []}
        run_id = await self._start("now", actor, step)
        if not run_id:
            raise Problem(409, "not_started", "; ".join(step["skipped"]) or "The run couldn't start.")
        return await self.check(run_id)

    async def run(self, run_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM signals.radar_runs WHERE run_id = %s", (run_id,))
            row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No Radar run {run_id}.")
        return row

    async def check(self, run_id: str) -> dict:
        row = await self.run(run_id)
        if row["status"] == "running" and self.client.connected():
            await self.collect(run_id)
        return await self.run(run_id)

    async def runs(self, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT run_id, trigger, status, window_since, window_until, stories, sent, bytes_processed, error,
                          created_by, created_at, finished_at, result -> 'considered' AS considered,
                          result -> 'shortlisted' AS shortlisted, result -> 'queries' AS queries, result -> 'usage' AS usage
                   FROM signals.radar_runs WHERE institution_id = %s ORDER BY created_at DESC LIMIT %s""",
                (self._iid(), limit))
            return await cur.fetchall()

    async def _start(self, trigger: str, actor: str | None, step: dict) -> str | None:
        iid, now = self._iid(), self.clock.now()
        try:
            state = await self.institutions.state(iid)
            ctx = await self.institutions.context(iid)
        except Problem:
            step["skipped"].append(f"no profile for institution {iid}")
            return None
        scope = ctx["radar_scope"]
        if not scope["places"]:
            step["skipped"].append("the profile gives Radar no places to watch")
            return None
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT max(window_until) AS u FROM signals.radar_runs WHERE institution_id = %s AND status = ANY(%s)",
                (iid, list(FINISHED)))
            last = (await cur.fetchone())["u"]
            lookback = now - timedelta(hours=settings.integer("RADAR_FIRST_LOOKBACK_HOURS"))
            since = min(max(last, lookback) if last else lookback, now - timedelta(minutes=15))
            cur = await conn.execute(
                "SELECT fingerprint FROM signals.radar_stories WHERE institution_id = %s AND last_seen_at > %s",
                (iid, now - timedelta(days=settings.integer("RADAR_SEEN_DAYS"))))
            seen = [r["fingerprint"] for r in await cur.fetchall()]
            run_id = f"rad-{now:%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"
            req = {"run_id": run_id, "institution": mreq.institution(state),
                   "scope": {"places": scope["places"], "places_why": scope.get("why", {}), "themes": scope["themes"],
                             "actors": scope["actors"]},
                   "window": {"since": since.isoformat(), "until": now.isoformat()}, "seen": seen,
                   "limits": {"max_stories": settings.integer("RADAR_MAX_STORIES"),
                              "max_model_calls": settings.integer("RADAR_MAX_MODEL_CALLS"),
                              "timeout_seconds": settings.integer("RADAR_TIMEOUT_SECONDS"),
                              "max_queries": settings.integer("RADAR_MAX_QUERIES"),
                              "max_bytes_per_query": settings.integer("RADAR_MAX_BYTES_PER_QUERY")}}
            await conn.execute(
                """INSERT INTO signals.radar_runs (run_id, institution_id, trigger, window_since, window_until, status, request,
                     created_by, created_at, next_poll_at) VALUES (%s, %s, %s, %s, %s, 'running', %s, %s, %s, %s)""",
                (run_id, iid, trigger, since, now, Jsonb(req), actor, now, now))
        try:
            st = await self.client.start(req)
        except AgentError as e:
            await self._failed(run_id, f"the agent refused or couldn't take the run: {e}", step)
            return run_id
        if st.get("status") in (*FINISHED, "failed"):
            await self._finish(run_id, st, step)
        return run_id

    async def collect(self, run_id: str, step: dict | None = None) -> None:
        step = step if step is not None else {}
        try:
            st = await self.client.status(run_id)
        except AgentError as e:
            if e.retry and "HTTP 404" not in str(e):
                return
            if "HTTP 404" in str(e) and await self._repost(run_id):
                return
            await self._failed(run_id, f"the agent lost the run: {e}", step)
            return
        if st.get("status") not in ("queued", "running"):
            await self._finish(run_id, st, step)

    async def _repost(self, run_id: str) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE signals.radar_runs SET reposts = reposts + 1 WHERE run_id = %s AND status = 'running'
                   AND reposts < %s RETURNING request""", (run_id, MAX_REPOSTS))
            row = await cur.fetchone()
        if not row:
            return False
        try:
            await self.client.start(row["request"])
        except AgentError:
            return False
        return True

    async def _failed(self, run_id: str, error: str, step: dict) -> None:
        log.warning("radar run %s failed: %s", run_id, error[:500])
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE signals.radar_runs SET status = 'failed', error = %s, finished_at = %s, next_poll_at = NULL
                   WHERE run_id = %s AND status = 'running'""", (error[:2000], self.clock.now(), run_id))
        step["failed"] = step.get("failed", 0) + 1

    async def _finish(self, run_id: str, st: dict, step: dict) -> None:
        if st.get("status") == "failed":
            await self._failed(run_id, st.get("error") or "the run failed", step)
            return
        try:
            result = RadarRunResult.model_validate(st.get("result") or {}).model_dump(mode="json", exclude_none=True)
        except ValidationError as e:
            await self._failed(run_id, f"the agent's answer broke the contract: {e.errors()[0]['msg']} at "
                                       f"{'.'.join(str(x) for x in e.errors()[0]['loc'])}", step)
            return
        now = self.clock.now()
        sent = 0
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT * FROM signals.radar_runs WHERE run_id = %s FOR UPDATE", (run_id,))
            run = await cur.fetchone()
            if not run or run["status"] != "running":
                return
            for s in result["stories"]:
                story = await self._upsert(conn, run, s, now)
                if s["send"] and story["status"] == "below":
                    await self._send(conn, story, run_id, "agent", now)
                    sent += 1
            await conn.execute(
                """UPDATE signals.radar_runs SET status = %s, result = %s, stories = %s, sent = %s, bytes_processed = %s,
                     finished_at = %s, next_poll_at = NULL WHERE run_id = %s""",
                (st["status"], Jsonb(result), len(result["stories"]), sent, result["bytes_processed"], now, run_id))
        step["done"] = step.get("done", 0) + 1
        step["stories"] = step.get("stories", 0) + len(result["stories"])
        step["sent"] = step.get("sent", 0) + sent

    async def _upsert(self, conn, run: dict, s: dict, now: datetime) -> dict:
        cur = await conn.execute("SELECT * FROM signals.radar_stories WHERE institution_id = %s AND fingerprint = %s FOR UPDATE",
                                 (run["institution_id"], s["fingerprint"]))
        old = await cur.fetchone()
        if old:
            have = {(h.get("url"), h["title"]) for h in old["headlines"]}
            headlines = old["headlines"] + [h for h in s["headlines"] if (h.get("url"), h["title"]) not in have]
            cur = await conn.execute(
                """UPDATE signals.radar_stories SET title = %s, summary = %s, why = %s, places = %s, themes = %s,
                     relevance = %s, score = %s, publishers = greatest(publishers, %s), headlines = %s, run_id = %s,
                     runs_seen = runs_seen + 1, last_seen_at = %s, development_of = coalesce(development_of, %s)
                   WHERE story_id = %s RETURNING *""",
                (s["title"], s["summary"], s["why"], s["places"], Jsonb(s["themes"]), s["relevance"], s["score"],
                 s["publishers"], Jsonb(headlines), run["run_id"], now, s.get("development_of"), old["story_id"]))
            return await cur.fetchone()
        cur = await conn.execute(
            """INSERT INTO signals.radar_stories (story_id, institution_id, fingerprint, title, summary, why, places, themes,
                 relevance, score, publishers, headlines, development_of, status, run_id, first_seen_at, last_seen_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'below', %s, %s, %s) RETURNING *""",
            (f"rs-{uuid.uuid4().hex[:10]}", run["institution_id"], s["fingerprint"], s["title"], s["summary"], s["why"],
             s["places"], Jsonb(s["themes"]), s["relevance"], s["score"], s["publishers"], Jsonb(s["headlines"]),
             s.get("development_of"), run["run_id"], now, now))
        return await cur.fetchone()

    async def _send(self, conn, story: dict, run_id: str, by: str, now: datetime) -> str:
        """The story as a finding for the investigation; a continuation of an open event's story joins it."""
        fid = f"f-radar-{story['story_id'].removeprefix('rs-')}"
        await conn.execute(
            """INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title, explanation,
                 score, themes, places, evidence, created_at)
               VALUES (%s, %s, %s, 'radar', %s, 'story', %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (finding_id) DO NOTHING""",
            (fid, WORLD, story["institution_id"],
             Jsonb({"radar_run_id": run_id, "story_fingerprint": story["fingerprint"], "story_id": story["story_id"],
                    "publishers": story["publishers"], "relevance": story["relevance"]}),
             story["title"], f"{story['summary']} Why it matters: {story['why']}", story["score"], Jsonb(story["themes"]),
             story["places"], Jsonb({"signals": [], "headlines": story["headlines"], "web": []}), now))
        await conn.execute("UPDATE signals.radar_stories SET status = 'sent', sent_by = %s, finding_id = %s WHERE story_id = %s",
                           (by, fid, story["story_id"]))
        if story["development_of"]:
            cur = await conn.execute(
                """SELECT e.event_id FROM signals.radar_stories s JOIN signals.findings f ON f.finding_id = s.finding_id
                   JOIN cases.events e ON e.event_id = f.outcome ->> 'event_id'
                   WHERE s.institution_id = %s AND s.fingerprint = %s AND e.status = 'open' AND e.world = %s""",
                (story["institution_id"], story["development_of"], WORLD))
            ev = await cur.fetchone()
            if ev:
                await conn.execute(
                    """INSERT INTO cases.event_developments (finding_id, event_id, joined_at, linked_by, reason)
                       VALUES (%s, %s, %s, 'radar', %s) ON CONFLICT (finding_id) DO NOTHING""",
                    (fid, ev["event_id"], now, "Radar found it continues the story of this event"))
                await conn.execute("UPDATE signals.findings SET status = 'linked', outcome = %s WHERE finding_id = %s",
                                   (Jsonb({"event_id": ev["event_id"], "development": True}), fid))
                await conn.execute("UPDATE cases.events SET open_until = %s WHERE event_id = %s",
                                   (now + timedelta(days=settings.integer("EVENT_OPEN_DAYS")), ev["event_id"]))
                await alerts.sync(conn, ev["event_id"], now, "Radar found the story continues")
        return fid

    # ------------------------------------------------------------ stories

    async def stories(self, status: str | None, place: str | None, theme: str | None, limit: int,
                      story_id: str | None = None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT s.*, f.status AS finding_status, f.outcome ->> 'event_id' AS event_id, e.title AS event_title
                   FROM signals.radar_stories s LEFT JOIN signals.findings f ON f.finding_id = s.finding_id
                   LEFT JOIN cases.events e ON e.event_id = f.outcome ->> 'event_id'
                   WHERE s.institution_id = %s AND (%s::text IS NULL OR s.story_id = %s) AND (%s::text IS NULL OR s.status = %s)
                   AND (%s::text IS NULL OR %s = ANY(s.places))
                   AND (%s::text IS NULL OR s.themes @> jsonb_build_array(jsonb_build_object('theme', %s::text)))
                   ORDER BY s.last_seen_at DESC, s.score DESC LIMIT %s""",
                (self._iid(), story_id, story_id, status, status, place, place, theme, theme, limit))
            rows = await cur.fetchall()
            cur = await conn.execute(
                """SELECT m.monitor_id, v.spec -> 'about' ->> 'name' AS name, v.spec -> 'public' -> 'places' AS places
                   FROM core.monitors m JOIN core.monitor_versions v ON v.monitor_id = m.monitor_id
                   AND v.version = m.live_version WHERE m.institution_id = %s AND m.status = 'live'""", (self._iid(),))
            monitors = await cur.fetchall()
        for r in rows:
            hint = next((m for m in monitors if set(r["places"]) & set(m["places"] or [])), None)
            r["monitor_hint"] = {"monitor_id": hint["monitor_id"], "name": hint["name"]} if hint else None
        return rows

    async def story(self, story_id: str) -> dict:
        rows = await self.stories(None, None, None, 1, story_id)
        if not rows:
            raise Problem(404, "not_found", f"No story {story_id}.")
        return rows[0]

    async def investigate(self, story_id: str, actor: str) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT * FROM signals.radar_stories WHERE story_id = %s FOR UPDATE", (story_id,))
            s = await cur.fetchone()
            if not s:
                raise Problem(404, "not_found", f"No story {story_id}.")
            if s["status"] == "sent":
                raise Problem(409, "already_sent", "This story was sent for investigation already.")
            await self._send(conn, s, s["run_id"], actor, now)
        return await self.story(story_id)

    async def dismiss(self, story_id: str, actor: str, restore: bool = False) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT status FROM signals.radar_stories WHERE story_id = %s", (story_id,))
            s = await cur.fetchone()
            if not s:
                raise Problem(404, "not_found", f"No story {story_id}.")
            if restore:
                if s["status"] != "dismissed":
                    raise Problem(409, "not_dismissed", "This story isn't dismissed.")
                await conn.execute("UPDATE signals.radar_stories SET status = 'below', dismissed_by = NULL, dismissed_at = NULL "
                                   "WHERE story_id = %s", (story_id,))
            else:
                if s["status"] == "sent":
                    raise Problem(409, "already_sent", "A story sent for investigation can't be dismissed; its event can be closed.")
                await conn.execute("UPDATE signals.radar_stories SET status = 'dismissed', dismissed_by = %s, dismissed_at = %s "
                                   "WHERE story_id = %s", (actor, self.clock.now(), story_id))
        return await self.story(story_id)
