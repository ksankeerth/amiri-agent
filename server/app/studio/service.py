"""The Scenario Studio.

A scenario is a template (app/studio/template.py) for an institution, with an intensity and the
parts switched off. A simulation runs it in the fixed world `studio`, one at a time, on its own
virtual clock, moved by the Studio page one step (a day, at 18:00 local) at a time:

    collect the agents' runs → attach developments, close events → (wait while any run is out)
    → investigate new findings (after SIM_INVESTIGATION_WAIT_STEPS) → (wait) → advance:
    the day's headlines, its price bar and the detector, the monitor's check of the day's headlines

Agent runs are collected regardless of `next_poll_at` (the virtual clock doesn't move while it
waits) and given SIM_AGENT_DEADLINE_SECONDS of real time. Ids carry the simulation's token and
the step, so a run can be recorded and replayed by position (app/studio/record.py). The tick never
touches `studio`; a step takes the tick's lock, so the two never overlap.
"""

import itertools
import logging
import uuid
from datetime import datetime, timedelta

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import settings
from app.alerts.service import plan as alert_plan
from app.clock import Clock, FixedClock
from app.institutions.service import Institutions
from app.investigation.client import AgentError
from app.investigation.service import Investigations
from app.investigation.tone import tone
from app.monitors import request as mreq
from app.monitors.service import write_findings
from app.problems import Problem
from app.series import detect
from app.studio import prices, template
from app.studio.record import RecordClient, token
from app.tick import TICK_LOCK

log = logging.getLogger("amiri.studio")

WORLD = "studio"
ACTIVE = ("running", "waiting")
FINISHED = ("completed", "stopped_early")


def _matches(event_themes: list[dict], story_themes: list[dict]) -> bool:
    return any(all(et.get(k) == v for k, v in st.items()) for st in story_themes for et in event_themes)


class Studio:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, investigation_client, monitor_client,
                 clock: Clock):
        self.pool, self.institutions, self.clock = pool, institutions, clock
        self.inv_client, self.mon_client = investigation_client, monitor_client

    # ------------------------------------------------------------ templates and scenarios

    async def templates(self, institution_id: str) -> list[dict]:
        ctx = await self.institutions.context(institution_id)
        return [{"template_id": k, **v, "unavailable": template.available(k, ctx)} for k, v in template.TEMPLATES.items()]

    async def create_scenario(self, institution_id: str, template_id: str, intensity: str, title: str | None,
                              actor: str, custom: dict | None = None) -> dict:
        ctx = await self.institutions.context(institution_id)
        why = template.available(template_id, ctx)
        if why:
            raise Problem(422, "template_unavailable", f"This template can't run here: {why}.")
        now = self.clock.now()
        sid = f"scn-{uuid.uuid4().hex[:8]}"
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO studio.scenarios (scenario_id, institution_id, template_id, title, intensity, custom, created_by,
                     created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (sid, institution_id, template_id, title or template.TEMPLATES[template_id]["title"], intensity,
                 Jsonb(custom or {}), actor, now, now))
        return await self.scenario(sid)

    async def update_scenario(self, scenario_id: str, intensity: str | None, switched_off: list[str] | None,
                              title: str | None, custom: dict | None = None) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE studio.scenarios SET intensity = coalesce(%s, intensity),
                     switched_off = coalesce(%s, switched_off), title = coalesce(%s, title),
                     custom = CASE WHEN %s::jsonb IS NULL THEN custom ELSE custom || %s::jsonb END,
                     version = version + 1, updated_at = %s WHERE scenario_id = %s RETURNING scenario_id""",
                (intensity, switched_off, title, Jsonb(custom) if custom is not None else None,
                 Jsonb(custom) if custom is not None else None, self.clock.now(), scenario_id))
            if not await cur.fetchone():
                raise Problem(404, "not_found", f"No scenario {scenario_id}.")
        return await self.scenario(scenario_id)

    async def _scenario_row(self, conn, scenario_id: str) -> dict:
        cur = await conn.execute("SELECT * FROM studio.scenarios WHERE scenario_id = %s", (scenario_id,))
        row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No scenario {scenario_id}.")
        return row

    async def scenario(self, scenario_id: str) -> dict:
        async with self.pool.connection() as conn:
            sc = await self._scenario_row(conn, scenario_id)
            cur = await conn.execute(
                """SELECT scenario_version, complete, recorded_at FROM studio.records WHERE scenario_id = %s
                   ORDER BY scenario_version DESC LIMIT 1""", (scenario_id,))
            rec = await cur.fetchone()
            cur = await conn.execute(
                """SELECT sim_id, mode, status, step, steps, created_at, finished_at FROM studio.simulations
                   WHERE scenario_id = %s ORDER BY created_at DESC LIMIT 5""", (scenario_id,))
            sims = await cur.fetchall()
        ctx = await self.institutions.context(sc["institution_id"])
        built = template.build(sc["template_id"], ctx, sc["intensity"], sc["switched_off"], sc["custom"], sc["title"])
        return {**sc, "built": built, "simulations": sims,
                "recording": {**rec, "current": rec["scenario_version"] == sc["version"]} if rec else None}

    async def scenarios(self, institution_id: str) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT s.*, (SELECT complete FROM studio.records r WHERE r.scenario_id = s.scenario_id
                                AND r.scenario_version = s.version) AS recorded,
                          (SELECT max(created_at) FROM studio.simulations m WHERE m.scenario_id = s.scenario_id) AS last_run
                   FROM studio.scenarios s WHERE institution_id = %s ORDER BY updated_at DESC""", (institution_id,))
            return await cur.fetchall()

    async def delete_scenario(self, scenario_id: str) -> None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT 1 FROM studio.simulations WHERE scenario_id = %s AND status = ANY(%s)", (scenario_id, list(ACTIVE)))
            if await cur.fetchone():
                raise Problem(409, "simulation_running", "Stop its simulation first.")
            await conn.execute("DELETE FROM studio.scenarios WHERE scenario_id = %s", (scenario_id,))

    # ------------------------------------------------------------ simulations

    async def start(self, scenario_id: str, mode: str, actor: str) -> dict:
        async with self.pool.connection() as conn:
            sc = await self._scenario_row(conn, scenario_id)
            if mode == "replay":
                cur = await conn.execute(
                    "SELECT complete FROM studio.records WHERE scenario_id = %s AND scenario_version = %s",
                    (scenario_id, sc["version"]))
                rec = await cur.fetchone()
                if not rec or not rec["complete"]:
                    raise Problem(409, "no_recording", "This version of the scenario has no complete recording: "
                                                       "run it once in record mode (it changed since, or never finished).")
        ctx = await self.institutions.context(sc["institution_id"])
        built = template.build(sc["template_id"], ctx, sc["intensity"], sc["switched_off"], sc["custom"], sc["title"])
        if mode != "replay" and not (self.inv_client.connected() and self.mon_client.connected()):
            raise Problem(503, "agents_not_connected", "The investigation and monitor agents must be connected "
                                                       "(INVESTIGATION_URL, MONITOR_URL); or replay a recording.")
        sim_id = f"sim-{uuid.uuid4().hex[:6]}"
        start_at = datetime.fromisoformat(built["clock"]["start_at"])
        now = self.clock.now()
        try:
            async with self.pool.connection() as conn, conn.transaction():
                await conn.execute(
                    """INSERT INTO studio.simulations (sim_id, scenario_id, scenario_version, institution_id, mode, status,
                         steps, step_hours, start_at, virtual_now, built, profile_version, created_by, created_at)
                       VALUES (%s, %s, %s, %s, %s, 'running', %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (sim_id, scenario_id, sc["version"], sc["institution_id"], mode, built["clock"]["steps"],
                     built["clock"]["step_hours"], start_at, start_at, Jsonb(built), ctx.get("profile_version"), actor, now))
                # the world is the Studio's alone: a new simulation starts from nothing
                await conn.execute("DELETE FROM cases.investigations WHERE world = %s", (WORLD,))
                await conn.execute("DELETE FROM signals.findings WHERE world = %s", (WORLD,))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        "INSERT INTO studio.sim_bars (sim_id, symbol, ts, close) VALUES (%s, %s, %s, %s)",
                        [(sim_id, built["prices"]["symbol"], ts, c) for ts, c in prices.path(built)])
                if mode == "record":
                    await conn.execute("DELETE FROM studio.records WHERE scenario_id = %s AND scenario_version = %s",
                                       (scenario_id, sc["version"]))
                    await conn.execute(
                        """INSERT INTO studio.records (scenario_id, scenario_version, complete, sim_id, recorded_at)
                           VALUES (%s, %s, false, %s, %s)""", (scenario_id, sc["version"], sim_id, now))
                await self._note(conn, sim_id, 0, start_at, "note", None,
                                 {"text": f"Simulation of “{built['title']}” for {built['institution']['name']} "
                                          f"({sc['intensity']} intensity, {mode})."})
        except UniqueViolation as e:
            raise Problem(409, "simulation_running", "Another simulation is running; stop it first.") from e
        return await self.simulation(sim_id)

    async def stop(self, sim_id: str) -> dict:
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE studio.simulations SET status = 'stopped', finished_at = %s WHERE sim_id = %s AND status = ANY(%s)",
                (self.clock.now(), sim_id, list(ACTIVE)))
        return await self.simulation(sim_id)

    async def current(self) -> dict | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT sim_id FROM studio.simulations WHERE status = ANY(%s)", (list(ACTIVE),))
            row = await cur.fetchone()
        return await self.simulation(row["sim_id"]) if row else None

    # ------------------------------------------------------------ the step

    async def step(self, sim_id: str, expected_step: int | None) -> dict:
        async with self.pool.connection() as lock:
            cur = await lock.execute("SELECT pg_try_advisory_lock(%s) AS ok", (TICK_LOCK,))
            if not (await cur.fetchone())["ok"]:
                raise Problem(409, "busy", "The background tick or another step is running; step again in a moment.",
                              retry_after=3)
            try:
                await self._step(sim_id, expected_step)
            finally:
                await lock.execute("SELECT pg_advisory_unlock(%s)", (TICK_LOCK,))
        return await self.simulation(sim_id)

    async def _sim(self, sim_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM studio.simulations WHERE sim_id = %s", (sim_id,))
            row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No simulation {sim_id}.")
        return row

    def _investigations(self, sim: dict, started: list[str]) -> Investigations:
        base = itertools.count(1)
        tok, step = token(sim["sim_id"]), sim["step"]

        def run_id() -> str:
            rid = f"inv-st-{tok}-{step}-{len(started) + next(base)}"
            started.append(rid)
            return rid

        return Investigations(self.pool, self.institutions, RecordClient(self.inv_client, self.pool, sim, "investigation"),
                              FixedClock(sim["virtual_now"]), worlds=(WORLD,), run_ids=run_id, as_of=True, poll_all=True,
                              max_attempts=settings.integer("SIM_MAX_ATTEMPTS"))

    async def _step(self, sim_id: str, expected_step: int | None) -> None:
        sim = await self._sim(sim_id)
        if sim["status"] not in ACTIVE:
            raise Problem(409, "not_running", f"The simulation is {sim['status']}.")
        if expected_step is not None and expected_step != sim["step"]:
            raise Problem(409, "step_moved", f"The simulation is at step {sim['step']}, not {expected_step}.",
                          step=sim["step"])
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT run_id FROM studio.agent_runs WHERE sim_id = %s AND step = %s "
                                     "AND kind = 'investigation' ORDER BY ordinal", (sim_id, sim["step"]))
            started = [r["run_id"] for r in await cur.fetchall()]
        known = set(started)
        inv = self._investigations(sim, started)
        pending = await self._collect(sim, inv)
        await inv._attach_developments(None)  # may start extend runs: they count as out too
        await inv._close_events()
        pending += await self._register(sim, started, known)
        await self._cases_to_timeline(sim)
        if pending:
            return await self._set_status(sim_id, "waiting")
        if sim["step"] >= settings.integer("SIM_INVESTIGATION_WAIT_STEPS"):
            step_info: dict = {"skipped": []}
            run = await inv._start(sim["institution_id"], WORLD, None, "studio", step_info)
            await self._register(sim, started, known)
            if run:
                async with self.pool.connection() as conn:
                    await self._note(conn, sim_id, sim["step"], sim["virtual_now"], "investigation", run["run_id"],
                                     {"findings": len(run["finding_ids"]), "status": "started"})
                return await self._set_status(sim_id, "waiting")
        if sim["step"] >= sim["steps"]:
            return await self._finish(sim)
        await self._advance(sim)

    async def _set_status(self, sim_id: str, status: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE studio.simulations SET status = %s WHERE sim_id = %s AND status = ANY(%s)",
                               (status, sim_id, list(ACTIVE)))

    async def _register(self, sim: dict, started: list[str], known: set[str]) -> int:
        """agent_runs rows for investigation runs started in this step (their real start for the deadline).
        An id taken for a batch that turned out empty has no run: it isn't registered."""
        new = [r for r in started if r not in known]
        if not new:
            return 0
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT run_id FROM cases.investigations WHERE run_id = ANY(%s)", (new,))
            real = {r["run_id"] for r in await cur.fetchall()}
            known.update(new)
            for rid in [r for r in new if r in real]:
                await conn.execute(
                    """INSERT INTO studio.agent_runs (run_id, sim_id, step, kind, ordinal, started_real, replayed)
                       VALUES (%s, %s, %s, 'investigation', %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (rid, sim["sim_id"], sim["step"], int(rid.rsplit("-", 1)[1]), self.clock.now(), sim["mode"] == "replay"))
        return len(real)

    async def _collect(self, sim: dict, inv: Investigations) -> int:
        """Collects every agent run still out; returns how many are still out."""
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM studio.agent_runs WHERE sim_id = %s AND NOT done ORDER BY started_real",
                                     (sim["sim_id"],))
            runs = await cur.fetchall()
        deadline = timedelta(seconds=settings.number("SIM_AGENT_DEADLINE_SECONDS"))
        out = 0
        for r in runs:
            late = sim["mode"] != "replay" and self.clock.now() - r["started_real"] > deadline
            if r["kind"] == "check":
                still = await self._collect_check(sim, r["run_id"], late)
            else:
                if late:
                    await inv._failed(r["run_id"], "the investigation took too long for the simulation", {}, retry=False)
                else:
                    await inv.collect(r["run_id"])
                still = await self._investigation_running(sim, r["run_id"])
            if still:
                out += 1
            else:
                async with self.pool.connection() as conn:
                    await conn.execute("UPDATE studio.agent_runs SET done = true WHERE run_id = %s", (r["run_id"],))
        return out

    async def _investigation_running(self, sim: dict, run_id: str) -> bool:
        """Whether the run is still out; a finished one is noted on the timeline once."""
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT status, error FROM cases.investigations WHERE run_id = %s", (run_id,))
            row = await cur.fetchone()
            if row and row["status"] != "running":
                cur = await conn.execute("SELECT 1 FROM studio.timeline WHERE ref = %s AND kind = 'investigation' "
                                         "AND data ->> 'status' <> 'started'", (run_id,))
                if not await cur.fetchone():
                    await self._note(conn, sim["sim_id"], sim["step"], sim["virtual_now"], "investigation", run_id,
                                     {"status": row["status"], "error": row["error"]})
        return bool(row and row["status"] == "running")

    # ------------------------------------------------------------ monitor checks

    async def _start_check(self, sim: dict, step: int, since: datetime, until: datetime, heads: list[dict]) -> None:
        built = sim["built"]
        check_id = f"chk-st-{token(sim['sim_id'])}-{step}-1"
        async with self.pool.connection() as conn:
            if not heads:
                await conn.execute(
                    """INSERT INTO studio.sim_checks (check_id, sim_id, step, monitor_key, window_since, window_until,
                         headlines, status, findings) VALUES (%s, %s, %s, %s, %s, %s, 0, 'quiet', 0)""",
                    (check_id, sim["sim_id"], step, built["monitor"]["key"], since, until))
                return
        state = await self.institutions.state(sim["institution_id"])
        req = {"run_id": check_id,
               "monitor": {"monitor_id": f"studio-{built['monitor']['key']}", "version": 1, "spec": built["monitor"]["spec"]},
               "institution": mreq.institution(state),
               "window": {"since": since.isoformat(), "until": until.isoformat()},
               "provided_news": [{"id": h["id"], "title": h["title"], "published_at": h["at"], "outlet": h["outlet"]}
                                 for h in heads],
               "recent_urls": []}
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO studio.sim_checks (check_id, sim_id, step, monitor_key, window_since, window_until,
                     headlines, status, request) VALUES (%s, %s, %s, %s, %s, %s, %s, 'running', %s)""",
                (check_id, sim["sim_id"], step, built["monitor"]["key"], since, until, len(heads), Jsonb(req)))
            await conn.execute(
                """INSERT INTO studio.agent_runs (run_id, sim_id, step, kind, ordinal, started_real, replayed)
                   VALUES (%s, %s, %s, 'check', 1, %s, %s)""",
                (check_id, sim["sim_id"], step, self.clock.now(), sim["mode"] == "replay"))
            await self._note(conn, sim["sim_id"], step, until, "check", check_id, {"status": "started", "headlines": len(heads)})
        client = RecordClient(self.mon_client, self.pool, sim, "check")
        try:
            await client.start(req)
        except AgentError as e:
            await self._check_done(sim, check_id, {"status": "failed", "error": f"the agent refused the check: {e}"})

    async def _collect_check(self, sim: dict, check_id: str, late: bool) -> bool:
        client = RecordClient(self.mon_client, self.pool, sim, "check")
        if late:
            await self._check_done(sim, check_id, {"status": "failed", "error": "the check took too long for the simulation"})
            return False
        try:
            st = await client.status(check_id)
        except AgentError as e:
            if e.retry and "HTTP 404" not in str(e):
                return True
            if "HTTP 404" in str(e):
                async with self.pool.connection() as conn:
                    cur = await conn.execute("SELECT request FROM studio.sim_checks WHERE check_id = %s", (check_id,))
                    row = await cur.fetchone()
                try:
                    await client.start(row["request"])
                    return True
                except AgentError:
                    pass
            await self._check_done(sim, check_id, {"status": "failed", "error": f"the agent lost the check: {e}"})
            return False
        if st.get("status") in ("queued", "running"):
            return True
        await self._check_done(sim, check_id, st)
        return False

    async def _check_done(self, sim: dict, check_id: str, st: dict) -> None:
        if st.get("status") == "failed":
            log.warning("studio %s: check %s failed: %s", sim["sim_id"], check_id, str(st.get("error"))[:500])
        now = sim["virtual_now"]
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT * FROM studio.sim_checks WHERE check_id = %s FOR UPDATE", (check_id,))
            chk = await cur.fetchone()
            if not chk or chk["status"] != "running":
                return
            n = 0
            if st.get("status") in FINISHED:
                n = await write_findings(conn, st["result"], sim["built"]["monitor"]["spec"], run_id=check_id,
                                         monitor_id=f"studio-{chk['monitor_key']}", version=1, world=WORLD,
                                         institution_id=sim["institution_id"], now=now)
            await conn.execute(
                "UPDATE studio.sim_checks SET status = %s, result = %s, findings = %s, error = %s WHERE check_id = %s",
                (st.get("status", "failed"), Jsonb(st.get("result")) if st.get("result") else None, n, st.get("error"),
                 check_id))
            await self._note(conn, sim["sim_id"], chk["step"], now, "check", check_id,
                             {"status": st.get("status"), "findings": n, "error": st.get("error"),
                              "summary": (st.get("result") or {}).get("summary")})
            cur = await conn.execute(
                "SELECT finding_id, title, score FROM signals.findings WHERE world = %s AND source_ref ->> 'check_run_id' = %s",
                (WORLD, check_id))
            for f in await cur.fetchall():
                await self._note(conn, sim["sim_id"], chk["step"], now, "finding", f["finding_id"],
                                 {"source": "monitor", "title": f["title"], "score": f["score"]})

    # ------------------------------------------------------------ advancing the clock

    async def _advance(self, sim: dict) -> None:
        built, sim_id = sim["built"], sim["sim_id"]
        step = sim["step"] + 1
        before = sim["virtual_now"]
        now = datetime.fromisoformat(built["clock"]["first_step_at"]) + timedelta(hours=sim["step_hours"] * (step - 1))
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE studio.simulations SET step = %s, virtual_now = %s, status = 'running' "
                               "WHERE sim_id = %s", (step, now, sim_id))
            heads = [h for h in built["headlines"] if before <= datetime.fromisoformat(h["at"]) < now]
            for h in heads:
                await self._note(conn, sim_id, step, datetime.fromisoformat(h["at"]), "headline", h["id"],
                                 {"title": h["title"], "outlet": h["outlet"], "story": h["story"]})
            cur = await conn.execute("SELECT ts, close FROM studio.sim_bars WHERE sim_id = %s AND ts <= %s ORDER BY ts",
                                     (sim_id, now))
            bars = [(r["ts"], r["close"]) for r in await cur.fetchall()]
        sim = {**sim, "step": step, "virtual_now": now}
        if bars and bars[-1][0] > before:
            await self._price_step(sim, bars, now)
        await self._start_check(sim, step, before, now, heads)
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT 1 FROM studio.agent_runs WHERE sim_id = %s AND NOT done", (sim_id,))
            if await cur.fetchone():
                await conn.execute("UPDATE studio.simulations SET status = 'waiting' WHERE sim_id = %s", (sim_id,))

    async def _price_step(self, sim: dict, bars: list, now: datetime) -> None:
        built, p = sim["built"], sim["built"]["prices"]
        d = prices.evaluate(bars, p["name"])
        start = datetime.fromisoformat(built["clock"]["start_at"])
        base = next((c for ts, c in reversed(bars) if ts < start), bars[0][1])
        async with self.pool.connection() as conn:
            await self._note(conn, sim["sim_id"], sim["step"], bars[-1][0], "price", p["symbol"],
                             {"close": bars[-1][1], "change_pct": round((bars[-1][1] / base - 1) * 100, 2),
                              "z": (d.get("max") or {}).get("z"), "fires": bool(d.get("fires"))})
            if not d.get("fires"):
                return
            cur = await conn.execute(
                """SELECT max(created_at) AS last FROM signals.findings WHERE world = %s AND source = 'timeseries'
                   AND institution_id = %s""", (WORLD, sim["institution_id"]))
            last = (await cur.fetchone())["last"]
            if last and now - last < timedelta(hours=settings.integer("SERIES_COOLDOWN_HOURS")):
                return
            fid = await self._write_price_finding(conn, sim, d, now)
            cur = await conn.execute("SELECT title, score FROM signals.findings WHERE finding_id = %s", (fid,))
            f = await cur.fetchone()
            await self._note(conn, sim["sim_id"], sim["step"], now, "finding", fid,
                             {"source": "timeseries", "title": f["title"], "score": f["score"]})

    async def _write_price_finding(self, conn, sim: dict, d: dict, now: datetime) -> str:
        """The market-series finding for a simulated move (as series/service.py writes a live one)."""
        p = sim["built"]["prices"]
        z = settings.number("SERIES_Z_THRESHOLD")
        tz = sim["built"]["institution"]["time_zone"]
        title, explanation, w = detect.finding_text(p["name"], d, z, tz)
        t = p["theme"]
        themes = [{"theme": t["theme"], "direction": t["direction_up"] if w["change_pct"] > 0 else t["direction_down"],
                   "currency": t["currency"]}]
        ref_end = datetime.fromisoformat(w["ref_ts"]) + detect.BAR
        fid = f"f-st-{token(sim['sim_id'])}-{sim['step']}-ts-1"
        evidence = {"signals": [{
            "series_id": f"studio-{p['symbol'].lower().replace('/', '_')}", "symbol": p["symbol"], "interval": "1day",
            "direction": "up" if w["change_pct"] > 0 else "down", "start_at": ref_end.isoformat(), "end_at": d["bar_end"],
            "ref_level": w["ref_close"], "obs_level": d["close"], "change_pct": w["change_pct"], "z": w["z"],
            "typical_daily_move_pct": d["typical_daily_move_pct"], "window_days": w["days"],
            "description": detect.signal_description(p["name"], d, w, tz)}], "headlines": [], "web": []}
        await conn.execute(
            """INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title,
                 explanation, score, themes, effective_from, period, places, evidence, created_at)
               VALUES (%s, %s, %s, 'timeseries', %s, 'signal_move', %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (finding_id) DO NOTHING""",
            (fid, WORLD, sim["institution_id"], Jsonb({"series_id": evidence["signals"][0]["series_id"], "simulated": True}),
             title, explanation, detect.score(w["z"], z), Jsonb(themes), datetime.fromisoformat(d["bar_end"]).date(),
             Jsonb({"start": ref_end.date().isoformat(), "end": datetime.fromisoformat(d["bar_end"]).date().isoformat()}),
             p["places"], Jsonb(evidence), now))
        return fid

    async def _finish(self, sim: dict) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE studio.simulations SET status = 'finished', finished_at = %s WHERE sim_id = %s",
                               (self.clock.now(), sim["sim_id"]))
            if sim["mode"] == "record":
                await conn.execute(
                    "UPDATE studio.records SET complete = true WHERE scenario_id = %s AND scenario_version = %s AND sim_id = %s",
                    (sim["scenario_id"], sim["scenario_version"], sim["sim_id"]))
            await self._note(conn, sim["sim_id"], sim["step"], sim["virtual_now"], "note", None,
                             {"text": "The simulation finished."})

    # ------------------------------------------------------------ the timeline and the view

    async def _note(self, conn, sim_id: str, step: int, at: datetime, kind: str, ref: str | None, data: dict) -> None:
        await conn.execute("INSERT INTO studio.timeline (sim_id, step, at, kind, ref, data) VALUES (%s, %s, %s, %s, %s, %s)",
                           (sim_id, step, at, kind, ref, Jsonb(data)))

    async def _cases_to_timeline(self, sim: dict) -> None:
        """Events and developments the investigation stored since the last look."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT e.event_id, e.title, e.themes, e.created_at FROM cases.events e WHERE e.world = %s
                   AND NOT EXISTS (SELECT 1 FROM studio.timeline t WHERE t.sim_id = %s AND t.kind = 'event'
                                   AND t.ref = e.event_id) ORDER BY e.created_at""", (WORLD, sim["sim_id"]))
            for e in await cur.fetchall():
                h = await (await conn.execute("SELECT expected FROM cases.hypotheses WHERE event_id = %s",
                                              (e["event_id"],))).fetchall()
                await self._note(conn, sim["sim_id"], sim["step"], e["created_at"], "event", e["event_id"],
                                 {"title": e["title"], "themes": e["themes"], "tone": tone(h), "effects": len(h)})
            cur = await conn.execute(
                """SELECT d.finding_id, d.event_id, d.reason, d.joined_at FROM cases.event_developments d
                   JOIN cases.events e USING (event_id) WHERE e.world = %s
                   AND NOT EXISTS (SELECT 1 FROM studio.timeline t WHERE t.sim_id = %s AND t.kind = 'development'
                                   AND t.ref = d.finding_id)""", (WORLD, sim["sim_id"]))
            for d in await cur.fetchall():
                await self._note(conn, sim["sim_id"], sim["step"], d["joined_at"], "development", d["finding_id"],
                                 {"event_id": d["event_id"], "reason": d["reason"]})

    async def simulation(self, sim_id: str, since: int = 0) -> dict:
        sim = await self._sim(sim_id)
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM studio.timeline WHERE sim_id = %s AND seq > %s ORDER BY seq",
                                     (sim_id, since))
            timeline = await cur.fetchall()
            cur = await conn.execute("SELECT ts, close FROM studio.sim_bars WHERE sim_id = %s AND ts <= %s ORDER BY ts",
                                     (sim_id, sim["virtual_now"]))
            bars = await cur.fetchall()
            cur = await conn.execute(
                """SELECT run_id, kind, step, started_real FROM studio.agent_runs WHERE sim_id = %s AND NOT done""",
                (sim_id,))
            pending = [{**r, "seconds": int((self.clock.now() - r["started_real"]).total_seconds())}
                       for r in await cur.fetchall()]
            cur = await conn.execute(
                """SELECT e.event_id, e.title, e.themes, e.status, e.anchor, e.created_at,
                          (SELECT count(*) FROM cases.event_developments d WHERE d.event_id = e.event_id) AS developments
                   FROM cases.events e WHERE e.world = %s ORDER BY e.created_at""", (WORLD,))
            events = []
            for e in await cur.fetchall():
                h = await (await conn.execute("SELECT expected, product_id, chain_label FROM cases.hypotheses "
                                              "WHERE event_id = %s", (e["event_id"],))).fetchall()
                events.append({**e, "tone": tone(h), "effects": len(h)})
            cur = await conn.execute("SELECT source, count(*) AS n FROM signals.findings WHERE world = %s GROUP BY source",
                                     (WORLD,))
            found = {r["source"]: r["n"] for r in await cur.fetchall()}
            alerts = []  # what the live app would raise for these events (the same code; nothing is written)
            for e in events:
                ev = await (await conn.execute("SELECT * FROM cases.events WHERE event_id = %s", (e["event_id"],))).fetchone()
                for a in await alert_plan(conn, ev):
                    alerts.append({"event_id": e["event_id"], "event_title": e["title"], "owner": a["owner"], "title": a["title"],
                                   "effects": [{k: x[k] for k in ("product", "metric_name", "direction", "size", "timing")}
                                               for x in a["effects"]]})
        built = sim.pop("built")
        start = datetime.fromisoformat(built["clock"]["start_at"])
        return {**sim, "title": built["title"], "institution": built["institution"], "symbol": built["prices"]["symbol"],
                "timeline": timeline, "bars": [b for b in bars if b["ts"] >= start - timedelta(days=21)],
                "pending": pending, "events": events, "alerts": alerts, "findings": found,
                "summary": self._summary(built, events, found)}

    @staticmethod
    def _summary(built: dict, events: list[dict], found: dict) -> dict:
        stories, used = [], set()
        for s in built["stories"]:
            e = next((x for x in events if _matches(x["themes"], s["themes"])), None)
            if e:
                used.add(e["event_id"])
            stories.append({"key": s["key"], "label": s["label"], "expected": s["expected"], "tone": s["tone"],
                            "found": e is not None, "event_id": e["event_id"] if e else None,
                            "event_title": e["title"] if e else None, "found_tone": e["tone"] if e else None})
        return {"stories": stories, "other_events": [{"event_id": e["event_id"], "title": e["title"], "tone": e["tone"]}
                                                     for e in events if e["event_id"] not in used],
                "findings": {k: {"expected": v, "found": found.get(k, 0)} for k, v in built["expected_findings"].items()}}
