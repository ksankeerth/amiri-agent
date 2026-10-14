"""The Scenario Studio: a whole currency-depreciation run with fake
agents, the step's rules, isolation from live, and record/replay."""

from tests.test_investigation_api import bank

S = "/api/v1/studio"
H = {"X-Amiri-Actor": "rm@serendib.lk"}


def classify(f: dict):
    """How the model would read the template's findings: (themes, expected deposit move)."""
    t = f["title"].lower()
    if f["source"] == "timeseries" or "falls" in t or "importers" in t:
        return [{"theme": "fx", "direction": "weaker", "currency": "LKR"}], "fall"
    if "steps in" in t:
        return [{"theme": "regulation", "direction": "central_bank_direction"}], None
    if "sent home" in t:
        return [{"theme": "remittance", "direction": "up"}], "rise"
    if "exporters" in t:
        return [{"theme": "sector", "direction": "boost"}], "rise"
    if "fuel" in t:
        return [{"theme": "prices", "direction": "up", "item": "fuel"}], "fall"
    return [{"theme": "macro", "direction": "worse"}], "fall"


async def scenario(client, env, intensity="medium") -> dict:
    await bank(client, env)
    r = await client.post(f"{S}/scenarios", json={"template_id": "currency-depreciation", "intensity": intensity}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()


async def run_to_end(client, sim: dict, limit: int = 300) -> dict:
    for _ in range(limit):
        if sim["status"] not in ("running", "waiting"):
            return sim
        r = await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={"expected_step": sim["step"]})
        assert r.status_code == 200, r.text
        sim = r.json()
    raise AssertionError(f"not finished after {limit} steps: {sim['status']} at {sim['step']}")


async def test_the_template_is_built_for_the_institution(client, env):
    sc = await scenario(client, env)
    b = sc["built"]
    assert b["prices"]["symbol"] == "USD/LKR" and b["institution"]["currency"] == "LKR"
    assert b["headlines"][0]["title"].startswith("Sri Lanka Rupee falls 2.0%")
    assert "Central Bank of Sri Lanka steps in" in b["headlines"][2]["title"]
    assert {s["key"] for s in b["stories"] if s["expected"]} == {"fx", "central_bank", "remittance", "exporters", "fuel"}
    exposure = [e["id"] for e in b["monitor"]["spec"]["private"]["exposure"]]
    assert exposure and all(e.startswith(("product:", "segment:")) for e in exposure)
    t = (await client.get(f"{S}/templates")).json()["items"]
    assert t[0]["template_id"] == "currency-depreciation" and t[0]["unavailable"] is None


async def test_a_whole_run_gives_the_expected_stories_and_touches_nothing_live(client, env, agent, monitor_agent, sql):
    sc = await scenario(client, env)
    agent.classify = classify
    r = await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"], "mode": "record"}, headers=H)
    assert r.status_code == 201, r.text
    sim = r.json()
    assert (await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"]})).status_code == 409  # one at a time
    # a stale page's step is refused
    r = await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={"expected_step": 5})
    assert r.status_code == 409 and r.json()["code"] == "step_moved"
    # the tick in the middle of a run touches nothing of it
    for _ in range(3):
        sim = (await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={"expected_step": sim["step"]})).json()
    before = await sql("SELECT finding_id, status FROM signals.findings WHERE world = 'studio' ORDER BY finding_id")
    await client.post("/internal/tick")
    assert await sql("SELECT finding_id, status FROM signals.findings WHERE world = 'studio' ORDER BY finding_id") == before
    sim = await run_to_end(client, sim)
    assert sim["status"] == "finished" and sim["step"] == 21 and sim["pending"] == []
    assert await sql("SELECT count(*) AS n FROM studio.agent_runs a WHERE kind = 'investigation' AND NOT EXISTS "
                     "(SELECT 1 FROM cases.investigations i WHERE i.run_id = a.run_id)") == [{"n": 0}]

    s = sim["summary"]
    by = {x["key"]: x for x in s["stories"]}
    assert all(by[k]["found"] for k in ("fx", "central_bank", "remittance", "exporters", "fuel")), s["stories"]
    assert (by["fx"]["found_tone"], by["remittance"]["found_tone"], by["central_bank"]["found_tone"]) == ("bad", "good", "neutral")
    assert s["findings"]["timeseries"]["found"] >= 1 and s["findings"]["monitor"]["found"] >= 5
    assert len(sim["events"]) == 5  # later fx findings joined the open fx event as developments
    fx = next(e for e in sim["events"] if e["themes"][0]["theme"] == "fx")
    assert fx["developments"] >= 1
    # the run shows the alerts the live app would raise for the bad events, and writes none
    assert sim["alerts"] and all(x["owner"] and x["effects"] for x in sim["alerts"])
    assert {x["event_id"] for x in sim["alerts"]} <= {e["event_id"] for e in sim["events"] if e["tone"] in ("bad", "mixed")}
    assert (await client.get("/api/v1/alerts")).json()["items"] == []
    kinds = {t["kind"] for t in sim["timeline"]}
    assert {"headline", "price", "finding", "check", "investigation", "event"} <= kinds
    # every investigation was sent in the simulation's own time
    assert all(q["as_of"].startswith("2027-03") for q in agent.requests)
    assert all("web_search" not in q for q in monitor_agent.requests)
    # nothing live
    assert await sql("SELECT count(*) AS n FROM signals.findings WHERE world = 'live'") == [{"n": 0}]
    assert (await client.get("/api/v1/events")).json()["items"] == []
    h = (await client.get("/health/details")).json()["checks"]["investigation"]
    assert h["last_run"] is None
    rec = (await client.get(f"{S}/scenarios/{sc['scenario_id']}")).json()["recording"]
    assert rec["complete"] and rec["current"]

    # replay: the same stories, no agent called
    calls = (len(agent.requests), len(monitor_agent.requests))
    sim2 = (await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"], "mode": "replay"})).json()
    sim2 = await run_to_end(client, sim2)
    assert (len(agent.requests), len(monitor_agent.requests)) == calls
    assert sim2["status"] == "finished"
    assert {e["title"] for e in sim2["events"]} == {e["title"] for e in sim["events"]}
    # an edit makes the recording out of date
    await client.patch(f"{S}/scenarios/{sc['scenario_id']}", json={"intensity": "high"})
    r = await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"], "mode": "replay"})
    assert r.status_code == 409 and r.json()["code"] == "no_recording"


async def test_a_step_waits_for_the_agents_and_gives_up_at_the_deadline(client, env, agent, monitor_agent, sql):
    sc = await scenario(client, env)
    monitor_agent.pending = True
    sim = (await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"]})).json()
    sim = (await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={})).json()
    assert sim["step"] == 1 and sim["status"] == "waiting" and sim["pending"][0]["kind"] == "check"
    sim = (await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={})).json()
    assert sim["step"] == 1 and sim["status"] == "waiting"  # still out: the clock doesn't move
    env.setenv("SIM_AGENT_DEADLINE_SECONDS", "-1")
    sim = (await client.post(f"{S}/simulations/{sim['sim_id']}:step", json={})).json()
    assert sim["step"] == 2  # the late check was given up on and the clock moved
    failed = await sql("SELECT status, error FROM studio.sim_checks WHERE step = 1")
    assert failed == [{"status": "failed", "error": "the check took too long for the simulation"}]


async def test_quiet_days_make_no_agent_calls(client, env, monitor_agent):
    sc = await scenario(client, env)
    sim = (await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"]})).json()
    sim = await run_to_end(client, sim)
    assert len(monitor_agent.requests) == 6  # one check per day with headlines, none on the other 15


async def test_edit_add_and_remove_headlines(client, env, agent, monitor_agent):
    agent.classify = classify
    sc = await scenario(client, env)
    heads = [{"id": h["id"], "title": h["title"], "day": h["day"], "time": h["time"]} for h in sc["built"]["headlines"]]
    heads[0]["title"] = "The rupee tumbles as importers scramble for dollars"
    heads = [h for h in heads if h["id"] != "h5"]  # removed: exporters
    heads.append({"id": "c-1", "title": "Garment makers warn of order cuts in Europe", "day": 6, "time": "08:15"})
    r = await client.patch(f"{S}/scenarios/{sc['scenario_id']}", json={"custom": {"headlines": heads}})
    assert r.status_code == 200, r.text
    b = r.json()["built"]
    assert [h["id"] for h in b["headlines"]] == ["h1", "h2", "h3", "h4", "c-1", "h6"]  # in time order
    assert b["headlines"][0]["title"].startswith("The rupee tumbles") and r.json()["version"] == 2
    st = {s["key"]: s["expected"] for s in b["stories"]}
    assert st["exporters"] is False and st["fx"] is True  # a removed headline's story isn't expected
    bad = await client.patch(f"{S}/scenarios/{sc['scenario_id']}", json={"custom": {"headlines": [heads[0], heads[0]]}})
    assert bad.status_code == 422


async def test_a_blank_scenario_runs_with_your_headlines_and_price_move(client, env, agent, monitor_agent):
    agent.classify = classify
    await bank(client, env)
    r = await client.post(f"{S}/scenarios", headers=H, json={
        "template_id": "blank", "title": "Gulf visa freeze",
        "custom": {"headlines": [{"id": "c-1", "title": "Saudi Arabia freezes new work visas for six months", "day": 1, "time": "09:00"},
                                 {"id": "c-2", "title": "Remittance firms report a drop in transfers to Sri Lanka", "day": 3, "time": "12:00"}],
                   "prices": {"direction": "weaker", "size_pct": 6, "ramp_days": 4}}})
    assert r.status_code == 201, r.text
    sc = r.json()
    assert sc["title"] == "Gulf visa freeze" and sc["built"]["stories"] == [] and len(sc["built"]["headlines"]) == 2
    assert sc["built"]["prices"]["shock"]["size_pct"] == 6 and not sc["built"]["prices"]["off"]
    sim = (await client.post(f"{S}/simulations", json={"scenario_id": sc["scenario_id"], "mode": "live"})).json()
    sim = await run_to_end(client, sim)
    assert sim["status"] == "finished" and sim["events"]
    assert sim["summary"]["stories"] == []
    calm = await client.patch(f"{S}/scenarios/{sc['scenario_id']}", json={"custom": {"prices": {"direction": "none"}}})
    assert calm.json()["built"]["prices"]["off"] is True and len(calm.json()["built"]["headlines"]) == 2  # headlines kept
