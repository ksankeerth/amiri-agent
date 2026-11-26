"""The prototype reset: the only way back is a new institution JSON file. Everything the institution made goes;
market prices and reference data stay. A file that doesn't pass changes nothing."""

import copy

from app import demo
from app.tick import TICK_LOCK
from tests.test_alerts_api import investigate, live_finding
from tests.test_investigation_api import bank

R = "/api/v1/prototype:reset"


def profile(kind="bank"):
    doc = demo.profile(kind)  # the file also carries an "_about" note, which the import format doesn't take
    return {"institution": doc["institution"], "sections": doc["sections"]}


def body(kind="bank", **over):
    return {"confirm": "RESET", "profile": {**profile(kind), **over}}


async def test_reset_wipes_the_institution_and_keeps_prices(client, env, sql, clock, agent):
    await bank(client, env)
    r = await client.post("/api/v1/series", json={"symbol": "USD/LKR", "places": ["LK"]})
    assert r.status_code == 201, r.text
    await live_finding(sql, clock, "f-r-1")
    await investigate(client)
    assert (await client.get("/api/v1/alerts")).json()["items"]
    assert (await client.post(R, json={**body(), "confirm": "yes"})).status_code == 422  # must type RESET
    r = await client.post(R, json=body("insurer"))  # a different institution than the one that was there
    assert r.status_code == 200, r.text
    assert r.json() == {"reset": True, "institution_id": "serendib-bank", "name": "Samudra Raya General Insurance",
                        "kept": ["market series and prices", "reference data"]}
    assert (await client.get("/api/v1/alerts")).json()["items"] == []
    assert (await client.get("/api/v1/events")).json()["items"] == []
    i = (await client.get("/api/v1/installation")).json()
    assert i["profile"] is True and i["status"] == "active"
    p = (await client.get("/api/v1/institutions/serendib-bank/profile")).json()
    assert p["institution"]["name"] == "Samudra Raya General Insurance" and p["institution"]["status"] == "active"
    want = {k: len(v) for k, v in profile("insurer")["sections"].items() if v}
    assert {k: len(v) for k, v in p["sections"].items() if v} == want  # every section of the file
    assert len((await client.get("/api/v1/series")).json()["items"]) == 1  # kept
    assert await sql("SELECT count(*) AS n FROM signals.price_bars") != [{"n": 0}]
    log = await sql("SELECT DISTINCT source FROM core.profile_changes ORDER BY source")
    assert log == [{"source": "import"}, {"source": "system"}]  # the file's items, then going live; nothing of the old one


async def test_reset_goes_back_and_forth_between_two_files(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    for kind, name, home in (("insurer", "Samudra Raya General Insurance", "ID"), ("bank", "Serendib Commercial Bank", "LK")):
        r = await client.post(R, json=body(kind))
        assert r.status_code == 200, r.text
        p = (await client.get("/api/v1/institutions/serendib-bank/profile")).json()
        assert p["institution"]["name"] == name and p["institution"]["status"] == "active"
        assert [f["code"] for f in p["sections"]["footprint"]] == [home]


async def test_the_files_own_institution_id_is_ignored(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    doc = copy.deepcopy(profile())
    doc["institution"]["institution_id"] = "something-else"
    r = await client.post(R, json={"confirm": "RESET", "profile": doc})
    assert r.status_code == 200 and r.json()["institution_id"] == "serendib-bank"


async def test_a_file_that_does_not_pass_wipes_nothing(client, env, sql, clock, agent):
    await bank(client, env)
    await live_finding(sql, clock, "f-r-2")
    await investigate(client)
    alerts = (await client.get("/api/v1/alerts")).json()["items"]
    assert alerts
    bad_type = copy.deepcopy(profile())
    bad_type["institution"]["institution_type"] = "toy-shop"  # not a type
    unknown = copy.deepcopy(profile())
    unknown["sections"]["spaceships"] = [{"name": "x"}]
    broken_item = copy.deepcopy(profile())
    broken_item["sections"]["products"][0]["segments"] = ["no-such-segment"]  # a link to nowhere
    broken_item["sections"]["segments"][0]["name"] = ""
    no_products = copy.deepcopy(profile())
    no_products["sections"]["products"] = []  # valid, but could not go live
    for label, doc in (("type", bad_type), ("section", unknown), ("item", broken_item), ("incomplete", no_products)):
        r = await client.post(R, json={"confirm": "RESET", "profile": doc})
        assert r.status_code == 422, (label, r.status_code, r.text[:300])
        assert r.json()["detail"]
    assert (await client.post(R, json={"confirm": "RESET", "profile": {"institution": {}, "sections": {}}})).status_code == 422
    # nothing was wiped, and the failed tries left nothing behind
    assert (await client.get("/api/v1/alerts")).json()["items"] == alerts
    p = (await client.get("/api/v1/institutions/serendib-bank/profile")).json()
    assert p["institution"]["name"] == "Serendib Commercial Bank" and p["institution"]["status"] == "setup"  # as the bank() fixture left it
    assert [x["institution_id"] for x in await sql("SELECT institution_id FROM core.institutions")] == ["serendib-bank"]


async def test_the_old_then_choice_is_refused(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    for old in ({"confirm": "RESET"}, {"confirm": "RESET", "then": "empty"}, {"confirm": "RESET", "then": "demo-bank"},
                {**body(), "then": "demo"}):
        r = await client.post(R, json=old)
        assert r.status_code == 422, old
        assert "JSON profile" in r.text
    assert (await client.get("/api/v1/installation")).json()["profile"] is False  # nothing was loaded


async def test_reset_is_refused_while_background_work_runs(client, env, app):
    await bank(client, env)
    async with app.state.pool.connection() as other:
        await other.execute("SELECT pg_advisory_lock(%s)", (TICK_LOCK,))
        try:
            r = await client.post(R, json=body())
            assert r.status_code == 409 and r.json()["code"] == "busy"
        finally:
            await other.execute("SELECT pg_advisory_unlock(%s)", (TICK_LOCK,))
    assert (await client.get("/api/v1/installation")).json()["profile"] is True  # untouched
    assert (await client.post(R, json=body())).status_code == 200


async def test_reset_is_refused_under_the_demo_lock(client, env):
    await bank(client, env)
    env.setenv("DEMO_LOCK", "true")
    r = await client.post(R, json=body())
    assert r.status_code == 403 and r.json()["code"] == "demo_locked"


async def test_reset_also_clears_the_data_connection_and_the_imported_data(client, env, sql):
    from tests.test_coverage_connected import ME, connect_sample
    from tests.test_institutions_api import seed

    await seed(client)
    await connect_sample(client, env)  # the example file: imported, checked, approved, validation on
    assert (await client.get("/api/v1/data-connection", headers=ME)).json()["validation_enabled"] is True
    assert (await client.post(R, json=body())).status_code == 200
    c = (await client.get("/api/v1/data-connection", headers=ME)).json()
    assert c["configured"] is False and c["validation_enabled"] is False and c["latest_check"] is None
    for t in ("ops.data_connection", "ops.data_checks", "ops.imported_data", "ops.imported_series"):
        assert (await sql(f"SELECT count(*) AS n FROM {t}"))[0]["n"] == 0, t


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
    r = await client.post(R, json=body())
    assert r.status_code == 403 and r.json()["code"] == "reset_off"
