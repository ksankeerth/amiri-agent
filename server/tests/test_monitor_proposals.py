"""The setup agent's monitors track: code's draft as a read-only
tool, proposals of kind monitors with their checks, and confirming them (submitted for approval)."""

import copy

from tests.test_assistant_api import AS_AGENT, ME, propose, say, session
from tests.test_investigation_api import bank

A = "/api/v1/assistant"


async def thread(client, env):
    await bank(client, env)
    s = await session(client, "serendib-bank")
    tid = (await client.get(f"{A}/thread", params={"institution_id": "serendib-bank"}, headers=ME)).json()["thread_id"]
    return s["session_id"], tid


async def template(client, section="flows", item_id="remit-sa") -> dict:
    r = await client.get("/api/v1/monitors:template", params={"section": section, "item_id": item_id,
                                                              "institution_id": "serendib-bank"}, headers=AS_AGENT)
    assert r.status_code == 200, r.text
    return r.json()


def op_from(t: dict, **edit) -> dict:
    spec = copy.deepcopy(t["spec"])
    for path, v in edit.items():
        *parts, last = path.split(".")
        d = spec
        for p in parts:
            d = d[p]
        d[last] = v
    return {"op": "create", "origin_ref": t["origin_ref"], "spec": spec}


def codes(r) -> set[str]:
    return {e["code"] for e in r.json().get("errors", [])}


async def test_the_draft_is_read_only_and_a_proposal_creates_submitted_monitors(client, env):
    sid, tid = await thread(client, env)
    t = await template(client)
    assert t["origin_ref"] == {"section": "flows", "item_id": "remit-sa"} and t["monitor_id"] is None
    assert (await client.get("/api/v1/monitors")).json()["items"] == []  # nothing saved
    op = op_from(t, **{"public.tell_me_if": [*t["spec"]["public"]["tell_me_if"], "Flights from Riyadh to Colombo are cancelled"],
                       "private.exposure": [{"id": "flow:remit-sa", "how_it_reaches_us": "Our savings inflows depend on it"},
                                            {"id": "segment:migrant-families"}]})
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="Watch Gulf jobs", monitors=[op])
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["kind"] == "monitors" and p["changes"][0]["op"] == "create" and p["changes"][0]["after"]["name"]
    # other tracks and kinds can't
    r = await propose(client, thread_id=tid, track="risks", kind="monitors", summary="x", monitors=[op])
    assert r.status_code == 422
    r = await propose(client, thread_id=tid, track="monitors", summary="x",
                      operations=[{"op": "create", "section": "rivals", "data": {"name": "A"}}])
    assert r.status_code == 422
    # confirm: created from the setup, submitted for approval, the track concluded
    p = (await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)).json()
    assert p["status"] == "confirmed", p
    made = p["result"]["monitors"][0]
    m = (await client.get(f"/api/v1/monitors/{made['monitor_id']}")).json()
    assert m["status"] == "submitted" and m["origin"] == "setup" and m["origin_ref"] == t["origin_ref"]
    assert m["versions"][0]["submitted_by"] == "assistant for dilan@serendib.lk" and m["drafted_fields"]
    th = (await client.get(f"{A}/thread", params={"institution_id": "serendib-bank"}, headers=ME)).json()
    assert next(x for x in th["tracks"] if x["track"] == "monitors")["status"] == "concluded"
    # the agent sees it, and the draft points at it
    await client.post(f"{A}/sessions/{sid}:end", headers=ME)  # the context is taken when a session starts
    ctx = (await client.get(f"{A}/sessions/{(await session(client, 'serendib-bank'))['session_id']}/context")).json()
    assert [x["monitor_id"] for x in ctx["monitors"]] == [made["monitor_id"]]
    assert (await template(client))["monitor_id"] == made["monitor_id"]
    items = (await client.get("/api/v1/monitors:draftable")).json()["items"]
    assert next(i for i in items if i["item_id"] == "remit-sa")["monitor_id"] == made["monitor_id"]


async def test_a_watched_item_is_changed_not_duplicated(client, env):
    _, tid = await thread(client, env)
    t = await template(client)
    p = (await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="Gulf", monitors=[op_from(t)])).json()
    mid = (await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)).json()["result"]["monitors"][0]["monitor_id"]
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="again", monitors=[op_from(t)])
    assert r.status_code == 422 and codes(r) == {"already_monitored"} and r.json()["errors"][0]["monitor_id"] == mid
    current = (await client.get(f"/api/v1/monitors/{mid}")).json()["spec"]
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="same",
                      monitors=[{"op": "update", "monitor_id": mid, "spec": current}])
    assert r.status_code == 422 and codes(r) == {"no_change"}
    changed = copy.deepcopy(current)
    changed["public"]["tell_me_if"].append("Saudi Arabia changes the rules for sending money home")
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="One more line",
                      monitors=[{"op": "update", "monitor_id": mid, "spec": changed}])
    assert r.status_code == 201, r.text
    assert r.json()["changes"][0]["before"]["tell_me_if"] != r.json()["changes"][0]["after"]["tell_me_if"]
    p = (await client.post(f"/api/v1/proposals/{r.json()['proposal_id']}:confirm", headers=ME)).json()
    m = (await client.get(f"/api/v1/monitors/{mid}")).json()
    assert m["latest_version"] == 2 and m["status"] == "submitted" and p["result"]["monitors"][0]["version"] == 2


async def test_numbers_only_as_the_user_typed_them(client, env):
    sid, tid = await thread(client, env)
    t = await template(client)
    lines = [*t["spec"]["public"]["tell_me_if"], "Job cuts affect more than 10,000 foreign workers"]
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x",
                      monitors=[op_from(t, **{"public.tell_me_if": lines})])
    assert r.status_code == 422 and codes(r) == {"unsupported_number"} and "10,000" in r.text
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x",
                      monitors=[op_from(t, alert_level=8)])
    assert r.status_code == 422 and r.json()["errors"][0]["field"] == "alert_level"
    kd = [{"date": "2026-11-01", "label": "Saudi quota rules start", "lead_days": 7}]
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x",
                      monitors=[op_from(t, **{"about.key_dates": kd})])
    assert r.status_code == 422 and {e["field"] for e in r.json()["errors"]} == {"about.key_dates"}
    await say(client, sid, "Tell me when cuts pass 10,000 workers; the quota rules start on 1 November, "
                           "warn me 7 days before. Alert level 8.")
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="Gulf jobs",
                      monitors=[op_from(t, alert_level=8, **{"public.tell_me_if": lines, "about.key_dates": kd})])
    assert r.status_code == 201, r.text


async def test_private_text_stays_out_of_public_fields_and_exposures_exist(client, env):
    _, tid = await thread(client, env)
    t = await template(client)
    private = "Their remittances fund most of our savings book"
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x", monitors=[op_from(
        t, **{"private.exposure": [{"id": "flow:remit-sa", "how_it_reaches_us": private}],
              "public.in_one_sentence": "Saudi job cuts; their remittances fund most of our savings book."})])
    assert r.status_code == 422 and codes(r) == {"private_in_public"}
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x",
                      monitors=[op_from(t, **{"private.exposure": [{"id": "product:nope"}]})])
    assert r.status_code == 422 and "product:nope" in r.text
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="x",
                      monitors=[op_from(t, **{"public.languages": ["ar"]})])
    assert r.status_code == 422  # English only in the prototype
    # a segment label in a public line is fine: profile names are public anyway
    r = await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="ok", monitors=[op_from(
        t, **{"private.exposure": [{"id": "segment:migrant-families", "how_it_reaches_us": "Migrant-worker families send money home"}],
              "public.in_one_sentence": "Saudi events that hit Migrant-worker families and the money they send home."})])
    assert r.status_code == 201, r.text


async def test_a_pending_proposal_stops_fitting_when_the_item_gets_a_monitor(client, env):
    _, tid = await thread(client, env)
    t = await template(client)
    p = (await propose(client, thread_id=tid, track="monitors", kind="monitors", summary="Gulf", monitors=[op_from(t)])).json()
    await client.post("/api/v1/monitors:draft", json={"section": "flows", "item_id": "remit-sa"}, headers=ME)  # by the form
    th = (await client.get(f"{A}/thread", params={"institution_id": "serendib-bank"}, headers=ME)).json()
    mine = next(x for x in th["proposals"] if x["proposal_id"] == p["proposal_id"])
    assert mine["fits"] is False and mine["fit_errors"][0]["code"] == "already_monitored"
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.status_code == 422 and (await client.get(f"/api/v1/proposals/{p['proposal_id']}")).json()["status"] == "failed"
