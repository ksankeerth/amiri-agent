"""The synthetic Dallas bank (demo/us-texas-bank): it imports as it is, its profile reads in Texas places, and the
sample bank (Metrics Spec reference API) serves the figures its US rules check.

What the sample bank serves for it today: facility_utilization on the credit lines (and by segment on the lines to
private-credit funds) and withdrawals on business deposits by segment domestic_business. It serves no sector
breakdown (for any institution) and no category-level metric, so large_depositor_net_flow is not there."""

import json

from app import reference, settings
from tests.test_mock_institutions import TODAY, api, enable, window

FOLDER = settings.PROJECT.parent / "demo" / "us-texas-bank"
DOC = json.loads((FOLDER / "profile.json").read_text())
B = "/api/v1/institutions"


async def load(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    env.setenv("INSTITUTION_ID", "us-texas-bank")
    r = await client.post(f"{B}:import", json=DOC)  # the file as it is
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_dallas_bank_imports_and_reads_in_texas_places(client, env):
    i = await load(client, env)
    assert i["name"] == "TODO-NAME Bank" and i["home_country"] == "US" and i["base_currency"] == "USD"
    assert i["time_zone"] == "America/Chicago" and i["subtype"] == "commercial" and i["size_band"] == "mid"
    assert i["counts"] == {"footprint": 2, "watch-places": 3, "segments": 5, "products": 6, "flows": 0, "regulators": 7,
                           "rivals": 0, "counterparties": 2, "risk-exposures": 0}
    prof = (await client.get(f"{B}/us-texas-bank/profile")).json()
    assert prof["readiness"]["ready"] is True
    assert prof["place_names"]["US-TX"] == "Texas" and prof["place_names"]["city:dallas"] == "Dallas"
    ctx = (await client.get(f"{B}/us-texas-bank/context")).json()
    scope = ctx["radar_scope"]
    assert {"US-TX", "city:dallas", "city:houston", "city:midland"} <= set(scope["places"])
    assert {"ERCOT", "Federal Reserve"} <= set(scope["actors"])
    assert {r["short"] for r in ctx["regulators"]} >= {"Fed", "FDIC", "CFPB", "Texas DOB", "OFAC"}
    segs = {s["id"]: {m["dimension"]: m["value"] for m in s["spec_mapping"]} for s in ctx["segments"]}
    assert segs["dc-contractors"] == {"sector": "F", "segment": "domestic_business"}
    assert segs["oil-gas"]["sector"] == "B" and segs["manufacturers"]["sector"] == "C" and segs["tech-firms"]["sector"] == "J"
    assert segs["private-credit"] == {"segment": "non_bank_financial"}
    kinds = {p["id"]: (p["category"], p["product_type"]) for p in ctx["products"]}
    assert kinds["credit-lines"] == ("business_loan", "working_capital") and kinds["business-deposits"][0] == "savings"
    assert kinds["business-cards"][0] == "cards" and kinds["nbfi-lines"] == ("business_loan", "working_capital")


async def series(client, product_id: str, metric: dict, **filters) -> list[dict]:
    start, until = window(metric["grain"], TODAY)
    r = await client.get(f"{api()}/series", params={"product_id": product_id, "metric": metric["key"], "start": start.isoformat(),
                                                    "until": until.isoformat(), **{f"filter[{k}]": v for k, v in filters.items()}})
    assert r.status_code == 200, r.text
    return [x for x in r.json()["rows"] if x["value"] is not None]


async def test_the_sample_bank_serves_the_figures_the_us_rules_check(client, env):
    await load(client, env)
    on = await enable(client)
    assert on["shaped_by"] == {"name": "TODO-NAME Bank", "source": "installation"}
    cat = (await client.get(f"{api()}/catalog")).json()
    assert cat["profile"]["country"] == "US" and cat["profile"]["base_currency"] == "USD"
    metrics = {p["product_id"]: {m["key"]: m for m in p["metrics"]} for p in cat["products"]}

    fu = metrics["credit-lines"]["facility_utilization"]  # business_loan.utilization.sector
    assert await series(client, "credit-lines", fu)
    nbfi = metrics["nbfi-lines"]["facility_utilization"]  # business_loan.utilization.nbfi_stress
    assert "non_bank_financial" in nbfi["breakdowns"]["segment"]
    assert await series(client, "nbfi-lines", nbfi, segment="non_bank_financial")
    wd = metrics["business-deposits"]["withdrawals"]  # savings.flows.sector_burn's second choice
    assert "domestic_business" in wd["breakdowns"]["segment"]
    assert await series(client, "business-deposits", wd, segment="domestic_business")

    # not served by the sample bank today (DONE.md: a gap against acceptance D2)
    assert not any("sector" in m.get("breakdowns", {}) for ms in metrics.values() for m in ms.values())
    assert not any("large_depositor_net_flow" in ms for ms in metrics.values())


def test_the_series_are_funds_with_valid_themes():
    s = json.loads((FOLDER / "series.json").read_text())["series"]
    assert [x["symbol"] for x in s] == ["CPER", "UNG", "USO", "IEF", "SHY"]  # exchange-traded funds, no single stocks
    for x in s:
        t = x["theme"]
        assert reference.theme_problem(t["theme"], t["direction_up"], t.get("item")) is None, x
        assert reference.theme_problem(t["theme"], t["direction_down"], t.get("item")) is None, x
        assert all(reference.is_place(p) for p in x["places"])


def test_the_bank_has_no_real_name():
    assert DOC["institution"]["name"] == "TODO-NAME Bank"
    assert DOC["sections"].get("rivals", []) == []  # no real banks named as rivals either
    assert {"profile.json", "series.json", "monitors.md"} <= {p.name for p in FOLDER.iterdir()}
