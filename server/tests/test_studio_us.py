"""The US Scenario Studio template (a Texas winter storm): offered to a US bank with Texas in its footprint only,
written for the bank's Texas city, and a whole run with fake agents finds its three stories. A bank elsewhere
lists exactly the templates it listed before."""

from app.monitors.schemas import MonitorSpec
from app.studio import template
from tests.test_investigation_api import bank
from tests.test_studio_api import H, S, run_to_end
from tests.test_us_demo_profile import load

US = "us-texas-winter-storm"


def classify(f: dict):
    """How the model would read the storm's findings: (themes, expected deposit move)."""
    t = f["title"].lower()
    if f["source"] == "timeseries" or "power prices" in t or "power bills" in t:
        return [{"theme": "prices", "direction": "up", "item": "electricity"}], "fall"
    if "data center" in t or "chip plants" in t:
        return [{"theme": "sector", "direction": "shock", "sector": "construction"}], "fall"
    return [{"theme": "disaster", "direction": "domestic", "item": "storm"}], "fall"


async def us_scenario(client, env) -> dict:
    await load(client, env)
    r = await client.post(f"{S}/scenarios", json={"template_id": US, "intensity": "medium"}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()


async def test_a_bank_outside_the_us_lists_the_same_templates_and_cannot_use_the_us_one(client, env):
    await bank(client, env)
    items = (await client.get(f"{S}/templates")).json()["items"]
    assert [t["template_id"] for t in items] == ["currency-depreciation", "blank"]
    assert all(set(t) == {"template_id", "title", "summary", "tags", "unavailable"} for t in items)
    r = await client.post(f"{S}/scenarios", json={"template_id": US, "intensity": "medium"}, headers=H)
    assert r.status_code == 422 and r.json()["code"] == "template_unavailable"


async def test_the_austin_bank_gets_the_storm_first_written_for_austin(client, env):
    sc = await us_scenario(client, env)
    items = (await client.get(f"{S}/templates")).json()["items"]
    assert [t["template_id"] for t in items] == [US, "currency-depreciation", "blank"]
    assert items[0]["title"].startswith("US · ") and items[0]["unavailable"] is None
    assert items[1]["unavailable"]  # no USD rate to move
    b = sc["built"]
    titles = [h["title"] for h in b["headlines"]]
    assert "Austin chip plants halt production as power and water are cut" in titles
    assert any("jump 600%" in t for t in titles)
    assert b["clock"]["start_at"].startswith("2027-02-08")  # a February freeze
    assert b["prices"]["theme"] == {"theme": "prices", "direction_up": "up", "direction_down": "down", "item": "electricity"}
    assert {s["key"] for s in b["stories"] if s["expected"]} == {"storm", "power", "industry"}
    MonitorSpec.model_validate(b["monitor"]["spec"])
    exposure = [e["id"] for e in b["monitor"]["spec"]["private"]["exposure"]]
    assert "product:dc-contractor-lines" in exposure and "product:chip-supplier-lines" in exposure


def test_the_storm_needs_a_us_home_and_a_texas_footprint():
    us_tx = {"country": "US", "footprint": [{"code": "US"}, {"code": "US-TX"}]}
    assert template.available(US, us_tx) is None
    assert "Texas" in template.available(US, {"country": "US", "footprint": [{"code": "US"}, {"code": "US-AZ"}]})
    assert "United States" in template.available(US, {"country": "LK", "footprint": [{"code": "LK"}]})
    assert template.offered(US, us_tx) and not template.offered(US, {"country": "LK"})
    assert all(template.offered(k, {"country": "LK"}) for k in ("currency-depreciation", "blank"))


async def test_a_whole_storm_run_finds_its_stories_and_the_power_price_keeps_its_item(client, env, agent,
                                                                                      monitor_agent, sql):
    sc = await us_scenario(client, env)
    agent.classify = classify
    r = await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"], "mode": "record"}, headers=H)
    assert r.status_code == 201, r.text
    sim = await run_to_end(client, r.json())
    assert sim["status"] == "finished"
    by = {x["key"]: x for x in sim["summary"]["stories"]}
    assert all(by[k]["found"] for k in ("storm", "power", "industry")), sim["summary"]["stories"]
    rows = await sql("SELECT themes FROM signals.findings WHERE world = 'studio' AND source = 'timeseries'")
    assert rows and all(r["themes"] == [{"theme": "prices", "direction": "up", "item": "electricity"}] for r in rows)
    assert await sql("SELECT count(*) AS n FROM signals.findings WHERE world = 'live'") == [{"n": 0}]
