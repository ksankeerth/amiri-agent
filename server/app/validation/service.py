"""Validation in the tick: due tasks are judged against the approved data connection, each evaluation
is kept (cases.validation_evaluations), and the task says when to look again.

A task is due when it is pending and its next check date has come (none yet: now). It runs only while
validation is on (the server allows it, the switch is on, the connection is approved), and only for
live tasks: a Studio simulation has no connection of its own yet. The validator's own memory (what it
saw before, for the alert lifecycle and superseded verdicts) is the task's earlier evaluations."""

import json
import logging
from datetime import date

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import ValidationError

from app import settings
from app.alerts import service as alerts
from app.clock import Clock
from app.connect.service import DataConnection
from app.problems import Problem
from app.validation import explain, validate
from app.validation.contract import ValidationTask
from app.validation.history import Evaluation, MemoryHistory
from app.validation.periods import local_date
from app.validation.reader import RunReader

log = logging.getLogger("amiri.validation")


class Validation:
    def __init__(self, pool: AsyncConnectionPool, connection: DataConnection, clock: Clock):
        self.pool, self.connection, self.clock = pool, connection, clock

    async def _history(self, task_id: str, task_hash: str) -> MemoryHistory:
        h = MemoryHistory()
        async with self.pool.connection() as conn:
            cur = await conn.execute("""SELECT * FROM cases.validation_evaluations WHERE task_id = %s AND task_hash = %s""",
                                     (task_id, task_hash))
            for r in await cur.fetchall():
                e = Evaluation(r["as_of"], r["verdict"], r["final"], r["alert"], r["signal"], r["look_percentile"],
                               r["signature"], r["unchanged_since"])
                h.rows[(task_id, task_hash, r["as_of"])] = (e, json.dumps(r["result"], default=str))
        return h

    async def _due(self, today: date | None, limit: int, task_ids: list[str] | None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT t.task_id, t.event_id, t.task,
                          (SELECT count(*) FROM cases.validation_tasks f WHERE f.event_id = t.event_id) AS family
                   FROM cases.validation_tasks t JOIN cases.investigations i ON i.run_id = t.run_id
                   WHERE t.status = 'pending' AND i.world = 'live'
                     AND (%(ids)s::text[] IS NULL OR t.task_id = ANY(%(ids)s))
                     AND (%(ids)s::text[] IS NOT NULL OR t.next_check_after IS NULL OR t.next_check_after <= %(today)s)
                   ORDER BY t.next_check_after NULLS FIRST, t.created_at LIMIT %(limit)s""",
                {"ids": task_ids, "today": today, "limit": limit})
            return await cur.fetchall()

    async def run_due(self, task_ids: list[str] | None = None, as_of: date | None = None) -> dict:
        step = {"step": "validate", "due": 0, "evaluated": 0, "errors": 0, "verdicts": {}, "alerts": 0, "skipped": []}
        if not await self.connection.validation_on():
            step["skipped"].append("validation is off (the server setting, the switch, or no approved connection)")
            return step
        utc_today = self.clock.now().date()
        rows = await self._due(as_of or utc_today, settings.integer("VALIDATION_TASKS_PER_TICK"), task_ids)
        step["due"] = len(rows)
        if not rows:
            return step
        try:
            data, target, _ = await self.connection.client()
        except Problem as e:
            step["skipped"].append(e.detail)
            return step
        reader = RunReader(data, target)
        try:
            for r in rows:
                await self._one(r, reader, as_of, step)
        finally:
            await data.aclose()
        for event_id in dict.fromkeys(r["event_id"] for r in rows):  # the checks move the events' alerts
            async with self.pool.connection() as conn, conn.transaction():
                step["alerts"] += await alerts.sync(conn, event_id, self.clock.now(), checked=True)
        return step

    async def _one(self, r: dict, reader: RunReader, as_of: date | None, step: dict) -> None:
        now = self.clock.now()
        try:
            task = ValidationTask.model_validate(r["task"])
        except ValidationError as e:
            log.warning("validation task %s can't be read: %s", r["task_id"], str(e)[:300])
            async with self.pool.connection() as conn:
                await conn.execute("UPDATE cases.validation_tasks SET status = 'failed', checked_at = %s WHERE task_id = %s",
                                   (now, r["task_id"]))
            step["errors"] += 1
            return
        day = as_of or local_date(now, task.time_zone)
        h = await self._history(task.task_id, validate.task_hash(task))
        result = await validate.evaluate(task, day, reader, h, int(r["family"]))
        e, rjson = h.rows[(task.task_id, result.task_hash, day)]
        done = result.next_check_after is None
        status = "failed" if result.verdict == "error" and result.error_kind == "permanent" else "done" if done else "pending"
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO cases.validation_evaluations (task_id, task_hash, as_of, verdict, final, alert, signal,
                     look_percentile, signature, unchanged_since, result, computed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (task_id, task_hash, as_of) DO UPDATE SET verdict = excluded.verdict, final = excluded.final,
                     alert = excluded.alert, signal = excluded.signal, look_percentile = excluded.look_percentile,
                     signature = excluded.signature, unchanged_since = excluded.unchanged_since, result = excluded.result,
                     computed_at = excluded.computed_at""",
                (task.task_id, result.task_hash, day, e.verdict, e.final, e.alert, e.signal, e.look_percentile, e.signature,
                 e.unchanged_since, Jsonb(json.loads(rjson)), now))
            await conn.execute(
                """UPDATE cases.validation_tasks SET status = %s, verdict = %s, final = %s, next_check_after = %s,
                     stop_after = %s, checked_at = %s WHERE task_id = %s""",
                (status, result.verdict, result.final, result.next_check_after, result.stop_after, now, task.task_id))
        step["evaluated"] += 1
        step["errors"] += result.verdict == "error"
        step["verdicts"][result.verdict] = step["verdicts"].get(result.verdict, 0) + 1
        log.info("validated %s (%s/%s): %s%s, next %s", task.task_id, task.product_id, task.metric, result.verdict,
                 " final" if result.final else "", result.next_check_after or "none")

    async def verdicts(self, event_id: str | None = None, task_id: str | None = None) -> list[dict]:
        """Each task with its latest evaluation and its verdict history (newest task first)."""
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT t.task_id, t.event_id, t.hypothesis_id, t.status, t.verdict, t.final, t.next_check_after,
                          t.stop_after, t.checked_at, t.task,
                          (SELECT e.result FROM cases.validation_evaluations e WHERE e.task_id = t.task_id
                           ORDER BY e.as_of DESC, e.computed_at DESC LIMIT 1) AS latest
                   FROM cases.validation_tasks t
                   WHERE (%s::text IS NULL OR t.event_id = %s) AND (%s::text IS NULL OR t.task_id = %s)
                   ORDER BY t.created_at DESC, t.task_id LIMIT 200""", (event_id, event_id, task_id, task_id))
            rows = await cur.fetchall()
        out = []
        for r in rows:
            t = r["task"]
            out.append({"task_id": r["task_id"], "event_id": r["event_id"], "hypothesis_id": r["hypothesis_id"],
                        "status": r["status"], "verdict": r["verdict"], "final": r["final"],
                        "next_check_after": r["next_check_after"], "stop_after": r["stop_after"],
                        "checked_at": r["checked_at"],
                        "task": {k: t.get(k) for k in ("product_id", "source_product_id", "metric", "unit", "filter",
                                                        "method", "expected_direction", "adverse_direction",
                                                        "expected_size", "watch", "owner", "catalog_version")},
                        "latest": r["latest"], "explain": explain.describe(r["latest"], t)})
        return out
