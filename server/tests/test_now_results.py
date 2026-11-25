"""A button's result arrives when the page asks for it, not on the next tick.

The run rows are the state: a running row is waiting for its agent, and reading it (GET a run, GET a finding)
asks the agent at once. Findings a person asked for (a monitor's or Radar's Check now, Investigate anyway) are
investigated at once instead of waiting for the batch. What the tick starts keeps its batch wait, as before."""

from tests.test_investigation_api import bank, sandbox_move
from tests.test_monitors_api import H, live, page
from tests.test_radar_api import R, story

I = "/api/v1/investigations"


async def test_investigate_now_is_collected_when_the_page_reads_the_run(client, env, agent):
    await bank(client, env)
    f = await sandbox_move(client)
    agent.pending = True
    run = (await client.post(I, json={})).json()["items"][0]
    assert run["status"] == "running"
    assert (await client.get(f"{I}/{run['run_id']}")).json()["status"] == "running"  # the agent is still at it
    agent.pending = False
    got = (await client.get(f"{I}/{run['run_id']}")).json()  # no tick in between
    assert got["status"] == "completed" and got["report"]
    assert (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()["status"] == "linked"


async def test_a_finding_being_investigated_is_collected_when_the_page_reads_it(client, env, agent):
    await bank(client, env)
    f = await sandbox_move(client)
    agent.pending = True
    await client.post(I, json={})
    assert (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()["status"] == "grouped"
    agent.pending = False
    got = (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()
    assert got["status"] == "linked" and got["outcome"]["event_id"]
    assert (await client.get("/api/v1/events", params={"world": "sandbox"})).json()["items"]


async def test_a_monitors_check_now_goes_straight_to_the_investigation(client, env, clock, monitor_agent, agent):
    await bank(client, env)
    m = await live(client)
    monitor_agent.pages = [page(clock, 30, 1)]
    run = (await client.post(f"/api/v1/monitors/{m['monitor_id']}:run", headers=H)).json()
    assert run["trigger"] == "now" and run["status"] == "completed" and run["findings"] == 1
    f = (await client.get(f"/api/v1/monitors/{m['monitor_id']}/findings")).json()["items"][0]
    assert [x["finding_id"] for x in agent.requests[0]["findings"]] == [f["finding_id"]]  # no batch wait
    got = (await client.get(f"/api/v1/findings/{f['finding_id']}")).json()  # the page's next poll
    assert got["status"] == "linked" and got["outcome"]["event_id"]


async def test_a_monitor_check_on_the_tick_still_waits_for_the_batch(client, env, clock, monitor_agent, agent):
    await bank(client, env)
    await live(client)
    monitor_agent.pages = [page(clock, 30, 1)]
    await client.post("/internal/tick")  # started
    await client.post("/internal/tick")  # collected: its finding joins the next batch, after the wait
    assert agent.requests == []


async def test_radars_check_now_investigates_what_it_sent_at_once(client, env, radar_agent, agent):
    await bank(client, env)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True),
                           story("tea-auction", "Tea auction prices dip", False, places=["LK"], themes=[])]]
    run = (await client.post(f"{R}:run")).json()
    run = (await client.get(f"{R}/runs/{run['run_id']}")).json()  # the page polls the run
    assert run["status"] == "completed" and run["sent"] == 1
    by = {s["fingerprint"]: s for s in (await client.get(f"{R}/stories")).json()["items"]}
    sent = by["ksa-visas"]["finding_id"]
    assert [x["finding_id"] for x in agent.requests[0]["findings"]] == [sent]
    assert (await client.get(f"/api/v1/findings/{sent}")).json()["status"] == "linked"

    # Investigate anyway: the story the agent held back is investigated at once too
    held = by["tea-auction"]["story_id"]
    fid = (await client.post(f"{R}/stories/{held}:investigate")).json()["finding_id"]
    assert [x["finding_id"] for x in agent.requests[1]["findings"]] == [fid]


async def test_radar_on_the_tick_still_waits_for_the_batch(client, env, radar_agent, agent):
    await bank(client, env)
    radar_agent.script = [[story("ksa-visas", "Saudi Arabia tightens visa renewals", True)]]
    await client.post("/internal/tick")
    await client.post("/internal/tick")
    assert agent.requests == []
