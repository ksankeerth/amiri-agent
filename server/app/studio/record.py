"""Record and replay of the agents' results, by position.

A simulation's agent calls are numbered (step, kind, ordinal) in `studio.agent_runs`. In
`record` mode each finished call's answer is stored under that position; in `replay` mode the
answer comes from the store and the agent isn't called (a missing one fails the call loudly). Ids
carry the simulation's token, so a replayed answer has the recorded token swapped for the current
one. The request's fingerprint is stored only to warn when it differs.
"""

import hashlib
import json
import logging

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.investigation.client import AgentError

logger = logging.getLogger(__name__)
FINISHED = ("completed", "stopped_early", "failed")
VOLATILE = ("run_id", "server_url", "created_at", "as_of")


def fingerprint(req: dict) -> str:
    def clean(x):
        if isinstance(x, dict):
            return {k: clean(v) for k, v in sorted(x.items()) if k not in VOLATILE}
        if isinstance(x, list):
            return [clean(v) for v in x]
        return x

    return hashlib.sha256(json.dumps(clean(req), default=str).encode()).hexdigest()[:16]


class RecordClient:
    """An agent client (InvestigationClient or MonitorClient) for one simulation."""

    def __init__(self, inner, pool: AsyncConnectionPool, sim: dict, kind: str):
        self.inner, self.pool, self.sim, self.kind = inner, pool, sim, kind
        self.mode = sim["mode"]
        self.url = inner.url

    def connected(self) -> bool:
        return self.mode == "replay" or self.inner.connected()

    async def _position(self, run_id: str) -> dict | None:
        """Where the run sits in the simulation, and the request it was started with."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT a.step, a.kind, a.ordinal, coalesce(i.request, c.request) AS request FROM studio.agent_runs a
                   LEFT JOIN cases.investigations i ON i.run_id = a.run_id
                   LEFT JOIN studio.sim_checks c ON c.check_id = a.run_id WHERE a.run_id = %s""", (run_id,))
            return await cur.fetchone()

    async def start(self, req: dict) -> dict:
        if self.mode == "replay":
            return {"run_id": req["run_id"], "status": "queued"}
        return await self.inner.start(req)

    async def status(self, run_id: str) -> dict:
        if self.mode == "replay":
            return await self._replayed(run_id)
        st = await self.inner.status(run_id)
        if self.mode == "record" and st.get("status") in FINISHED:
            await self._store(run_id, st)
        return st

    async def _store(self, run_id: str, st: dict) -> None:
        pos = await self._position(run_id)
        if not pos:
            return
        s = self.sim
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO studio.record_calls (scenario_id, scenario_version, step, kind, ordinal, fingerprint,
                     run_id, result) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (scenario_id, scenario_version, step, kind, ordinal) DO UPDATE
                   SET fingerprint = EXCLUDED.fingerprint, run_id = EXCLUDED.run_id, result = EXCLUDED.result""",
                (s["scenario_id"], s["scenario_version"], pos["step"], pos["kind"], pos["ordinal"],
                 fingerprint(pos["request"] or {}), run_id, Jsonb(st)))

    async def _replayed(self, run_id: str) -> dict:
        pos = await self._position(run_id)
        s = self.sim
        row = None
        if pos:
            async with self.pool.connection() as conn:
                cur = await conn.execute(
                    """SELECT c.*, r.sim_id AS recorded_sim FROM studio.record_calls c JOIN studio.records r
                         USING (scenario_id, scenario_version)
                       WHERE scenario_id = %s AND scenario_version = %s AND step = %s AND kind = %s AND ordinal = %s""",
                    (s["scenario_id"], s["scenario_version"], pos["step"], pos["kind"], pos["ordinal"]))
                row = await cur.fetchone()
        if not row:
            where = f"step {pos['step']}, {pos['kind']} {pos['ordinal']}" if pos else run_id
            raise AgentError(f"replay: nothing was recorded for {where}; the run differs from the recording "
                             "(record it again)", retry=False)
        if pos["request"] and fingerprint(pos["request"]) != row["fingerprint"]:
            logger.warning("replay %s: the request differs from the recorded one; using the recording", run_id)
        text = json.dumps(row["result"]).replace(token(row["recorded_sim"]), token(s["sim_id"]))
        return {**json.loads(text), "run_id": run_id}

    async def aclose(self) -> None:  # the inner client belongs to the app
        return None


def token(sim_id: str) -> str:
    """The part of a simulation's id that its run and finding ids carry."""
    return sim_id.removeprefix("sim-")
