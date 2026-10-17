"""Alerts: raised per (event, owning team) from the investigation's expected effects,
escalated by later findings, routed through monitors, resolved when the event closes; a person's
acknowledgement; nothing from the sandbox."""


from tests.test_investigation_api import bank, sandbox_move

A = "/api/v1/alerts"
FX = '[{"theme": "fx", "direction": "weaker", "currency": "LKR"}]'


async def live_finding(sql, clock, fid: str, source: str = "timeseries", themes: str = FX, ref: str = "{}"):
    await sql("""INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title, explanation,
                   score, themes, places, evidence, created_at)
                 VALUES (%s, 'live', 'serendib-bank', %s, %s, %s, %s, 'x', 70, %s, '{LK}', %s, %s)""",
              (fid, source, ref, "signal_move" if source == "timeseries" else "news_match", f"Finding {fid}", themes,
               '{"signals": [{"description": "x"}]}' if source == "timeseries" else
               '{"headlines": [{"title": "Rupee slides", "published_at": "2026-10-07T09:00:00Z"}]}', clock.now()))


async def investigate(client):
    await client.post("/api/v1/investigations", json={"world": "live"})
    await client.post("/internal/tick")


async def test_an_event_raises_an_early_warning_for_the_owning_team(client, env, sql, clock, agent):
    await bank(client, env)
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={"world": "sandbox"})
    await client.post("/internal/tick")
    assert (await client.get(A)).json()["items"] == []  # the sandbox raises none
    await live_finding(sql, clock, "f-a-1")
    await investigate(client)
    items = (await client.get(A)).json()["items"]
    assert len(items) == 1
    a = items[0]
    assert (a["owner"], a["level"], a["status"]) == ("Retail banking", "warning", "new")
    assert a["title"] == "Migrant Family Savings: deposit inflow expected to fall"
    assert a["effects"][0]["adverse"] is True and a["history"][0]["change"] == "raised"
    assert a["event_title"] and a["top_finding"] == "Finding f-a-1" and a["sources"] == ["timeseries"]
    assert len((await client.get(A, params={"event_id": a["event_id"]})).json()["items"]) == 1  # an event's own alerts
    assert (await client.get(A, params={"event_id": "e-none"})).json()["items"] == []
    s = (await client.get(f"{A}:summary")).json()
    assert s["to_review"] == 1 and s["by_level"]["warning"] == 1 and s["teams"] == [{"owner": "Retail banking", "to_review": 1}]
    o = (await client.get("/api/v1/overview")).json()
    assert any(x["kind"] == "alerts" and x["level"] == "warn" for x in o["attention"])


async def test_a_favourable_effect_raises_no_alert(client, env, sql, clock, agent):
    await bank(client, env)
    agent.classify = lambda f: ([{"theme": "remittance", "direction": "up"}], "rise")
    await live_finding(sql, clock, "f-a-2", themes='[]')
    await investigate(client)
    assert (await client.get("/api/v1/events")).json()["items"]  # the event is there, for the Events page
    assert (await client.get(A)).json()["items"] == []
    assert "opportunity" not in (await client.get(f"{A}:summary")).json()["by_level"]


async def test_acknowledge_then_a_later_finding_escalates_it(client, env, sql, clock, agent):
    await bank(client, env)
    await live_finding(sql, clock, "f-a-3")
    await investigate(client)
    a = (await client.get(A)).json()["items"][0]
    r = await client.post(f"{A}/{a['alert_id']}:ack", json={"note": "Treasury is on it"}, headers={"X-Amiri-Actor": "rm@serendib.lk"})
    a = r.json()
    assert (a["status"], a["acknowledged_by"], a["ack_note"]) == ("acknowledged", "rm@serendib.lk", "Treasury is on it")
    assert (await client.post(f"{A}/{a['alert_id']}:ack")).status_code == 409
    clock.advance(hours=2)
    await live_finding(sql, clock, "f-a-4")  # the same move: joins the open event
    await client.post("/internal/tick")
    a = (await client.get(f"{A}/{a['alert_id']}")).json()
    assert a["status"] == "new" and a["history"][-1]["change"] == "escalated"
    assert "1 more finding" in a["history"][-1]["text"]


async def test_a_monitor_routes_the_alert_to_its_teams(client, env, sql, clock, agent):
    from tests.test_monitors_api import live

    await bank(client, env)
    m = await live(client, **{"about.also_notify": ["Treasury"]})
    await live_finding(sql, clock, "f-a-5", source="monitor", themes='[]', ref=f'{{"monitor_id": "{m["monitor_id"]}"}}')
    await investigate(client)
    by = {a["owner"]: a for a in (await client.get(A)).json()["items"]}
    assert set(by) == {"Retail banking", "Treasury"} and by["Treasury"]["via_monitor"] == m["monitor_id"]


async def test_resolve_reopen_and_the_event_closing(client, env, sql, clock, agent):
    await bank(client, env)
    await live_finding(sql, clock, "f-a-6")
    await investigate(client)
    a = (await client.get(A)).json()["items"][0]
    a = (await client.post(f"{A}/{a['alert_id']}:resolve", json={"note": "No exposure"})).json()
    assert a["status"] == "resolved" and a["resolved_note"] == "No exposure"
    a = (await client.post(f"{A}/{a['alert_id']}:reopen")).json()
    assert a["status"] == "new" and [h["change"] for h in a["history"]] == ["raised", "resolved", "reopened"]
    clock.advance(days=15)
    await client.post("/internal/tick")
    a = (await client.get(f"{A}/{a['alert_id']}")).json()
    assert a["status"] == "resolved" and a["resolved_by"] == "Amiri Agent" and a["event_status"] == "closed"
    assert (await client.get(A, params={"status": "new"})).json()["items"] == []


def checked(verdict: str, alert: str, final: bool = True, pct: float = -21.3) -> dict:
    """A stored validation result, as the validator writes it."""
    return {"verdict": verdict, "final": final, "alert": alert, "alert_basis": "explained" if alert != "none" else None,
            "method": "recent_vs_prior", "metric": "deposit_inflow", "evaluated_as_of": "2026-10-07",
            "validator_version": "2.1.0", "reasons": ["thresholds_met"] if verdict == "confirms" else [],
            "observation": {"change": {"pct": pct}, "baseline": {"median_adjusted": 100.0, "scale": 4.0},
                            "statistics": [{"statistic": "pct_change", "value": pct, "met": verdict == "confirms",
                                            "threshold": {"statistic": "pct_change", "op": "<=", "value": -15}}]},
            "data": {"spec_version": "1.0.0", "catalog_version": "1.0.0/2026-10-07", "vintage_rule": "same_age",
                     "same_age_days": 9}}


async def check_effect(app, sql, clock, a: dict, result: dict, day: str) -> int:
    from psycopg.types.json import Jsonb

    from app.alerts import service as alerts
    h = a["effects"][0]["hypothesis_id"]
    if not await sql("SELECT 1 FROM cases.validation_tasks WHERE task_id = 'vt-al-1'"):
        await sql("""INSERT INTO cases.validation_tasks (task_id, hypothesis_id, event_id, run_id, task, created_at)
                     SELECT 'vt-al-1', h.hypothesis_id, h.event_id, h.run_id, %s, now() FROM cases.hypotheses h
                     WHERE h.hypothesis_id = %s""",
                  (Jsonb({"task_id": "vt-al-1", "metric": "deposit_inflow", "method": "recent_vs_prior", "filter": {}}), h))
    await sql("""INSERT INTO cases.validation_evaluations (task_id, task_hash, as_of, verdict, final, alert, signal,
                   signature, result, computed_at) VALUES ('vt-al-1', 'h', %s, %s, %s, %s, 'none', 's', %s, now())""",
              (day, result["verdict"], result["final"], result["alert"], Jsonb(result)))
    async with app.state.pool.connection() as conn, conn.transaction():
        return await alerts.sync(conn, a["event_id"], clock.now(), checked=True)


async def test_the_data_moves_the_alert_and_reopens_it_after_the_event_closed(client, env, sql, clock, agent, app):
    await bank(client, env)
    await live_finding(sql, clock, "f-a-9")
    await investigate(client)
    a = (await client.get(A)).json()["items"][0]
    assert a["basis"] == "expected" and a["effects"][0]["check"] is None  # nothing checked yet
    # no effect yet: the history says so; the alert stays where it is
    await client.post(f"{A}/{a['alert_id']}:ack", json={"note": "watching"})
    assert await check_effect(app, sql, clock, a, checked("no_effect", "none", final=False, pct=-3.0), "2026-10-05") == 0
    a = (await client.get(f"{A}/{a['alert_id']}")).json()
    assert (a["level"], a["status"], a["history"][-1]["change"]) == ("warning", "acknowledged", "checked")
    assert a["basis"] == "data" and a["checked"] == {"no_effect": 1}
    assert "deposit inflow" in a["history"][-1]["text"].lower() and "no effect" in a["history"][-1]["text"]
    # the event closes; weeks later the data confirms the fall: the alert comes back, confirmed
    await sql("UPDATE cases.events SET status = 'closed' WHERE event_id = %s", (a["event_id"],))
    await sql("UPDATE core.alerts SET status = 'resolved' WHERE alert_id = %s", (a["alert_id"],))
    assert await check_effect(app, sql, clock, a, checked("confirms", "adverse"), "2026-10-07") == 1
    a = (await client.get(f"{A}/{a['alert_id']}")).json()
    assert (a["level"], a["status"], a["history"][-1]["change"]) == ("adverse", "new", "confirmed")
    line = a["effects"][0]["check"]["line"]
    assert line.startswith("Deposit inflow") and "\u221221.3%" in line and line.endswith(": confirms"), line
    assert (await client.get(f"{A}:summary")).json()["by_level"]["adverse"] == 1
    # the event page shows the check with what it rests on
    e = (await client.get(f"/api/v1/events/{a['event_id']}")).json()
    t = e["tasks"][0]
    assert t["check"]["verdict"] == "confirms" and t["check"]["spec_link"] == "/spec#metric-deposit_inflow"
    assert t["check"]["versions"] == {"spec": "1.0.0", "catalog": "1.0.0/2026-10-07", "validator": "2.1.0",
                                      "data": "as known on 6 Oct 2026 (each period at the same age, 9 days)"}
    assert t["check"]["usual"] == "\u22128.0% to +8.0%" and t["check"]["checks"][0].endswith(": met")
