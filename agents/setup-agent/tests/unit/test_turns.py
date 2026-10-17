"""The contract's endpoints and the routing rules, with a scripted router (no model)."""

import pytest
from conftest import H, start, turn

from app.contract import EVENT
from app.router import RouterChoice, RouterNote


def kinds(evs):
    return [e for e, _ in evs if e != "text_delta"]


def real(evs):
    return [(e, d) for e, d in evs if e != "text_delta"]


def valid(evs):
    for e, d in evs:
        if e != "done":
            EVENT.validate_python({**d, "type": e})


async def test_session_and_contract_header(client):
    r = await client.post("/sessions", headers=H, json={"bogus": 1})
    assert r.status_code == 422
    sid = await start(client)
    r = await client.post(f"/sessions/{sid}/turns", headers=H, json={"bogus": True})
    assert r.status_code == 422
    r = await client.post("/sessions/nope/turns", headers=H, json={
        "turn_id": "t", "session_id": "s", "thread_id": "t", "institution_id": None, "user_id": "u",
        "text": "hi", "current_track": None, "profile_version": None})
    assert r.status_code == 404 and r.headers["X-Amiri-Contract"] == "1.0" and r.json()["code"] == "not_found"


async def test_first_setup_goes_to_the_institution_and_keeps_notes(client, scripted):
    sid = await start(client)
    scripted.script = [RouterChoice(track="customers_products", clearly_elsewhere=True, reason="customers",
                                    notes=[RouterNote(track="customers_products", text="farmers and estate workers"),
                                           RouterNote(track="nonsense", text="dropped")])]
    evs = await turn(client, sid, text="Most of our customers are farmers and estate workers.")
    valid(evs)
    assert evs[0] == ("text_delta", {"text": ""})
    assert real(evs)[0] == ("track", {"track": "institution", "reason": "first setup: the institution comes first"})
    assert ("track_notes", {"notes": [{"track": "customers_products", "text": "farmers and estate workers"}]}) in evs
    assert kinds(evs)[-2:] == ["usage", "done"] and "message" in kinds(evs)
    assert scripted.calls[0][2] is False  # the router is told there's no institution


async def test_a_picked_track_needs_no_model(client, scripted):
    sid = await start(client, "bank-1")
    evs = await turn(client, sid, "bank-1", text="Let's look at risks.", requested_track="risks")
    assert real(evs)[0][1]["track"] == "risks" and scripted.calls == []
    evs = await turn(client, sid, "bank-1", text="Again.", requested_track="risks", current_track="risks")
    assert "track" not in kinds(evs)  # no change, no track event


async def test_sticky_unless_clearly_elsewhere(client, scripted):
    sid = await start(client, "bank-1")
    scripted.script = [RouterChoice(track="rules", clearly_elsewhere=False, reason="maybe rules")]
    evs = await turn(client, sid, "bank-1", text="And the central bank?", current_track="risks")
    assert "track" not in kinds(evs)
    scripted.script = [RouterChoice(track="rules", clearly_elsewhere=True, reason="regulators")]
    evs = await turn(client, sid, "bank-1", text="Who regulates us?", current_track="risks")
    assert real(evs)[0] == ("track", {"track": "rules", "reason": "regulators"})


async def test_off_topic_gets_a_redirect_and_keeps_the_track(client, scripted):
    sid = await start(client, "bank-1")
    scripted.script = [RouterChoice(track="offtopic", clearly_elsewhere=True, reason="a poem")]
    evs = await turn(client, sid, "bank-1", text="Write me a poem about the sea.", current_track="risks")
    assert "track" not in kinds(evs) and "proposal" not in kinds(evs)
    msg = next(d for e, d in evs if e == "message")["text"]
    assert msg.startswith("I can only help set up Amiri Agent") and "Back to risks" in msg


async def test_router_down_stays_in_the_current_track(client, scripted):
    sid = await start(client, "bank-1")
    scripted.script = [None]
    evs = await turn(client, sid, "bank-1", text="Something", current_track="rules")
    assert "track" not in kinds(evs) and "message" in kinds(evs)


async def test_an_answer_stays_in_its_track_and_an_empty_turn_is_an_error(client, scripted):
    sid = await start(client, "bank-1")
    evs = await turn(client, sid, "bank-1", answer={"question_id": "q1", "options": ["Yes"]}, current_track="rules")
    assert "track" not in kinds(evs) and scripted.calls == []
    evs = await turn(client, sid, "bank-1", current_track="rules")
    assert real(evs)[0] == ("error", {"code": "empty_turn", "message": "A turn needs a message or an answer."})


async def test_a_failure_ends_the_turn_with_an_error_event(client, monkeypatch):
    from app import engine

    async def broken(s, turn, r, usage):
        raise RuntimeError("boom")
        yield  # an async generator

    monkeypatch.setattr(engine, "_responder", broken)
    sid = await start(client, "bank-1")
    evs = await turn(client, sid, "bank-1", text="hi", requested_track="risks")
    valid(evs)
    assert ("error", {"code": "agent_failed", "message": "The setup agent failed (RuntimeError)."}) in evs
    assert kinds(evs)[-2:] == ["usage", "done"]


@pytest.mark.parametrize("status, code", [(429, "models_busy"), (503, "models_busy"), (400, "model_request_failed")])
async def test_model_errors_say_whether_trying_again_helps(client, monkeypatch, status, code):
    from google.genai import errors

    from app import engine

    async def refused(s, turn, r, usage):
        raise errors.APIError(status, {"error": {"code": status, "message": "nope", "status": "X"}})
        yield

    monkeypatch.setattr(engine, "_responder", refused)
    sid = await start(client, "bank-1")
    evs = await turn(client, sid, "bank-1", text="hi", requested_track="risks")
    valid(evs)
    err = next(d for e, d in evs if e == "error")
    assert err["code"] == code
    assert ("Try again" in err["message"]) == (code == "models_busy")


async def test_no_credentials_is_said_plainly(client, monkeypatch):
    from google.auth.exceptions import DefaultCredentialsError

    from app import engine

    async def no_key(s, turn, r, usage):
        raise DefaultCredentialsError("no credentials")
        yield

    monkeypatch.setattr(engine, "_responder", no_key)
    sid = await start(client, "bank-1")
    evs = await turn(client, sid, "bank-1", text="hi", requested_track="risks")
    assert next(d for e, d in evs if e == "error")["code"] == "models_unavailable"
