"""The setup agent switches to the US guide as soon as the profile's home country is the US.

A new institution starts on the base guides; once it exists with home country US, every track's
instruction carries the US guide and the agent says so once. Sri Lanka and a chat with no institution
keep the base prompts exactly (tests/unit/test_snapshot_non_us.py pins them).
"""

import httpx
import pytest
from conftest import H, ScriptedRouter, context
from fastapi import FastAPI
from test_snapshot_non_us import LK, Server, prompts
from test_track_loop import ScriptedLlm, system_text

from app import engine, router, track_loop, turn_api
from app.guides import REGION_GUIDES, region_guide
from app.sessions import SessionStore

US = {"institution_id": "us-bank", "name": "Austin Tech Bank", "institution_type": "bank", "subtype": "commercial",
      "country": "US", "currency": "USD", "time_zone": "America/Chicago", "summary": "", "footprint": [],
      "segments": [], "products": [], "flows": [], "regulators": [], "radar_scope": {"places": ["US"]}}
GUIDE = (REGION_GUIDES / "us.txt").read_text().strip()
SAID = "Got it, a US bank: I'll use the US setup guide."


class UsServer(Server):
    """The fake server, with the US region and the institution as it is now (None: not created yet)."""

    def __init__(self):
        super().__init__({})
        self.institution: dict | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        p = request.url.path
        if p.endswith("/context"):
            return httpx.Response(200, json=self.institution) if self.institution else httpx.Response(404, json={})
        if p == "/api/v1/reference/countries":
            return httpx.Response(200, json={"items": [{"code": "US"}], "region": {"id": "us", "label": "United States"}})
        return super().handler(request)


@pytest.fixture
def chat(monkeypatch):
    server, llm = UsServer(), ScriptedLlm()
    monkeypatch.setattr(router, "_router", ScriptedRouter())
    monkeypatch.setattr(engine, "_responder", track_loop.respond)
    monkeypatch.setattr(track_loop, "_model", lambda: llm)
    monkeypatch.setattr(track_loop, "_region", None)
    app = FastAPI()
    app.include_router(turn_api.router)
    app.state.sessions = SessionStore(transport=httpx.MockTransport(server.handler))
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent"), server, llm


async def start(client, pack_extra: dict | None = None) -> str:
    r = await client.post("/sessions", headers=H, json={
        "session_id": "ses-1", "thread_id": "thr-1", "user_id": "u@x", "institution_id": None,
        "server_url": "http://server", "context": {**context(None), **(pack_extra or {})}})
    assert r.status_code == 201, r.text
    return r.json()["agent_session_id"]


async def say(client, sid, text: str, track: str, institution_id: str | None) -> list[tuple[str, dict]]:
    import json

    r = await client.post(f"/sessions/{sid}/turns", headers=H, json={
        "turn_id": "t", "session_id": "ses-1", "thread_id": "thr-1", "institution_id": institution_id, "user_id": "u@x",
        "current_track": track, "requested_track": track, "profile_version": 1 if institution_id else None, "text": text})
    assert r.status_code == 200, r.text
    out = []
    for block in r.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        if lines["event"] not in ("done", "text_delta"):
            out.append((lines["event"], json.loads(lines["data"])))
    return out


def messages(events) -> list[str]:
    return [d["text"] for e, d in events if e == "message"]


async def test_an_austin_bank_gets_the_us_guide_once_its_home_country_is_set(chat):
    client, server, llm = chat
    sid = await start(client)

    # 1. no institution yet: the base guide; the model proposes the institution with home country US
    llm.script = [[("propose", {"summary": "Create Austin Tech Bank", "operations": None, "monitors": None, "evidence": None,
                                "institution": {"name": "Austin Tech Bank", "institution_type": "bank",
                                                "subtype": "commercial", "home_country": "US", "base_currency": "USD",
                                                "time_zone": "America/Chicago"}})],
                  "Here's the bank as a card. Nothing changes until you apply it."]
    ev = await say(client, sid, "We're a tech bank in Austin, Texas", "institution", None)
    sent = server.posted()[0]
    assert sent["kind"] == "create_institution" and sent["institution"]["home_country"] == "US"
    assert GUIDE not in system_text(llm.requests[0]) and not any(SAID in m for m in messages(ev))

    # 2. applied: the next turn's instruction carries the US guide, and the agent says so, once
    server.institution = US
    llm.script = ["Next, where does the bank operate?"]
    ev = await say(client, sid, "Done, what next?", "footprint_flows", "us-bank")
    assert GUIDE in system_text(llm.requests[-1])
    said = messages(ev)
    assert len(said) == 1 and said[0].startswith(SAID + "\n\n") and said[0].count(SAID) == 1

    # 3. not repeated, though the guide stays in every track
    llm.script = ["Which products does it offer?"]
    ev = await say(client, sid, "Branches in Texas only.", "customers_products", "us-bank")
    assert GUIDE in system_text(llm.requests[-1]) and not any(SAID in m for m in messages(ev))


async def test_the_servers_guide_text_wins_when_the_pack_carries_one(chat):
    client, server, llm = chat
    server.institution = US
    sid = await start(client, {"region_guide": {"region": "us", "version": "us-1", "text": "SERVER GUIDE TEXT"}})
    llm.script = ["Hello."]
    await say(client, sid, "Hello.", "rules", "us-bank")
    txt = system_text(llm.requests[-1])
    assert "SERVER GUIDE TEXT" in txt and GUIDE not in txt


def test_no_guide_without_a_us_home_country():
    assert region_guide(None) is None and region_guide({}) is None
    assert region_guide(LK) is None and region_guide({**US, "country": "ID"}) is None
    assert region_guide(US) == ("us", GUIDE)
    # a pack for another region doesn't replace this agent's copy
    assert region_guide(US, {"region_guide": {"region": "xx", "text": "other"}}) == ("us", GUIDE)


async def test_every_us_track_has_the_guide_and_no_lk_track_does(monkeypatch):
    us = await prompts(monkeypatch, US)
    assert all(GUIDE in p for p in us.values())
    lk = await prompts(monkeypatch, LK)
    assert not any("US setup guide" in p for p in lk.values())
    for track, text in us.items():  # the US prompt is the LK-style prompt plus the guide, nothing taken away
        assert text.count(GUIDE) == 1, track


async def test_an_existing_us_bank_is_not_told_again_each_session(chat):
    """The guide is in every turn, but the announcement is for the session where the home country becomes the US."""
    client, server, llm = chat
    server.institution = US
    sid = await start(client)
    for track, text in (("rules", "Hello."), ("customers_products", "Which products?")):
        llm.script = ["Sure."]
        ev = await say(client, sid, text, track, "us-bank")
        assert GUIDE in system_text(llm.requests[-1]) and not any(SAID in m for m in messages(ev))


async def test_a_home_country_changed_to_the_us_is_announced_once(chat):
    client, server, llm = chat
    server.institution = {**LK, "institution_id": "us-bank"}
    sid = await start(client)
    llm.script = ["Sure."]
    ev = await say(client, sid, "Hello.", "institution", "us-bank")
    assert GUIDE not in system_text(llm.requests[-1]) and not any(SAID in m for m in messages(ev))
    server.institution = US  # the home country is now the US
    for _ in range(2):
        llm.script = ["Sure."]
        ev = await say(client, sid, "And now?", "rules", "us-bank")
        said = [m for m in messages(ev) if SAID in m]
        assert GUIDE in system_text(llm.requests[-1])
        if _ == 0:
            assert said, messages(ev)
        else:
            assert not said


def test_the_guide_file_is_read_once():
    from app import guides

    guides._guide_file.cache_clear()
    region_guide(US), region_guide(US)
    assert guides._guide_file.cache_info().misses == 1
