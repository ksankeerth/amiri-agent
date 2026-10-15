"""Monitors: drafting from the profile, the spec checks, the lifecycle
and versions, checks on the tick and Run now, findings and their way to the investigation."""

from datetime import datetime, timedelta

import pytest

from app import settings
from app.monitors import templates
from tests.test_investigation_api import bank

H = {"X-Amiri-Actor": "rm@serendib.lk"}


def spec(**over) -> dict:
    s = {
        "about": {"name": "Gulf jobs and security", "owner": "Retail banking", "check_frequency": 60,
                  "key_dates": [{"date": "2026-11-01", "label": "Saudi labour quota rules take effect", "lead_days": 7}]},
        "public": {"watch": [{"name": "Saudi Arabia", "type": "place", "other_forms": ["KSA"]},
                             {"name": "migrant workers", "type": "topic"}],
                   "in_one_sentence": "Events in the Gulf that could cut jobs or pay for our migrant customers.",
                   "tell_me_if": ["Conflict or attacks affect a Gulf state where many migrants work",
                                  "A Gulf state announces job cuts, visa limits or wage controls for foreign workers"],
                   "example_headlines": {"match": [{"headline": "Saudi Arabia cuts foreign worker quotas", "line": 2}]},
                   "places": ["SA", "AE", "LK"], "languages": ["en"]},
        "private": {"exposure": [{"id": "segment:migrant-families", "how_it_reaches_us": "Remittances fund savings."},
                                 {"id": "product:migrant-savings"}]},
        "alert_level": 6,
    }
    for path, v in over.items():
        *parts, last = path.split(".")
        d = s
        for p in parts:
            d = d[p]
        d[last] = v
    return s


async def create(client, **over) -> dict:
    r = await client.post("/api/v1/monitors", json={"spec": spec(**over)}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()


async def live(client, **over) -> dict:
    m = await create(client, **over)
    assert (await client.post(f"/api/v1/monitors/{m['monitor_id']}:submit", headers=H)).status_code == 200
    r = await client.post(f"/api/v1/monitors/{m['monitor_id']}:approve", headers={"X-Amiri-Actor": "cro@serendib.lk"})
    assert r.status_code == 200, r.text
    return r.json()


def page(clock, minutes_ago: int, n: int = 1, **kw) -> dict:
    return {"url": f"https://www.arabnews.com/node/{n}", "title": f"Saudi Arabia cuts foreign worker quotas ({n})",
            "published_at": (clock.now() - timedelta(minutes=minutes_ago)).isoformat(), "line": 2, "places": ["SA"], **kw}


# ---------------------------------------------------------------- writing


async def test_a_monitor_is_drafted_from_a_profile_item_by_code(client, env):
    await bank(client, env)
    items = (await client.get("/api/v1/monitors:draftable")).json()["items"]
    sections = {i["section"] for i in items}
    assert sections == {"risk-exposures", "regulators", "rivals", "flows", "counterparties"}
    assert len({i["label"] for i in items}) == len(items)  # a branch's corridor names its own end (→ Kerala)
    flow = next(i for i in items if i["section"] == "flows" and i["item_id"] == "remit-sa")
    r = await client.post("/api/v1/monitors:draft", json={"section": "flows", "item_id": flow["item_id"]}, headers=H)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["status"] == "draft" and m["origin"] == "profile" and m["origin_ref"] == {"section": "flows", "item_id": "remit-sa"}
    assert m["drafted_fields"] == templates.DRAFTED and m["created_by"] == "rm@serendib.lk"
    s = m["spec"]
    assert s["public"]["places"] == ["SA", "LK"] and "Saudi Arabia" in s["about"]["name"]
    assert {e["id"] for e in s["private"]["exposure"]} >= {"flow:remit-sa"}
    for i in items:  # every draftable item makes a valid spec
        r = await client.post("/api/v1/monitors:draft", json={"section": i["section"], "item_id": i["item_id"]}, headers=H)
        assert r.status_code == 201, (i, r.text)
    r = await client.post("/api/v1/monitors:draft", json={"section": "rivals", "item_id": "nope"})
    assert r.status_code == 404


async def test_the_spec_is_checked_against_the_profile_and_the_limits(client, env):
    await bank(client, env)
    r = await client.post("/api/v1/monitors", json={"spec": spec(**{"private.exposure": [{"id": "product:nope"}]})})
    assert r.status_code == 422 and "product:nope" in r.json()["detail"]
    r = await client.post("/api/v1/monitors", json={"spec": spec(**{"about.check_frequency": 15})})
    assert r.status_code == 422 and "60 minutes" in r.text
    r = await client.post("/api/v1/monitors", json={"spec": spec(**{"public.places": ["SA", "XX-99"]})})
    assert r.status_code == 422 and "XX-99" in r.text
    r = await client.post("/api/v1/monitors", json={"spec": spec(**{"public.example_headlines": {
        "match": [{"headline": "Something happened", "line": 5}]}})})
    assert r.status_code == 422


# ---------------------------------------------------------------- lifecycle and versions


async def test_submit_approve_pause_resume_retire(client, env, clock):
    await bank(client, env)
    m = await create(client)
    mid = m["monitor_id"]
    assert (await client.post(f"/api/v1/monitors/{mid}:approve")).status_code == 409  # not submitted
    await client.post(f"/api/v1/monitors/{mid}:submit", headers=H)
    r = await client.post(f"/api/v1/monitors/{mid}:request-changes", json={"note": "Add Qatar."}, headers=H)
    m = r.json()
    assert m["status"] == "draft" and m["versions"][0]["note"] == "Add Qatar." and m["live_version"] is None
    m = await live(client)
    assert m["status"] == "live" and m["live_version"] == 1
    assert datetime.fromisoformat(m["next_check_at"]) == clock.now()  # due at once
    v = m["versions"][0]
    assert v["status"] == "approved" and v["submitted_by"] == "rm@serendib.lk" and v["approved_by"] == "cro@serendib.lk"
    mid = m["monitor_id"]
    assert (await client.post(f"/api/v1/monitors/{mid}:resume")).status_code == 409
    assert (await client.post(f"/api/v1/monitors/{mid}:pause")).json()["status"] == "paused"
    assert (await client.post(f"/api/v1/monitors/{mid}:resume")).json()["status"] == "live"
    assert (await client.post(f"/api/v1/monitors/{mid}:retire")).json()["status"] == "retired"
    r = await client.patch(f"/api/v1/monitors/{mid}", json={"spec": spec()})
    assert r.status_code == 409 and r.json()["type"].endswith("/monitor_retired")
    items = (await client.get("/api/v1/monitors")).json()["items"]
    assert [i["status"] for i in items][-1] == "retired"
    assert [i["monitor_id"] for i in (await client.get("/api/v1/monitors", params={"status": "draft"})).json()["items"]]


async def test_a_change_to_a_live_monitor_waits_for_approval_while_the_live_one_runs(client, env, monitor_agent):
    await bank(client, env)
    m = await live(client)
    mid = m["monitor_id"]
    r = await client.patch(f"/api/v1/monitors/{mid}", json={
        "spec": spec(**{"public.places": ["SA", "AE", "QA", "LK"]}), "note": "Add Qatar."}, headers=H)
    m = r.json()
    assert m["status"] == "live" and m["live_version"] == 1 and m["latest_version"] == 2
    assert m["pending"] == {"version": 2, "status": "draft", "note": "Add Qatar."}
    assert "QA" in m["spec"]["public"]["places"] and "QA" not in m["live_spec"]["public"]["places"]
    await client.post("/internal/tick")
    assert monitor_agent.requests[-1]["monitor"]["version"] == 1  # the live version is what runs
    await client.patch(f"/api/v1/monitors/{mid}", json={"spec": spec(**{"public.places": ["SA", "QA"]})})
    assert (await client.get(f"/api/v1/monitors/{mid}")).json()["latest_version"] == 2  # a draft is edited in place
    await client.post(f"/api/v1/monitors/{mid}:submit")
    m = (await client.post(f"/api/v1/monitors/{mid}:approve")).json()
    assert m["live_version"] == 2 and m["pending"] is None and m["status"] == "live"
    assert [v["status"] for v in m["versions"]] == ["superseded", "approved"]


async def test_live_monitors_are_limited(client, env):
    await bank(client, env)
    env.setenv("MONITORS_LIVE_MAX", "1")
    await live(client)
    m = await create(client)
    await client.post(f"/api/v1/monitors/{m['monitor_id']}:submit")
    r = await client.post(f"/api/v1/monitors/{m['monitor_id']}:approve")
    assert r.status_code == 409 and "MONITORS_LIVE_MAX" in r.text


# ---------------------------------------------------------------- checks


async def test_the_tick_checks_a_due_monitor_and_its_findings_reach_the_investigation(
        client, env, clock, monitor_agent, agent, sql):
    await bank(client, env)
    m = await live(client)
    mid = m["monitor_id"]
    monitor_agent.pages = [page(clock, 30, 1, key_date="2026-11-01"), page(clock, 60 * 30, 2)]  # the 2nd: too old
    ran = (await client.post("/internal/tick")).json()["ran"]
    step = next(s for s in ran if s["step"] == "monitors")
    assert step["started"] == 1 and step["done"] == 0  # started on this tick, collected on the next
    ran = (await client.post("/internal/tick")).json()["ran"]
    step = next(s for s in ran if s["step"] == "monitors")
    assert step["started"] == 0 and step["done"] == 1 and step["findings"] == 1
    req = monitor_agent.requests[0]
    assert req["monitor"] == {"monitor_id": mid, "version": 1, "spec": m["spec"]}
    assert req["institution"]["country"] == "LK" and req["institution"]["currency"] == "LKR"
    assert {"segment:migrant-families", "product:migrant-savings"} <= {
        f"segment:{s['id']}" for s in req["institution"]["segments"]} | {f"product:{p['id']}" for p in req["institution"]["products"]}
    assert req["web_search"] == {"max_queries": 3} and req["recent_urls"] == []
    span = datetime.fromisoformat(req["window"]["until"]) - datetime.fromisoformat(req["window"]["since"])
    assert span == timedelta(hours=24)  # an approved monitor's first check reads the last day (a draft's test: one period)
    f = (await client.get(f"/api/v1/monitors/{mid}/findings")).json()["items"]
    assert len(f) == 1
    f = f[0]
    assert f["source"] == "monitor" and f["kind"] == "news_match" and f["world"] == "live" and f["themes"] == []
    assert f["source_ref"]["monitor_id"] == mid and f["source_ref"]["lines"] == [2]
    assert f["source_ref"]["line_texts"] == [spec()["public"]["tell_me_if"][1]]
    assert f["score"] == 60 and f["places"] == ["SA"] and str(f["effective_from"]) == "2026-11-01"
    assert f["evidence"]["headlines"][0]["url"] == "https://www.arabnews.com/node/1"
    m = (await client.get(f"/api/v1/monitors/{mid}")).json()
    assert m["last_check"]["status"] == "fired" and m["last_check"]["findings"] == 1
    runs = (await client.get(f"/api/v1/monitors/{mid}/runs")).json()["items"]
    assert runs[0]["status"] == "completed" and runs[0]["coverage"]["pages_in_window"] == 1

    # the investigation takes it like any other finding
    r = await client.post("/api/v1/investigations", json={})
    assert r.status_code == 202, r.text
    sent = agent.requests[0]["findings"][0]
    assert sent["source"] == "monitor" and sent["kind"] == "news_match" and sent["evidence"]["headlines"]

    # not due again until its frequency has passed; the next check starts where this one ended
    await client.post("/internal/tick")
    assert len(monitor_agent.requests) == 1
    clock.advance(minutes=61)
    monitor_agent.pages.append(page(clock, 10, 3))
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    req2 = monitor_agent.requests[1]
    assert req2["window"]["since"] == req["window"]["until"]
    assert req2["recent_urls"] == ["https://www.arabnews.com/node/1"]
    assert (await client.get(f"/api/v1/monitors/{mid}")).json()["findings_30d"] == 2


async def test_run_now_on_a_draft_is_a_test_in_the_sandbox(client, env, monitor_agent, clock):
    await bank(client, env)
    m = await create(client)
    mid = m["monitor_id"]
    monitor_agent.pages = [page(clock, 20)]
    r = await client.post(f"/api/v1/monitors/{mid}:run", headers=H)
    assert r.status_code == 202, r.text
    run = r.json()
    assert run["trigger"] == "test" and run["world"] == "sandbox" and run["status"] == "completed" and run["findings"] == 1
    f = (await client.get(f"/api/v1/monitors/{mid}/findings")).json()["items"][0]
    assert f["world"] == "sandbox"
    m = (await client.get(f"/api/v1/monitors/{mid}")).json()
    assert m["last_check"] is None and m["status"] == "draft"  # a test doesn't count as the monitor's check
    assert (await client.get(f"/api/v1/monitor-checks/{run['run_id']}")).json()["request"]["monitor"]["version"] == 1
    ran = (await client.post("/internal/tick")).json()["ran"]  # drafts aren't checked on the tick
    assert next(s for s in ran if s["step"] == "monitors")["started"] == 0


async def test_a_check_still_running_is_collected_later_and_a_lost_one_is_sent_again(client, env, monitor_agent, clock):
    await bank(client, env)
    m = await live(client)
    monitor_agent.pending = True
    await client.post("/internal/tick")
    run_id = monitor_agent.requests[0]["run_id"]
    assert (await client.get(f"/api/v1/monitor-checks/{run_id}")).json()["status"] == "running"
    r = await client.post(f"/api/v1/monitors/{m['monitor_id']}:run")
    assert r.status_code == 409  # one check at a time
    monitor_agent.forget.add(run_id)  # the agent restarted
    await client.post("/internal/tick")
    run = (await client.get(f"/api/v1/monitor-checks/{run_id}")).json()
    assert run["reposts"] == 1 and len(monitor_agent.requests) == 2 and run["status"] == "running"
    monitor_agent.pending = False
    await client.post("/internal/tick")
    assert (await client.get(f"/api/v1/monitor-checks/{run_id}")).json()["status"] == "completed"


async def test_a_failed_check_is_recorded_and_the_monitor_keeps_its_schedule(client, env, monitor_agent, clock):
    await bank(client, env)
    m = await live(client)
    monitor_agent.fail_run = True
    await client.post("/internal/tick")
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s["step"] == "monitors")["failed"] == 1
    m = (await client.get(f"/api/v1/monitors/{m['monitor_id']}")).json()
    assert m["last_check"]["status"] == "error" and m["next_check_at"] > m["created_at"]
    h = (await client.get("/health/details")).json()
    assert h["checks"]["monitor"]["status"] == "failing" and h["status"] == "degraded"
    monitor_agent.fail_next = [422]
    clock.advance(minutes=61)
    await client.post("/internal/tick")
    runs = (await client.get(f"/api/v1/monitors/{m['monitor_id']}/runs")).json()["items"]
    assert runs[0]["status"] == "failed" and "refused" in runs[0]["error"]


async def test_a_failed_daily_check_is_retried_within_the_hour(client, env, monitor_agent, clock):
    await bank(client, env)
    m = await live(client, **{"about.check_frequency": 1440})
    monitor_agent.fail_run = True
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    got = (await client.get(f"/api/v1/monitors/{m['monitor_id']}")).json()
    assert got["last_check"]["status"] == "error"
    assert (datetime.fromisoformat(got["next_check_at"]) - clock.now()).total_seconds() <= 60 * 60
    monitor_agent.fail_run = False
    clock.advance(minutes=61)  # not a day
    await client.post("/internal/tick")
    runs = (await client.get(f"/api/v1/monitors/{m['monitor_id']}/runs")).json()["items"]
    assert len(runs) == 2 and runs[0]["status"] != "failed"


async def test_drafting_the_same_profile_item_again_opens_the_monitor_that_has_it(client, env):
    await bank(client, env)
    a = await client.post("/api/v1/monitors:draft", json={"section": "risk-exposures", "item_id": "gulf"}, headers=H)
    b = await client.post("/api/v1/monitors:draft", json={"section": "risk-exposures", "item_id": "gulf"}, headers=H)
    assert a.status_code == b.status_code == 201 and a.json()["monitor_id"] == b.json()["monitor_id"]
    assert len((await client.get("/api/v1/monitors")).json()["items"]) == 1
    await client.post(f"/api/v1/monitors/{a.json()['monitor_id']}:retire", headers=H)  # a retired one doesn't count
    c = await client.post("/api/v1/monitors:draft", json={"section": "risk-exposures", "item_id": "gulf"}, headers=H)
    assert c.json()["monitor_id"] != a.json()["monitor_id"]


async def test_without_the_agent_nothing_is_checked(client, env, app):
    await bank(client, env)
    m = await live(client)
    app.state.monitors.client.url = ""
    ran = (await client.post("/internal/tick")).json()["ran"]
    assert next(s for s in ran if s["step"] == "monitors")["skipped"] == ["MONITOR_URL is not set"]
    r = await client.post(f"/api/v1/monitors/{m['monitor_id']}:run")
    assert r.status_code == 503
    st = (await client.get("/api/v1/monitors:status")).json()
    assert st["connected"] is False and st["live"] == 1 and st["notes"]


@pytest.mark.skipif(not (settings.PROJECT.parent / "agents" / "investigation-agent").exists(), reason="the agents' fixtures aren't in this checkout")
async def test_any_japac_institution_drafts_and_checks_monitors(client, env, monitor_agent, clock):
    import json

    ph = json.loads((settings.PROJECT.parent / "agents" / "investigation-agent" / "tests" / "fixtures" / "profiles"
                     / "ph_bank.json").read_text())
    r = await client.post("/api/v1/institutions:import", json=ph)
    assert r.status_code == 201, r.text
    env.setenv("INSTITUTION_ID", "ph-bank")
    items = (await client.get("/api/v1/monitors:draftable")).json()["items"]
    assert items and {i["section"] for i in items} == {"flows"}
    made = [(await client.post("/api/v1/monitors:draft", json={"section": "flows", "item_id": i["item_id"]})).json() for i in items]
    assert all("PH" in m["spec"]["public"]["places"] for m in made)
    mid = made[0]["monitor_id"]
    await client.post(f"/api/v1/monitors/{mid}:submit")
    await client.post(f"/api/v1/monitors/{mid}:approve")
    await client.post("/internal/tick")
    inst = monitor_agent.requests[0]["institution"]
    assert (inst["country"], inst["currency"], inst["country_name"]) == ("PH", "PHP", "Philippines")
    assert inst["flows"] and inst["corridors"]


async def test_saving_without_a_change_makes_no_new_version(client, env):
    await bank(client, env)
    m = await live(client)
    mid = m["monitor_id"]
    r = (await client.patch(f"/api/v1/monitors/{mid}", json={"spec": m["spec"]})).json()
    assert r["latest_version"] == m["latest_version"] and len(r["versions"]) == len(m["versions"])  # nothing changed
    changed = (await client.patch(f"/api/v1/monitors/{mid}", json={"spec": spec(**{"public.places": ["SA", "QA"]})})).json()
    assert changed["latest_version"] == m["latest_version"] + 1  # a real change is the next version
    again = (await client.patch(f"/api/v1/monitors/{mid}", json={"spec": changed["spec"]})).json()
    assert again["latest_version"] == changed["latest_version"]
