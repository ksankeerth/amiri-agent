"""Today's setup prompts for institutions without a region pack (Sri Lanka), and before the
institution exists, pinned.

Each track's instruction, as the scripted model receives it through the real ADK runner, must stay
exactly as it was at ce1d73e for a Sri Lankan institution and for a new one with no home country yet.
The expected text is in tests/fixtures/snapshots/ and is never regenerated: a difference here is a
change in behaviour.
"""

import json
from pathlib import Path

import httpx
import pytest
from conftest import H, ScriptedRouter, context
from fastapi import FastAPI
from test_track_loop import FakeServer, ScriptedLlm, system_text

from app import engine, router, track_loop, turn_api
from app.guides import GUIDES
from app.sessions import SessionStore

SNAPSHOTS = Path(__file__).parents[1] / "fixtures" / "snapshots"
LK = {"institution_id": "serendib-bank", "name": "Serendib Commercial Bank", "institution_type": "bank",
      "subtype": "commercial", "country": "LK", "currency": "LKR", "time_zone": "Asia/Colombo",
      "summary": "Mid-size commercial bank: retail deposits, SME lending, pawning; branches in South India.",
      "footprint": [{"code": "LK", "name": "Sri Lanka", "role": "head_office"}],
      "segments": [{"id": "migrant-families", "label": "Migrant-worker families"}],
      "products": [{"id": "pawning", "name": "Pawning", "category": "gold_loan", "product_type": "gold_loan"}],
      "flows": [{"kind": "remittances_in", "local": "LK", "counterpart": "SA"}],
      "regulators": [{"name": "Central Bank of Sri Lanka", "short": "CBSL", "area": "banking"}],
      "radar_scope": {"places": ["LK", "SA"]}}
TRACKS = sorted(GUIDES)


class Server(FakeServer):
    def __init__(self, ctx: dict):
        super().__init__()
        self.ctx = ctx

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/context"):
            return httpx.Response(200, json=self.ctx)
        return super().handler(request)


async def prompts(monkeypatch, ctx: dict | None) -> dict[str, str]:
    """Each track's system instruction for one turn ("Hello."), in a new chat session."""
    monkeypatch.setattr(track_loop, "_region", None)
    out = {}
    for track in TRACKS:
        server, llm = Server(ctx or {}), ScriptedLlm(script=["Hello."])
        monkeypatch.setattr(router, "_router", ScriptedRouter())
        monkeypatch.setattr(engine, "_responder", track_loop.respond)
        monkeypatch.setattr(track_loop, "_model", lambda llm=llm: llm)
        app = FastAPI()
        app.include_router(turn_api.router)
        app.state.sessions = SessionStore(transport=httpx.MockTransport(server.handler))
        iid = ctx["institution_id"] if ctx else None
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent") as client:
            r = await client.post("/sessions", headers=H, json={
                "session_id": "ses-1", "thread_id": "thr-1", "user_id": "u@x", "institution_id": iid,
                "server_url": "http://server", "context": context(ctx)})
            sid = r.json()["agent_session_id"]
            r = await client.post(f"/sessions/{sid}/turns", headers=H, json={
                "turn_id": "t", "session_id": "ses-1", "thread_id": "thr-1", "institution_id": iid, "user_id": "u@x",
                "current_track": track, "requested_track": track, "profile_version": 3 if ctx else None,
                "text": "Hello."})
            assert r.status_code == 200, r.text
        out[track] = system_text(llm.requests[0])
    return out


@pytest.mark.parametrize("name, ctx", [("lk", LK), ("new", None)])
async def test_setup_prompts_are_unchanged(monkeypatch, name, ctx):
    got = await prompts(monkeypatch, ctx)
    assert got == json.loads((SNAPSHOTS / f"setup_prompts_{name}.json").read_text())
