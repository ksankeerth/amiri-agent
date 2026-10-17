"""The agent's coverage once an institution's data is connected: with validation on an approved connection it is the
catalog's (only what the institution serves, with its own breakdowns); otherwise it is exactly the Metrics Spec
assumption, as before."""

from app.investigation import coverage as cov
from tests.test_institutions_api import seed

ME = {"X-Amiri-Actor": "admin@x"}
COV = "/api/v1/internal/coverage"


async def connect_sample(client, env, approve: bool = True, on: bool = True):
    await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": []})
    await client.put("/api/v1/data-connection", json={"source": "sample", "sample": "bank"}, headers=ME)
    await client.post("/api/v1/data-connection:check", headers=ME)
    if approve:
        await client.post("/api/v1/data-connection:approve", headers=ME)
    env.setenv("METRICS_VALIDATION", "on")
    if approve and on:
        assert (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()["validation_enabled"]


def metric(c: dict, product: str, key: str) -> dict | None:
    p = next(x for x in c["products"] if x["product_id"] == product)
    return next((m for m in p["metrics"] if m["metric"] == key), None)


async def test_without_validation_coverage_is_the_assumption_as_before(client, env, app):
    await seed(client)
    before = (await client.get(COV, params={"institution_id": "serendib-bank"})).json()
    state = await app.state.institutions.state("serendib-bank")
    assert before == cov.coverage(state) and before["data_source"]["assumed"] is True
    await connect_sample(client, env, approve=True, on=False)  # approved, but the switch is off
    assert (await client.get(COV, params={"institution_id": "serendib-bank"})).json() == before
    lc = metric(before, "trade-finance", "lc_openings")
    assert "segment" in lc["dimensions"]  # the spec's assumption offers every spec breakdown


async def test_with_validation_on_coverage_is_what_the_catalog_serves(client, env):
    await seed(client)
    await connect_sample(client, env)
    c = (await client.get(COV, params={"institution_id": "serendib-bank"})).json()
    src = c["data_source"]
    assert src["assumed"] is False and src["data_source_id"] == "sample-bank" and src["catalog_version"].startswith("1.0.0/")
    lc = metric(c, "trade-finance", "lc_openings")
    assert lc and set(lc["dimensions"]) == {"size_band"} and "sme" in lc["dimensions"]["size_band"]  # no segment
    assert lc["method"] and lc["thresholds"] and lc["history_from"]  # the spec's rules, the catalog's history
    tf = next(p for p in c["products"] if p["product_id"] == "trade-finance")
    assert tf["source_product_id"] == "trade-finance" and len(tf["metrics"]) == 2  # only what the catalog serves
    assert c["groups"] == []  # the sample serves no whole-category metrics
    assert c["unmatched"] == {"profile": [], "source": []}


async def test_an_unreadable_catalog_falls_back_to_the_assumption(client, env, app):
    await seed(client)
    await connect_sample(client, env)

    async def broken():
        raise RuntimeError("down")
    app.state.data_connection.client = broken
    c = (await client.get(COV, params={"institution_id": "serendib-bank"})).json()
    assert c["data_source"]["assumed"] is True and "segment" in metric(c, "trade-finance", "lc_openings")["dimensions"]


def test_narrowed_by_key_alias_and_category_scope():
    m = lambda key, lag=1: {"metric": key, "grain": "weekly", "lag_days": lag, "dimensions": {"segment": ["a"]}}  # noqa: E731
    assumed = {"products": [{"product_id": "p1", "source_product_id": None, "metrics": [m("x"), m("old_y"), m("z")]},
                            {"product_id": "p2", "source_product_id": "cat-p2", "metrics": [m("x")]}],
               "groups": [{"group_id": "group-payments", "category": "payments", "name": "All payments",
                           "metrics": [m("digital", 2)]}]}
    raw = {"spec_version": "1.0.0", "generated_at": "2026-10-16T00:00:00Z",
           "aliases": [{"old": {"key": "old_y"}, "new": {"key": "y"}}],
           "products": [{"product_id": "p1", "metrics": [{"key": "x", "grain": "monthly", "max_lag_days": 5,
                                                         "breakdowns": {"size_band": ["sme"]}, "history_from": "2023-01-02"},
                                                        {"key": "y", "breakdowns": {}}]},
                        {"product_id": "pay", "scope": "category", "category": "payments", "metrics": [{"key": "digital"}]},
                        {"product_id": "extra", "metrics": []}]}
    c = cov.narrowed(assumed, raw, "institution-api", "Your institution's API")
    p1, p2 = c["products"]
    assert [x["metric"] for x in p1["metrics"]] == ["x", "old_y"]  # z isn't served; old_y is served as y
    x = p1["metrics"][0]
    assert x["grain"] == "monthly" and x["lag_days"] == 5 and x["dimensions"] == {"size_band": ["sme"]}
    assert p2["metrics"] == [] and c["unmatched"] == {"profile": ["p2"], "source": ["extra"]}
    assert c["groups"][0]["metrics"][0]["lag_days"] == 2 and c["data_source"]["catalog_version"] == "1.0.0/2026-10-16"
