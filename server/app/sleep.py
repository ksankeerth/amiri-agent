"""Asleep: the server starts and answers even when its database is stopped.

In Google Cloud the database can be stopped to save money when nobody is testing
(infra/terraform, `awake = false`). The server then starts anyway: the web app and
sign-in work, and every API call answers 503 `asleep` with Retry-After, so the web app
shows a "paused" page instead of errors.

While asleep, a request at most every DB_WAKE_PROBE_SECONDS tries the database (a single
connection, DB_CONNECT_TIMEOUT_SECONDS). Once it answers, the pool opens, pending
migrations and reference data load, and the server is awake: nothing needs a restart.
"""

import asyncio
import logging
import time

import psycopg
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app import db, settings
from app.problems import Problem, problem_response
from app.reference import load as refload

logger = logging.getLogger(__name__)

# what needs the database; the rest works without it: liveness (/health), sign-in, robots, the API docs, the web app
NEEDS_DB = ("/api/", "/internal/", "/health/")
OPEN = ("/api/v1/auth/",)  # sign-in (its config says whether the server is asleep)


class State:
    def __init__(self) -> None:
        self.awake = False
        self.last_probe = 0.0
        self.lock = asyncio.Lock()


def state(app: FastAPI) -> State:
    if not hasattr(app.state, "sleep"):
        app.state.sleep = State()
    return app.state.sleep


async def wake(app: FastAPI, url: str, force: bool = False) -> bool:
    """Tries the database (at most every DB_WAKE_PROBE_SECONDS unless forced). True when awake."""
    st = state(app)
    if st.awake:
        return True
    async with st.lock:
        if st.awake:
            return True
        now = time.monotonic()
        if not force and now - st.last_probe < settings.number("DB_WAKE_PROBE_SECONDS"):
            return False
        st.last_probe = now
        try:
            conn = await psycopg.AsyncConnection.connect(url, connect_timeout=settings.integer("DB_CONNECT_TIMEOUT_SECONDS"),
                                                         autocommit=True)
            await conn.close()
            pool = app.state.pool
            await pool.open(wait=True, timeout=settings.number("DB_CONNECT_TIMEOUT_SECONDS") * 2)
            if settings.flag("AUTO_MIGRATE"):
                async with pool.connection() as c:
                    await db.migrate(c)
                    await refload.load(c)
        except Exception as e:  # stopped, starting, or unreachable: stay asleep
            logger.warning("database not reachable (%s: %s); the server is asleep", type(e).__name__, str(e)[:200])
            return False
        st.awake = True
        logger.info("database reachable: the server is awake")
        return True


class Asleep(BaseHTTPMiddleware):
    """While the database is unreachable, API calls answer 503 `asleep` (the web app shows a paused page)."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        app = request.app
        if state(app).awake or not path.startswith(NEEDS_DB) or path.startswith(OPEN):
            return await call_next(request)
        if await wake(app, app.state.database_url):
            return await call_next(request)
        return problem_response(Problem(503, "asleep", "Amiri Agent is paused to save costs: its database is stopped. "
                                                       "Ask the person who runs it to wake it up.", retry_after=60))
