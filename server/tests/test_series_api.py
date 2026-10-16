"""Market series API: every scenario the page and the schedule can meet."""

import asyncio
from datetime import UTC, datetime

import psycopg

from app import settings
from tests.conftest import START

FX = {"theme": "fx", "direction_up": "weaker", "direction_down": "stronger", "currency": "LKR"}


async def add(client, symbol="USD/LKR", **kw):
    r = await client.post("/api/v1/series", json={"symbol": symbol, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def at(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---------------------------------------------------------------- adding


async def test_add_reads_history_and_shows_closed_bars_only(client, sql):
    s = await add(client, name="USD/LKR", places=["LK"], theme=FX)
    assert s["series_id"] == "usd_lkr" and s["symbol"] == "USD/LKR"
    assert s["state"] == "normal", s["state_reason"]
    # 10:00 is still forming at 10:30, so the latest closed bar is 09:00-10:00
    assert at(s["latest"]["bar_ts"]) == datetime(2026, 10, 7, 9, tzinfo=UTC)
    assert at(s["latest"]["bar_end"]) == datetime(2026, 10, 7, 10, tzinfo=UTC)
    assert [w["days"] for w in s["latest"]["windows"]] == [1, 3, 5]
    assert s["latest"]["typical_daily_move_pct"] > 0
    assert len(s["spark"]) == 14
    assert s["instrument"]["type"] == "Physical Currency"
    assert s["detector"]["stale_after_hours"] == 6
    assert at(s["fetch"]["next_scheduled_at"]) == datetime(2026, 10, 7, 11, tzinfo=UTC)
    assert s["fetch"]["refresh_available_at"] is None and s["last_finding"] is None
    calls = await sql("SELECT trigger, status, credits FROM signals.provider_calls")
    assert calls == [{"trigger": "backfill", "status": "ok", "credits": 1}]
    assert (await sql("SELECT count(*) AS n FROM signals.findings"))[0]["n"] == 0
    r = await client.get("/api/v1/series")
    assert [x["series_id"] for x in r.json()["items"]] == ["usd_lkr"]


async def test_session_market_gets_session_stale_rule(client):
    s = await add(client, "BNO", name="Brent (BNO)")
    assert s["instrument"]["type"] == "ETF" and s["detector"]["stale_after_hours"] == 30


async def test_add_refusals(client, env, fake):
    await add(client)
    r = await client.post("/api/v1/series", json={"symbol": "usd/lkr"})
    assert r.status_code == 409 and r.json()["code"] == "series_exists"
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR", "series_id": "usd_lkr"})
    assert r.status_code == 409 and r.json()["code"] == "series_exists"
    r = await client.post("/api/v1/series", json={"symbol": "NOPE/XYZ"})
    assert r.status_code == 422 and r.json()["code"] == "symbol_not_found"
    assert "not found" in r.json()["provider_message"]
    r = await client.post("/api/v1/series", json={"symbol": "XBR/USD"})
    assert r.status_code == 422 and r.json()["code"] == "symbol_not_on_plan"
    assert "Grow plan" in r.json()["provider_message"]
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR", "places": ["Sri Lanka"]})
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR", "detector": {"z_threshold": 0.2}})
    assert r.status_code == 422
    fake.fail_next.append((429, {"code": 429, "message": "You have run out of API credits for the current minute.", "status": "error"}))
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR"})
    assert r.status_code == 503 and r.json()["code"] == "provider_rate_limited"
    assert r.headers["Retry-After"] == "60"
    fake.fail_next.append((401, {"code": 401, "message": "**apikey** parameter is incorrect", "status": "error"}))
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR"})
    assert r.status_code == 502 and r.json()["code"] == "provider_auth_failed"
    env.setenv("SERIES_MAX", "1")
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR"})
    assert r.status_code == 409 and r.json()["code"] == "series_limit_reached"
    env.setenv("SERIES_MAX", "8")
    env.delenv("TWELVEDATA_API_KEY")
    env.setenv("TWELVEDATA_API_KEY", "")
    r = await client.post("/api/v1/series", json={"symbol": "AED/LKR"})
    assert r.status_code == 503 and r.json()["code"] == "provider_not_configured"
    assert len((await client.get("/api/v1/series")).json()["items"]) == 1


async def test_two_adds_of_the_same_symbol_at_once(client):
    r1, r2 = await asyncio.gather(
        client.post("/api/v1/series", json={"symbol": "AED/LKR"}),
        client.post("/api/v1/series", json={"symbol": "AED/LKR"}),
    )
    assert sorted([r1.status_code, r2.status_code]) == [201, 409]


async def test_warming_up_when_history_is_short(client, fake):
    fake.symbols["AED/LKR"]["bars"] = fake.symbols["AED/LKR"]["bars"][-24 * 10:]
    s = await add(client, "AED/LKR")
    assert s["state"] == "warming_up" and "trading days needed" in s["state_reason"]


# ---------------------------------------------------------------- refresh


async def test_refresh_now_cooldown_and_no_new_data(client, clock, fake):
    await add(client)
    clock.advance(hours=2)  # 12:30: bars 10:00 and 11:00 have closed
    fake.extend("USD/LKR", 2)
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 200, r.text
    f = r.json()["fetch"]
    assert f["status"] == "ok" and f["trigger"] == "manual" and f["bars_new"] == 2
    assert at(f["latest_bar_ts"]) == datetime(2026, 10, 7, 11, tzinfo=UTC)
    s = r.json()["series"]
    assert at(s["fetch"]["refresh_available_at"]) == datetime(2026, 10, 7, 12, 32, tzinfo=UTC)

    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 429 and r.json()["code"] == "refresh_too_soon"
    assert r.headers["Retry-After"] == "120"

    clock.advance(minutes=3)
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 200 and r.json()["fetch"]["status"] == "no_new_data"
    assert r.json()["fetch"]["bars_new"] == 0


async def test_refresh_provider_failure_is_logged_raw(client, clock, fake):
    await add(client)
    clock.advance(hours=1)
    fake.fail_next.append((500, {"code": 500, "message": "Internal server error: upstream FX feed timeout", "status": "error"}))
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 502 and r.json()["code"] == "provider_unavailable"
    assert r.json()["provider_message"] == "Internal server error: upstream FX feed timeout"
    s = (await client.get("/api/v1/series/usd_lkr")).json()
    assert s["fetch"]["last_status"] == "error"
    assert s["fetch"]["last_error"]["message"] == "Internal server error: upstream FX feed timeout"
    assert s["state"] == "normal"  # the data itself is still fresh
    log = (await client.get("/api/v1/series/usd_lkr/fetches")).json()["items"]
    assert [x["trigger"] for x in log] == ["manual", "backfill"]
    assert log[0]["status"] == "error" and log[0]["error_code"] == "unavailable"


async def test_refresh_refusals(client, sql):
    s = await add(client)
    r = await client.post("/api/v1/series/nope:refresh")
    assert r.status_code == 404
    await sql("UPDATE signals.series SET fetch_started_at = %s", (START,))
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 409 and r.json()["code"] == "fetch_in_progress"
    assert (await client.get("/api/v1/series/usd_lkr")).json()["fetch"]["in_progress"] is True
    await sql("UPDATE signals.series SET fetch_started_at = NULL")
    r = await client.patch("/api/v1/series/usd_lkr", json={"enabled": False}, headers={"If-Match": str(s["version"])})
    assert r.status_code == 200 and r.json()["state"] == "paused"
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 409 and r.json()["code"] == "series_paused"


async def test_a_crashed_fetch_stops_blocking_after_the_lease(client, sql, clock, fake):
    await add(client)
    await sql("UPDATE signals.series SET fetch_started_at = %s", (START,))
    clock.advance(minutes=6)
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 200


async def test_minute_and_day_budgets(client, env, clock):
    await add(client)
    env.setenv("TWELVEDATA_CREDITS_PER_MINUTE", "1")
    clock.advance(seconds=30)
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 429 and r.json()["code"] == "provider_minute_budget_reached"
    assert r.headers["Retry-After"] == "30"
    # the refused refresh didn't use up the series' cooldown
    assert (await client.get("/api/v1/series/usd_lkr")).json()["fetch"]["refresh_available_at"] is None
    env.setenv("TWELVEDATA_CREDITS_PER_MINUTE", "8")
    env.setenv("TWELVEDATA_CREDITS_PER_DAY", "1")
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.status_code == 429 and r.json()["code"] == "provider_daily_budget_reached"
    secs_to_midnight = int((datetime(2026, 10, 8, tzinfo=UTC) - clock.now()).total_seconds())
    assert r.headers["Retry-After"] == str(secs_to_midnight)


# ---------------------------------------------------------------- the hourly schedule


async def test_tick_fetches_due_series_within_the_credit_budget(client, env, clock, fake, sql):
    for sym in ("USD/LKR", "AED/LKR", "USD/INR"):
        await add(client, sym)
    r = await client.post("/internal/tick")
    assert r.json()["ran"][0]["due"] == 0  # 10:30: nothing due before 11:00

    env.setenv("TWELVEDATA_CREDITS_PER_MINUTE", "2")
    clock.at = datetime(2026, 10, 7, 11, 0, 20, tzinfo=UTC)
    for sym in ("USD/LKR", "AED/LKR", "USD/INR"):
        fake.extend(sym, 1)
    step = (await client.post("/internal/tick")).json()["ran"][0]
    assert (step["due"], step["claimed"], step["done"], step["waiting_for_credits"]) == (3, 2, 0 + 2, 1)
    rows = await sql("SELECT series_id, next_fetch_at, last_fetch_status FROM signals.series ORDER BY series_id")
    nexts = {x["series_id"]: x["next_fetch_at"] for x in rows}
    assert sorted(nexts.values())[:1] == [datetime(2026, 10, 7, 11, tzinfo=UTC)]  # one still waiting
    assert sum(1 for v in nexts.values() if v == datetime(2026, 10, 7, 12, tzinfo=UTC)) == 2

    clock.at = datetime(2026, 10, 7, 11, 15, 5, tzinfo=UTC)
    step = (await client.post("/internal/tick")).json()["ran"][0]
    assert (step["due"], step["done"]) == (1, 1)
    calls = await sql("SELECT trigger, count(*) AS n FROM signals.provider_calls GROUP BY trigger ORDER BY trigger")
    assert calls == [{"trigger": "backfill", "n": 3}, {"trigger": "scheduled", "n": 3}]


async def test_tick_retries_soon_after_an_outage_and_skips_paused(client, clock, fake, sql):
    await add(client)
    await add(client, "AED/LKR")
    await client.patch("/api/v1/series/aed_lkr", json={"enabled": False})
    clock.at = datetime(2026, 10, 7, 11, 0, 10, tzinfo=UTC)
    fake.fail_next.append((503, {"code": 503, "message": "Service Unavailable", "status": "error"}))
    step = (await client.post("/internal/tick")).json()["ran"][0]
    assert (step["due"], step["failed"]) == (1, 1)
    nxt = (await sql("SELECT next_fetch_at FROM signals.series WHERE series_id = 'usd_lkr'"))[0]["next_fetch_at"]
    assert nxt == datetime(2026, 10, 7, 11, 15, 10, tzinfo=UTC)
    # resuming makes a paused series due at once
    r = await client.patch("/api/v1/series/aed_lkr", json={"enabled": True})
    assert at(r.json()["fetch"]["next_scheduled_at"]) == clock.now()


async def test_overlapping_ticks(client, app):
    await add(client)
    url = settings.raw("TEST_DATABASE_URL")
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as other:
        await other.execute("SELECT pg_advisory_lock(7310000)")
        r = await client.post("/internal/tick")
        assert r.json()["skipped"] == "another tick is running"
        await other.execute("SELECT pg_advisory_unlock(7310000)")
    assert "ran" in (await client.post("/internal/tick")).json()


async def test_tick_without_a_key(client, env):
    await add(client)
    env.setenv("TWELVEDATA_API_KEY", "")
    env.setenv("SERIES_FETCH_EVERY_MINUTES", "60")
    r = await client.post("/internal/tick")
    assert r.status_code == 200


# ---------------------------------------------------------------- detection


async def test_a_big_move_becomes_one_finding(client, clock, fake, sql):
    await add(client, theme=FX, places=["LK"])
    clock.at = datetime(2026, 10, 7, 12, 0, 30, tzinfo=UTC)
    fake.extend("USD/LKR", 2, step_pct=3.0)  # bar 11:00-12:00 closes 3% up
    step = (await client.post("/internal/tick")).json()["ran"][0]
    assert step["done"] == 1
    s = (await client.get("/api/v1/series/usd_lkr")).json()
    assert s["state"] == "moved", s["state_reason"]
    f = (await client.get("/api/v1/series/usd_lkr/findings")).json()["items"]
    assert len(f) == 1
    f = f[0]
    assert f["finding_id"] == "f-ts-usd_lkr-2026100711" and f["kind"] == "signal_move"
    assert f["title"].startswith("USD/LKR up ") and "typical" in f["title"]
    assert f["themes"] == [{"theme": "fx", "direction": "weaker", "currency": "LKR"}] and f["world"] == "live"
    assert f["places"] == ["LK"] and f["score"] >= 50
    sig = f["evidence"]["signals"][0]
    assert sig["z"] >= 3 and sig["end_at"].startswith("2026-10-07T12:00") and sig["direction"] == "up"
    assert sig["description"].startswith("USD/LKR rose from ") and "typical move" in sig["description"]
    assert s["last_finding"]["finding_id"] == f["finding_id"]

    # another jump within 24 h: quiet
    clock.at = datetime(2026, 10, 7, 13, 0, 30, tzinfo=UTC)
    fake.bump("USD/LKR", datetime(2026, 10, 7, 12, tzinfo=UTC), 3.0)
    assert (await client.post("/internal/tick")).json()["ran"][0]["done"] == 1
    assert (await sql("SELECT count(*) AS n FROM signals.findings"))[0]["n"] == 1

    # after the cooldown it can fire again
    clock.at = datetime(2026, 10, 8, 13, 0, 30, tzinfo=UTC)
    fake.extend("USD/LKR", 26)
    fake.bump("USD/LKR", datetime(2026, 10, 8, 12, tzinfo=UTC), -4.0)
    r = await client.post("/api/v1/series/usd_lkr:refresh")
    assert r.json()["fetch"]["finding_id"] == "f-ts-usd_lkr-2026100812"
    titles = [x["title"] for x in (await client.get("/api/v1/series/usd_lkr/findings")).json()["items"]]
    assert len(titles) == 2 and titles[0].startswith("USD/LKR down ")


async def test_no_finding_from_history_read_when_adding(client, fake, sql):
    bars = fake.symbols["USD/INR"]["bars"]
    t, p = bars[-2]
    bars[-2] = (t, p * 1.05)  # the latest closed bar is a 5% jump
    s = await add(client, "USD/INR")
    assert s["latest"]["max_z"] >= 3
    assert (await sql("SELECT count(*) AS n FROM signals.findings"))[0]["n"] == 0


async def test_theme_is_set_by_code_from_the_symbol(client, env):
    # no institution yet: an FX pair reads as the move of its non-major side
    assert (await add(client, "USD/LKR"))["theme"] == {**FX, "item": None}
    gold = await add(client, "XAU/USD")
    assert gold["theme"] == {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "gold",
                             "currency": None}
    assert (await add(client, "USD/INR"))["theme"] == {**FX, "currency": "INR", "item": None}
    assert (await add(client, "AED/LKR", theme=None))["theme"] is None  # asked for none


async def test_default_theme_rules():
    from app.series.service import default_theme
    assert default_theme("USD/LKR", None)["currency"] == "LKR"
    assert default_theme("LKR/USD", "LKR") == {"theme": "fx", "direction_up": "stronger",
                                               "direction_down": "weaker", "currency": "LKR"}
    assert default_theme("AED/LKR", "LKR")["direction_up"] == "weaker"  # the home side, not majors
    assert default_theme("PHP/JPY", None)["currency"] == "PHP"  # quoted in a major: up = PHP stronger
    assert default_theme("PHP/JPY", None)["direction_up"] == "stronger"
    assert default_theme("EUR/USD", None) is None and default_theme("SPX", None) is None


async def test_theme_must_be_in_the_vocabulary(client):
    old = {"theme": "fx", "direction_up": "depreciation", "direction_down": "appreciation"}
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "theme": old})
    assert r.status_code == 422 and "weaker" in r.text
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "theme": {**FX, "currency": None}})
    assert r.status_code == 422 and "needs the currency" in r.text
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "theme": {**FX, "item": "gold"}})
    assert r.status_code == 422 and "no item" in r.text
    themes = {t["theme"]: t for t in (await client.get("/api/v1/reference/themes")).json()["items"]}
    assert [d["direction"] for d in themes["fx"]["directions"]] == ["weaker", "stronger"]
    assert themes["fx"]["currency"] is True and themes["rates"]["currency"] is False
    assert themes["commodities"]["items"] == ["gold", "crops", "oil"] and themes["sector"]["sector"] is True


async def test_simulated_move_makes_a_sandbox_finding_only(client, sql):
    s = await add(client, theme=FX, places=["LK"])
    n_bars = (await sql("SELECT count(*) AS n FROM signals.price_bars WHERE series_id = 'usd_lkr'"))[0]["n"]
    r = await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": 0.01})
    assert r.status_code == 200 and r.json()["fired"] is False and "Try a bigger move" in r.json()["note"]
    r = await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": -6})
    out = r.json()
    assert out["fired"] is True, out["note"]
    f = out["finding"]
    assert f["world"] == "sandbox" and f["finding_id"].startswith("f-sim-usd_lkr-")
    assert f["title"].startswith("Simulated: USD/LKR down ")
    assert f["themes"] == [{"theme": "fx", "direction": "stronger", "currency": "LKR"}]
    assert f["evidence"]["signals"][0]["direction"] == "down"
    after = (await client.get("/api/v1/series/usd_lkr")).json()
    assert after["state"] == s["state"] and after["last_finding"] is None and after["latest"] == s["latest"]
    assert (await sql("SELECT count(*) AS n FROM signals.price_bars WHERE series_id = 'usd_lkr'"))[0]["n"] == n_bars
    listed = (await client.get("/api/v1/series/usd_lkr/findings")).json()["items"]
    assert [x["world"] for x in listed] == ["sandbox"]
    assert (await client.post("/api/v1/series/usd_lkr:simulate", json={"change_pct": 0})).status_code == 422
    assert (await client.post("/api/v1/series/nope:simulate", json={"change_pct": 5})).status_code == 404


# ---------------------------------------------------------------- stale


async def test_stale_counts_weekday_hours_only(client, clock):
    await add(client)
    clock.at = datetime(2026, 10, 7, 15, 30, tzinfo=UTC)  # 5.5 h after the last bar ended
    assert (await client.get("/api/v1/series/usd_lkr")).json()["state"] == "normal"
    clock.at = datetime(2026, 10, 7, 17, 0, tzinfo=UTC)
    s = (await client.get("/api/v1/series/usd_lkr")).json()
    assert s["state"] == "stale" and "stale after 6" in s["state_reason"]


async def test_weekend_is_not_stale(client, fake, clock):
    # data up to Friday 21:00; it's Sunday 22:00
    fake.symbols["USD/LKR"]["bars"] = [b for b in fake.symbols["USD/LKR"]["bars"]
                                       if b[0] <= datetime(2026, 10, 2, 20, tzinfo=UTC)]
    clock.at = datetime(2026, 10, 4, 22, 0, tzinfo=UTC)
    s = await add(client)
    assert s["state"] != "stale", s["state_reason"]


# ---------------------------------------------------------------- edit and delete


async def test_patch_versions_and_validation(client):
    s = await add(client)
    r = await client.patch("/api/v1/series/usd_lkr", json={"name": "Rupee per dollar"}, headers={"If-Match": "99"})
    assert r.status_code == 409 and r.json()["current_version"] == s["version"]
    r = await client.patch("/api/v1/series/usd_lkr", json={"detector": {"z_threshold": 0.5}})
    assert r.status_code == 422
    r = await client.patch("/api/v1/series/usd_lkr", json={"detector": {"windows_days": [5, 1, 1]}, "theme": FX,
                                                           "places": ["LK", "AE"]},
                           headers={"If-Match": f'"{s["version"]}"'})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["version"] == s["version"] + 1 and r.headers["ETag"] == f'"{v["version"]}"'
    assert v["detector"]["windows_days"] == [1, 5] and v["detector"]["z_threshold"] == 3
    assert [w["days"] for w in v["latest"]["windows"]] == [1, 5]
    r = await client.patch("/api/v1/series/usd_lkr", json={"theme": None})
    assert r.json()["theme"] is None and r.json()["places"] == ["LK", "AE"]
    r = await client.patch("/api/v1/series/usd_lkr", json={"symbol": "EUR/USD"})
    assert r.status_code == 422


async def test_delete_keeps_findings_and_frees_the_slot(client, clock, fake, sql, env):
    env.setenv("SERIES_MAX", "1")
    await add(client)
    clock.at = datetime(2026, 10, 7, 12, 0, 30, tzinfo=UTC)
    fake.extend("USD/LKR", 2, step_pct=3.0)
    await client.post("/internal/tick")
    r = await client.delete("/api/v1/series/usd_lkr")
    assert r.status_code == 204
    assert (await client.get("/api/v1/series/usd_lkr")).status_code == 404
    assert (await client.delete("/api/v1/series/usd_lkr")).status_code == 404
    assert (await sql("SELECT count(*) AS n FROM signals.price_bars"))[0]["n"] == 0
    assert (await sql("SELECT count(*) AS n FROM signals.findings"))[0]["n"] == 1
    assert (await sql("SELECT count(*) AS n FROM signals.provider_calls"))[0]["n"] == 2
    clock.advance(minutes=2)
    await add(client, "AED/LKR")


# ---------------------------------------------------------------- chart data


async def test_bars_hourly_and_daily(client):
    await add(client)
    r = await client.get("/api/v1/series/usd_lkr/bars", params={
        "from": "2026-10-06T00:00:00Z", "until": "2026-10-08T00:00:00Z"})
    items = r.json()["items"]
    assert r.status_code == 200 and len(items) == 24 + 10  # 6 Oct, and 7 Oct up to 09:00
    assert r.json()["from"].startswith("2026-10-06")
    r = await client.get("/api/v1/series/usd_lkr/bars", params={
        "from": "2026-09-28T00:00:00Z", "until": "2026-10-08T00:00:00Z", "interval": "1d"})
    days = r.json()["items"]
    assert [d["bars"] for d in days] == [24, 24, 24, 24, 24, 24, 24, 10]  # Mon-Fri, Mon-Wed
    assert days[-1]["close"] == (await client.get("/api/v1/series/usd_lkr")).json()["latest"]["close"]


async def test_bars_refusals(client):
    await add(client)
    u = "/api/v1/series/usd_lkr/bars"
    r = await client.get(u, params={"from": "2026-10-06T00:00:00Z", "until": "2026-10-06T00:00:00Z"})
    assert r.status_code == 422 and r.json()["code"] == "invalid_window"
    r = await client.get(u, params={"from": "2026-10-06T00:00:00", "until": "2026-10-07T00:00:00"})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    r = await client.get(u, params={"from": "2025-01-01T00:00:00Z", "until": "2026-10-07T00:00:00Z"})
    assert r.status_code == 400 and r.json()["code"] == "range_too_large"
    r = await client.get(u, params={"from": "last 7 days", "until": "2026-10-07T00:00:00Z"})
    assert r.status_code == 422
    r = await client.get("/api/v1/series/nope/bars", params={"from": "2026-10-06T00:00:00Z", "until": "2026-10-07T00:00:00Z"})
    assert r.status_code == 404


# ---------------------------------------------------------------- status, lookup, health


async def test_credits_count_each_call_once(client, sql):
    # the api-credits-used header is the minute's running total (1, 2, 3); each call costs 1
    for sym in ("USD/LKR", "USD/INR", "XAU/USD"):
        await add(client, sym)
    calls = await sql("SELECT credits FROM signals.provider_calls ORDER BY at")
    assert [c["credits"] for c in calls] == [1, 1, 1]
    st = (await client.get("/api/v1/series:status")).json()
    assert st["provider"]["credits"]["used_last_minute"] == 3 and st["provider"]["credits"]["used_today"] == 3


async def test_status_and_lookup(client, fake):
    await add(client)
    st = (await client.get("/api/v1/series:status")).json()
    assert st["prototype"] is True and any("not live" in n for n in st["notes"])
    assert st["limits"] == {"max_series": 8, "used": 1, "available": 7}
    assert st["provider"]["configured"] is True
    assert st["provider"]["credits"]["used_last_minute"] == 1 and st["provider"]["credits"]["used_today"] == 1
    assert st["schedule"]["next_run_at"].startswith("2026-10-07T11:00")
    r = await client.get("/api/v1/series:lookup", params={"q": "LKR"})
    items = r.json()["items"]
    assert {i["symbol"] for i in items} == {"USD/LKR", "AED/LKR"}
    assert {i["symbol"]: i["watched"] for i in items} == {"USD/LKR": True, "AED/LKR": False}
    n = len(fake.calls)
    r = await client.get("/api/v1/series:lookup", params={"q": "lkr"})
    assert r.json()["cached"] is True and len(fake.calls) == n


async def test_health(client, env):
    d = (await client.get("/health/details")).json()
    # no profile for INSTITUTION_ID (bank-a) yet: findings can't be investigated
    assert d["status"] == "degraded" and d["checks"]["institution"] == {"status": "missing", "institution_id": "bank-a"}
    assert d["checks"]["database"]["schema_version"] == "0021_studio_custom"
    assert d["checks"]["investigation"]["status"] == "ok" and d["checks"]["investigation"]["validation"] is False
    r = await client.post("/api/v1/institutions", json={
        "institution_id": "bank-a", "name": "Bank A", "institution_type": "bank", "subtype": "commercial",
        "home_country": "LK", "base_currency": "LKR", "time_zone": "Asia/Colombo"})
    assert r.status_code == 201, r.text
    d = (await client.get("/health/details")).json()
    assert d["status"] == "ok" and d["checks"]["institution"]["status"] == "ok"
    env.setenv("TWELVEDATA_API_KEY", "")
    d = (await client.get("/health/details")).json()
    assert d["status"] == "degraded" and d["checks"]["twelvedata"]["status"] == "not_configured"
    assert (await client.get("/health")).json() == {"status": "ok"}
