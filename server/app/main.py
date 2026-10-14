"""The amiri-server app. `uv run amiri serve` runs it."""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import auth, db, health, overview, prototype, settings, tick
from app.alerts import api as alerts_api
from app.alerts.service import Alerts
from app.assistant import api as assistant_api
from app.assistant.agent import make_assistant
from app.assistant.service import AssistantService
from app.clock import Clock
from app.institutions import api as institutions_api
from app.institutions.service import Institutions
from app.investigation import api as investigation_api
from app.investigation.client import InvestigationClient, MonitorClient, RadarClient
from app.investigation.service import Investigations
from app.monitors import api as monitors_api
from app.monitors.service import Monitors
from app.problems import Problem, on_problem, on_validation
from app.providers.twelvedata import TwelveDataClient
from app.radar import api as radar_api
from app.radar.service import Radar
from app.reference import load as refload
from app.series import api as series_api
from app.series.service import MarketSeries
from app.studio import api as studio_api
from app.studio.service import Studio

DESCRIPTION = """\
Amiri Agent server API. This version covers **market series**: the prices and rates Amiri Agent
watches by itself (Twelve Data, hourly), and the moves it flags as findings; and the
**institution profile** (bank or insurer): identity, footprint, customer groups,
products, flows, regulators, rivals, counterparties and known risks, with suggestions,
readiness, history and the agents' context.
No model is involved. Errors are RFC 9457 problem details. Roles are applied in the
web app, not here (prototype).
"""


def create_app(*, database_url: str | None = None, provider: TwelveDataClient | None = None,
               clock: Clock | None = None, assistant=None, investigation: InvestigationClient | None = None,
               monitor: MonitorClient | None = None, radar: RadarClient | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool = db.make_pool(database_url)
        await pool.open(wait=True)
        if settings.flag("AUTO_MIGRATE"):
            async with pool.connection() as conn:
                await db.migrate(conn)
                await refload.load(conn)
        prov = provider or TwelveDataClient()
        app.state.pool = pool
        app.state.series = MarketSeries(pool, prov, clock or Clock())
        app.state.institutions = Institutions(pool, clock or Clock())
        mon_client = monitor or MonitorClient()
        app.state.monitors = Monitors(pool, app.state.institutions, mon_client, clock or Clock())
        app.state.assistant = AssistantService(pool, app.state.institutions, assistant or make_assistant(), clock or Clock(),
                                               monitors=app.state.monitors)
        inv_client = investigation or InvestigationClient()
        app.state.investigations = Investigations(pool, app.state.institutions, inv_client, clock or Clock())
        app.state.alerts = Alerts(pool, clock or Clock())
        radar_client = radar or RadarClient()
        app.state.radar = Radar(pool, app.state.institutions, radar_client, clock or Clock())
        app.state.studio = Studio(pool, app.state.institutions, inv_client, mon_client, clock or Clock())
        app.state.started_at = datetime.now(UTC).isoformat()
        try:
            yield
        finally:
            if provider is None:
                await prov.aclose()
            if investigation is None:
                await inv_client.aclose()
            if monitor is None:
                await mon_client.aclose()
            if radar is None:
                await radar_client.aclose()
            await pool.close()

    app = FastAPI(title="amiri-server", version=health.VERSION, description=DESCRIPTION, lifespan=lifespan)
    app.add_exception_handler(Problem, on_problem)
    app.add_exception_handler(RequestValidationError, on_validation)
    origins = settings.names("CORS_ORIGINS")
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                           allow_headers=["*"], expose_headers=["ETag", "Location", "Retry-After"])
    app.add_middleware(auth.Gate)
    app.include_router(auth.robots)
    app.include_router(auth.router)
    app.include_router(health.router)
    app.include_router(series_api.router)
    app.include_router(institutions_api.router)
    app.include_router(institutions_api.ref_router)
    app.include_router(assistant_api.router)
    app.include_router(investigation_api.router)
    app.include_router(investigation_api.internal)
    app.include_router(monitors_api.router)
    app.include_router(studio_api.router)
    app.include_router(radar_api.router)
    app.include_router(alerts_api.router)
    app.include_router(overview.router)
    app.include_router(prototype.router)
    app.include_router(tick.router)
    serve_web(app)
    return app


def serve_web(app: FastAPI) -> None:
    """Serves the built web app (web/dist) at /, with every other path falling
    back to index.html so the app's own routes work on reload."""
    dist = Path(settings.raw("WEB_DIST"))
    dist = dist if dist.is_absolute() else settings.PROJECT / dist
    index = dist / "index.html"
    if not index.exists():
        return
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def web(path: str):
        if path.split("/")[0] in ("api", "internal", "health", "docs", "openapi.json", "redoc"):
            raise HTTPException(404)
        f = (dist / path).resolve()
        if path and f.is_file() and dist.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(index)


app = create_app()
