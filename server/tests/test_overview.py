"""The Overview: first run, live counts and events, the "needs you" rules,
and nothing from the sandbox or the Studio."""

from tests.test_investigation_api import bank as _bank
from tests.test_investigation_api import sandbox_move

OV = "/api/v1/overview?audience=all"  # with Amiri Agent's own plumbing notes, which a Risk Manager's default view leaves out


async def bank(client, env):
    await _bank(client, env)
    r = await client.post("/api/v1/institutions/serendib-bank:activate")
    assert r.status_code == 200, r.text
LIVE_FX = """INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title, explanation,
               score, themes, places, evidence, created_at)
             VALUES ('f-live-1', 'live', 'serendib-bank', 'timeseries', '{}', 'signal_move', 'USD/LKR up 2.1%% in 1 day',
               'A move.', 70, '[{"theme": "fx", "direction": "weaker", "currency": "LKR"}]', '{LK}',
               '{"signals": [{"description": "x"}]}', %s)"""


async def test_before_the_institution_exists_it_is_a_first_run(client, env):
    env.setenv("INSTITUTION_ID", "nobody")
    o = (await client.get(OV)).json()
    assert o["first_run"] is True and o["institution"] is None and o["events"] == []


async def test_live_events_their_effects_and_what_needs_you(client, env, sql, clock, agent):
    await bank(client, env)
    await sandbox_move(client)  # sandbox: never on the Overview
    o = (await client.get(OV)).json()
    assert o["first_run"] is False and o["counts"]["findings_24h"]["timeseries"] == 0
    kinds = {a["kind"]: a for a in o["attention"]}
    assert kinds["tick"]["level"] == "crit" and o["attention"][0]["kind"] == "tick"  # never ran: most serious first

    await sql(LIVE_FX, (clock.now(),))
    await client.post("/api/v1/investigations", json={"world": "live"})
    await client.post("/internal/tick")
    o = (await client.get(OV)).json()
    assert o["counts"]["open_events"] == 1 and o["counts"]["effects_to_watch"] == 1
    assert o["counts"]["findings_24h"]["timeseries"] == 1
    e = o["events"][0]
    assert e["tone"] == "bad" and e["top_effects"][0]["product"] == "Migrant Family Savings"
    assert "LK" in o["map"]["places"] and o["map"]["places"]["LK"]["name"] == "Sri Lanka"
    assert o["findings"][0]["finding_id"] == "f-live-1" and o["findings"][0]["event_id"] == e["event_id"]
    assert "tick" not in {a["kind"] for a in o["attention"]} and o["services"]["tick"]["ok"] is True

    clock.advance(minutes=40)
    o = (await client.get(OV)).json()
    assert o["attention"][0]["kind"] == "tick"  # two ticks missed


async def test_monitors_waiting_and_a_failed_check_need_you(client, env, monitor_agent):
    from tests.test_monitors_api import create, live

    await bank(client, env)
    m = await create(client)
    await client.post(f"/api/v1/monitors/{m['monitor_id']}:submit")
    lm = await live(client, **{"about.name": "Gulf jobs live"})
    monitor_agent.fail_run = True
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    o = (await client.get(OV)).json()
    kinds = {a["kind"]: a for a in o["attention"]}
    assert kinds["approval"]["title"] == "1 monitor waits for approval"
    assert kinds["monitor_failed"]["link"] == f"/monitors/{lm['monitor_id']}"
    assert o["counts"]["monitors_live"] == 1 and o["counts"]["monitors_waiting_approval"] == 1


async def test_the_studio_is_linked_not_counted(client, env, agent, monitor_agent):
    await bank(client, env)
    sc = (await client.post("/api/v1/studio/scenarios", json={"template_id": "currency-depreciation"})).json()
    sim = (await client.post("/api/v1/studio/simulations", json={"scenario_id": sc["scenario_id"]})).json()
    for _ in range(4):
        sim = (await client.post(f"/api/v1/studio/simulations/{sim['sim_id']}:step", json={})).json()
    o = (await client.get(OV)).json()
    assert o["studio"]["sim_id"] == sim["sim_id"] and o["counts"]["findings_24h"]["timeseries"] == 0
    assert o["events"] == []


async def test_a_risk_manager_sees_what_they_can_act_on_not_the_plumbing(client, env):
    await bank(client, env)
    mine = (await client.get("/api/v1/overview")).json()
    full = (await client.get(OV)).json()
    assert {a["kind"] for a in full["attention"]} >= {"tick"}
    assert not {a["kind"] for a in mine["attention"]} & {"tick", "radar_agent", "monitor_agent", "investigation"}
    assert mine["admin_notes"] >= 1 and full["admin_notes"] == 0
