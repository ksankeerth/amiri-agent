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


async def test_reset_also_clears_the_data_connection_and_the_samples(client, env, sql):
    from tests.test_coverage_connected import ME, connect_sample
    from tests.test_institutions_api import seed

    await seed(client)
    await connect_sample(client, env)  # the sample bank: connected, checked, approved, validation on
    await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": [{"id": "floods"}]})
    assert (await client.get("/api/v1/data-connection", headers=ME)).json()["validation_enabled"] is True
    assert (await client.post(R, json={"confirm": "RESET"})).status_code == 200
    c = (await client.get("/api/v1/data-connection", headers=ME)).json()
    assert c["configured"] is False and c["validation_enabled"] is False and c["latest_check"] is None
    bank = (await client.get("/api/v1/mock-institutions")).json()["items"][0]
    assert bank["enabled"] is False and bank["conditions"] == []
    for t in ("ops.data_connection", "ops.data_checks", "ops.mock_institutions"):
        assert (await sql(f"SELECT count(*) AS n FROM {t}"))[0]["n"] == 0, t


async def test_reset_to_the_demo_bank(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    r = await client.post(R, json={"confirm": "RESET", "then": "demo"})
    assert r.status_code == 200, r.text
    i = (await client.get("/api/v1/installation")).json()
    assert i["profile"] is True and i["status"] == "active"


async def test_reset_switches_between_the_two_demos(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    for then, name, home in (("demo-insurer", "Samudra Raya General Insurance", "ID"), ("demo-bank", "Serendib Commercial Bank", "LK")):
        r = await client.post(R, json={"confirm": "RESET", "then": then})
        assert r.status_code == 200, r.text
        p = (await client.get("/api/v1/institutions/serendib-bank/profile")).json()
        assert p["institution"]["name"] == name and p["institution"]["status"] == "active"
        assert [f["code"] for f in p["sections"]["footprint"]] == [home]  # home only: no branches abroad


async def test_the_empty_first_screen_loads_a_demo_once(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    D = "/api/v1/prototype:demo"
    assert (await client.post(D, json={"kind": "shop"})).status_code == 422
    r = await client.post(D, json={"kind": "insurer"})
    assert r.status_code == 200 and r.json() == {"institution_id": "serendib-bank", "name": "Samudra Raya General Insurance",
                                                 "kind": "insurer"}
    r = await client.post(D, json={"kind": "bank"})
    assert r.status_code == 409 and r.json()["code"] == "not_empty"  # never over an institution


async def test_both_demo_profiles_download(client):
    for kind, name in (("bank", "serendib-commercial-bank"), ("insurer", "samudra-raya-general-insurance")):
        r = await client.get("/api/v1/reference/demo-profile", params={"kind": kind})
        assert r.status_code == 200 and f"{name}.json" in r.headers["content-disposition"]
        assert r.json()["institution"]["institution_type"] == kind


async def test_reset_can_be_switched_off(client, env):
    env.setenv("PROTOTYPE_RESET", "false")
    assert (await client.post(R, json={"confirm": "RESET"})).status_code == 403
