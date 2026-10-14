"""Smoke check of the tools against a running amiri-server (no model: a scripted one).

    uv run python scripts/smoke_tools.py --server http://localhost:8000 --institution serendib-bank

Each scripted turn calls real tools on the real server and makes a real proposal (it stays
pending; reject it in the chat or let it expire). Prints what each tool returned in brief.
"""

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests" / "unit"))

from test_track_loop import ScriptedLlm

from app import engine, track_loop
from app.contract import AgentSessionIn, TurnIn
from app.sessions import SessionStore


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--server", default="http://localhost:8000")
    p.add_argument("--institution", default="serendib-bank")
    p.add_argument("--user", default="dilan@serendib.lk")
    a = p.parse_args()
    s = httpx.Client(base_url=a.server, headers={"X-Amiri-Actor": a.user})
    ses = s.post("/api/v1/assistant/sessions", json={"institution_id": a.institution}).json()
    ctx = s.get(f"/api/v1/assistant/sessions/{ses['session_id']}/context").json()
    store = SessionStore()
    sess = store.create(AgentSessionIn(session_id=ses["session_id"], thread_id=ses["thread_id"], user_id=a.user,
                                       institution_id=a.institution, server_url=a.server, context=ctx))
    llm = ScriptedLlm()
    track_loop.set_model(lambda: llm)
    engine.set_responder(track_loop.respond)
    draft = s.get("/api/v1/monitors:draftable", params={"institution_id": a.institution}).json()["items"]
    free = next(i for i in draft if not i["monitor_id"])
    tmpl = s.get("/api/v1/monitors:template", params={"institution_id": a.institution, "section": free["section"],
                                                      "item_id": free["item_id"]}).json()
    flows = s.get(f"/api/v1/institutions/{a.institution}/suggestions/flows").json()["items"]
    new_flow = next((x["item"] for x in flows if not x["added"]), None)
    plans = [
        ("footprint_flows", [[("get_section", {"section": "flows"})], [("get_suggestions", {"section": "flows"})],
                             [("propose", {"summary": "Smoke: add a flow", "operations": [
                                 {"op": "create", "section": "flows", "data": new_flow}] if new_flow else [],
                                 "institution": None, "monitors": None, "evidence": None})], "ok"]),
        ("monitors", [[("get_monitor_candidates", {})],
                      [("get_monitor_template", {"section": free["section"], "item_id": free["item_id"]})],
                      [("propose", {"summary": "Smoke: a monitor", "operations": None, "institution": None,
                                    "monitors": [{"op": "create", "origin_ref": tmpl["origin_ref"], "spec": tmpl["spec"]}],
                                    "evidence": None})], "ok"]),
        ("rules", [[("get_suggestions", {"section": "regulators"})], [("search_places", {"query": "Kerala",
                                                                                          "countries_only": False})],
                   [("get_reference", {"name": "product-taxonomy"})], [("get_field_rules", {"section": "rivals"})],
                   [("get_readiness", {})], "ok"]),
        ("verification", [[("get_history", {"limit": 3})], "ok"]),
        ("agent_view", [[("get_agent_context", {})], [("conclude", {"summary": "Smoke: explained"})], "ok"]),
    ]
    made = []
    for track, script in plans:
        llm.script, llm.requests = list(script), []
        turn = TurnIn(turn_id=uuid.uuid4().hex[:6], session_id=ses["session_id"], thread_id=ses["thread_id"],
                      institution_id=a.institution, user_id=a.user, text="smoke", requested_track=track,
                      current_track=track, profile_version=None)
        events = [ev async for ev in engine.run_turn(sess, turn)]
        print(f"\n== {track}: {[e.type for e in events]}")
        for r in llm.requests[1:]:
            fr = r.contents[-1].parts[0].function_response
            if fr:
                body = fr.response
                print(f"  {fr.name}: {body.get('status')} {json.dumps(body)[:220]}")
        made += [e.proposal_id for e in events if e.type == "proposal"]
    for pid in made:
        s.post(f"/api/v1/proposals/{pid}:reject")
    print(f"\nproposals made and rejected: {made}")


asyncio.run(main())
