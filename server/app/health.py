"""GET /health (liveness) and GET /health/details."""

import time

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app import db, settings
from app.providers.twelvedata import TwelveDataClient

router = APIRouter(tags=["health"])
VERSION = "0.1.0"


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/health/details")
async def health_details(request: Request):
    app = request.app
    checks: dict = {}
    status = "ok"
    t = time.monotonic()
    try:
        async with app.state.pool.connection() as conn:
            version = await db.schema_version(conn)
            cur = await conn.execute(
                """SELECT count(*) FILTER (WHERE enabled) AS enabled, count(*) AS total,
                          count(*) FILTER (WHERE last_fetch_status = 'error') AS failing
                   FROM signals.series"""
            )
            s = await cur.fetchone()
            cur = await conn.execute("SELECT 1 FROM core.institutions WHERE institution_id = %s",
                                     (settings.raw("INSTITUTION_ID"),))
            has_profile = await cur.fetchone() is not None
            cur = await conn.execute(
                """SELECT status, error, finished_at FROM cases.investigations
                   WHERE status <> 'running' AND world <> 'studio' ORDER BY created_at DESC LIMIT 1""")
            last_run = await cur.fetchone()
            cur = await conn.execute(
                """SELECT (SELECT count(*) FROM core.monitors WHERE status = 'live') AS live,
                          (SELECT status FROM signals.monitor_runs WHERE status <> 'running'
                           ORDER BY created_at DESC LIMIT 1) AS last_check""")
            mon = await cur.fetchone()
        checks["database"] = {"status": "ok", "latency_ms": int((time.monotonic() - t) * 1000),
                              "schema_version": version}
    except Exception as e:  # raw error, as raised
        checks["database"] = {"status": "down", "error": f"{type(e).__name__}: {e}"}
        s, has_profile, last_run, mon = None, True, None, None
        status = "down"
    configured = TwelveDataClient.configured()
    checks["twelvedata"] = {"status": "ok" if configured else "not_configured"}
    checks["institution"] = {"status": "ok" if has_profile else "missing", "institution_id": settings.raw("INSTITUTION_ID")}
    inv = app.state.investigations.client
    checks["investigation"] = {
        "status": "not_configured" if not inv.connected() else
        ("failing" if last_run and last_run["status"] == "failed" else "ok"),
        "url": inv.url or None, "validation": settings.raw("METRICS_VALIDATION") == "on",
        "last_run": dict(last_run) if last_run else None}
    rc = app.state.radar.client
    async with app.state.pool.connection() as conn:
        cur = await conn.execute("SELECT status, error FROM signals.radar_runs WHERE status <> 'running' "
                                 "ORDER BY created_at DESC LIMIT 1")
        rlast = await cur.fetchone()
    checks["radar"] = {"status": "not_configured" if not rc.connected() else
                       ("failing" if rlast and rlast["status"] == "failed" else "ok"),
                       "url": rc.url or None, "last_run": rlast["status"] if rlast else None}
    mc = app.state.monitors.client
    checks["monitor"] = {
        "status": "not_configured" if not mc.connected() else
        ("failing" if mon and mon["last_check"] == "failed" else "ok"),
        "url": mc.url or None, "live_monitors": mon["live"] if mon else None,
        "last_check": mon["last_check"] if mon else None}
    if status == "ok" and (not configured or (s and s["failing"]) or not has_profile
                           or checks["investigation"]["status"] != "ok"
                           or checks["monitor"]["status"] == "failing"
                           or (checks["monitor"]["status"] == "not_configured" and mon and mon["live"])):
        status = "degraded"
    body = {
        "service": "amiri-server", "version": VERSION, "started_at": app.state.started_at,
        "status": status, "checks": checks,
        "series": dict(s) if s else None,
    }
    return JSONResponse(jsonable_encoder(body), status_code=503 if status == "down" else 200)
