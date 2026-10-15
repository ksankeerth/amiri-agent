"""Monitors: lifecycle, versions, checks and their findings.

Lifecycle: draft → submitted → live ⇄ paused → retired. A change to a live monitor makes the
next version a draft while the live one keeps running; approving it replaces the live one.
Any Risk Manager approves (no separate approver role in the prototype); every step records who did it.

Checks: the tick (`run_due`) collects running checks, then starts the live monitors that are
due (at most MONITOR_CHECKS_PER_TICK); "Run now" starts one at once, and on a monitor that
isn't live it is a test of its latest version, whose findings go to the sandbox world. Each
check reads news published since the last completed check. Its findings become the shared
Finding and go to the investigation like any other.
"""

import logging
import re
import uuid
from datetime import datetime, timedelta

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import settings
from app.clock import Clock
from app.institutions.service import Institutions
from app.investigation.client import AgentError, MonitorClient
from app.monitors import request as build
from app.monitors import templates
from app.monitors.schemas import MonitorSpec
from app.problems import Problem

log = logging.getLogger("amiri.monitors")

FINISHED = ("completed", "stopped_early")
MAX_REPOSTS = 3


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "monitor"


class Monitors:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, client: MonitorClient, clock: Clock):
        self.pool, self.institutions, self.client, self.clock = pool, institutions, client, clock

    # ------------------------------------------------------------ reads

    async def _row(self, conn, monitor_id: str, lock: bool = False) -> dict:
        cur = await conn.execute(f"SELECT * FROM core.monitors WHERE monitor_id = %s{' FOR UPDATE' if lock else ''}",
                                 (monitor_id,))
        row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No monitor {monitor_id}.")
        return row

    async def _versions(self, conn, monitor_id: str) -> dict[int, dict]:
        cur = await conn.execute("SELECT * FROM core.monitor_versions WHERE monitor_id = %s ORDER BY version",
                                 (monitor_id,))
        return {v["version"]: v for v in await cur.fetchall()}

    def _view(self, m: dict, versions: dict[int, dict], findings_30d: int = 0) -> dict:
        latest = versions[m["latest_version"]]
        live = versions.get(m["live_version"]) if m["live_version"] else None
        pending = latest if m["live_version"] != m["latest_version"] else None
        spec = latest["spec"]
        return {
            "monitor_id": m["monitor_id"], "institution_id": m["institution_id"], "status": m["status"],
            "name": spec["about"]["name"], "sentence": spec["public"]["in_one_sentence"],
            "owner": spec["about"]["owner"], "check_frequency": spec["about"]["check_frequency"],
            "live_version": m["live_version"], "latest_version": m["latest_version"],
            "pending": {"version": pending["version"], "status": pending["status"], "note": pending["note"]} if pending else None,
            "spec": spec, "live_spec": live["spec"] if live and pending else None,
            "origin": m["origin"], "origin_ref": m["origin_ref"], "drafted_fields": m["drafted_fields"],
            "next_check_at": m["next_check_at"] if m["status"] == "live" else None,
            "last_check": {"at": m["last_check_at"], "status": m["last_check_status"], "findings": m["last_check_findings"]}
            if m["last_check_at"] else None,
            "findings_30d": findings_30d,
            "review_due": bool(spec["about"].get("review_by") and spec["about"]["review_by"] <= self.clock.now().date().isoformat()),
            "versions": [{k: v[k] for k in ("version", "status", "note", "created_by", "created_at", "submitted_by",
                                            "submitted_at", "approved_by", "approved_at")} for v in versions.values()],
            "created_by": m["created_by"], "created_at": m["created_at"], "updated_at": m["updated_at"],
        }  # fmt: skip

    async def all(self, institution_id: str, status: str | None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT m.*, (SELECT count(*) FROM signals.findings f WHERE f.source = 'monitor'
                     AND f.source_ref ->> 'monitor_id' = m.monitor_id AND f.world = 'live'
                     AND f.created_at > %s) AS f30
                   FROM core.monitors m WHERE m.institution_id = %s AND (%s::text IS NULL OR m.status = %s)
                   ORDER BY m.status = 'retired', m.created_at""",
                (self.clock.now() - timedelta(days=30), institution_id, status, status))
            rows = await cur.fetchall()
            out = []
            for m in rows:
                v = await self._versions(conn, m["monitor_id"])
                view = self._view(m, v, m["f30"])
                out.append({k: view[k] for k in view if k not in ("spec", "live_spec", "versions")})
        return out

    async def get(self, monitor_id: str) -> dict:
        async with self.pool.connection() as conn:
            m = await self._row(conn, monitor_id)
            cur = await conn.execute(
                """SELECT count(*) AS n FROM signals.findings WHERE source = 'monitor' AND world = 'live'
                   AND source_ref ->> 'monitor_id' = %s AND created_at > %s""",
                (monitor_id, self.clock.now() - timedelta(days=30)))
            return self._view(m, await self._versions(conn, monitor_id), (await cur.fetchone())["n"])

    async def runs(self, monitor_id: str, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            await self._row(conn, monitor_id)
            cur = await conn.execute(
                """SELECT run_id, version, world, trigger, window_since, window_until, status, findings, error, reposts,
                          created_at, finished_at, result -> 'summary' AS summary, result -> 'coverage' AS coverage,
                          result -> 'usage' AS usage
                   FROM signals.monitor_runs WHERE monitor_id = %s ORDER BY created_at DESC LIMIT %s""",
                (monitor_id, limit))
            return await cur.fetchall()

    async def findings(self, monitor_id: str, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            await self._row(conn, monitor_id)
            cur = await conn.execute(
                """SELECT * FROM signals.findings WHERE source = 'monitor' AND source_ref ->> 'monitor_id' = %s
                   ORDER BY created_at DESC LIMIT %s""", (monitor_id, limit))
            return await cur.fetchall()

    # ------------------------------------------------------------ writes

    async def unknown_exposures(self, institution_id: str, spec: MonitorSpec) -> list[str]:
        inst = build.institution(await self.institutions.state(institution_id))  # what the agent will be given
        known = {f"{prefix}:{it['id']}" for prefix, key in (
            ("product", "products"), ("segment", "segments"), ("flow", "flows"), ("rival", "rivals"),
            ("regulator", "regulators"), ("counterparty", "counterparties"), ("risk", "risks"))
            for it in inst[key]}  # fmt: skip
        return [e.id for e in spec.private.exposure if e.id not in known]

    async def _check_exposures(self, institution_id: str, spec: MonitorSpec) -> None:
        bad = await self.unknown_exposures(institution_id, spec)
        if bad:
            raise Problem(422, "invalid", f"Exposures not in the profile: {', '.join(bad)}.",
                          errors=[{"field": "spec.private.exposure", "message": f"unknown: {', '.join(bad)}"}])

    async def create(self, institution_id: str, spec: MonitorSpec, actor: str, *, origin: str = "form",
                     origin_ref: dict | None = None, drafted: list[str] | None = None, note: str | None = None) -> dict:
        await self._check_exposures(institution_id, spec)
        now = self.clock.now()
        monitor_id = f"mon-{_slug(spec.about.name)}-{uuid.uuid4().hex[:4]}"
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO core.monitors (monitor_id, institution_id, status, latest_version, origin, origin_ref,
                     drafted_fields, created_by, created_at, updated_at)
                   VALUES (%s, %s, 'draft', 1, %s, %s, %s, %s, %s, %s)""",
                (monitor_id, institution_id, origin, Jsonb(origin_ref) if origin_ref else None, drafted or [],
                 actor, now, now))
            await conn.execute(
                """INSERT INTO core.monitor_versions (monitor_id, version, spec, status, note, created_by, created_at)
                   VALUES (%s, 1, %s, 'draft', %s, %s, %s)""",
                (monitor_id, Jsonb(spec.model_dump(mode="json")), note, actor, now))
        return await self.get(monitor_id)

    async def draft(self, institution_id: str, section: str, item_id: str, actor: str) -> dict:
        state = await self.institutions.state(institution_id)
        raw, ref = templates.draft(state, section, item_id)
        # drafting the same profile item again opens the monitor that already watches it, not a second copy
        existing = next((r["monitor_id"] for r in await self.summaries(institution_id)
                         if r["origin_ref"] == ref and r["status"] != "retired"), None)
        if existing:
            return await self.get(existing)
        spec = MonitorSpec.model_validate(raw)
        return await self.create(institution_id, spec, actor, origin="profile", origin_ref=ref, drafted=templates.DRAFTED)

    async def draftable(self, institution_id: str) -> list[dict]:
        """Profile items a monitor can be drafted from; `monitor_id` when one already watches the item."""
        have = {(r["origin_ref"]["section"], r["origin_ref"]["item_id"]): r["monitor_id"]
                for r in await self.summaries(institution_id) if r["origin_ref"] and r["status"] != "retired"}
        return [{**i, "monitor_id": have.get((i["section"], i["item_id"]))}
                for i in templates.draftable(await self.institutions.state(institution_id))]

    async def template(self, institution_id: str, section: str, item_id: str) -> dict:
        """Code's draft for a profile item, without saving anything (the setup agent's tool)."""
        if section not in templates.SECTIONS:
            raise Problem(422, "validation_error", f"Monitors are drafted from {', '.join(templates.SECTIONS)}.")
        spec, ref = templates.draft(await self.institutions.state(institution_id), section, item_id)
        existing = next((r["monitor_id"] for r in await self.summaries(institution_id)
                         if r["origin_ref"] == ref and r["status"] != "retired"), None)
        return {"spec": MonitorSpec.model_validate(spec).model_dump(mode="json"), "origin_ref": ref,
                "drafted_fields": templates.DRAFTED, "monitor_id": existing}

    async def summaries(self, institution_id: str) -> list[dict]:
        """The institution's monitors in brief (the setup agent's context; duplicate checks)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT m.monitor_id, m.status, m.origin, m.origin_ref, m.live_version, m.latest_version,
                          v.spec -> 'about' ->> 'name' AS name, v.spec -> 'public' ->> 'in_one_sentence' AS sentence,
                          v.status AS latest_status
                   FROM core.monitors m JOIN core.monitor_versions v
                     ON v.monitor_id = m.monitor_id AND v.version = m.latest_version
                   WHERE m.institution_id = %s ORDER BY m.created_at""", (institution_id,))
            return await cur.fetchall()

    async def latest_spec(self, monitor_id: str) -> tuple[dict, dict]:
        """(monitor row, its latest version's spec)."""
        async with self.pool.connection() as conn:
            m = await self._row(conn, monitor_id)
            versions = await self._versions(conn, monitor_id)
        return m, versions[m["latest_version"]]["spec"]

    async def update(self, monitor_id: str, spec: MonitorSpec, actor: str, note: str | None) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            m = await self._row(conn, monitor_id, lock=True)
            if m["status"] == "retired":
                raise Problem(409, "monitor_retired", "A retired monitor can't change.")
            await self._check_exposures(m["institution_id"], spec)
            versions = await self._versions(conn, monitor_id)
            latest = versions[m["latest_version"]]
            if spec.model_dump(mode="json") == latest["spec"] and not note:  # nothing changed: no new version
                return await self.get(monitor_id)
            if latest["status"] == "draft":  # edit the draft in place
                await conn.execute(
                    "UPDATE core.monitor_versions SET spec = %s, note = coalesce(%s, note) WHERE monitor_id = %s AND version = %s",
                    (Jsonb(spec.model_dump(mode="json")), note, monitor_id, latest["version"]))
            else:  # submitted or approved: the change is the next version, a draft
                v = m["latest_version"] + 1
                await conn.execute(
                    """INSERT INTO core.monitor_versions (monitor_id, version, spec, status, note, created_by, created_at)
                       VALUES (%s, %s, %s, 'draft', %s, %s, %s)""",
                    (monitor_id, v, Jsonb(spec.model_dump(mode="json")), note, actor, now))
                if latest["status"] == "submitted":  # withdrawn by the change
                    await conn.execute("UPDATE core.monitor_versions SET status = 'superseded' WHERE monitor_id = %s "
                                       "AND version = %s", (monitor_id, latest["version"]))
                await conn.execute("UPDATE core.monitors SET latest_version = %s WHERE monitor_id = %s", (v, monitor_id))
            status = m["status"] if m["status"] in ("live", "paused") else "draft"
            await conn.execute("UPDATE core.monitors SET status = %s, drafted_fields = '{}', updated_at = %s "
                               "WHERE monitor_id = %s", (status, now, monitor_id))
        return await self.get(monitor_id)

    async def transition(self, monitor_id: str, action: str, actor: str, note: str | None = None) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            m = await self._row(conn, monitor_id, lock=True)
            versions = await self._versions(conn, monitor_id)
            latest = versions[m["latest_version"]]
            st = m["status"]
            if st == "retired":
                raise Problem(409, "monitor_retired", "A retired monitor can't change.")

            def bad(why: str):
                return Problem(409, "invalid_transition", why, monitor_status=st, latest_version_status=latest["status"])

            if action == "submit":
                if latest["status"] != "draft":
                    raise bad("Only a draft version can be submitted.")
                await conn.execute(
                    """UPDATE core.monitor_versions SET status = 'submitted', submitted_by = %s, submitted_at = %s
                       WHERE monitor_id = %s AND version = %s""", (actor, now, monitor_id, latest["version"]))
                if st == "draft":
                    st = "submitted"
            elif action in ("approve", "request_changes"):
                if latest["status"] != "submitted":
                    raise bad("Only a submitted version can be approved or sent back.")
                if action == "request_changes":
                    await conn.execute("UPDATE core.monitor_versions SET status = 'draft', note = %s WHERE monitor_id = %s "
                                       "AND version = %s", (note, monitor_id, latest["version"]))
                    if st == "submitted":
                        st = "draft"
                else:
                    if st in ("draft", "submitted"):
                        await self._live_limit(conn)
                    await conn.execute("UPDATE core.monitor_versions SET status = 'superseded' WHERE monitor_id = %s "
                                       "AND status = 'approved'", (monitor_id,))
                    await conn.execute(
                        """UPDATE core.monitor_versions SET status = 'approved', approved_by = %s, approved_at = %s
                           WHERE monitor_id = %s AND version = %s""", (actor, now, monitor_id, latest["version"]))
                    await conn.execute("UPDATE core.monitors SET live_version = %s WHERE monitor_id = %s",
                                       (latest["version"], monitor_id))
                    if st != "paused":
                        st = "live"
                        await conn.execute("UPDATE core.monitors SET next_check_at = %s WHERE monitor_id = %s",
                                           (now, monitor_id))
            elif action == "pause":
                if st != "live":
                    raise bad("Only a live monitor can be paused.")
                st = "paused"
            elif action == "resume":
                if st != "paused":
                    raise bad("Only a paused monitor can be resumed.")
                await self._live_limit(conn)
                st = "live"
                await conn.execute("UPDATE core.monitors SET next_check_at = %s WHERE monitor_id = %s", (now, monitor_id))
            elif action == "retire":
                st = "retired"
            else:
                raise Problem(404, "not_found", f"No action {action}.")
            await conn.execute("UPDATE core.monitors SET status = %s, updated_at = %s WHERE monitor_id = %s",
                               (st, now, monitor_id))
        return await self.get(monitor_id)

    async def _live_limit(self, conn) -> None:
        cur = await conn.execute("SELECT count(*) AS n FROM core.monitors WHERE status = 'live'")
        mx = settings.integer("MONITORS_LIVE_MAX")
        if (await cur.fetchone())["n"] >= mx:
            raise Problem(409, "monitor_limit_reached",
                          f"This installation runs at most {mx} live monitors (MONITORS_LIVE_MAX). Pause or retire one.")

    # ------------------------------------------------------------ checks

    async def status(self) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT count(*) FILTER (WHERE status = 'live') AS live,
                          min(next_check_at) FILTER (WHERE status = 'live') AS next_check_at FROM core.monitors""")
            m = await cur.fetchone()
            cur = await conn.execute("SELECT count(*) AS n FROM signals.monitor_runs WHERE status = 'running'")
            running = (await cur.fetchone())["n"]
        return {"connected": self.client.connected(), "agent_url": self.client.url or None, "live": m["live"],
                "live_max": settings.integer("MONITORS_LIVE_MAX"), "next_check_at": m["next_check_at"],
                "running": running, "min_frequency_minutes": settings.integer("MONITOR_MIN_FREQUENCY_MINUTES"),
                "web_queries_per_check": settings.integer("MONITOR_WEB_QUERIES_PER_CHECK"),
                "notes": [] if self.client.connected() else
                ["The monitor agent isn't connected (MONITOR_URL); live monitors aren't checked."]}

    async def run_due(self) -> dict:
        step = {"step": "monitors", "started": 0, "done": 0, "failed": 0, "findings": 0, "skipped": []}
        if not self.client.connected():
            step["skipped"].append("MONITOR_URL is not set")
            return step
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT run_id FROM signals.monitor_runs WHERE status = 'running' AND next_poll_at <= %s ORDER BY created_at",
                (self.clock.now(),))
            due_runs = [r["run_id"] for r in await cur.fetchall()]
        for run_id in due_runs:
            await self.collect(run_id, step)
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT monitor_id FROM core.monitors m WHERE status = 'live' AND next_check_at <= %s
                   AND NOT EXISTS (SELECT 1 FROM signals.monitor_runs r WHERE r.monitor_id = m.monitor_id
                                   AND r.status = 'running')
                   ORDER BY next_check_at LIMIT %s""",
                (self.clock.now(), settings.integer("MONITOR_CHECKS_PER_TICK")))
            due = [r["monitor_id"] for r in await cur.fetchall()]
        for monitor_id in due:
            await self._start(monitor_id, "tick", step)
        return step

    async def run_now(self, monitor_id: str, actor: str) -> dict:
        if not self.client.connected():
            raise Problem(503, "monitor_not_connected", "The monitor agent isn't connected (MONITOR_URL is not set).")
        async with self.pool.connection() as conn:
            m = await self._row(conn, monitor_id)
            cur = await conn.execute("SELECT 1 FROM signals.monitor_runs WHERE monitor_id = %s AND status = 'running'",
                                     (monitor_id,))
            if await cur.fetchone():
                raise Problem(409, "check_running", "A check of this monitor is running; it is collected on the next tick.")
        if m["status"] == "retired":
            raise Problem(409, "monitor_retired", "A retired monitor isn't checked.")
        step = {"skipped": []}
        run_id = await self._start(monitor_id, "now" if m["status"] == "live" else "test", step)
        if not run_id:
            raise Problem(409, "not_started", "; ".join(step["skipped"]) or "The check couldn't start.")
        return await self.check(run_id)

    async def run(self, run_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM signals.monitor_runs WHERE run_id = %s", (run_id,))
            row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No check {run_id}.")
        return row

    async def check(self, run_id: str) -> dict:
        """A check; a running one is asked for its status first (Run now is collected without waiting for the tick)."""
        row = await self.run(run_id)
        if row["status"] == "running" and self.client.connected():
            return await self.collect(run_id)
        return row

    async def _start(self, monitor_id: str, trigger: str, step: dict) -> str | None:
        """Starts a check: the live version on the tick and Run now; the latest version as a test."""
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            m = await self._row(conn, monitor_id, lock=True)
            versions = await self._versions(conn, monitor_id)
            version = m["latest_version"] if trigger == "test" else m["live_version"]
            spec = versions[version]["spec"]
            world = "sandbox" if trigger == "test" else "live"
            cur = await conn.execute(
                """SELECT max(window_until) AS until FROM signals.monitor_runs WHERE monitor_id = %s AND world = %s
                   AND status IN ('completed', 'stopped_early')""", (monitor_id, world))
            last = (await cur.fetchone())["until"]
            freq = timedelta(minutes=spec["about"]["check_frequency"])
            back = timedelta(hours=settings.integer("MONITOR_FIRST_LOOKBACK_HOURS"))
            # a newly approved monitor's first check reads the last day, so it reports what is already out there;
            # a test of a draft reads one period (it is quick and cheap)
            first = now - (back if world == "live" else min(max(freq, timedelta(hours=1)), back))
            since = max(last, now - timedelta(hours=settings.integer("MONITOR_FIRST_LOOKBACK_HOURS"))) if last else first
            since = min(since, now - timedelta(minutes=15))  # Run now right after a check: a short window still
            cur = await conn.execute(
                """SELECT DISTINCT h ->> 'url' AS url FROM signals.findings f,
                     jsonb_array_elements(f.evidence -> 'headlines') h
                   WHERE f.source = 'monitor' AND f.source_ref ->> 'monitor_id' = %s AND f.created_at > %s
                   AND f.world = %s AND h ->> 'url' IS NOT NULL""",
                (monitor_id, now - timedelta(days=settings.integer("MONITOR_RECENT_DAYS")), world))
            recent = [r["url"] for r in await cur.fetchall()]
            try:
                state = await self.institutions.state(m["institution_id"])
            except Problem:
                step["skipped"].append(f"no profile for institution {m['institution_id']}")
                return None
            run_id = f"chk-{now:%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"
            req = build.build(run_id, monitor_id, version, spec, state, since, now, recent)
            await conn.execute(
                """INSERT INTO signals.monitor_runs (run_id, monitor_id, version, institution_id, world, trigger,
                     window_since, window_until, status, request, created_at, next_poll_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'running', %s, %s, %s)""",
                (run_id, monitor_id, version, m["institution_id"], world, trigger, since, now, Jsonb(req), now, now))
            if trigger != "test":
                await conn.execute("UPDATE core.monitors SET next_check_at = %s WHERE monitor_id = %s",
                                   (now + freq, monitor_id))
        try:
            st = await self.client.start(req)
        except AgentError as e:
            await self._failed(run_id, f"the agent refused or couldn't take the check: {e}", step)
            return run_id
        step["started"] = step.get("started", 0) + 1
        if st.get("status") in (*FINISHED, "failed"):
            await self._finish(run_id, st, step)
        return run_id

    async def collect(self, run_id: str, step: dict | None = None) -> dict:
        step = step if step is not None else {}
        try:
            st = await self.client.status(run_id)
        except AgentError as e:
            if e.retry and "HTTP 404" not in str(e):
                return await self.run(run_id)  # unreachable: the next tick
            if "HTTP 404" in str(e) and await self._repost(run_id):
                return await self.run(run_id)
            await self._failed(run_id, f"the agent lost the check: {e}", step)
            return await self.run(run_id)
        if st.get("status") not in ("queued", "running"):
            await self._finish(run_id, st, step)
        return await self.run(run_id)

    async def _repost(self, run_id: str) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE signals.monitor_runs SET reposts = reposts + 1 WHERE run_id = %s AND status = 'running'
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
        log.warning("monitor check %s failed: %s", run_id, error[:500])
        now = self.clock.now()
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE signals.monitor_runs SET status = 'failed', error = %s, finished_at = %s, next_poll_at = NULL
                   WHERE run_id = %s AND status = 'running' RETURNING monitor_id, trigger""", (error[:2000], now, run_id))
            row = await cur.fetchone()
            if row and row["trigger"] != "test":
                # a failed check read nothing and didn't advance its window: retry soon, not after a whole day
                await conn.execute(
                    """UPDATE core.monitors SET last_check_at = %s, last_check_status = 'error', last_check_findings = 0,
                         next_check_at = LEAST(next_check_at, %s) WHERE monitor_id = %s""",
                    (now, now + timedelta(minutes=settings.integer("MONITOR_RETRY_MINUTES")), row["monitor_id"]))
        step["failed"] = step.get("failed", 0) + 1

    async def _finish(self, run_id: str, st: dict, step: dict) -> None:
        if st.get("status") == "failed":
            await self._failed(run_id, st.get("error") or "the check failed", step)
            return
        result = st["result"]
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT * FROM signals.monitor_runs WHERE run_id = %s FOR UPDATE", (run_id,))
            run = await cur.fetchone()
            if not run or run["status"] != "running":
                return
            n = await write_findings(conn, result, run["request"]["monitor"]["spec"], run_id=run_id,
                                     monitor_id=run["monitor_id"], version=run["version"], world=run["world"],
                                     institution_id=run["institution_id"], now=now)
            await conn.execute(
                """UPDATE signals.monitor_runs SET status = %s, result = %s, findings = %s, finished_at = %s,
                     next_poll_at = NULL WHERE run_id = %s""", (st["status"], Jsonb(result), n, now, run_id))
            if run["trigger"] != "test":
                await conn.execute(
                    """UPDATE core.monitors SET last_check_at = %s, last_check_status = %s, last_check_findings = %s
                       WHERE monitor_id = %s""", (now, "fired" if n else "quiet", n, run["monitor_id"]))
        step["done"] = step.get("done", 0) + 1
        step["findings"] = step.get("findings", 0) + n


async def write_findings(conn, result: dict, spec: dict, *, run_id: str, monitor_id: str, version: int, world: str,
                         institution_id: str, now: datetime) -> int:
    """A check's findings as shared Findings: one per finding that cites a source the
    agent read. Also used by the Scenario Studio's checks. Returns how many were written."""
    sources = {s["ref"]: s for s in result.get("sources", [])}
    lines = spec["public"]["tell_me_if"]
    n = 0
    for i, f in enumerate(result["findings"], start=1):
        cited = [sources[r] for r in [*(w["url"] for w in f["evidence"].get("web", [])),
                                      *(h["item_id"] for h in f["evidence"].get("news", []))] if r in sources]
        if not cited:
            continue
        n += 1
        score = min(100, spec["alert_level"] * 10 + (10 if len({c.get("outlet") for c in cited}) >= 2 else 0))
        await conn.execute(
            """INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title,
                 explanation, score, themes, effective_from, period, places, evidence, created_at)
               VALUES (%s, %s, %s, 'monitor', %s, 'news_match', %s, %s, %s, '[]', %s, NULL, %s, %s, %s)
               ON CONFLICT (finding_id) DO NOTHING""",
            (f"f-mon-{run_id.removeprefix('chk-')}-{i}", world, institution_id,
             Jsonb({"monitor_id": monitor_id, "monitor_version": version, "check_run_id": run_id,
                    "lines": f["tell_me_if_lines"],
                    "line_texts": [lines[x - 1] for x in f["tell_me_if_lines"] if 0 < x <= len(lines)]}),
             f["title"], f["explanation"], score, f.get("key_date"), f.get("places") or [],
             Jsonb({"signals": [], "headlines": [
                 {"title": c["title"], "url": c.get("url"), "outlet": c.get("outlet"),
                  "published_at": c["published_at"]} for c in cited if c.get("published_at")],
                 "web": [{"url": c["url"], "title": c["title"]} for c in cited
                         if not c.get("published_at") and c.get("url")]}),
             now))  # fmt: skip
    return n
