"""POST /internal/tick: Cloud Scheduler calls it every 15 minutes (locally, the
compose ticker or `uv run amiri tick`). It runs whatever is due. A database
advisory lock means two ticks never overlap; the second returns at once."""

import logging
import time

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb

TICK_LOCK = 7_310_000
KEEP = 200  # ticks kept in signals.ticks

router = APIRouter(tags=["internal"])
log = logging.getLogger("amiri.tick")


async def run_tick(app) -> dict:
    started = time.monotonic()
    async with app.state.pool.connection() as conn:
        cur = await conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (TICK_LOCK,))
        if not (await cur.fetchone())["ok"]:
            log.info("tick skipped: another tick is running")
            return {"skipped": "another tick is running", "ran": [], "duration_ms": 0}
        try:
            at = app.state.series.clock.now()
            ran = []
            # in this order: news and moves found now join this tick's investigation batch, whose tasks
            # the validation step then judges
            for name, run_due in (("series", app.state.series.run_due), ("radar", app.state.radar.run_due),
                                  ("monitors", app.state.monitors.run_due),
                                  ("investigation", app.state.investigations.run_due),
                                  ("validation", app.state.validation.run_due)):
                t = time.monotonic()
                try:
                    step = await run_due()
                except Exception as e:  # one step failing must not stop the others
                    log.exception("tick step %s failed", name)
                    step = {"step": name, "error": f"{type(e).__name__}: {str(e)[:300]}"}
                step["ms"] = int((time.monotonic() - t) * 1000)
                ran.append(step)
            ms = int((time.monotonic() - started) * 1000)
            await conn.execute("INSERT INTO signals.ticks (started_at, duration_ms, ran) VALUES (%s, %s, %s) "
                               "ON CONFLICT (started_at) DO NOTHING", (at, ms, Jsonb(ran)))
            await conn.execute("DELETE FROM signals.ticks WHERE started_at < (SELECT min(started_at) FROM "
                               "(SELECT started_at FROM signals.ticks ORDER BY started_at DESC LIMIT %s) t)", (KEEP,))
        finally:
            await conn.execute("SELECT pg_advisory_unlock(%s)", (TICK_LOCK,))
    ms = int((time.monotonic() - started) * 1000)
    failed = [s.get("step") for s in ran if s.get("error") or s.get("failed")]
    (log.warning if failed else log.info)("tick %s ms: %s%s", ms, " · ".join(summary(s) for s in ran),
                                          f" (problems in: {', '.join(failed)})" if failed else "")
    return {"ran": ran, "duration_ms": ms}


def summary(step: dict) -> str:
    """One step in a few words: its non-zero counts, what it skipped, or its error."""
    name = step.get("step", "?")
    if step.get("error"):
        return f"{name} error"
    counts = [f"{k} {v}" for k, v in step.items() if isinstance(v, int) and v and k not in ("ms",)]
    skipped = step.get("skipped") or []
    return f"{name} " + (", ".join(counts) if counts else "skipped" if skipped else "nothing due")


@router.post("/internal/tick", summary="Run the work that is due (Cloud Scheduler, every 15 min)")
async def tick(request: Request):
    return await run_tick(request.app)
