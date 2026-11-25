"""The demo lock (DEMO_LOCK=true): every endpoint that edits, deletes or resets something someone set up answers
403 demo_locked, and so do the alert actions and the checks that spend budget (a monitor's Check now, Radar's Run
now). What the demo itself needs (Scenario Studio runs, the connection's Check, asking the assistant) keeps working. With the lock off nothing changes."""

import pytest

from app.institutions.schemas import SECTIONS
from tests.test_alerts_api import investigate, live_finding
from tests.test_coverage_connected import ME
from tests.test_investigation_api import SEED, bank
from tests.test_monitors_api import H, live, spec
from tests.test_studio_api import H as STUDIO_H

INST = "/api/v1/institutions/serendib-bank"
S = "/api/v1/studio"
RENAME = {"op": "update", "section": "institution", "data": {"name": "Changed"}}


def refused(r) -> bool:
    return r.status_code == 403 and r.json()["type"].endswith("/demo_locked") and \
        r.json()["detail"] == "Editing is switched off for this demo."


async def test_the_installation_says_whether_the_demo_is_locked(client, env):
    assert (await client.get("/api/v1/installation")).json()["demo_lock"] is False
    env.setenv("DEMO_LOCK", "true")
    assert (await client.get("/api/v1/installation")).json()["demo_lock"] is True


async def test_every_edit_delete_and_reset_is_refused(client, env):
    await bank(client, env)
    m = await live(client)  # a live monitor to try the transitions on
    mid = m["monitor_id"]
    await client.post("/api/v1/series", json={"symbol": "USD/LKR", "places": ["LK"]})
    sc = (await client.post(f"{S}/scenarios", json={"template_id": "currency-depreciation", "intensity": "medium"},
                            headers=STUDIO_H)).json()
    env.setenv("DEMO_LOCK", "true")
    calls = [
        # the institution and its profile
        ("POST", "/api/v1/institutions", {**SEED["institution"], "institution_id": "other-bank"}),
        ("POST", "/api/v1/institutions:import", {"institution": SEED["institution"], "sections": SEED["sections"]}),
        ("PATCH", INST, {"name": "Changed"}),
        ("DELETE", INST, None),
        ("POST", f"{INST}:activate", None),
        ("POST", f"{INST}:archive", None),
        ("POST", f"{INST}:restore", None),
        ("POST", f"{INST}:batch", {"operations": [RENAME]}),
        *[(verb, f"{INST}/{section}" + ("" if verb == "POST" else "/x"), body)
          for section in SECTIONS
          for verb, body in (("POST", {k: v for k, v in SEED["sections"][section][0].items() if k != "id"} if SEED["sections"].get(section) else {}),
                             ("PATCH", {}), ("DELETE", None))],
        # the setup assistant: Apply
        ("POST", "/api/v1/proposals/p-1:confirm", None),
        # monitors
        ("POST", "/api/v1/monitors", {"spec": spec()}),
        ("POST", "/api/v1/monitors:draft", {"section": "flows", "item_id": "x"}),
        ("PATCH", f"/api/v1/monitors/{mid}", {"spec": spec()}),
        *[("POST", f"/api/v1/monitors/{mid}:{a}", {"note": "no thanks"} if a == "request-changes" else None)
          for a in ("submit", "approve", "request-changes", "pause", "resume", "retire")],
        # market series
        ("POST", "/api/v1/series", {"symbol": "AED/LKR"}),
        ("PATCH", "/api/v1/series/usd_lkr", {"enabled": False}),
        ("DELETE", "/api/v1/series/usd_lkr", None),
        # the data connection
        ("POST", "/api/v1/data-connection:import", {"format": "amiri-institution-data/1"}),
        ("POST", "/api/v1/data-connection:approve", None),
        ("PUT", "/api/v1/validation", {"enabled": True}),
        # Scenario Studio: edit and delete
        ("PATCH", f"{S}/scenarios/{sc['scenario_id']}", {"title": "Renamed"}),
        ("DELETE", f"{S}/scenarios/{sc['scenario_id']}", None),
        # clearing the simulated findings, the reset, loading a demo
        ("DELETE", "/api/v1/sandbox", None),
        ("POST", "/api/v1/prototype:reset", {"confirm": "RESET"}),
        ("POST", "/api/v1/prototype:demo", {"kind": "bank"}),
    ]
    for method, url, body in calls:
        r = await client.request(method, url, json=body, headers=ME)
        assert refused(r), (method, url, r.status_code, r.text[:200])
    # nothing changed
    assert (await client.get(f"{INST}/profile")).json()["institution"]["name"] == SEED["institution"]["name"]
    assert len((await client.get("/api/v1/series")).json()["items"]) == 1
    assert (await client.get(f"/api/v1/monitors/{mid}")).json()["status"] == "live"
    assert (await client.get(f"{S}/scenarios")).json()["items"][0]["scenario_id"] == sc["scenario_id"]


async def test_a_dry_run_is_not_a_change(client, env):
    await bank(client, env)
    env.setenv("DEMO_LOCK", "true")
    r = await client.post(f"{INST}:batch", json={"operations": [RENAME], "dry_run": True})
    assert r.status_code == 200 and r.json()["dry_run"] is True


async def test_the_demo_itself_keeps_working(client, env, sql, clock, agent, monitor_agent, radar_agent):
    await bank(client, env)
    m = await live(client)
    await live_finding(sql, clock, "f-lock-1")
    await investigate(client)
    alert = (await client.get("/api/v1/alerts")).json()["items"][0]["alert_id"]
    env.setenv("DEMO_LOCK", "true")
    # alerts stay as they were set up: acknowledge, resolve and reopen are locked
    a = f"/api/v1/alerts/{alert}"
    assert refused(await client.post(f"{a}:ack", json={"note": "looking"}, headers=ME))
    assert refused(await client.post(f"{a}:resolve", headers=ME))
    assert refused(await client.post(f"{a}:reopen", headers=ME))
    assert (await client.get(f"{a}")).json()["status"] == "new"
    # Scenario Studio: a new scenario and a run
    r = await client.post(f"{S}/scenarios", json={"template_id": "currency-depreciation", "intensity": "medium"},
                          headers=STUDIO_H)
    assert r.status_code == 201, r.text
    sim = await client.post(f"{S}/simulations", json={"scenario_id": r.json()["scenario_id"], "mode": "record"},
                            headers=STUDIO_H)
    assert sim.status_code == 201, sim.text
    sim_id = sim.json()["sim_id"]
    assert (await client.post(f"{S}/simulations/{sim_id}:stop", headers=STUDIO_H)).status_code == 200
    # Check now and Run now spend budget: locked. The connection's Check stays open.
    for url in (f"/api/v1/monitors/{m['monitor_id']}:run", "/api/v1/radar:run"):
        assert refused(await client.post(url, headers=H)), url
    r = await client.post("/api/v1/data-connection:check", headers=H)
    assert r.status_code != 403  # it may be busy (409), never locked
    # asking the setup assistant (a session)
    r = await client.post("/api/v1/assistant/sessions", json={"institution_id": "serendib-bank"}, headers=ME)
    assert r.status_code in (200, 201), r.text


@pytest.mark.parametrize("flag", ["false", ""])
async def test_with_the_lock_off_nothing_changes(client, env, flag):
    await bank(client, env)
    env.setenv("DEMO_LOCK", flag)
    r = await client.patch(INST, json={"name": "Serendib Commercial Bank PLC"})
    assert r.status_code == 200, r.text
    assert (await client.post("/api/v1/series", json={"symbol": "USD/LKR", "places": ["LK"]})).status_code == 201
    assert (await client.delete("/api/v1/series/usd_lkr")).status_code == 204
