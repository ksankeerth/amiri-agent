"""The prototype reset: everything the institution made goes; market prices and reference data stay."""

from tests.test_alerts_api import investigate, live_finding
from tests.test_investigation_api import bank

R = "/api/v1/prototype:reset"


async def test_reset_wipes_the_institution_and_keeps_prices(client, env, sql, clock, agent):
    await bank(client, env)
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "places": ["LK"]})
    assert r.status_code == 201, r.text
    await live_finding(sql, clock, "f-r-1")
    await investigate(client)
    assert (await client.get("/api/v1/alerts")).json()["items"]
    assert (await client.post(R, json={"confirm": "yes"})).status_code == 422  # must type RESET
    r = await client.post(R, json={"confirm": "RESET"})
    assert r.status_code == 200 and r.json()["then"] == "empty"
    assert (await client.get("/api/v1/alerts")).json()["items"] == []
    assert (await client.get("/api/v1/events")).json()["items"] == []
    assert (await client.get("/api/v1/installation")).json()["profile"] is False
    assert len((await client.get("/api/v1/series")).json()["items"]) == 1  # kept
    assert await sql("SELECT count(*) AS n FROM signals.price_bars") != [{"n": 0}]


async def test_reset_to_the_demo_bank(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    r = await client.post(R, json={"confirm": "RESET", "then": "demo"})
    assert r.status_code == 200, r.text
    i = (await client.get("/api/v1/installation")).json()
    assert i["profile"] is True and i["status"] == "active"


async def test_reset_can_be_switched_off(client, env):
    env.setenv("PROTOTYPE_RESET", "false")
    assert (await client.post(R, json={"confirm": "RESET"})).status_code == 403
