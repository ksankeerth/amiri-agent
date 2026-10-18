"""The shared track loop through the real ADK runner, with a scripted model in place of Gemini
and a fake amiri-server behind httpx's mock transport."""

import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

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
from app.router import RouterChoice
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
        self.decided: list[dict] = []  # GET /proposals: proposals and how they were decided
        self.suggestions: dict[str, list] = {"flows": [{"added": False, "item": FLOW}]}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        p = request.url.path
        if p.endswith("/context"):
            return httpx.Response(200, json=CTX)
        if p.endswith("/readiness"):
            return httpx.Response(200, json={"ready": False, "checks": [
                {"id": "flows", "level": "recommended", "ok": False, "message": "No flows yet", "section": "flows"}]})
        if "/suggestions/" in p:
            return httpx.Response(200, json={"items": self.suggestions.get(p.rsplit("/", 1)[1], [])})
        if p == "/api/v1/proposals" and request.method == "GET":  # what was decided (track_loop._decided)
            return httpx.Response(200, json=self.decided)
        if p == "/api/v1/reference/countries":
            return httpx.Response(200, json={"items": [{"code": "LK"}, {"code": "PH"}],
                                             "region": {"id": "japac", "label": "Japan and Asia-Pacific (JAPAC)"}})
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


def system_text(req: LlmRequest) -> str:
    si = req.config.system_instruction
    return si if isinstance(si, str) else " ".join(p.text or "" for p in getattr(si, "parts", []) or [])


async def test_first_setup_states_the_supported_region(world, monkeypatch):
    client, _server, llm = world
    monkeypatch.setattr(track_loop, "_region", None)
    llm.script = ["This prototype supports institutions based in Japan and Asia-Pacific; a UK home isn't supported yet."]
    sid = await start(client, institution=False)
    await turn(client, sid, track="institution", institution=False, text="We're a UK insurer in London.")
    txt = system_text(llm.requests[0])
    assert "Japan and Asia-Pacific (JAPAC)" in txt and "LK, PH" in txt and "don't propose" in txt
    # not repeated in a track of an existing institution
    llm.script = ["ok"]
    sid = await start(client)
    await turn(client, sid, text="hi")
    assert "Supported region" not in system_text(llm.requests[-1])


async def test_a_failed_or_declined_proposal_is_told_once(world):
    client, server, llm = world
    now = datetime.now(UTC).isoformat()
    server.decided = [
        {"proposal_id": "p-1", "status": "failed", "summary": "Create Thamesgate General", "decided_at": now,
         "result": {"detail": "the prototype covers JAPAC only"}},
        {"proposal_id": "p-2", "status": "rejected", "summary": "Add Kuwait", "decided_at": now, "result": None},
        {"proposal_id": "p-3", "status": "confirmed", "summary": "Add Kerala", "decided_at": now, "result": {}},
        {"proposal_id": "p-4", "status": "failed", "summary": "Old one", "decided_at": "2026-01-01T00:00:00+00:00",
         "result": {"detail": "x"}},
    ]
    llm.script = ["Sorry, that didn't go through.", "ok"]
    sid = await start(client)
    await turn(client, sid, text="Did it work?")
    txt = system_text(llm.requests[0])
    assert "“Create Thamesgate General” FAILED, nothing was saved: the prototype covers JAPAC only" in txt
    assert "declined “Add Kuwait”" in txt and "Add Kerala" not in txt and "Old one" not in txt
    await turn(client, sid, text="And now?")
    assert "FAILED" not in system_text(llm.requests[-1])  # said once


async def test_the_institution_track_cant_end_without_an_institution(world):
    client, _server, llm = world
    llm.script = [[("conclude", {"summary": "Set up Thamesgate General"})], "Not set up yet."]
    sid = await start(client, institution=False)
    evs = await turn(client, sid, track="institution", institution=False, text="We write motor cover.")
    assert "track_concluded" not in [e for e, _ in evs]
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "blocked" and "no institution yet" in reply["message"]


async def test_an_empty_turn_gets_one_more_try(world):
    client, _server, llm = world
    llm.script = ["", "Which regulator shall I add first: RBNZ or APRA?"]
    sid = await start(client)
    evs = await turn(client, sid, text="Our home regulator, the Australian one, and sanctions for USD?")
    msgs = [d["text"] for e, d in evs if e == "message"]
    assert msgs == ["Which regulator shall I add first: RBNZ or APRA?"]
    assert "ended without a reply" in llm.requests[-1].contents[-1].parts[0].text


async def test_a_claimed_proposal_that_wasnt_made_never_reaches_the_user(world):
    client, _server, llm = world
    claim = "I have proposed adding New Zealand earthquakes. Please review and apply the proposal."
    # it claims, is told it didn't propose, and then proposes for real
    llm.script = [claim, [("propose", {"summary": "Add earthquakes", "operations": [
        {"op": "create", "section": "flows", "data": FLOW}], "institution": None, "monitors": None, "evidence": None})],
        "Here it is: nothing changes until you apply it."]
    sid = await start(client)
    evs = await turn(client, sid, track="footprint_flows", text="Add earthquakes and droughts.")
    assert ("proposal", {"proposal_id": "prop-1"}) in evs
    assert claim not in [d["text"] for e, d in evs if e == "message"]
    assert "didn't call propose" in llm.requests[1].contents[-1].parts[0].text
    # it claims twice: the user is told plainly that nothing was proposed
    llm.script = [claim, claim]
    sid = await start(client)
    evs = await turn(client, sid, track="footprint_flows", text="Add earthquakes and droughts.")
    assert "proposal" not in [e for e, _ in evs]
    assert [d["text"] for e, d in evs if e == "message"] == [track_loop.NO_PROPOSAL]


async def test_a_short_yes_after_a_question_stays_in_the_track_that_asked(world):
    client, _server, llm = world
    route = router._router
    llm.script = ["Shall I add all four regulators?", "Done: here's the proposal."]
    sid = await start(client)
    await turn(client, sid, track="rules", text="Which regulators apply to us?")
    route.script = [RouterChoice(track="institution", reason="mentions the bank", clearly_elsewhere=True)]
    evs = await turn(client, sid, track=None, current_track="rules", text="Yes please.")
    assert "track" not in [e for e, _ in evs]  # stayed in rules
    assert "Yes please." not in [m for m, _, _ in route.calls]  # the router wasn't even asked
    from app.engine import is_short_reply
    assert is_short_reply("Yes please.") and is_short_reply("no") and is_short_reply("Both, thanks")
    assert not is_short_reply("Yesterday we opened a branch in Kerala") and not is_short_reply("We also lend to farmers")


async def test_a_track_cant_end_while_its_proposal_waits_for_apply(world):
    client, server, llm = world
    server.decided = [{"proposal_id": "prop-9", "status": "pending", "track": "footprint_flows",
                       "summary": "Add Seoul and Gyeonggi", "decided_at": None}]
    llm.script = [[("conclude", {"summary": "Added Seoul and Gyeonggi"})], "The card above still needs your Apply."]
    sid = await start(client)
    evs = await turn(client, sid, track="footprint_flows", text="Yes, add Seoul and Gyeonggi as branches.")
    assert "track_concluded" not in [e for e, _ in evs]
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "blocked" and "“Add Seoul and Gyeonggi” is still waiting" in reply["message"]
    assert "NOT saved until applied): Add Seoul and Gyeonggi" in system_text(llm.requests[0])


async def test_empty_flow_figures_and_a_missing_home_regulator_come_with_a_reminder(world):
    client, server, llm = world
    server.suggestions = {"flows": [], "regulators": [
        {"added": False, "item": {"regulator_id": "global-fatf", "name": "FATF", "relation": "standard"}}]}
    llm.script = [[("get_suggestions", {"section": "flows"}), ("get_suggestions", {"section": "regulators"})], "ok"]
    sid = await start(client)
    await turn(client, sid, text="Our expats send money home to Indonesia.")
    flows, regs = (p.function_response.response for p in llm.requests[1].contents[-1].parts)
    assert "never drop them" in flows["note"] and "no regulator for the home country" in regs["note"]


async def test_proposal_warnings_reach_the_model(world):
    client, server, llm = world
    server.proposal_answers = [(201, {"proposal_id": "prop-1", "warnings": [
        {"section": "products", "id": "savings", "code": "no_segments", "message": "no customer group"}]})]
    llm.script = [[("propose", {"summary": "Add savings", "operations": [
        {"op": "create", "section": "products", "data": {"name": "Savings"}}], "institution": None, "monitors": None,
        "evidence": None})], "Which groups use savings?"]
    sid = await start(client)
    await turn(client, sid, track="customers_products", text="We offer savings.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert "ask which groups use it: savings: no customer group" in reply["message"]


async def test_currencies_go_on_their_own_card_before_regulators(world):
    client, server, llm = world
    ops = [{"op": "update", "section": "institution", "data": {"clearing_currencies": ["USD", "AUD"]}},
           {"op": "create", "section": "regulators", "data": {"name": "UN"}}]
    llm.script = [[("propose", {"summary": "x", "operations": ops, "institution": None, "monitors": None,
                                "evidence": None})], "ok"]
    sid = await start(client)
    await turn(client, sid, track="rules", text="We settle in USD and AUD; add the regulators.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "error" and "clearing currencies on their own first" in reply["message"]
    assert server.posted() == []


async def test_the_model_hears_what_the_card_actually_holds(world):
    client, server, llm = world
    server.proposal_answers = [(201, {"proposal_id": "prop-1", "changes": [
        {"op": "create", "section": "regulators", "id": "global-un"}]})]
    llm.script = [[("propose", {"summary": "Add regulators", "operations": [
        {"op": "create", "section": "regulators", "data": {"name": "UN"}}], "institution": None, "monitors": None,
        "evidence": None})], "Here it is."]
    sid = await start(client)
    await turn(client, sid, track="rules", text="Add the regulators.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert "The card holds exactly: create regulators global-un." in reply["message"]


async def test_a_hazard_the_finder_didnt_suggest_is_refused(world):
    client, server, llm = world
    server.suggestions = {"risk-exposures": []}
    exp = {"kind": "climate", "title": "Japan earthquakes", "places": ["JP"], "hazard_id": "jp-earthquake"}
    llm.script = [[("propose", {"summary": "Add Japan earthquakes", "operations": [
        {"op": "create", "section": "risk-exposures", "data": exp}], "institution": None, "monitors": None,
        "evidence": None})], "The risk finder has nothing for your places."]
    sid = await start(client)
    await turn(client, sid, track="risks", text="Propose our risks.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "error" and reply["message"].startswith("jp-earthquake: not suggested by the risk finder")
    assert server.posted() == []


async def test_facts_noted_for_other_tracks_are_offered_next(world, monkeypatch):
    from app import router
    from app.router import RouterChoice, RouterNote

    async def fake(message, current, has_institution):
        return RouterChoice(track="customers_products", clearly_elsewhere=True, reason="products", notes=[
            RouterNote(track="footprint_flows", text="Operate in Seoul and Gyeonggi")]), 1
    monkeypatch.setattr(router, "_router", fake)
    client, _server, llm = world
    llm.script = ["Which groups buy motor cover?"]
    sid = await start(client)
    await turn(client, sid, track="customers_products", requested_track=None,
               text="We write motor cover in Seoul and Gyeonggi.")
    assert "“Operate in Seoul and Gyeonggi” → Footprint and flows" in system_text(llm.requests[0])


async def test_a_card_waiting_in_another_track_is_pointed_out_once(world):
    client, server, llm = world
    server.decided = [{"proposal_id": "prop-9", "status": "pending", "track": "footprint_flows",
                       "summary": "Add Seoul and Gyeonggi", "decided_at": None}]
    llm.script = ["Which groups buy motor cover?", "Noted."]
    sid = await start(client)
    evs = await turn(client, sid, track="customers_products", text="We sell motor cover.")
    msg = next(d["text"] for e, d in evs if e == "message")
    assert msg.endswith("Still waiting for your Apply, so nothing of it is saved yet: “Add Seoul and Gyeonggi”.")
    evs = await turn(client, sid, track="customers_products", text="To households.")
    assert "Still waiting" not in next(d["text"] for e, d in evs if e == "message")


async def test_a_name_is_asked_in_text_not_as_options(world):
    client, _server, llm = world
    llm.script = [[("ask_user", {"question": "What is your broker's name?", "options": ["Aon", "Marsh"],
                                 "multi": False})], "What is your broker called?"]
    sid = await start(client)
    evs = await turn(client, sid, track="rivals_partners", text="Add a broker partner.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "error" and "a name isn't a choice" in reply["message"]
    assert "question" not in [e for e, _ in evs]


async def test_a_custom_risk_must_be_in_the_users_words(world):
    client, _server, llm = world
    made_up = {"kind": "climate", "title": "Monsoon flooding in Seoul and Gyeonggi", "places": ["KR-11"]}
    theirs = {"kind": "climate", "title": "Typhoons hitting Busan", "places": ["KR-26"]}
    llm.script = [[("propose", {"summary": "x", "operations": [{"op": "create", "section": "risk-exposures",
                                                                 "data": made_up}],
                                "institution": None, "monitors": None, "evidence": None})], "ok",
                  [("propose", {"summary": "x", "operations": [{"op": "create", "section": "risk-exposures",
                                                                 "data": theirs}],
                                "institution": None, "monitors": None, "evidence": None})], "Here it is."]
    sid = await start(client)
    await turn(client, sid, track="risks", text="Propose the key risks for our cover in Seoul and Gyeonggi.")
    assert "isn't in the user's words" in llm.requests[1].contents[-1].parts[0].function_response.response["message"]
    evs = await turn(client, sid, track="risks", text="We worry about typhoons hitting Busan.")
    assert ("proposal", {"proposal_id": "prop-1"}) in evs


async def test_a_superseded_card_is_not_pointed_out(world):
    client, server, llm = world
    server.decided = [  # newest first, as the server lists them
        {"proposal_id": "p2", "status": "pending", "track": "footprint_flows", "kind": "profile",
         "summary": "Add Seoul and Gyeonggi", "decided_at": None},
        {"proposal_id": "p1", "status": "pending", "track": "footprint_flows", "kind": "profile",
         "summary": "Add Seoul", "decided_at": None},
        {"proposal_id": "p0", "status": "pending", "track": "institution", "kind": "create_institution",
         "summary": "Create Hangang (non-life)", "decided_at": None}]
    llm.script = ["Noted."]
    sid = await start(client)
    evs = await turn(client, sid, track="customers_products", text="We sell motor cover.")
    msg = next(d["text"] for e, d in evs if e == "message")
    assert msg.endswith("nothing of it is saved yet: “Add Seoul and Gyeonggi”.")


async def test_products_created_with_groups_must_be_linked(world):
    client, server, llm = world
    ops = [{"op": "create", "section": "segments", "data": {"id": "homeowners", "label": "Homeowners"}},
           {"op": "create", "section": "products", "data": {"name": "Home", "category": "property"}}]
    llm.script = [[("propose", {"summary": "x", "operations": ops, "institution": None, "monitors": None,
                                "evidence": None})], "Which groups buy home cover?"]
    sid = await start(client)
    await turn(client, sid, track="customers_products", text="Homeowners buy home cover.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "error" and reply["message"].startswith("Home: no customer group")
    assert server.posted() == []


async def test_the_risks_track_cant_browse_the_worldwide_hazard_library(world):
    client, _server, llm = world
    llm.script = [[("get_reference", {"name": "hazards"})], "The risk finder has nothing for your places."]
    sid = await start(client)
    await turn(client, sid, track="risks", text="Propose our main risks.")
    reply = llm.requests[1].contents[-1].parts[0].function_response.response
    assert reply["status"] == "blocked" and "the hazard library is worldwide" in reply["message"]
