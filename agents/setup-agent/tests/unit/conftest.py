"""Fixtures: the contract's API in-process, with a scripted router in place of the model."""

import json

import httpx
import pytest
from fastapi import FastAPI

from app import engine, router, turn_api
from app.router import RouterChoice
from app.sessions import SessionStore


class ScriptedRouter:
    """Answers each router call with the next scripted choice (None: every model failed)."""

    def __init__(self):
        self.script: list[RouterChoice | None] = []
        self.calls: list[tuple[str, str | None, bool]] = []

    async def __call__(self, message, current, has_institution):
        self.calls.append((message, current, has_institution))
        return (self.script.pop(0) if self.script else None), 1


@pytest.fixture
def scripted(monkeypatch):
    r = ScriptedRouter()
    monkeypatch.setattr(router, "_router", r)
    monkeypatch.setattr(engine, "_responder", engine.not_built)
    return r


@pytest.fixture
def client(scripted):
    app = FastAPI()
    app.include_router(turn_api.router)
    app.state.sessions = SessionStore()
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent")


H = {"X-Amiri-Contract": "1.0"}


def context(institution: dict | None = None, current: str | None = None) -> dict:
    return {"thread_id": "thr-1", "institution": institution, "readiness": None, "filled_by": None,
            "profile_version": 3 if institution else None, "changes_since_last_session": [], "tracks": [],
            "track_definitions": [], "current_track": current, "thread_summary": None, "recent_messages": [],
            "pending_proposals": []}


async def start(client, institution_id: str | None = None, current: str | None = None) -> str:
    inst = {"institution_id": institution_id, "name": "Bank"} if institution_id else None
    r = await client.post("/sessions", headers=H, json={
        "session_id": "ses-1", "thread_id": "thr-1", "user_id": "u@x", "institution_id": institution_id,
        "server_url": "http://server", "context": context(inst, current)})
    assert r.status_code == 201, r.text
    return r.json()["agent_session_id"]


async def turn(client, sid: str, institution_id: str | None = None, **kw) -> list[tuple[str, dict]]:
    body = {"turn_id": "t-1", "session_id": "ses-1", "thread_id": "thr-1", "institution_id": institution_id,
            "user_id": "u@x", "current_track": None, "profile_version": None, **kw}
    r = await client.post(f"/sessions/{sid}/turns", headers=H, json=body)
    assert r.status_code == 200, r.text
    out = []
    for block in r.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out
