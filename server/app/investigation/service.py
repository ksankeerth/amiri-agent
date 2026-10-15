"""Findings -> investigation runs -> events, hypotheses and tasks.

The tick step (`run_due`):
  1. collects running runs (GET /investigations/{run_id}) and stores what they found;
  2. starts new runs: per institution and world, the new findings whose oldest one has
     waited INVESTIGATION_WAIT_MINUTES (related findings arrive together), at most 20.
"Investigate now" (`start_now`) skips the wait. A run that fails is retried with its
findings up to INVESTIGATION_MAX_ATTEMPTS; then they are set aside with the error.

Before either, a new finding whose lead theme (theme, direction, and the currency or item)
matches an open event of the same institution and world joins that event as a
development: the story continues, nothing new to investigate. Events
stay open EVENT_OPEN_DAYS after their last finding, then close.

Worlds: an instance acts only on its own worlds. The tick's covers `live` and `sandbox`
(quick tests); the Scenario Studio builds one per step for `studio` with the simulation's
virtual clock, which also sends `as_of`, names its runs predictably and collects every
running run (its clock doesn't move while it waits).
"""

import json
import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import settings
from app.alerts import service as alerts
from app.clock import Clock
from app.institutions.service import Institutions
from app.investigation import request as build
from app.investigation.client import AgentError, InvestigationClient
from app.investigation.tone import tone
from app.problems import Problem
from app.text import plural

log = logging.getLogger("amiri.investigation")


def _lead(theme: dict) -> dict:
    """What makes two findings the same move: the theme, its direction and its currency or item (no empty keys)."""
    return {k: v for k, v in theme.items() if k in ("theme", "direction", "currency", "item") and v not in (None, "", "none")}


async def _add_themes(conn, event_id: str, themes: list[dict]) -> None:
    """Themes a development brings that the event doesn't have yet: the event covers them from now on."""
    cur = await conn.execute("SELECT themes FROM cases.events WHERE event_id = %s", (event_id,))
    row = await cur.fetchone()
    if not row:
        return
    have = {(t["theme"], t["direction"]) for t in row["themes"]}
    new = [t for t in themes if (t["theme"], t["direction"]) not in have]
    if new:
        await conn.execute("UPDATE cases.events SET themes = themes || %s WHERE event_id = %s", (Jsonb(new), event_id))

MAX_FINDINGS = 20
MAX_REPOSTS = 3
FINISHED = ("completed", "stopped_early")
TICK_WORLDS = ("live", "sandbox")


def _short(run_id: str) -> str:
    return run_id.removeprefix("inv-")


class Investigations:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, client: InvestigationClient,
                 clock: Clock, *, worlds: tuple[str, ...] = TICK_WORLDS, run_ids: Callable[[], str] | None = None,
                 as_of: bool = False, poll_all: bool = False, max_attempts: int | None = None):
        self.pool, self.institutions, self.client, self.clock = pool, institutions, client, clock
        self.worlds = list(worlds)
        self._run_ids, self.as_of, self.poll_all = run_ids, as_of, poll_all
        self.max_attempts = max_attempts

    def _run_id(self) -> str:
        return self._run_ids() if self._run_ids else f"inv-{self.clock.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:4]}"

    def _request(self, run_id: str, ctx: dict, rows: list[dict], validation: bool) -> dict:
        req = build.build(run_id, ctx, rows, validation)
        if self.as_of:
            req["as_of"] = self.clock.now().isoformat()
        return req

    # ------------------------------------------------------------ status

    async def status(self) -> dict:
        async with self.pool.connection() as conn:
            iid = settings.raw("INSTITUTION_ID")
            cur = await conn.execute(
                """SELECT count(*) FILTER (WHERE institution_id = %s) AS waiting,
                          min(created_at) FILTER (WHERE institution_id = %s) AS oldest,
                          count(*) FILTER (WHERE institution_id <> %s) AS stranded,
                          array_agg(DISTINCT institution_id) FILTER (WHERE institution_id <> %s) AS others
                   FROM signals.findings WHERE status = 'new' AND world = ANY(%s)""", (iid, iid, iid, iid, self.worlds))
            f = await cur.fetchone()
            cur = await conn.execute("SELECT count(*) AS n FROM cases.investigations WHERE status = 'running' "
                                     "AND world = ANY(%s)", (self.worlds,))
            running = (await cur.fetchone())["n"]
        wait = settings.integer("INVESTIGATION_WAIT_MINUTES")
        return {
            "connected": self.client.connected(), "agent_url": self.client.url or None,
            "validation": settings.raw("METRICS_VALIDATION") == "on", "wait_minutes": wait,
            "findings_waiting": f["waiting"], "oldest_waiting_since": f["oldest"],
            "next_batch_at": f["oldest"] + timedelta(minutes=wait) if f["oldest"] else None,
            "runs_running": running,
            "notes": ([] if self.client.connected() else
                      ["The investigation agent isn't connected (INVESTIGATION_URL); new findings wait."])
                     + ([] if settings.raw("METRICS_VALIDATION") == "on" else
                        ["Metrics validation is off: investigations stop at a readable report, with no validation tasks."])
                     + ([f"{plural(f['stranded'], 'finding')} were written for {', '.join(f['others'])}, not this installation's "
                         f"institution ({iid}); they wait until a profile with that id exists."] if f["stranded"] else []),
        }

    # ------------------------------------------------------------ the tick step

    async def run_due(self) -> dict:
        step = {"step": "investigate", "claimed": 0, "done": 0, "failed": 0, "skipped": []}
        if not self.client.connected():
            step["skipped"].append("INVESTIGATION_URL is not set")
            step["developments"] = len(await self._attach_developments(None))
            step["closed"] = await self._close_events()
            return step
        await self._collect_due(step)
        step["developments"] = len(await self._attach_developments(None))
        step["closed"] = await self._close_events()
        now = self.clock.now()
        cutoff = now - timedelta(minutes=settings.integer("INVESTIGATION_WAIT_MINUTES"))
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT institution_id, world FROM signals.findings WHERE status = 'new' AND world = ANY(%s)
                   GROUP BY institution_id, world HAVING min(created_at) <= %s""", (self.worlds, cutoff))
            groups = await cur.fetchall()
        for g in groups:
            run = await self._start(g["institution_id"], g["world"], None, "tick", step)
            if run:
                step["claimed"] += len(run["finding_ids"])
        return step

    async def start_now(self, finding_ids: list[str] | None, world: str | None) -> dict:
        developments = await self._attach_developments(finding_ids)
        if not self.client.connected():
            if developments:
                return {"items": [], "developments": developments}
            raise Problem(503, "investigation_not_connected",
                          "The investigation agent isn't connected (INVESTIGATION_URL is not set).")
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT DISTINCT institution_id, world FROM signals.findings WHERE status = 'new'
                   AND (%s::text[] IS NULL OR finding_id = ANY(%s)) AND (%s::text IS NULL OR world = %s)
                   AND world = ANY(%s)""",
                (finding_ids, finding_ids, world, world, self.worlds))
            groups = await cur.fetchall()
        if not groups:
            if developments:
                return {"items": [], "developments": developments}
            raise Problem(409, "nothing_to_investigate",
                          "No new findings to investigate" + (" among those given." if finding_ids else "."))
        step = {"skipped": []}
        runs = [r for g in groups if (r := await self._start(g["institution_id"], g["world"], finding_ids, "now", step))]
        if not runs and not developments:
            raise Problem(409, "not_started", "; ".join(step["skipped"]) or "No run could be started.")
        return {"items": [await self.run(r["run_id"]) for r in runs], "developments": developments}

    async def _attach_developments(self, only: list[str] | None) -> list[dict]:
        """New findings that continue an open event's move join it (no new run)."""
        now = self.clock.now()
        joined, extend = [], []
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                """SELECT * FROM signals.findings WHERE status = 'new' AND jsonb_array_length(themes) > 0
                   AND world = ANY(%s) AND (%s::text[] IS NULL OR finding_id = ANY(%s))
                   ORDER BY created_at FOR UPDATE SKIP LOCKED""",
                (self.worlds, only, only))
            for f in await cur.fetchall():
                lead = _lead(f["themes"][0])
                cur2 = await conn.execute(
                    """SELECT event_id, title, themes FROM cases.events WHERE institution_id = %s AND world = %s
                       AND status = 'open' AND open_until >= %s AND themes @> %s ORDER BY anchor DESC LIMIT 1""",
                    (f["institution_id"], f["world"], now, Jsonb([lead])))
                e = await cur2.fetchone()
                if not e:
                    continue
                what = " ".join(x for x in (lead["theme"], lead.get("currency") or lead.get("item"), lead["direction"]) if x)
                reason = f"the same move as the open event ({what.replace('_', ' ')})"
                await conn.execute(
                    """INSERT INTO cases.event_developments (finding_id, event_id, joined_at, linked_by, reason)
                       VALUES (%s, %s, %s, 'rule', %s)""", (f["finding_id"], e["event_id"], now, reason))
                await conn.execute(
                    "UPDATE signals.findings SET status = 'linked', outcome = %s WHERE finding_id = %s",
                    (Jsonb({"event_id": e["event_id"], "development": True}), f["finding_id"]))
                await conn.execute("UPDATE cases.events SET open_until = %s WHERE event_id = %s",
                                   (now + timedelta(days=settings.integer("EVENT_OPEN_DAYS")), e["event_id"]))
                await alerts.sync(conn, e["event_id"], now, "a later finding joined the event")
                joined.append({"finding_id": f["finding_id"], "event_id": e["event_id"], "event_title": e["title"]})
                have = {(t["theme"], t["direction"]) for t in e["themes"]}
                new = [t for t in f["themes"][1:] if (t["theme"], t["direction"]) not in have]
                if new:
                    await _add_themes(conn, e["event_id"], new)  # the event now covers them (and later findings match)
                    extend.append((e["event_id"], f, new))
        for event_id, f, new in extend:
            if self.client.connected():
                await self._start_extend(event_id, f, new)
        return joined

    async def _start_extend(self, event_id: str, row: dict, themes: list[dict]) -> None:
        """A development with themes the event doesn't have: hypotheses for those only."""
        try:
            ctx = await self.institutions.context(row["institution_id"])
        except Problem:
            return
        now = self.clock.now()
        run_id = self._run_id()
        validation = settings.raw("METRICS_VALIDATION") == "on"
        req = {**self._request(run_id, ctx, [row], validation), "extend": {"event_id": event_id, "themes": themes}}
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO cases.investigations (run_id, institution_id, world, status, trigger, finding_ids,
                     validation, request, created_at, next_poll_at, extend_event_id)
                   VALUES (%s, %s, %s, 'running', 'extend', %s, %s, %s, %s, %s, %s)""",
                (run_id, row["institution_id"], row["world"], [row["finding_id"]], validation, Jsonb(req), now, now,
                 event_id))
        try:
            await self.client.start(req)
        except AgentError as e:
            await self._failed(run_id, f"the agent refused or couldn't take the run: {e}", {}, retry=False)

    async def _close_events(self) -> int:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE cases.events SET status = 'closed', closed_at = %s
                   WHERE status = 'open' AND open_until < %s AND world = ANY(%s) RETURNING event_id""",
                (self.clock.now(), self.clock.now(), self.worlds))
            closed = [r["event_id"] for r in await cur.fetchall()]
            await alerts.resolve_events(conn, closed, self.clock.now())
            return len(closed)

    async def clear_sandbox(self) -> dict:
        """Removes simulated findings and what their investigations found; live data stays."""
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("DELETE FROM cases.investigations WHERE world = 'sandbox' RETURNING run_id")
            runs = len(await cur.fetchall())
            cur = await conn.execute("DELETE FROM signals.findings WHERE world = 'sandbox' RETURNING finding_id")
            findings = len(await cur.fetchall())
            await conn.execute("DELETE FROM signals.monitor_runs WHERE world = 'sandbox'")
        return {"findings": findings, "investigations": runs}

    async def _start(self, institution_id: str, world: str, only: list[str] | None, trigger: str, step: dict) -> dict | None:
        try:
            ctx = await self.institutions.context(institution_id)
        except Problem:
            step["skipped"].append(f"no profile for institution {institution_id} (set INSTITUTION_ID)")
            return None
        now = self.clock.now()
        run_id = self._run_id()
        validation = settings.raw("METRICS_VALIDATION") == "on"
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                """SELECT * FROM signals.findings WHERE status = 'new' AND institution_id = %s AND world = %s
                   AND (%s::text[] IS NULL OR finding_id = ANY(%s))
                   ORDER BY created_at LIMIT %s FOR UPDATE SKIP LOCKED""",
                (institution_id, world, only, only, MAX_FINDINGS))
            rows = await cur.fetchall()
            if not rows:
                return None
            req = self._request(run_id, ctx, rows, validation)
            attempt = 1 + max((r["outcome"] or {}).get("attempts", 0) for r in rows)
            await conn.execute(
                """INSERT INTO cases.investigations (run_id, institution_id, world, status, trigger, finding_ids,
                     validation, request, attempt, created_at, next_poll_at)
                   VALUES (%s, %s, %s, 'running', %s, %s, %s, %s, %s, %s, %s)""",
                (run_id, institution_id, world, trigger, [r["finding_id"] for r in rows], validation, Jsonb(req),
                 attempt, now, now))
            await conn.execute("UPDATE signals.findings SET status = 'grouped', run_id = %s WHERE finding_id = ANY(%s)",
                               (run_id, [r["finding_id"] for r in rows]))
        try:
            st = await self.client.start(req)
        except AgentError as e:
            await self._failed(run_id, f"the agent refused or couldn't take the run: {e}", step, retry=e.retry)
            return {"run_id": run_id, "finding_ids": [r["finding_id"] for r in rows]}
        if st.get("status") in FINISHED or st.get("status") == "failed":
            await self._finish(run_id, st, step)
        return {"run_id": run_id, "finding_ids": [r["finding_id"] for r in rows]}

    async def _collect_due(self, step: dict) -> None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT run_id FROM cases.investigations WHERE status = 'running' AND world = ANY(%s)
                   AND (%s OR next_poll_at <= %s) ORDER BY created_at""", (self.worlds, self.poll_all, self.clock.now()))
            due = [r["run_id"] for r in await cur.fetchall()]
        for run_id in due:
            await self.collect(run_id, step)

    async def collect(self, run_id: str, step: dict | None = None) -> None:
        step = step if step is not None else {"done": 0, "failed": 0}
        try:
            st = await self.client.status(run_id)
        except AgentError as e:
            if e.retry and "HTTP 404" not in str(e):
                return  # unreachable: try again on the next tick
            if "HTTP 404" in str(e) and await self._repost(run_id):
                return  # sent again (the agent restarted, or another instance answered): collect next tick
            await self._failed(run_id, f"the agent lost the run: {e}", step, retry=True)
            return
        if st.get("status") in ("queued", "running"):
            return
        await self._finish(run_id, st, step)

    async def _repost(self, run_id: str) -> bool:
        """Sends a lost run's request again (same run_id: the agent starts it, or answers with it)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE cases.investigations SET reposts = reposts + 1 WHERE run_id = %s AND status = 'running'
                   AND reposts < %s RETURNING request""", (run_id, MAX_REPOSTS))
            row = await cur.fetchone()
        if not row:
            return False
        try:
            await self.client.start(row["request"])
        except AgentError:
            return False
        return True

    async def _finish(self, run_id: str, st: dict, step: dict) -> None:
        if st.get("status") == "failed":
            await self._failed(run_id, st.get("error") or "the run failed", step, retry=True)
            return
        result = st["result"]
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT * FROM cases.investigations WHERE run_id = %s FOR UPDATE", (run_id,))
            run = await cur.fetchone()
            if not run or run["status"] != "running":
                return
            await self._store(conn, run, result, now)
            await conn.execute(
                """UPDATE cases.investigations SET status = %s, result = %s, report = %s, finished_at = %s,
                     next_poll_at = NULL WHERE run_id = %s""",
                (st["status"], Jsonb(result), result.get("report") or "", now, run_id))
        step["done"] = step.get("done", 0) + 1

    async def _open_event_for(self, conn, run: dict, themes: list[dict], now: datetime) -> dict | None:
        """An open event of the same institution and world whose themes hold this lead theme."""
        if not themes:
            return None
        lead = _lead(themes[0])
        cur = await conn.execute(
            """SELECT event_id, title FROM cases.events WHERE institution_id = %s AND world = %s AND status = 'open'
               AND open_until >= %s AND themes @> %s AND run_id <> %s ORDER BY anchor DESC LIMIT 1""",
            (run["institution_id"], run["world"], now, Jsonb([lead]), run["run_id"]))
        return await cur.fetchone()

    async def _store(self, conn, run: dict, result: dict, now: datetime) -> None:
        s = _short(run["run_id"])
        extend = run.get("extend_event_id")
        ev = {e["event_id"]: (extend if extend else f"ev-{s}-{e['event_id'].removeprefix('e-')}") for e in result["events"]}
        # A finding the server couldn't match by theme (a monitor's or Radar's, classified by the agent) may
        # turn out to be the same move as an open event: it joins that event as a development, and the
        # run's duplicate event and its hypotheses are dropped (the open event already has them).
        joined: dict[str, dict] = {}
        first_of: dict[str, dict] = {}  # one event per lead theme in a run: a second with the same lead joins the first
        for e in ([] if extend else result["events"]):
            key = json.dumps(_lead(e["themes"][0]), sort_keys=True) if e["themes"] else e["event_id"]
            if key in first_of:
                joined[e["event_id"]] = {"event_id": ev[first_of[key]["event_id"]], "title": first_of[key].get("title")}
                ev[e["event_id"]] = ev[first_of[key]["event_id"]]
                first_of[key]["finding_ids"] = list(dict.fromkeys(first_of[key]["finding_ids"] + e["finding_ids"]))
                continue
            first_of[key] = e
            if (o := await self._open_event_for(conn, run, e["themes"], now)) is not None:
                joined[e["event_id"]] = o
                ev[e["event_id"]] = o["event_id"]
                t = e["themes"][0]
                what = " ".join(x for x in (t["theme"], t.get("currency") or t.get("item"), t["direction"]) if x)
                for f in e["finding_ids"]:
                    await conn.execute(
                        """INSERT INTO cases.event_developments (finding_id, event_id, joined_at, linked_by, reason)
                           VALUES (%s, %s, %s, 'rule', %s) ON CONFLICT (finding_id) DO NOTHING""",
                        (f, o["event_id"], now, f"classified as the same move as the open event ({what.replace('_', ' ')})"))
                await conn.execute("UPDATE cases.events SET open_until = %s WHERE event_id = %s",
                                   (now + timedelta(days=settings.integer("EVENT_OPEN_DAYS")), o["event_id"]))
                await _add_themes(conn, o["event_id"], e["themes"][1:])
        every_event = result["events"]
        result = {**result, "events": [e for e in every_event if e["event_id"] not in joined],
                  "hypotheses": [h for h in result["hypotheses"] if h["event_id"] not in joined],
                  "tasks": [t for t in result["tasks"] if t["event_id"] not in joined]}
        hy = {h["hypothesis_id"]: f"hy-{s}-{h['hypothesis_id'].removeprefix('h-')}" for h in result["hypotheses"]}
        tk = {t["task_id"]: f"vt-{s}-{t['task_id'].removeprefix('t-')}" for t in result["tasks"]}
        task_of = {t["hypothesis_id"]: tk[t["task_id"]] for t in result["tasks"]}
        for e in ([] if extend else result["events"]):
            await conn.execute(
                """INSERT INTO cases.events (event_id, run_id, institution_id, world, title, themes, country,
                     country_code, anchor, anchor_basis, size, places, regions, finding_ids, created_at, open_until)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (ev[e["event_id"]], run["run_id"], run["institution_id"], run["world"],
                 e.get("title") or ", ".join(f"{t['theme']} {t['direction']}" for t in e["themes"]),
                 Jsonb(e["themes"]), e["country"], e.get("country_code"), e["anchor"], e["anchor_basis"],
                 Jsonb(e["size"]) if e.get("size") else None, e.get("places", []), e.get("regions", []),
                 e["finding_ids"], now, now + timedelta(days=settings.integer("EVENT_OPEN_DAYS"))))
        for h in result["hypotheses"]:
            await conn.execute(
                """INSERT INTO cases.hypotheses (hypothesis_id, event_id, run_id, product_id, product_type, angle,
                     mechanism_id, chain_label, statement, segment, expected, task_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (hy[h["hypothesis_id"]], ev[h["event_id"]], run["run_id"], h["product_id"], h["product_type"],
                 h["angle"], h["mechanism_id"], h["chain_label"], h["statement"],
                 Jsonb(h["segment"]) if h.get("segment") else None, Jsonb(h["expected"]),
                 task_of.get(h["hypothesis_id"])))
        for t in result["tasks"]:
            body = {**t, "task_id": tk[t["task_id"]], "hypothesis_id": hy[t["hypothesis_id"]], "event_id": ev[t["event_id"]]}
            await conn.execute(
                """INSERT INTO cases.validation_tasks (task_id, hypothesis_id, event_id, run_id, task, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (body["task_id"], body["hypothesis_id"], body["event_id"], run["run_id"], Jsonb(body), now))
        for eid in dict.fromkeys(ev.values()):  # the events this run made or grew: their alerts
            await alerts.sync(conn, eid, now, "the investigation added to the event" if eid in
                              {o["event_id"] for o in joined.values()} or extend else "")
        if extend:  # the development's finding is already linked to the event
            return
        # what became of each finding
        outcome: dict[str, dict] = {}
        for e in every_event:
            for f in e["finding_ids"]:
                outcome[f] = {"status": "linked", "event_id": ev[e["event_id"]],
                              **({"development": True} if e["event_id"] in joined else {})}
        for o in result["out_of_scope"]:
            if o["reason"] == "merged_into_event" and o.get("event_id") in ev:
                outcome[o["finding_id"]] = {"status": "linked", "event_id": ev[o["event_id"]]}
            elif o["finding_id"] not in outcome:
                outcome[o["finding_id"]] = {"status": "set_aside", "reason": o["reason"], "note": o.get("note")}
        for f in run["finding_ids"]:
            o = outcome.get(f)
            if o:
                await conn.execute("UPDATE signals.findings SET status = %s, outcome = %s WHERE finding_id = %s",
                                   (o.pop("status"), Jsonb(o), f))
            else:  # not reached (the run stopped early): back in the queue
                await conn.execute("UPDATE signals.findings SET status = 'new', run_id = NULL WHERE finding_id = %s", (f,))

    async def _failed(self, run_id: str, error: str, step: dict, *, retry: bool) -> None:
        log.warning("investigation %s failed%s: %s", run_id, " (will retry)" if retry else "", error[:500])
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                """UPDATE cases.investigations SET status = 'failed', error = %s, finished_at = %s, next_poll_at = NULL
                   WHERE run_id = %s AND status = 'running' RETURNING finding_ids, attempt, extend_event_id""",
                (error[:2000], now, run_id))
            run = await cur.fetchone()
            if not run:
                return
            if run["extend_event_id"]:  # its finding stays a development of the event
                step["failed"] = step.get("failed", 0) + 1
                return
            again = retry and run["attempt"] < (self.max_attempts or settings.integer("INVESTIGATION_MAX_ATTEMPTS"))
            await conn.execute(
                """UPDATE signals.findings SET status = %s, run_id = CASE WHEN %s THEN NULL ELSE run_id END,
                     outcome = %s WHERE finding_id = ANY(%s)""",
                ("new" if again else "set_aside", again,
                 Jsonb({"attempts": run["attempt"], "last_error": error[:500]} if again else
                       {"reason": "investigation_failed", "note": error[:500]}), run["finding_ids"]))
        step["failed"] = step.get("failed", 0) + 1

    # ------------------------------------------------------------ reads

    async def findings(self, status: str | None, world: str | None, source: str | None, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT * FROM signals.findings WHERE (%s::text IS NULL OR status = %s)
                   AND (CASE WHEN %s::text IS NULL THEN world <> 'studio' ELSE world = %s END)
                   AND (%s::text IS NULL OR source = %s)
                   ORDER BY created_at DESC LIMIT %s""", (status, status, world, world, source, source, limit))
            return await cur.fetchall()

    async def finding(self, finding_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM signals.findings WHERE finding_id = %s", (finding_id,))
            row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No finding {finding_id}.")
        return row

    async def runs(self, limit: int, world: str | None = None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT i.run_id, i.institution_id, i.world, i.status, i.trigger, i.finding_ids, i.validation,
                          i.error, i.attempt, i.created_at, i.finished_at,
                          (SELECT count(*) FROM cases.events e WHERE e.run_id = i.run_id) AS events,
                          (SELECT count(*) FROM cases.hypotheses h WHERE h.run_id = i.run_id) AS hypotheses,
                          (SELECT count(*) FROM cases.validation_tasks t WHERE t.run_id = i.run_id) AS tasks
                   FROM cases.investigations i WHERE (CASE WHEN %s::text IS NULL THEN i.world <> 'studio' ELSE i.world = %s END)
                   ORDER BY i.created_at DESC LIMIT %s""", (world, world, limit))
            return await cur.fetchall()

    async def run(self, run_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM cases.investigations WHERE run_id = %s", (run_id,))
            row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No investigation {run_id}.")
        return row

    async def events(self, world: str | None, limit: int, status: str | None = None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT e.*, (SELECT count(*) FROM cases.hypotheses h WHERE h.event_id = e.event_id) AS hypotheses,
                          (SELECT count(*) FROM cases.validation_tasks t WHERE t.event_id = e.event_id) AS tasks,
                          (SELECT count(*) FROM cases.event_developments d WHERE d.event_id = e.event_id) AS developments
                   FROM cases.events e WHERE (CASE WHEN %s::text IS NULL THEN e.world <> 'studio' ELSE e.world = %s END)
                   AND (%s::text IS NULL OR e.status = %s)
                   ORDER BY e.anchor DESC LIMIT %s""", (world, world, status, status, limit))
            rows = await cur.fetchall()
            cur = await conn.execute("SELECT event_id, expected FROM cases.hypotheses WHERE event_id = ANY(%s)",
                                     ([r["event_id"] for r in rows],))
            by: dict[str, list[dict]] = {}
            for h in await cur.fetchall():
                by.setdefault(h["event_id"], []).append(h)
            return [{**r, "tone": tone(by.get(r["event_id"], []))} for r in rows]

    async def event(self, event_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM cases.events WHERE event_id = %s", (event_id,))
            e = await cur.fetchone()
            if not e:
                raise Problem(404, "not_found", f"No event {event_id}.")
            cur = await conn.execute("SELECT * FROM signals.findings WHERE finding_id = ANY(%s) ORDER BY created_at",
                                     (e["finding_ids"],))
            findings = await cur.fetchall()
            cur = await conn.execute("SELECT * FROM cases.hypotheses WHERE event_id = %s ORDER BY hypothesis_id",
                                     (event_id,))
            hyps = await cur.fetchall()
            cur = await conn.execute("SELECT task FROM cases.validation_tasks WHERE event_id = %s ORDER BY task_id",
                                     (event_id,))
            tasks = [r["task"] for r in await cur.fetchall()]
            cur = await conn.execute(
                """SELECT d.finding_id, d.joined_at, d.linked_by, d.reason, f.title, f.created_at
                   FROM cases.event_developments d JOIN signals.findings f USING (finding_id)
                   WHERE d.event_id = %s ORDER BY d.joined_at""", (event_id,))
            developments = await cur.fetchall()
            cur = await conn.execute("SELECT run_id, status, validation, report, result, request FROM cases.investigations "
                                     "WHERE run_id = %s", (e["run_id"],))
            run = await cur.fetchone()
        names = {p["product_id"]: p["name"] for p in run["request"].get("products", [])}
        country_name = run["request"].get("institution", {}).get("country_name")
        result = run["result"] or {}
        agent_event = next((x for x in result.get("events", []) if x["finding_ids"] == e["finding_ids"]), None)
        aside = [s for s in result.get("screening", [])
                 if agent_event and s["event_id"] == agent_event["event_id"] and s["decision"] != "kept"]
        hyps = [{**h, "product_name": names.get(h["product_id"], h["product_id"])} for h in hyps]
        return {**e, "country_name": country_name, "findings": findings, "hypotheses": hyps, "tasks": tasks,
                "set_aside": aside, "developments": developments,
                "run": {"run_id": run["run_id"], "status": run["status"], "validation": run["validation"],
                        "report": run["report"]}}
