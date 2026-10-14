"""The setup agent contract (app/assistant/contract.py): the conformance check, the
server's HTTP connector against the fake agent, failures, and the scenario runner."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from app.assistant import agent_check, scenarios
from app.assistant.agent import HttpAgent
from app.assistant.fake_agent import contract_openapi, create_fake_agent
from tests.test_assistant_api import ME, propose, say, session
from tests.test_institutions_api import new


def fake():
    app = create_fake_agent()
    return app, httpx.ASGITransport(app=app)


async def test_conformance_check_passes_on_the_fake_agent():
    _, transport = fake()
    results = await agent_check.Checker("http://agent", transport).run()
    bad = [r for r in results if not r.ok]
    assert not bad, agent_check.report(results)
    assert len(results) >= 20


async def test_conformance_check_catches_a_broken_agent():
    broken = FastAPI()

    @broken.get("/health")
    async def h():
        return {"status": "ok"}

    @broken.post("/sessions", status_code=201)
    async def s():
        return {"agent_session_id": "x"}

    @broken.post("/sessions/{sid}/turns")
    async def t(sid: str):
        async def ev():
            yield 'event: question\ndata: {"question_id": "q1", "text": "Pick", "options": []}\n\n'  # no options
            yield 'event: track\ndata: {"track": "marketing"}\n\n'  # not a track
        if sid != "x":
            raise RuntimeError("boom")  # a 500 for unknown sessions
        return StreamingResponse(ev(), media_type="text/event-stream")

    results = await agent_check.Checker("http://agent", httpx.ASGITransport(app=broken, raise_app_exceptions=False)).run()
    failed = {r.check for r in results if not r.ok}
    assert "first-setup message: every event matches the contract" in failed
    assert "POST /sessions sends the contract header" in failed
    assert "unknown session: 404 or 422, not 5xx" in failed


async def test_contract_openapi():
    spec = contract_openapi()
    assert set(spec["paths"]) == {"/health", "/health/details", "/sessions", "/sessions/{agent_session_id}/turns"}
    assert {"MessageEv", "QuestionEv", "TrackEv", "ProposalEv", "Event", "TurnIn", "AgentSessionIn"} <= set(spec["components"]["schemas"])


async def test_server_through_the_http_connector(client, app):
    _, transport = fake()
    app.state.assistant.agent = HttpAgent(transport=transport)
    assert (await client.get("/api/v1/assistant/status")).json() == {"backend": "http", "connected": True, "message": None}
    s = await session(client)
    assert s["agent_connected"] is True
    ev = await say(client, s["session_id"], "We're a commercial bank in Sri Lanka.")
    kinds = [e for e, _ in ev]
    assert kinds[0] == "start" and kinds[-1] == "done" and "track" in kinds and "message" in kinds and "question" in kinds

    # scripted: the agent made a proposal through the tools, and says so
    iid = (await new(client))["institution_id"]
    s2 = await session(client, iid)
    tid = (await client.get("/api/v1/assistant/thread", params={"institution_id": iid}, headers=ME)).json()["thread_id"]
    p = (await propose(client, thread_id=tid, session_id=s2["session_id"], track="rivals_partners", summary="Add a rival",
                       operations=[{"op": "create", "section": "rivals", "data": {"name": "Gulf Pay", "type": "wallet"}}])).json()
    script = [{"type": "track", "track": "rivals_partners"}, {"type": "message", "text": "Shall I add Gulf Pay?"},
              {"type": "proposal", "proposal_id": p["proposal_id"]}, {"type": "usage", "model_calls": 2, "input_tokens": 10, "output_tokens": 5}]
    async with httpx.AsyncClient(transport=transport, base_url="http://agent") as c:
        await c.post("/_script", json={"events": script})
    ev = await say(client, s2["session_id"], "Add Gulf Pay as a rival")
    prop = next(d for e, d in ev if e == "proposal")
    assert prop["proposal"]["proposal_id"] == p["proposal_id"] and prop["proposal"]["changes"][0]["section"] == "rivals"
    assert next(d for e, d in ev if e == "track")["tab"] == "rivals"

    # an off-contract event ends the turn cleanly
    async with httpx.AsyncClient(transport=transport, base_url="http://agent") as c:
        await c.post("/_script", json={"events": [{"type": "question", "question_id": "q", "text": "?", "options": []}]})
    ev = await say(client, s2["session_id"], "hmm")
    assert next(d for e, d in ev if e == "error")["code"] == "agent_contract_violation"

    # the agent restarted and lost the session: the next message starts a new one
    async with httpx.AsyncClient(transport=transport, base_url="http://agent") as c:
        await c.delete("/_script")
    ev = await say(client, s2["session_id"], "still there?")
    assert next(d for e, d in ev if e == "error")["code"] == "agent_session_lost"
    r = await client.post("/api/v1/assistant/run_sse", json={"session_id": s2["session_id"], "text": "hi"}, headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "session_ended"
    s3 = await session(client, iid)
    assert s3["session_id"] != s2["session_id"]
    ev = await say(client, s3["session_id"], "hello again")
    assert "message" in [e for e, _ in ev]


async def test_agent_down(client, app):
    def refuse(request):
        raise httpx.ConnectError("refused")
    app.state.assistant.agent = HttpAgent(transport=httpx.MockTransport(refuse))
    st = (await client.get("/api/v1/assistant/status")).json()
    assert st["connected"] is False and st["backend"] == "http"
    s = await session(client)
    assert s["agent_connected"] is False
    ev = await say(client, s["session_id"], "hello?")
    assert next(d for e, d in ev if e == "error")["code"] == "assistant_not_connected"


@pytest.mark.skipif(not scenarios.CATALOGUE.exists(), reason="the scenario catalogue isn't in this checkout")
async def test_scenario_runner(app):
    from app.assistant.agent import StubAssistant
    app.state.assistant.agent = StubAssistant()
    results = await scenarios.run("http://test", ["S01", "S12", "S32"], httpx.ASGITransport(app=app))
    by = {r["id"]: r for r in results}
    assert not any(r.get("error") for r in results), results
    t1 = by["S01"]["turns"][0]["checks"]
    assert {"check": "track is institution", "result": "pass", "detail": "institution"} in t1
    assert by["S32"]["turns"][0]["reply"].startswith("Sorry, I can only help in English")
    assert "manual" in scenarios.summary(results)


async def test_monitor_scenarios_set_up_their_monitors(client, app, sql):
    from app.assistant.agent import StubAssistant
    app.state.assistant.agent = StubAssistant()
    results = await scenarios.run("http://test", ["S45", "S50", "S52", "S54"], httpx.ASGITransport(app=app))
    assert not any(r.get("error") for r in results), results
    ph = await sql("SELECT home_country FROM core.institutions WHERE institution_id LIKE 'scen-s54-%'")
    assert ph == [{"home_country": "PH"}]
    made = await sql("SELECT origin_ref FROM core.monitors WHERE institution_id LIKE 'scen-s45-%'")
    assert made == [{"origin_ref": {"section": "flows", "item_id": "remit-sa"}}]
    checks = results[0]["turns"][0]["checks"]
    assert {"check": "made a proposal", "result": "fail"} in checks  # the stub proposes nothing
