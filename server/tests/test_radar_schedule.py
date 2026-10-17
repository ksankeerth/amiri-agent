"""Radar's schedule: once a day at a local time, Check now limited per local day and never moving the schedule,
and windows that chain run to run. The bank's time zone is Asia/Colombo (UTC+5:30); the test clock starts at
10:30 UTC on Wed 7 Oct, 16:00 in Colombo."""

from datetime import datetime, timedelta
from itertools import pairwise

from tests.test_investigation_api import bank

R = "/api/v1/radar"


def started(ran: list[dict]) -> int:
    return next(s for s in ran if s["step"] == "radar")["started"]


async def daily(client, env):
    env.setenv("RADAR_EVERY_MINUTES", "1440")
    env.setenv("RADAR_RUN_AT", "06:00")
    env.setenv("RADAR_RUN_NOW_PER_DAY", "5")
    await bank(client, env)


async def test_once_a_day_at_the_local_time(client, env, radar_agent, clock):
    await daily(client, env)
    assert started((await client.post("/internal/tick")).json()["ran"]) == 1  # the first one runs at once
    await client.post("/internal/tick")  # collected
    st = (await client.get(f"{R}:status")).json()
    assert st["run_at"] == "06:00" and st["time_zone"] == "Asia/Colombo"
    assert datetime.fromisoformat(st["next_run_at"]) == datetime.fromisoformat("2026-10-08T00:30:00+00:00")  # 06:00 Colombo
    clock.at = datetime.fromisoformat("2026-10-08T00:29:00+00:00")
    assert started((await client.post("/internal/tick")).json()["ran"]) == 0  # 05:59 in Colombo: not yet
    clock.advance(minutes=2)
    assert started((await client.post("/internal/tick")).json()["ran"]) == 1  # 06:01: the day's run
    await client.post("/internal/tick")
    clock.advance(hours=12)
    assert started((await client.post("/internal/tick")).json()["ran"]) == 0  # only once a day
    first, second = radar_agent.requests[0], radar_agent.requests[1]
    assert second["window"]["since"] == first["window"]["until"]  # no gap, no overlap


async def test_check_now_is_limited_per_day_and_never_moves_the_schedule(client, env, radar_agent, clock):
    await daily(client, env)
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    for i in range(5):
        clock.advance(minutes=30)  # spaced like real clicks (a window is at least 15 minutes: GDELT's lag)
        r = await client.post(f"{R}:run")
        assert r.status_code < 300, (i, r.text)
    st = (await client.get(f"{R}:status")).json()
    assert st["run_now"] == {"used": 5, "limit": 5, "left": 0}
    r = await client.post(f"{R}:run")
    assert r.status_code == 429 and r.json()["code"] == "run_now_limit" and "5 checks" in r.json()["detail"]
    # the checks didn't move the day's run: still 06:00 tomorrow
    assert datetime.fromisoformat(st["next_run_at"]) == datetime.fromisoformat("2026-10-08T00:30:00+00:00")
    windows = [q["window"] for q in radar_agent.requests]
    assert all(b["since"] == a["until"] for a, b in pairwise(windows))
    # local midnight in Colombo (18:30 UTC): the checks are back; the day's run waits for 06:00
    clock.at = datetime.fromisoformat("2026-10-07T18:31:00+00:00")
    assert (await client.get(f"{R}:status")).json()["run_now"]["left"] == 5
    assert started((await client.post("/internal/tick")).json()["ran"]) == 0
    clock.advance(hours=6)  # 06:01 Colombo
    assert started((await client.post("/internal/tick")).json()["ran"]) == 1


async def test_without_a_run_time_it_runs_every_period_from_the_last_scheduled_run(client, env, radar_agent, clock):
    await bank(client, env)  # hourly, RADAR_RUN_AT empty (the test defaults)
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    await client.post(f"{R}:run")  # a check in between doesn't push the next scheduled run
    clock.advance(minutes=61)
    assert started((await client.post("/internal/tick")).json()["ran"]) == 1
    st = (await client.get(f"{R}:status")).json()
    assert st["run_at"] is None and st["every_minutes"] == 60
    assert datetime.fromisoformat(st["next_run_at"]) > clock.now() + timedelta(minutes=58)
