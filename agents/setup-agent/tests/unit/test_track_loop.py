"""The shared track loop through the real ADK runner, with a scripted model in place of Gemini
and a fake amiri-server behind httpx's mock transport."""

import json
from collections.abc import AsyncGenerator

import httpx
import pytest
from conftest import H, ScriptedRouter, context
from fastapi import FastAPI
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from app import engine, router, track_loop, turn_api
from app.sessions import SessionStore

CTX = {"institution_id": "bank-1", "name": "Test Bank", "institution_type": "bank", "country": "LK", "currency": "LKR",
       "segments": [{"id": "farmers", "label": "Farmers"}], "flows": [], "radar_scope": {"places": ["LK"]}}
FLOW = {"kind": "remittances_in", "local": "LK", "counterpart": "SA", "figure_id": "remittances-in-lk-sa-2024",
        "value": {"amount": 1200000000, "currency": "USD", "year": 2024}}


class ScriptedLlm(BaseLlm):
    """Each call returns the next step: a list of (tool, args) calls, or a text reply."""

    model: str = "scripted"
    script: list = Field(default_factory=list)
    requests: list = Field(default_factory=list)

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        step = self.script.pop(0) if self.script else "Done."
        if isinstance(step, str):
            parts = [types.Part(text=step)]
        else:
            parts = [types.Part(function_call=types.FunctionCall(name=n, args=a)) for n, a in step]
        yield LlmResponse(content=types.Content(role="model", parts=parts),
                          usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=100, candidates_token_count=10))


class FakeServer:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.proposal_answers: list[tuple[int, dict]] = []  # (status, body) for POST /proposals, in order

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        p = request.url.path
        if p.endswith("/context"):
            return httpx.Response(200, json=CTX)
        if p.endswith("/readiness"):
            return httpx.Response(200, json={"ready": False, "checks": [
                {"id": "flows", "level": "recommended", "ok": False, "message": "No flows yet", "section": "flows"}]})
        if p.endswith("/suggestions/flows"):
            return httpx.Response(200, json={"items": [{"added": False, "item": FLOW}]})
        if p == "/api/v1/proposals":
            status, body = self.proposal_answers.pop(0) if self.proposal_answers else (201, {"proposal_id": "prop-1"})
            return httpx.Response(status, json=body)
        if p == "/api/v1/monitors:draftable":
            return httpx.Response(200, json={"items": []})
        return httpx.Response(404, json={"detail": f"no fake for {p}"})

    def posted(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests if r.method == "POST"]


@pytest.fixture
def world(monkeypatch):
    server, llm, route = FakeServer(), ScriptedLlm(), ScriptedRouter()
    monkeypatch.setattr(router, "_router", route)
    monkeypatch.setattr(engine, "_responder", track_loop.respond)
    monkeypatch.setattr(track_loop, "_model", lambda: llm)
    app = FastAPI()
    app.include_router(turn_api.router)
    app.state.sessions = SessionStore(transport=httpx.MockTransport(server.handler))
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent")
    return client, server, llm


async def start(client, institution: bool = True) -> str:
    r = await client.post("/sessions", headers=H, json={
        "session_id": "ses-1", "thread_id": "thr-1", "user_id": "u@x", "institution_id": "bank-1" if institution else None,
        "server_url": "http://server", "context": context(CTX if institution else None)})
    return r.json()["agent_session_id"]


async def turn(client, sid, track="footprint_flows", institution=True, **kw) -> list[tuple[str, dict]]:
    body = {"turn_id": "t", "session_id": "ses-1", "thread_id": "thr-1", "institution_id": "bank-1" if institution else None,
            "user_id": "u@x", "current_track": track, "requested_track": track, "profile_version": 3, **kw}
    r = await client.post(f"/sessions/{sid}/turns", headers=H, json=body)
    assert r.status_code == 200, r.text
    out = []
    for block in r.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        if lines["event"] not in ("done", "text_delta"):
            out.append((lines["event"], json.loads(lines["data"])))
    return out


async def test_a_track_proposes_a_suggestion_and_says_so(world):
    client, server, llm = world
    llm.script = [[("get_suggestions", {"section": "flows"})],
                  [("propose", {"summary": "Add Saudi remittances", "operations": [
                      {"op": "create", "section": "flows", "data": FLOW}], "institution": None, "monitors": None,
                      "evidence": [{"operation": 0, "from": "suggestion:flows/remittances-in-lk-sa-2024"}]})],
                  "Here's the Saudi flow from the published figures. Nothing changes until you apply it."]
    sid = await start(client)
    evs = await turn(client, sid, text="Add our Gulf remittances.")
    assert ("proposal", {"proposal_id": "prop-1"}) in evs
    assert evs[-2][0] == "message" and evs[-2][1]["text"].startswith("Here's the Saudi flow")
    assert evs[-1] == ("usage", {"model_calls": 3, "input_tokens": 300, "output_tokens": 30})
    sent = server.posted()[0]
    assert (sent["track"], sent["kind"], sent["thread_id"], sent["session_id"], sent["on_behalf_of"]) == (
        "footprint_flows", "profile", "thr-1", "ses-1", "u@x")
    assert sent["operations"][0]["data"]["figure_id"] == "remittances-in-lk-sa-2024"
    hdr = next(r for r in server.requests if r.method == "POST").headers
    assert hdr["X-Amiri-On-Behalf-Of"] == "u@x" and hdr["X-Amiri-Source"] == "assistant"
    sys = llm.requests[0].config.system_instruction
    assert "Test Bank, a bank in LK" in sys and "radar_scope" not in sys and "No flows yet" in sys


async def test_a_refused_proposal_is_repaired_at_most_twice(world):
    client, server, llm = world
    bad = (422, {"detail": "Numbers in the proposal aren't backed.", "errors": [
        {"operation": 0, "field": "value.amount", "code": "unsupported_number", "message": "1.5bn isn't backed"}]})
    server.proposal_answers = [bad, bad, (201, {"proposal_id": "prop-9"})]
    call = ("propose", {"summary": "x", "operations": [{"op": "create", "section": "flows", "data": FLOW}],
                        "institution": None, "monitors": None, "evidence": None})
    llm.script = [[call], [call], [call], "Fixed: here it is."]
    sid = await start(client)
    evs = await turn(client, sid, text="Add Kuwait.")
    assert ("proposal", {"proposal_id": "prop-9"}) in evs
    replies = [json.loads(json.dumps(c.parts[0].function_response.response)) for r in llm.requests[1:3]
               for c in r.contents[-1:] if c.parts[0].function_response]
    assert all(x["status"] == "error" and x["errors"][0]["code"] == "unsupported_number" for x in replies)

    server.proposal_answers = [bad, bad, bad]
    llm.script = [[call], [call], [call], "I couldn't propose that."]
    sid = await start(client)
    evs = await turn(client, sid, text="Add Kuwait.")
    assert "proposal" not in [e for e, _ in evs]
    last = llm.requests[-1].contents[-1].parts[0].function_response.response
    assert last["status"] == "blocked" and "Don't retry" in last["message"]


async def test_code_picks_the_kind_the_track_proposes(world):
    client, server, llm = world
    inst = {"name": "New Bank", "institution_type": "bank", "home_country": "PH", "base_currency": "PHP",
            "time_zone": "Asia/Manila"}
    llm.script = [[("propose", {"summary": "Create New Bank", "operations": None, "institution": inst, "monitors": None,
                                "evidence": None})], "Here's your institution."]
    sid = await start(client, institution=False)
    await turn(client, sid, track="institution", institution=False, text="New Bank, Philippines.")
    assert server.posted()[0]["kind"] == "create_institution" and server.posted()[0]["institution"] == inst

    llm.script = [[("propose", {"summary": "x", "operations": [{"op": "create", "section": "flows", "data": FLOW}],
                                "institution": None, "monitors": None, "evidence": None})], "ok"]
    sid = await start(client)
    await turn(client, sid, track="monitors", text="Watch Saudi jobs.")
    reply = llm.requests[-1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "error" and "put the changes in monitors" in reply["message"]


async def test_a_question_then_its_answer(world):
    client, _server, llm = world
    llm.script = [[("ask_user", {"question": "Which kind of bank?", "options": ["Commercial", "Savings"], "multi": False})]]
    sid = await start(client, institution=False)
    evs = await turn(client, sid, track="institution", institution=False, text="We're a bank.")
    q = next(d for e, d in evs if e == "question")
    assert q["options"] == ["Commercial", "Savings"] and q["question_id"].startswith("q-")
    assert "message" not in [e for e, _ in evs]  # the question is the reply
    llm.script = ["Thanks."]
    await turn(client, sid, track="institution", institution=False, requested_track=None,
               answer={"question_id": q["question_id"], "options": ["Savings"]})
    said = llm.requests[-1].contents[-1].parts[0].text
    assert said == "My answer to “Which kind of bank?”: Savings"
    assert any("We're a bank." in (p.text or "") for c in llm.requests[-1].contents for p in c.parts)  # the track remembers


async def test_read_only_tracks_conclude_and_cannot_propose(world):
    client, server, llm = world
    llm.script = [[("propose", {"summary": "x", "operations": [], "institution": None, "monitors": None, "evidence": None})],
                  [("conclude", {"summary": "Explained what Amiri Agent does with risks"})], "Radar and monitors watch them."]
    sid = await start(client)
    evs = await turn(client, sid, track="question", text="What happens to our risks?")
    assert ("track_concluded", {"track": "question", "summary": "Explained what Amiri Agent does with risks"}) in evs
    assert server.posted() == []


async def test_too_many_steps_end_the_turn_with_an_error(world, monkeypatch):
    client, _server, llm = world
    monkeypatch.setenv("MAX_STEPS_PER_TURN", "2")
    llm.script = [[("get_readiness", {})]] * 5
    sid = await start(client)
    evs = await turn(client, sid, text="Check everything.")
    assert ("error", {"code": "step_limit", "message": "I took too many steps on that. Could you say it again, more simply?"}) in evs


async def test_every_track_has_a_guide_and_valid_tools():
    from app.guides import GUIDES
    from app.tracks import TRACKS

    assert set(GUIDES) == set(TRACKS) - {"offtopic"}
    for t, g in GUIDES.items():
        names = {f.__name__ for f in g.tools}
        assert ("propose" in names) != TRACKS[t].read_only, t
