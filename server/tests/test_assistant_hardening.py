"""The fixes from the scenario review: notes per track,
English only, rate limits, one turn at a time, turns that survive a disconnect, timeouts,
the number check on replies, usage, personal data, double confirm for bulk deletes, stale
proposals, the form taking over the setup chat, undo, and why places are in Radar's scope."""

import asyncio

from app.assistant.agent import AssistantEvent
from tests.test_assistant_api import ME, propose, say, session
from tests.test_institutions_api import BANK, new, seed

A = "/api/v1/assistant"


class ScriptAgent:
    """Plays back given events; can wait on a gate or hang."""

    name = "script"

    def __init__(self, evs=(), gate: asyncio.Event | None = None, hang: bool = False):
        self.evs, self.gate, self.hang, self.calls = list(evs), gate, hang, 0

    def connected(self):
        return True

    async def start_session(self, *a):
        return "script-session"

    async def run(self, turn):
        self.calls += 1
        if self.hang:
            await asyncio.sleep(3600)
        for ev in self.evs:
            if self.gate is not None:
                await self.gate.wait()
            yield ev


async def thread(client, iid=None):
    return (await client.get(f"{A}/thread", params={"institution_id": iid} if iid else {}, headers=ME)).json()


async def test_notes_kept_for_later_tracks(client, app):
    app.state.assistant.agent = ScriptAgent([
        AssistantEvent("track", {"track": "institution"}),
        AssistantEvent("track_notes", {"notes": [{"track": "footprint_flows", "text": "branches in Kerala and Tamil Nadu"},
                                                 {"track": "customers_products", "text": "migrant families, SMEs"},
                                                 {"track": "nonsense", "text": "dropped"}]}),
        AssistantEvent("message", {"text": "Noted. First, the institution itself."})])
    s = await session(client)
    ev = await say(client, s["session_id"], "We're a bank in Sri Lanka with branches in Kerala and Tamil Nadu; customers are migrant families and SMEs")
    notes = next(d for e, d in ev if e == "track_notes")["notes"]
    assert [n["track"] for n in notes] == ["footprint_flows", "customers_products"]
    th = await thread(client)
    by = {t["track"]: t for t in th["tracks"]}
    assert by["footprint_flows"]["notes"][0]["text"] == "branches in Kerala and Tamil Nadu"
    assert by["footprint_flows"]["status"] == "not_started"
    # the next session's context pack carries them
    ctx = (await client.get(f"{A}/sessions/{s['session_id']}/context")).json()
    assert ctx["track_definitions"][0]["track"] == "institution"


async def test_english_only(client, app):
    agent = ScriptAgent([AssistantEvent("message", {"text": "hi"})])
    app.state.assistant.agent = agent
    s = await session(client)
    ev = await say(client, s["session_id"], "අපේ ගනුදෙනුකරුවන් කවුද?")
    msg = next(d for e, d in ev if e == "message")
    assert msg["canned"] == "english_only" and agent.calls == 0
    await say(client, s["session_id"], "Who are our customers? (cafés included)")
    assert agent.calls == 1


async def test_rate_limit(client, app, env):
    env.setenv("ASSISTANT_TURNS_PER_MINUTE", "2")
    app.state.assistant.agent = ScriptAgent([AssistantEvent("message", {"text": "ok"})])
    s = await session(client)
    await say(client, s["session_id"], "one")
    await say(client, s["session_id"], "two")
    r = await client.post(f"{A}/run_sse", json={"session_id": s["session_id"], "text": "three"}, headers=ME)
    assert r.status_code == 429 and r.json()["code"] == "rate_limited" and r.headers["Retry-After"] == "60"


async def test_one_turn_at_a_time_and_disconnects(client, app):
    gate = asyncio.Event()
    app.state.assistant.agent = ScriptAgent([AssistantEvent("message", {"text": "a slow reply"})], gate=gate)
    svc = app.state.assistant
    s = await session(client)
    turn = await svc.open_turn(s["session_id"], "first", None, None, "dilan@serendib.lk")
    stream = svc.run(turn)
    assert (await stream.__anext__()).startswith("event: start")
    r = await client.post(f"{A}/run_sse", json={"session_id": s["session_id"], "text": "second"}, headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "turn_in_progress"
    assert (await thread(client))["turn_in_progress"] is True
    await stream.aclose()  # the browser went away
    gate.set()
    await asyncio.gather(*list(svc._tasks))
    th = await thread(client)
    assert th["turn_in_progress"] is False
    assert [m["content"].get("text") for m in th["messages"] if m["role"] == "assistant"] == ["a slow reply"]  # saved whole
    await say(client, s["session_id"], "now it's free")


async def test_timeout(client, app, env):
    env.setenv("ASSISTANT_TIMEOUT_SECONDS", "0.2")
    app.state.assistant.agent = ScriptAgent(hang=True)
    s = await session(client)
    ev = await say(client, s["session_id"], "hello?")
    assert next(d for e, d in ev if e == "error")["code"] == "assistant_timeout"
    assert (await thread(client))["turn_in_progress"] is False


async def test_numbers_in_replies_and_usage(client, app, sql):
    await seed(client)
    app.state.assistant.agent = ScriptAgent([
        AssistantEvent("usage", {"model_calls": 2, "input_tokens": 900, "output_tokens": 120}),
        AssistantEvent("message", {"text": "You get USD 1.2bn a year from Saudi Arabia (2024), about 37% of your flows."}),
        AssistantEvent("usage", {"model_calls": 1, "input_tokens": 300})])
    s = await session(client, "serendib-bank")
    ev = await say(client, s["session_id"], "How much from Saudi Arabia?")
    msg = next(d for e, d in ev if e == "message")
    assert msg["unverified_numbers"] == ["37%"]  # 1.2bn and 2024 are in the profile
    u = (await sql("SELECT usage FROM assistant.sessions WHERE session_id = %s", (s["session_id"],)))[0]["usage"]
    assert float(u["model_calls"]) == 3 and float(u["input_tokens"]) == 1200 and float(u["output_tokens"]) == 120


async def test_personal_data_refused(client):
    iid = (await new(client))["institution_id"]
    await session(client, iid)
    tid = (await thread(client, iid))["thread_id"]
    r = await propose(client, thread_id=tid, track="customers_products", summary="x",
                      operations=[{"op": "create", "section": "segments", "data": {"label": "Mr Perera, big borrower"}}])
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "personal_data"
    r = await client.post(f"/api/v1/institutions/{iid}/segments", json={"label": "Large borrowers", "note": "account 004512345678"})
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "personal_data"  # the forms too
    r = await client.patch(f"/api/v1/institutions/{iid}", json={"summary": "Contact risk@serendib.lk"})
    assert r.status_code == 422
    ok = await client.post(f"/api/v1/institutions/{iid}/segments", json={"label": "Large borrowers", "note": "exposures above LKR 1,000,000,000"})
    assert ok.status_code == 201


async def test_bulk_delete_needs_a_second_confirm(client):
    await seed(client)
    await session(client, "serendib-bank")
    tid = (await thread(client, "serendib-bank"))["thread_id"]
    p = (await propose(client, thread_id=tid, track="rivals_partners", summary="Remove three rivals", operations=[
        {"op": "delete", "section": "rivals", "id": r} for r in ("kandy-merchant-bank", "malabar-cooperative-bank", "coromandel-finance")])).json()
    assert p["deletes"] == 3
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "confirm_deletes_required" and r.json()["deletes"] == 3
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", params={"confirm_deletes": 3}, headers=ME)
    assert r.status_code == 200 and r.json()["status"] == "confirmed"


async def test_stale_proposal_shown(client):
    await seed(client)
    await session(client, "serendib-bank")
    tid = (await thread(client, "serendib-bank"))["thread_id"]
    p = (await propose(client, thread_id=tid, track="customers_products", summary="Note", operations=[
        {"op": "update", "section": "segments", "id": "farmers", "if_version": 1, "data": {"note": "tea"}}])).json()
    th = await thread(client, "serendib-bank")
    assert next(x for x in th["proposals"] if x["proposal_id"] == p["proposal_id"])["fits"] is True
    await client.patch("/api/v1/institutions/serendib-bank/segments/farmers", json={"note": "by hand"})
    th = await thread(client, "serendib-bank")
    x = next(x for x in th["proposals"] if x["proposal_id"] == p["proposal_id"])
    assert x["fits"] is False and x["fit_errors"]


async def test_form_creation_takes_over_the_setup_chat(client, app):
    app.state.assistant.agent = ScriptAgent([AssistantEvent("message", {"text": "ok"})])
    s = await session(client)
    await say(client, s["session_id"], "We're a bank in Sri Lanka")
    pre = await thread(client)
    i = await client.post("/api/v1/institutions", json=BANK, headers={**ME, "X-Amiri-Source": "form"})
    th = await thread(client, i.json()["institution_id"])
    assert th["thread_id"] == pre["thread_id"] and len(th["messages"]) == len(pre["messages"])


async def test_undo(client):
    iid = (await new(client))["institution_id"]
    r = await client.post(f"/api/v1/institutions/{iid}:batch", json={"operations": [
        {"op": "create", "section": "rivals", "id": "a", "data": {"name": "A"}},
        {"op": "update", "section": "institution", "data": {"governance_body": "Board Risk Committee"}}]})
    assert r.status_code == 200
    h = (await client.get(f"/api/v1/institutions/{iid}/history")).json()["items"]
    batch = h[0]["batch_id"]
    u = (await client.get(f"/api/v1/institutions/{iid}/history/batches/{batch}/undo")).json()
    assert u["valid"] is True and [o["op"] for o in u["operations"]] == ["update", "delete"]
    await client.post(f"/api/v1/institutions/{iid}:batch", json={"operations": u["operations"]})
    i = (await client.get(f"/api/v1/institutions/{iid}")).json()
    assert i["counts"]["rivals"] == 0 and i["governance_body"] is None
    # undoing the delete brings it back, same id
    h = (await client.get(f"/api/v1/institutions/{iid}/history")).json()["items"]
    u2 = (await client.get(f"/api/v1/institutions/{iid}/history/batches/{h[0]['batch_id']}/undo")).json()
    await client.post(f"/api/v1/institutions/{iid}:batch", json={"operations": u2["operations"]})
    assert (await client.get(f"/api/v1/institutions/{iid}/rivals/a")).json()["name"] == "A"
    assert (await client.get(f"/api/v1/institutions/{iid}/history/batches/nope/undo")).status_code == 404


async def test_radar_scope_reasons(client):
    await seed(client)
    why = (await client.get("/api/v1/institutions/serendib-bank/context")).json()["radar_scope"]["why"]
    assert any(r.startswith("place to watch") for r in why["KW"])
    assert any(r.startswith("flow: remittances in") for r in why["SA"])
    assert any(r.startswith("risk: Gulf") for r in why["SA"])
    assert why["IN-KL"][0].startswith("footprint")
