"""The server starts with its database stopped, answers `asleep`, and wakes once it answers."""

import httpx
import pytest

from app import settings, sleep
from app.main import create_app

DOWN = "postgresql://amiri:amiri@127.0.0.1:1/nothing"  # nothing listens on port 1


@pytest.fixture
async def asleep_app(env, monkeypatch):
    monkeypatch.setenv("DB_CONNECT_TIMEOUT_SECONDS", "1")
    monkeypatch.setenv("DB_WAKE_PROBE_SECONDS", "0")
    app = create_app(database_url=DOWN)
    async with app.router.lifespan_context(app):
        yield app


async def test_starts_and_answers_asleep(asleep_app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asleep_app), base_url="http://test") as c:
        assert (await c.get("/health")).status_code == 200
        cfg = (await c.get("/api/v1/auth/config")).json()
        assert cfg["asleep"] is True
        r = await c.get("/api/v1/installation")
        assert r.status_code == 503 and r.json()["code"] == "asleep" and r.headers["Retry-After"] == "60"
        assert (await c.post("/internal/tick")).status_code == 503
        assert (await c.get("/health/details")).status_code == 503


async def test_wakes_when_the_database_answers(asleep_app):
    asleep_app.state.database_url = settings.raw("TEST_DATABASE_URL")
    asleep_app.state.pool.conninfo = asleep_app.state.database_url
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=asleep_app), base_url="http://test") as c:
        assert (await c.get("/api/v1/auth/config")).json()["asleep"] is False
        assert sleep.state(asleep_app).awake
        assert (await c.get("/api/v1/installation")).status_code == 200
