"""The setup agent's server side: one thread per
institution, sessions with a context pack, tracks, and proposals with track scope and the
number check. The agent is not connected (default) or the stub."""

import json

from app.assistant.agent import StubAssistant
from tests.test_institutions_api import BANK, MIGRANTS, new

A = "/api/v1/assistant"
ME = {"X-Amiri-Actor": "dilan@serendib.lk"}
AS_AGENT = {"X-Amiri-On-Behalf-Of": "dilan@serendib.lk", "X-Amiri-Source": "assistant"}


def events(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


async def session(client, institution_id=None):
    r = await client.post(f"{A}/sessions", json={"institution_id": institution_id}, headers=ME)
    assert r.status_code == 201, r.text
    return r.json()


async def say(client, sid, text=None, answer=None, track=None):
    body = {"session_id": sid, **({"text": text} if text else {}), **({"answer": answer} if answer else {}),
            **({"track": track} if track else {})}
    r = await client.post(f"{A}/run_sse", json=body, headers=ME)
    assert r.status_code == 200, r.text
    return events(r.text)


async def propose(client, **body):
    return await client.post("/api/v1/proposals", json=body, headers=AS_AGENT)


async def test_tracks_and_not_connected(client):
    tracks = (await client.get(f"{A}/tracks")).json()
    by = {t["track"]: t for t in tracks}
    assert [t["track"] for t in sorted([t for t in tracks if t["order"]], key=lambda t: t["order"])] == [
        "institution", "footprint_flows", "customers_products", "rules", "rivals_partners", "risks", "monitors", "verification"]
    assert by["history"]["read_only"] and by["agent_view"]["read_only"] and not by["offtopic"]["shown"]
    assert by["risks"]["writes"] == ["risk-exposures"] and by["risks"]["tab"] == "risks"
    assert (await client.get(f"{A}/status")).json()["connected"] is False
    s = await session(client)
    ev = await say(client, s["session_id"], "We are a bank")
    assert [e for e, _ in ev] == ["start", "error", "done"] and ev[1][1]["code"] == "assistant_not_connected"
    th = (await client.get(f"{A}/thread", headers=ME)).json()
    assert th["institution_id"] is None and th["active_session_id"] == s["session_id"]
    assert [m["kind"] for m in th["messages"]] == ["session", "text", "error"]  # kept, even unconnected


async def test_first_setup_through_the_chat(client, app):
    app.state.assistant.agent = StubAssistant()
    s = await session(client)
    ctx = (await client.get(f"{A}/sessions/{s['session_id']}/context")).json()
    assert ctx["institution"] is None and ctx["tracks"][0]["status"] == "not_started"
    ev = await say(client, s["session_id"], "We are a commercial bank in Sri Lanka; our year starts in April")
    kinds = [e for e, _ in ev]
    assert "track" in kinds and "question" in kinds
    tr = next(d for e, d in ev if e == "track")
    assert tr["track"] == "institution" and tr["tab"] == "overview" and tr["label"] == "Institution"
    th = (await client.get(f"{A}/thread", headers=ME)).json()
    assert th["current_track"] == "institution"
    assert next(t for t in th["tracks"] if t["track"] == "institution")["status"] == "in_progress"

    # the institution track concludes: create the institution
    inst = {**BANK, "governance_body": "Board Risk Committee", "fiscal_year_start_month": 7}
    r = await propose(client, thread_id=th["thread_id"], track="institution", kind="create_institution",
                      summary="Create Serendib Commercial Bank", institution=inst)
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "unsupported_number"  # July was never said
    r = await propose(client, thread_id=th["thread_id"], track="institution", kind="create_institution",
                      summary="Create Serendib Commercial Bank", institution={**inst, "fiscal_year_start_month": 4})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["kind"] == "create_institution" and p["changes"][0]["op"] == "create" and p["tab"] == "overview"
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    iid = r.json()["result"]["institution_id"]
    th = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()
    assert th["thread_id"] == p["thread_id"]  # the same chat, now the institution's
    assert next(t for t in th["tracks"] if t["track"] == "institution")["status"] == "concluded"
    assert th["messages"][-1]["kind"] == "applied"
    prof = (await client.get(f"/api/v1/institutions/{iid}/profile")).json()
    assert prof["origins"]["footprint"]["lk"]["source"] == "assistant"
    assert prof["origins"]["footprint"]["lk"]["proposal_id"] == p["proposal_id"]
    h = (await client.get(f"/api/v1/institutions/{iid}/history", params={"source": "assistant"})).json()["items"]
    assert h and all(x["proposal_id"] == p["proposal_id"] for x in h)


async def test_track_scope_and_number_check(client):
    iid = (await new(client))["institution_id"]
    s = await session(client, iid)
    th = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()
    tid = th["thread_id"]
    # a track writes only its own sections
    r = await propose(client, thread_id=tid, track="risks", summary="x",
                      operations=[{"op": "create", "section": "products", "data": {"name": "P", "category": "savings", "product_type": "savings_account"}}])
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "outside_track"
    r = await propose(client, thread_id=tid, track="rules", summary="x",
                      operations=[{"op": "update", "section": "institution", "data": {"name": "Other"}}])
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "outside_track"
    r = await propose(client, thread_id=tid, track="history", summary="x", operations=[])
    assert r.status_code == 422
    # numbers: not typed, not referenced -> refused
    flow = {"kind": "remittances_in", "local": "LK", "counterpart": "KW", "value": {"amount": 1.5e9, "currency": "USD", "year": 2024}}
    r = await propose(client, thread_id=tid, track="footprint_flows", summary="Kuwait remittances",
                      operations=[{"op": "create", "section": "flows", "data": flow}])
    assert r.status_code == 422 and {e["field"] for e in r.json()["errors"]} == {"value.amount", "value.year"}
    # the user said it
    await say(client, s["session_id"], "We get about USD 1.5bn a year from Kuwait, as of 2024")
    r = await propose(client, thread_id=tid, track="footprint_flows", summary="Kuwait remittances",
                      operations=[{"op": "create", "section": "flows", "data": flow}])
    assert r.status_code == 201, r.text
    # a reference figure carries its own numbers
    sa = next(x["item"] for x in (await client.get(f"/api/v1/institutions/{iid}/suggestions/flows")).json()["items"]
              if x["item"]["counterpart"] == "SA")
    r = await propose(client, thread_id=tid, track="footprint_flows", summary="Saudi remittances",
                      operations=[{"op": "create", "section": "flows", "data": sa}])
    assert r.status_code == 201, r.text
    # invalid operations fail at once, so the agent can repair them
    r = await propose(client, thread_id=tid, track="customers_products", summary="x",
                      operations=[{"op": "create", "section": "products", "data": {"name": "Cover", "category": "life", "product_type": "term_life"}}])
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "category_not_for_type"


async def test_mixed_forms_and_chat(client, app):
    app.state.assistant.agent = StubAssistant()
    iid = (await new(client))["institution_id"]
    s = await session(client, iid)
    await say(client, s["session_id"], "Let's do customers", track="customers_products")
    # the user adds a group with the form, between turns
    await client.post(f"/api/v1/institutions/{iid}/segments", json=MIGRANTS, headers={"X-Amiri-Source": "form"})
    ev = await say(client, s["session_id"], "anything else?")
    assert any("1 change made with the forms" in d.get("text", "") for e, d in ev if e == "message")
    ev = await say(client, s["session_id"], "and now?")
    assert not any("made with the forms" in d.get("text", "") for e, d in ev if e == "message")  # seen now
    th = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()
    picked = [m for m in th["messages"] if m["kind"] == "track"]
    assert picked[0]["content"] == {"track": "customers_products", "picked": True}
    # the agent's proposal, confirmed: the item records it came from the assistant
    r = await propose(client, thread_id=th["thread_id"], track="customers_products", summary="Add pensioners",
                      operations=[{"op": "create", "section": "segments", "data": {"label": "Pensioners", "spec_mapping": [{"dimension": "segment", "value": "pensioner"}]}}])
    p = r.json()
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.json()["tab"] == "customers"
    prof = (await client.get(f"/api/v1/institutions/{iid}/profile")).json()
    assert prof["origins"]["segments"]["pensioners"]["source"] == "assistant"
    assert prof["origins"]["segments"]["migrant-worker-families"]["source"] == "form"


async def test_sessions_end_and_resume(client, clock):
    iid = (await new(client))["institution_id"]
    s1 = await session(client, iid)
    again = await session(client, iid)
    assert again["session_id"] == s1["session_id"] and again["resumed"] is True
    await say(client, s1["session_id"], "hello")
    await client.post(f"/api/v1/institutions/{iid}/rivals", json={"name": "Coastal Remit"})
    clock.advance(minutes=31)
    r = await client.post(f"{A}/run_sse", json={"session_id": s1["session_id"], "text": "hi"}, headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "session_ended"
    s2 = await session(client, iid)
    assert s2["session_id"] != s1["session_id"]
    ctx = (await client.get(f"{A}/sessions/{s2['session_id']}/context")).json()
    assert [c["section"] for c in ctx["changes_since_last_session"]] == ["rivals"]
    assert ctx["recent_messages"] and ctx["institution"]["name"] == "Serendib Commercial Bank"
    r = await client.post(f"{A}/run_sse", json={"session_id": s2["session_id"], "text": "hi"}, headers={"X-Amiri-Actor": "x@y"})
    assert r.status_code == 403
    th = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()
    assert [m["kind"] for m in th["messages"]].count("session") == 2  # one chat, two sessions
    page = (await client.get(f"{A}/threads/{th['thread_id']}/messages", params={"limit": 2})).json()
    assert len(page["items"]) == 2 and page["next_before"]
    r = await client.put(f"{A}/threads/{th['thread_id']}/summary", json={"summary": "Set up footprint; rivals next."})
    assert r.json()["summary"].startswith("Set up")


async def test_proposal_decisions(client, clock):
    iid = (await new(client))["institution_id"]
    await session(client, iid)
    tid = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()["thread_id"]
    seg = await client.post(f"/api/v1/institutions/{iid}/segments", json={**MIGRANTS, "label": "Migrants"})
    sid = seg.json()["item"]["id"]
    p = (await propose(client, thread_id=tid, track="customers_products", summary="Note",
                       operations=[{"op": "update", "section": "segments", "id": sid, "if_version": 1, "data": {"note": "Gulf"}}])).json()
    assert (await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers={"X-Amiri-Actor": "x@y"})).status_code == 403
    await client.patch(f"/api/v1/institutions/{iid}/segments/{sid}", json={"note": "changed by a form"})
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.status_code == 409 and (await client.get(f"/api/v1/proposals/{p['proposal_id']}")).json()["status"] == "failed"
    p2 = (await propose(client, thread_id=tid, track="rivals_partners", summary="Add a rival",
                        operations=[{"op": "create", "section": "rivals", "data": {"name": "A"}}])).json()
    assert (await client.post(f"/api/v1/proposals/{p2['proposal_id']}:reject", headers=ME)).json()["status"] == "rejected"
    th = (await client.get(f"{A}/thread", params={"institution_id": iid}, headers=ME)).json()
    assert next(t for t in th["tracks"] if t["track"] == "rivals_partners")["status"] == "not_started"  # rejected: not concluded
    p3 = (await propose(client, thread_id=tid, track="rivals_partners", summary="Add a rival",
                        operations=[{"op": "create", "section": "rivals", "data": {"name": "B"}}])).json()
    clock.advance(hours=25)
    assert (await client.get(f"/api/v1/proposals/{p3['proposal_id']}")).json()["status"] == "expired"
    assert (await client.post(f"/api/v1/proposals/{p3['proposal_id']}:confirm", headers=ME)).status_code == 409
