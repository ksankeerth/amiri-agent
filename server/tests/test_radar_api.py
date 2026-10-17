"""Radar: runs on the tick and Check now, stories by fingerprint, the agent's sent
stories as findings, developments, a person's actions, the daily BigQuery cap, the contract."""

from tests.test_investigation_api import bank

R = "/api/v1/radar"


def story(fp: str, title: str, send: bool, **kw) -> dict:
    return {"fingerprint": fp, "title": title, "summary": f"{title}.", "places": kw.pop("places", ["SA", "LK"]),
            "themes": kw.pop("themes", [{"theme": "remittance", "direction": "down"}]), "relevance": "high",
            "score": kw.pop("score", 72 if send else 40), "publishers": kw.pop("publishers", 5),
            "headlines": kw.pop("headlines", [{"title": title, "outlet": "arabnews.com", "url": f"https://arabnews.com/{fp}",
                                               "published_at": "2026-10-07T08:00:00Z"}]),
            "send": send, "why": kw.pop("why", "Remittances from Saudi Arabia fund your customers' deposits."), **kw}


async def test_a_run_on_the_tick_stores_stories_and_sends_what_the_agent_chose(client, env, radar_agent, agent):
    await bank(client, env)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True),
                           story("tea-auction", "Tea auction prices dip", False, places=["LK"], themes=[])]]
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s["step"] == "radar")["started"] == 1
    req = radar_agent.requests[0]
    assert "SA" in req["scope"]["places"] and "Coastal Remit" in req["scope"]["actors"]
    assert req["scope"]["places_why"]["LK"] == ["footprint (home)"] and req["institution"]["country"] == "LK"
    assert req["limits"]["max_queries"] == 1 and req["limits"]["max_bytes_per_query"] == 1_500_000_000  # the cost guards
    assert req["seen"] == [] and req["seen_stories"] == [] and req["model_calls_left_today"] == 300
    await client.post("/internal/tick")  # collected
    items = (await client.get(f"{R}/stories")).json()["items"]
    by = {s["fingerprint"]: s for s in items}
    assert by["ksa-visas"]["status"] == "sent" and by["ksa-visas"]["sent_by"] == "agent" and by["tea-auction"]["status"] == "below"
    f = (await client.get(f"/api/v1/findings/{by['ksa-visas']['finding_id']}")).json()
    assert (f["source"], f["kind"], f["world"]) == ("radar", "story", "live")
    assert f["themes"] == [{"theme": "remittance", "direction": "down"}]
    assert "Why it matters" in f["explanation"] and f["evidence"]["headlines"][0]["outlet"] == "arabnews.com"
    st = (await client.get(f"{R}:status")).json()
    assert st["last_run"]["stories"] == 2 and st["last_run"]["sent"] == 1 and st["bytes_today"] == 1_200_000_000
    # the investigation takes it like any other finding
    await client.post("/api/v1/investigations", json={"world": "live"})
    assert agent.requests[-1]["findings"][0]["source"] == "radar"


async def test_the_schedule_and_a_story_seen_again(client, env, radar_agent, clock):
    await bank(client, env)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True)]]
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    assert len(radar_agent.requests) == 1  # not due again within the hour
    clock.advance(minutes=61)
    more = [{"title": "Kuwait follows Saudi visa rules", "outlet": "gulfnews.com", "url": "https://gulfnews.com/1",
             "published_at": "2026-10-07T10:00:00Z"}]
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True, headlines=more, publishers=8)]]
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    r2 = radar_agent.requests[1]
    assert r2["seen"] == ["ksa-visas"] and r2["window"]["since"] == radar_agent.requests[0]["window"]["until"]
    # the agent keeps no memory: the server sends what it needs to recognise the story again
    (s1,) = r2["seen_stories"]
    assert s1["fingerprint"] == "ksa-visas" and s1["title"] == "Saudi Arabia tightens visa renewals"
    assert s1["places"] == ["SA", "LK"] and s1["headlines"] == ["Saudi Arabia tightens visa renewals"]
    assert r2["model_calls_left_today"] == 300 - 1  # the first run's call counts against the day
    items = (await client.get(f"{R}/stories")).json()["items"]
    assert len(items) == 1 and items[0]["runs_seen"] == 2 and items[0]["publishers"] == 8
    assert len(items[0]["headlines"]) == 2  # merged, not repeated
    findings = (await client.get("/api/v1/findings", params={"source": "radar"})).json()["items"]
    assert len(findings) == 1  # one finding per story


async def test_a_continuation_joins_the_open_event(client, env, radar_agent, agent, sql):
    await bank(client, env)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True)]]
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    await client.post("/api/v1/investigations", json={"world": "live"})
    await client.post("/internal/tick")
    event_id = (await client.get("/api/v1/events")).json()["items"][0]["event_id"]
    radar_agent.script = [[story("ksa-visas-2", "Saudi visa rules start for domestic workers", True,
                                 development_of="ksa-visas")]]
    r = await client.post(f"{R}:run")
    assert r.status_code == 202, r.text
    run = (await client.get(f"{R}/runs/{r.json()['run_id']}")).json()
    assert run["status"] == "completed"
    dev = await sql("SELECT event_id, linked_by FROM cases.event_developments")
    assert dev == [{"event_id": event_id, "linked_by": "radar"}]
    s = next(x for x in (await client.get(f"{R}/stories")).json()["items"] if x["fingerprint"] == "ksa-visas-2")
    assert s["event_id"] == event_id


async def test_a_person_sends_dismisses_and_restores(client, env, radar_agent):
    await bank(client, env)
    radar_agent.script = [[story("tea-auction", "Tea auction prices dip", False, places=["LK"], themes=[]),
                           story("ksa-visas", "Saudi Arabia tightens visa renewals", True)]]
    await client.post(f"{R}:run")
    items = {s["fingerprint"]: s for s in (await client.get(f"{R}/stories")).json()["items"]}
    tea, ksa = items["tea-auction"]["story_id"], items["ksa-visas"]["story_id"]
    assert (await client.post(f"{R}/stories/{ksa}:dismiss")).status_code == 409  # sent already
    d = (await client.post(f"{R}/stories/{tea}:dismiss", headers={"X-Amiri-Actor": "rm@serendib.lk"})).json()
    assert d["status"] == "dismissed" and d["dismissed_by"] == "rm@serendib.lk"
    assert (await client.get(f"{R}/stories", params={"status": "dismissed"})).json()["items"][0]["story_id"] == tea
    assert (await client.post(f"{R}/stories/{tea}:restore")).json()["status"] == "below"
    s = (await client.post(f"{R}/stories/{tea}:investigate", headers={"X-Amiri-Actor": "rm@serendib.lk"})).json()
    assert s["status"] == "sent" and s["sent_by"] == "rm@serendib.lk" and s["finding_id"]
    assert (await client.post(f"{R}/stories/{tea}:investigate")).status_code == 409


async def test_the_daily_bigquery_cap(client, env, radar_agent, clock):
    await bank(client, env)
    env.setenv("RADAR_DAILY_BYTES_CAP", "1000000000")  # 1 GB; a run reports 1.2 GB
    await client.post(f"{R}:run")
    st = (await client.get(f"{R}:status")).json()
    assert st["budget_spent"] is True and st["notes"]
    r = await client.post(f"{R}:run")
    assert r.status_code == 409 and r.json()["code"] == "budget_spent"
    assert st["run_now"]["used"] == 1  # the refused one doesn't count
    clock.advance(minutes=61)
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s["step"] == "radar")["skipped"] == ["today's BigQuery budget is spent"]


async def test_an_answer_off_the_contract_fails_the_run(client, env, radar_agent):
    await bank(client, env)
    bad = story("xyz-1", "Something", True)
    del bad["why"]
    radar_agent.script = [[bad]]
    r = await client.post(f"{R}:run")
    run = (await client.get(f"{R}/runs/{r.json()['run_id']}")).json()
    assert run["status"] == "failed" and "broke the contract" in run["error"]


async def test_not_connected(client, env, app):
    await bank(client, env)
    app.state.radar.client.url = ""
    assert (await client.post(f"{R}:run")).status_code == 503
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s["step"] == "radar")["skipped"] == ["RADAR_URL is not set"]


async def test_a_live_monitor_covering_the_places_is_hinted(client, env, radar_agent):
    from tests.test_monitors_api import live

    await bank(client, env)
    m = await live(client)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True)]]
    await client.post(f"{R}:run")
    s = (await client.get(f"{R}/stories")).json()["items"][0]
    assert s["monitor_hint"] == {"monitor_id": m["monitor_id"], "name": m["name"]}


async def test_the_conformance_check_passes_on_the_fake_agent():
    import httpx

    from app.radar import check
    from app.radar.fake_agent import create_fake_agent

    results = await check.Checker("http://fake", httpx.ASGITransport(app=create_fake_agent())).run()
    failed = [r for r in results if not r.ok]
    assert not failed, check.report(results)
    assert len(results) >= 20
