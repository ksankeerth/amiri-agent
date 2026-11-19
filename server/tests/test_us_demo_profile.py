"""The US demo bank (demo/austin-tech-bank/bundle.json): its profile imports as it is, reads in Texas and
California places, and the sample bank (Metrics Spec reference API) serves the figures its stories check.

The lead story (tech layoffs, then Austin mortgages) uses figures the sample bank already serves: instalment
collection on the employee mortgages and withdrawals on employee savings, by segment and region. The sample bank
serves no sector breakdown (for any institution) and no category-level metric, so large_depositor_net_flow is
not there."""

import json

from app import reference, settings
from tests.test_mock_institutions import TODAY, api, enable, window

FOLDER = settings.PROJECT.parent / "demo" / "austin-tech-bank"
BUNDLE = json.loads((FOLDER / "bundle.json").read_text())
B = "/api/v1/institutions"


async def load(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    env.setenv("INSTITUTION_ID", "austin-tech-bank")
    r = await client.post(f"{B}:import", json={"institution": BUNDLE["institution"], "sections": BUNDLE["sections"]})
    assert r.status_code == 201, r.text
    return r.json()


async def test_the_austin_bank_imports_and_reads_in_us_places(client, env):
    i = await load(client, env)
    assert i["name"] == "Austin Tech Bank" and i["home_country"] == "US" and i["base_currency"] == "USD"
    assert i["time_zone"] == "America/Chicago" and i["subtype"] == "commercial" and i["size_band"] == "mid"
    assert i["counts"] == {"footprint": 3, "watch-places": 4, "segments": 6, "products": 12, "flows": 0, "regulators": 6,
                           "rivals": 0, "counterparties": 2, "risk-exposures": 0}
    prof = (await client.get(f"{B}/austin-tech-bank/profile")).json()
    assert prof["readiness"]["ready"] is True
    names = prof["place_names"]
    assert (names["US-TX"], names["US-CA"], names["city:austin"], names["city:san-jose"]) == (
        "Texas", "California", "Austin", "San Jose")
    ctx = (await client.get(f"{B}/austin-tech-bank/context")).json()
    scope = ctx["radar_scope"]
    assert {"US-TX", "US-CA", "city:austin", "city:dallas", "city:midland", "city:san-jose"} <= set(scope["places"])
    assert {"ERCOT", "Fedwire Funds Service", "Fed", "FDIC", "Texas DOB", "CFPB", "FinCEN", "OFAC"} <= set(scope["actors"])
    rule = {r["short"]: r for r in prof["sections"]["regulators"]}
    assert all(rule[s]["basis"] == "rule" and rule[s]["regulator_id"] for s in ("Fed", "FDIC", "Texas DOB", "CFPB", "OFAC"))
    assert rule["FinCEN"]["basis"] == "user"  # not in the rule table: kept as the user's own entry
    kinds = {p["id"]: (p["category"], p["product_type"]) for p in ctx["products"]}
    assert kinds["employee-mortgages"] == ("retail_loan", "housing_loan")
    assert kinds["startup-deposits"] == ("savings", "current_account") and kinds["venture-debt"][1] == "working_capital"


async def series(client, product_id: str, metric: dict, **filters) -> list[dict]:
    start, until = window(metric["grain"], TODAY)
    r = await client.get(f"{api()}/series", params={"product_id": product_id, "metric": metric["key"], "start": start.isoformat(),
                                                    "until": until.isoformat(), **{f"filter[{k}]": v for k, v in filters.items()}})
    assert r.status_code == 200, r.text
    return [x for x in r.json()["rows"] if x["value"] is not None]


async def test_the_sample_bank_serves_the_figures_the_stories_check(client, env):
    await load(client, env)
    on = await enable(client)
    assert on["shaped_by"] == {"name": "Austin Tech Bank", "source": "installation"}
    cat = (await client.get(f"{api()}/catalog")).json()
    assert cat["profile"]["country"] == "US" and cat["profile"]["base_currency"] == "USD"
    metrics = {p["product_id"]: {m["key"]: m for m in p["metrics"]} for p in cat["products"]}

    # the lead story: tech layoffs, then mortgages (retail_loan.repayment_stress.sector) and savings
    icr = metrics["employee-mortgages"]["installment_collection_rate"]
    assert await series(client, "employee-mortgages", icr, segment="salaried")
    assert await series(client, "employee-mortgages", icr, region_l1="US-TX")
    wd = metrics["employee-savings"]["withdrawals"]
    assert await series(client, "employee-savings", wd, segment="salaried")
    # credit lines (business_loan.utilization.*): uncut, and the fund lines by segment non_bank_financial
    assert await series(client, "chip-supplier-lines", metrics["chip-supplier-lines"]["facility_utilization"])
    ccl = metrics["capital-call-lines"]["facility_utilization"]
    assert await series(client, "capital-call-lines", ccl, segment="non_bank_financial")
    assert await series(client, "dc-contractor-loans", metrics["dc-contractor-loans"]["installment_collection_rate"])

    # not served by the sample bank today (acceptance D2 passes as served; see DONE.md)
    assert not any("sector" in m.get("breakdowns", {}) for ms in metrics.values() for m in ms.values())
    assert not any("large_depositor_net_flow" in ms for ms in metrics.values())


def test_the_bundles_series_and_monitors_are_valid():
    s = BUNDLE["series"]
    assert [x["symbol"] for x in s] == ["QQQ", "UNG", "USO", "IEF"]  # exchange-traded funds, no single stocks
    for x in s:
        t = x["theme"]
        assert reference.theme_problem(t["theme"], t["direction_up"], t.get("item")) is None, x
        assert reference.theme_problem(t["theme"], t["direction_down"], t.get("item")) is None, x
        assert all(reference.is_place(p) for p in x["places"])
    ms = BUNDLE["monitors"]
    assert len(ms) == 7 and all(m["status"] == "live" for m in ms)
    assert all(any("politics" in line for line in m["spec"]["public"]["ignore"]) for m in ms)


def test_no_real_bank_is_named():
    assert BUNDLE["institution"]["name"] == "Austin Tech Bank"
    assert BUNDLE["sections"]["rivals"] == []
