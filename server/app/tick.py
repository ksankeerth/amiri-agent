"""POST /internal/tick: Cloud Scheduler calls it every 15 minutes (locally, the
compose ticker or `uv run amiri tick`). It runs whatever is due. A database
advisory lock means two ticks never overlap; the second returns at once."""

import time

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb

TICK_LOCK = 7_310_000
KEEP = 200  # ticks kept in signals.ticks

router = APIRouter(tags=["internal"])


async def run_tick(app) -> dict:
    started = time.monotonic()
    async with app.state.pool.connection() as conn:
        cur = await conn.execute("SELECT pg_try_advisory_lock(%s) AS ok", (TICK_LOCK,))
        if not (await cur.fetchone())["ok"]:
            return {"skipped": "another tick is running", "ran": [], "duration_ms": 0}
        try:
            at = app.state.series.clock.now()
            ran = []
            t = time.monotonic()
            step = await app.state.series.run_due()
            step["ms"] = int((time.monotonic() - t) * 1000)
            ran.append(step)
            t = time.monotonic()
            step = await app.state.radar.run_due()  # before the monitors and the investigation, as the series
            step["ms"] = int((time.monotonic() - t) * 1000)
            ran.append(step)
            t = time.monotonic()
            step = await app.state.monitors.run_due()  # before the investigation: news found now joins this tick's batch
            step["ms"] = int((time.monotonic() - t) * 1000)
            ran.append(step)
            t = time.monotonic()
            step = await app.state.investigations.run_due()  # after the series: a new move joins this tick's batch
            step["ms"] = int((time.monotonic() - t) * 1000)
            ran.append(step)
            ms = int((time.monotonic() - started) * 1000)
            await conn.execute("INSERT INTO signals.ticks (started_at, duration_ms, ran) VALUES (%s, %s, %s) "
                               "ON CONFLICT (started_at) DO NOTHING", (at, ms, Jsonb(ran)))
            await conn.execute("DELETE FROM signals.ticks WHERE started_at < (SELECT min(started_at) FROM "
                               "(SELECT started_at FROM signals.ticks ORDER BY started_at DESC LIMIT %s) t)", (KEEP,))
        finally:
            await conn.execute("SELECT pg_advisory_unlock(%s)", (TICK_LOCK,))
    return {"ran": ran, "duration_ms": int((time.monotonic() - started) * 1000)}


@router.post("/internal/tick", summary="Run the work that is due (Cloud Scheduler, every 15 min)")
async def tick(request: Request):
    return await run_tick(request.app)
