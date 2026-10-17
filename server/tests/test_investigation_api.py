"""Findings -> the investigation agent -> events: coverage and calendar for the agent, the
request built from the profile, batching on the tick, investigate now, failures, reads."""

import json
from datetime import UTC, datetime, timedelta

from app import settings

SEED = json.loads((settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())
FX = {"theme": "fx", "direction_up": "weaker", "direction_down": "stronger", "currency": "LKR"}


async def bank(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    r = await client.post("/api/v1/institutions:import", json={"institution": SEED["institution"],
                                                               "sections": SEED["sections"]})
    assert r.status_code == 201, r.text


async def sandbox_move(client, pct=-6.0) -> dict:
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "theme": FX, "places": ["LK"]})
    assert r.status_code == 201, r.text
    out = (await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": pct})).json()
    assert out["fired"], out["note"]
    return out["finding"]


# ---------------------------------------------------------------- what the agent reads


async def test_coverage_is_assumed_from_the_metrics_spec(client, env):
    await bank(client, env)
    c = (await client.get("/api/v1/internal/coverage", params={"institution_id": "serendib-bank"})).json()
    assert c["data_source"]["assumed"] is True and c["data_source"]["data_source_id"] == "metrics-spec"
    p = {x["product_id"]: x for x in c["products"]}
    sme = {m["metric"]: m for m in p["sme-loans"]["metrics"]}  # business_loan / working_capital
    fu = sme["facility_utilization"]
    assert "importer" in fu["dimensions"]["segment"] and fu["method"] and fu["thresholds"]
    assert "LK-1" in fu["dimensions"].get("region_l1", ["LK-1"])
    assert "lc_openings" in {m["metric"] for m in p["trade-finance"]["metrics"]}  # import_lc
    saving = {m["metric"]: m for m in p["migrant-savings"]["metrics"]}["deposit_inflow"]
    assert saving["currency"] == "LKR" and "LK-11" in saving["dimensions"]["region_l2"]
    assert p["migrant-savings"]["book_size"] == {"value": 64000000000, "unit": "LKR"}


async def test_calendar_is_the_home_country_s_public_holidays(client, env):
    await bank(client, env)
    c = (await client.get("/api/v1/internal/calendar", params={
        "institution_id": "serendib-bank", "start": "2026-10-20", "until": "2026-10-28"})).json()
    days = {d["date"]: d for d in c["days"]}
    assert c["time_zone"] == "Asia/Colombo" and c["weekend_days"] == [6, 7]
    assert days["2026-10-25"]["holidays"] and not days["2026-10-25"]["business"]  # a full-moon Poya day
    assert days["2026-10-26"]["business"] and not days["2026-10-24"]["business"]  # Monday; Saturday
    r = await client.get("/api/v1/internal/calendar", params={
        "institution_id": "serendib-bank", "start": "2026-10-20", "until": "2026-10-20"})
    assert r.status_code == 422


# ---------------------------------------------------------------- investigate


async def test_investigate_now_sends_the_profile_and_stores_the_event(client, env, agent, sql):
    await bank(client, env)
    f = await sandbox_move(client)
    status = (await client.get("/api/v1/investigation:status")).json()
    assert status["connected"] and status["findings_waiting"] == 1 and status["validation"] is False
    r = await client.post("/api/v1/investigations", json={})
    assert r.status_code == 202, r.text
    run = r.json()["items"][0]
    req = agent.requests[0]
    inst = req["institution"]
    assert (inst["country"], inst["country_name"], inst["currency"], inst["time_zone"]) == (
        "LK", "Sri Lanka", "LKR", "Asia/Colombo")
    # where it books business: role and regions, so a story elsewhere in India isn't the footprint
    assert {"country": "IN", "currency": "INR", "role": "branches",
            "regions": ["IN-TN", "IN-KL", "IN-KA"]} in inst["footprint"]
    assert any(fl["kind"] == "remittances_in" for fl in inst["flows"]) and inst["corridors"]
    assert {p["product_id"] for p in req["products"]} >= {"sme-loans", "trade-finance"}
    sent = req["findings"][0]
    assert sent["finding_id"] == f["finding_id"] and sent["themes"] == [{"theme": "fx", "direction": "stronger", "currency": "LKR"}]
    assert req["validation"] is False and req["server_url"]
    assert run["status"] == "running" and run["finding_ids"] == [f["finding_id"]]
    # the agent took it; the next tick collects it
    ran = (await client.post("/internal/tick")).json()["ran"]
    inv = next(s for s in ran if s.get("step") == "investigate")
    assert inv["done"] == 1
    events = (await client.get("/api/v1/events")).json()["items"]
    assert len(events) == 1 and events[0]["title"] == "The LKR weakened (6%)" and events[0]["world"] == "sandbox"
    e = (await client.get(f"/api/v1/events/{events[0]['event_id']}")).json()
    assert [h["chain_label"] for h in e["hypotheses"]] == ["Savings fall"] and e["tasks"] == []
    assert e["run"]["report"].startswith("# Investigation for Serendib") and e["set_aside"][0]["reason"] == "Not exposed."
    got = (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()
    assert got["status"] == "linked" and got["outcome"] == {"event_id": events[0]["event_id"]}
    health = (await client.get("/health/details")).json()
    assert health["checks"]["investigation"]["last_run"]["status"] == "completed"


async def test_the_server_setting_alone_asks_for_no_tasks(client, env, agent):
    env.setenv("METRICS_VALIDATION", "on")  # the server allows it, but the Platform Admin hasn't switched it on
    await bank(client, env)
    status = (await client.get("/api/v1/investigation:status")).json()
    assert status["validation"] is False and any("validation is off" in n for n in status["notes"])
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={})
    assert agent.requests[0]["validation"] is False


async def test_with_validation_on_tasks_are_stored(client, env, agent):
    from tests.test_coverage_connected import connect_sample

    await bank(client, env)
    await connect_sample(client, env)  # METRICS_VALIDATION on, a sample approved, the switch on
    assert (await client.get("/api/v1/investigation:status")).json()["validation"] is True
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={})
    assert agent.requests[0]["validation"] is True
    await client.post("/internal/tick")
    e = (await client.get("/api/v1/events")).json()["items"][0]
    assert e["tasks"] == 1
    detail = (await client.get(f"/api/v1/events/{e['event_id']}")).json()
    task = detail["tasks"][0]
    assert task["task_id"].startswith("vt-") and task["hypothesis_id"] == detail["hypotheses"][0]["hypothesis_id"]
    assert detail["hypotheses"][0]["task_id"] == task["task_id"]


async def test_the_tick_waits_for_related_findings(client, env, agent, clock):
    await bank(client, env)
    await sandbox_move(client)
    await client.post("/internal/tick")
    assert agent.requests == []  # the batch waits INVESTIGATION_WAIT_MINUTES
    clock.at = clock.now() + timedelta(minutes=11)
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s.get("step") == "investigate")["claimed"] == 1 and len(agent.requests) == 1


async def test_a_failed_run_is_retried_then_set_aside(client, env, agent):
    env.setenv("INVESTIGATION_MAX_ATTEMPTS", "2")
    await bank(client, env)
    f = await sandbox_move(client)
    agent.fail_next = [500, 500]
    await client.post("/api/v1/investigations", json={})
    got = (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()
    assert got["status"] == "new" and got["outcome"]["attempts"] == 1  # back in the queue
    await client.post("/api/v1/investigations", json={})
    got = (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()
    assert got["status"] == "set_aside" and got["outcome"]["reason"] == "investigation_failed"
    runs = (await client.get("/api/v1/investigations")).json()["items"]
    assert [r["status"] for r in runs] == ["failed", "failed"] and "HTTP 500" in runs[0]["error"]


async def test_a_refused_request_is_not_retried(client, env, agent):
    await bank(client, env)
    f = await sandbox_move(client)
    agent.fail_next = [422]
    await client.post("/api/v1/investigations", json={})
    assert (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()["status"] == "set_aside"


async def test_a_run_still_running_is_collected_later(client, env, agent):
    await bank(client, env)
    await sandbox_move(client)
    agent.pending = True
    run = (await client.post("/api/v1/investigations", json={})).json()["items"][0]
    await client.post("/internal/tick")
    assert (await client.get(f"/api/v1/investigations/{run['run_id']}")).json()["status"] == "running"
    agent.pending = False
    r = await client.post(f"/api/v1/investigations/{run['run_id']}:collect")
    assert r.json()["status"] == "completed" and r.json()["report"]


async def test_no_profile_and_nothing_to_do(client, env, agent):
    await sandbox_move(client)  # INSTITUTION_ID is bank-a: no profile
    r = await client.post("/api/v1/investigations", json={})
    assert r.status_code == 409 and "no profile for institution bank-a" in r.text
    await bank(client, env)
    r = await client.post("/api/v1/investigations", json={"finding_ids": ["f-none"]})
    assert r.status_code == 409 and r.json()["code"] == "nothing_to_investigate"


async def test_old_fx_words_are_sent_in_the_new_shape(client, env, agent, sql):
    await bank(client, env)
    f = await sandbox_move(client)
    await sql("UPDATE signals.findings SET themes = %s::jsonb, institution_id = 'serendib-bank' WHERE finding_id = %s",
              (json.dumps([{"theme": "fx", "direction": "home_weaker"}]), f["finding_id"]))
    await client.post("/api/v1/investigations", json={})
    assert agent.requests[0]["findings"][0]["themes"] == [{"theme": "fx", "direction": "weaker", "currency": "LKR"}]


async def test_not_connected(app, client, env):
    app.state.investigations.client.url = ""
    s = (await client.get("/api/v1/investigation:status")).json()
    assert s["connected"] is False and any("isn't connected" in n for n in s["notes"])
    r = await client.post("/api/v1/investigations", json={})
    assert r.status_code == 503
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s.get("step") == "investigate")["skipped"] == ["INVESTIGATION_URL is not set"]


# ---------------------------------------------------------------- developments, closing, sandbox


async def test_a_continuing_move_joins_the_open_event(client, env, agent, clock):
    await bank(client, env)
    await sandbox_move(client, -6.0)
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    event = (await client.get("/api/v1/events")).json()["items"][0]
    # the same move again (LKR stronger): no new run, it joins the event
    out = (await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": -7})).json()
    r = (await client.post("/api/v1/investigations", json={})).json()
    assert r["items"] == [] and r["developments"][0]["event_id"] == event["event_id"]
    assert len(agent.requests) == 1
    detail = (await client.get(f"/api/v1/events/{event['event_id']}")).json()
    assert [d["finding_id"] for d in detail["developments"]] == [out["finding"]["finding_id"]]
    got = (await client.get(f"/api/v1/findings/{out['finding']['finding_id']}")).json()
    assert got["status"] == "linked" and got["outcome"] == {"event_id": event["event_id"], "development": True}
    # the opposite move is news: a new investigation
    await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": 9})
    r = (await client.post("/api/v1/investigations", json={})).json()
    assert len(r["items"]) == 1 and r["developments"] == [] and len(agent.requests) == 2


async def test_events_close_when_quiet(client, env, agent, clock):
    env.setenv("EVENT_OPEN_DAYS", "3")
    await bank(client, env)
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    assert (await client.get("/api/v1/events", params={"status": "open"})).json()["items"]
    clock.at = clock.now() + timedelta(days=4)
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s.get("step") == "investigate")["closed"] == 1
    e = (await client.get("/api/v1/events")).json()["items"][0]
    assert e["status"] == "closed" and e["closed_at"]


async def test_clearing_the_sandbox_keeps_live_data(client, env, agent, clock, fake):
    await bank(client, env)
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    clock.at = datetime(2026, 10, 7, 12, 0, 30, tzinfo=UTC)
    fake.extend("USD/LKR", 2, step_pct=3.0)
    await client.post("/internal/tick")  # a live finding
    out = (await client.delete("/api/v1/sandbox")).json()
    assert out == {"findings": 1, "investigations": 1}
    left = (await client.get("/api/v1/findings")).json()["items"]
    assert [f["world"] for f in left] == ["live"] and (await client.get("/api/v1/events")).json()["items"] == []


async def test_installation_names_the_institution_and_its_time_zone(client, env):
    i = (await client.get("/api/v1/installation")).json()
    assert i["profile"] is False and "no profile" in i["notes"][0]
    await bank(client, env)
    i = (await client.get("/api/v1/installation")).json()
    assert (i["institution_id"], i["name"], i["time_zone"], i["country_name"], i["base_currency"]) == (
        "serendib-bank", "Serendib Commercial Bank", "Asia/Colombo", "Sri Lanka", "LKR")


async def test_series_defaults_by_code(client):
    r = await client.post("/api/v1/series", json={"symbol": "USD/INR"})
    assert r.json()["places"] == ["IN"] and r.json()["theme"]["currency"] == "INR"
    r = await client.post("/api/v1/series", json={"symbol": "BNO"})
    assert r.json()["theme"]["item"] == "oil" and r.json()["places"] == []
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "places": ["LK", "AE"]})
    assert r.json()["places"] == ["LK", "AE"]  # given places stay


async def test_a_development_with_a_new_theme_extends_the_event(client, env, agent, sql):
    await bank(client, env)
    await sandbox_move(client, -6.0)
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    event = (await client.get("/api/v1/events")).json()["items"][0]
    # a later finding: the same move, plus a theme the event doesn't have
    out = (await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": -7})).json()
    themes = [*out["finding"]["themes"], {"theme": "remittance", "direction": "down"}]
    await sql("UPDATE signals.findings SET themes = %s::jsonb WHERE finding_id = %s",
              (json.dumps(themes), out["finding"]["finding_id"]))
    r = (await client.post("/api/v1/investigations", json={})).json()
    assert r["developments"][0]["event_id"] == event["event_id"]
    req = agent.requests[-1]
    assert req["extend"] == {"event_id": event["event_id"], "themes": [{"theme": "remittance", "direction": "down"}]}
    grown = (await client.get(f"/api/v1/events/{event['event_id']}")).json()
    assert {"theme": "remittance", "direction": "down"} in grown["themes"]  # the event now covers the new theme
    await client.post("/internal/tick")
    detail = (await client.get(f"/api/v1/events/{event['event_id']}")).json()
    assert len(detail["hypotheses"]) == 2 and len((await client.get("/api/v1/events")).json()["items"]) == 1
    got = (await client.get(f"/api/v1/findings/{out['finding']['finding_id']}")).json()
    assert got["status"] == "linked" and got["outcome"]["development"] is True


async def test_a_much_bigger_move_resizes_the_event_and_investigates_what_it_now_reaches(client, env, agent):
    await bank(client, env)
    await sandbox_move(client, 4.0)  # the rupee 4% weaker
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    event = (await client.get("/api/v1/events")).json()["items"][0]
    small = event["size"]["value"]
    # a little more of the same move: it joins, no run
    await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": 4.5})
    r = (await client.post("/api/v1/investigations", json={})).json()
    assert r["developments"] and len(agent.requests) == 1
    # far more (EVENT_RESIZE_FACTOR 1.5): the event is re-sized and an extend run asks for what the bigger move reaches
    out = (await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": 7.0})).json()
    await client.post("/api/v1/investigations", json={})
    req = agent.requests[-1]
    assert len(agent.requests) == 2 and req["extend"]["event_id"] == event["event_id"]
    assert req["extend"]["resize"] is True and req["extend"]["previous_size"] == {"unit": "pct", "value": small}
    grown = (await client.get(f"/api/v1/events/{event['event_id']}")).json()
    assert grown["size"]["value"] > 1.5 * small and f"({grown['size']['value']:g}%)" in grown["title"]
    assert out["finding"]["finding_id"] in [d["finding_id"] for d in grown["developments"]]


async def test_a_lost_run_is_sent_again(client, env, agent):
    await bank(client, env)
    await sandbox_move(client)
    agent.pending = True
    run = (await client.post("/api/v1/investigations", json={})).json()["items"][0]
    agent.forget.add(run["run_id"])
    await client.post(f"/api/v1/investigations/{run['run_id']}:collect")
    assert len(agent.requests) == 2 and agent.requests[1]["run_id"] == run["run_id"]  # the same request again
    agent.pending = False
    assert (await client.post(f"/api/v1/investigations/{run['run_id']}:collect")).json()["status"] == "completed"


async def test_the_internal_api_can_require_an_agent_token(client, env):
    await bank(client, env)
    params = {"institution_id": "serendib-bank"}
    assert (await client.get("/api/v1/internal/coverage", params=params)).status_code == 200
    env.setenv("INTERNAL_AUTH", "id_token")
    r = await client.get("/api/v1/internal/coverage", params=params)
    assert r.status_code == 401 and r.json()["code"] == "unauthenticated"
    r = await client.get("/api/v1/internal/coverage", params=params, headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


async def test_coverage_has_whole_category_groups(client, env):
    await bank(client, env)
    c = (await client.get("/api/v1/internal/coverage", params={"institution_id": "serendib-bank"})).json()
    groups = {g["group_id"]: g for g in c["groups"]}
    assert groups["group-payments"]["institution_wide"] is True
    assert {m["metric"] for m in groups["group-payments"]["metrics"]} >= {"digital_transactions", "failed_transactions_own"}
    assert [m["metric"] for m in groups["group-savings"]["metrics"]] == ["large_depositor_net_flow"]


async def test_a_themeless_finding_classified_as_an_open_story_joins_its_event(client, env, agent, sql):
    """A monitor's finding has no themes, so the server can't match it before the run; once the agent
    classifies it as the open event's move, it joins that event instead of opening a duplicate."""
    await bank(client, env)
    await sandbox_move(client)  # fx: LKR stronger
    await client.post("/api/v1/investigations", json={})
    await client.post("/internal/tick")
    first = (await client.get("/api/v1/events")).json()["items"]
    assert len(first) == 1
    await sql("""INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title,
                   explanation, score, themes, places, evidence, created_at)
                 VALUES ('f-mon-test-1', 'sandbox', 'serendib-bank', 'monitor', '{}', 'news_match',
                   'Rupee firms as inflows rise', 'A monitor matched it.', 60, '[]', '{LK}',
                   '{"headlines": [{"title": "Rupee firms as inflows rise", "published_at": "2026-10-07T09:00:00Z"}]}',
                   now())""")
    agent.themes = [{"theme": "fx", "direction": "stronger", "currency": "LKR"}]
    r = await client.post("/api/v1/investigations", json={})
    assert r.status_code == 202, r.text
    await client.post("/internal/tick")
    events = (await client.get("/api/v1/events")).json()["items"]
    assert len(events) == 1 and events[0]["developments"] == 1
    f = (await client.get("/api/v1/findings/f-mon-test-1")).json()
    assert f["status"] == "linked" and f["outcome"] == {"event_id": events[0]["event_id"], "development": True}
    hyps = await sql("SELECT count(*) AS n FROM cases.hypotheses")
    assert hyps == [{"n": 1}]  # the duplicate's hypotheses were dropped


async def test_a_cold_agent_gets_the_run_sent_again():
    """The first POST times out (the agent is starting); the same run is sent again and accepted."""
    import httpx

    from app.investigation.client import MonitorClient

    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("cold start", request=request)
        return httpx.Response(202, json={"run_id": "r1", "status": "queued"})
    c = MonitorClient("http://agent", transport=httpx.MockTransport(handler))
    assert (await c.start({"run_id": "r1"}))["status"] == "queued"
    assert len(calls) == 2 and calls[0].content == calls[1].content


async def test_a_finding_says_how_its_investigation_is_going(client, env, agent):
    await bank(client, env)
    f = await sandbox_move(client)
    await client.post("/api/v1/investigations", json={})
    items = (await client.get("/api/v1/findings", params={"world": "sandbox"})).json()["items"]
    got = next(x for x in items if x["finding_id"] == f["finding_id"])
    assert got["status"] == "grouped" and got["run_status"] == "running" and got["run_started_at"]
    await client.post(f"/api/v1/investigations/{got['run_id']}:collect")
    items = (await client.get("/api/v1/findings", params={"world": "sandbox"})).json()["items"]
    got = next(x for x in items if x["finding_id"] == f["finding_id"])
    assert got["status"] == "linked" and got["run_status"] == "completed" and got["outcome"]["event_id"]
