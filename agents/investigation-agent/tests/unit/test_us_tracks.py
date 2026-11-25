"""The US pack's impact rules: added for a US institution only, never for anyone else.

A run's catalog is the built-in tracks plus the US pack when the institution's home country is the US
(app/packs); every other country gets the built-in tracks and their version exactly as before
(tests/fixtures/snapshots/investigation_catalog.json, pinned before the pack existed).
"""

import asyncio
import copy
import json
from pathlib import Path

import pytest

from app import tracks
from app.candidates import list_candidates
from app.contract import Event, InvestigationRequest, Limits, ThemeTag
from app.investigate import Investigation
from app.packs import catalog_for
from app.packs.us_tracks import MECHANISMS as US
from tests.scenarios.catalog import finding, headline, reading
from tests.unit.test_scenarios import CorrectModel

FIXTURES = Path(__file__).parents[1] / "fixtures"
PINNED = json.loads((FIXTURES / "snapshots" / "investigation_catalog.json").read_text())
US_IDS = ["savings.flows.sector_burn", "business_loan.utilization.sector", "business_loan.utilization.nbfi_stress"]
SPEC = json.loads((Path(__file__).parents[4] / "server" / "app" / "spec" / "metrics_spec_v1.json").read_text())


@pytest.mark.parametrize("country", ["LK", "ID", "PH", None])
def test_without_a_pack_the_catalog_and_version_are_the_pinned_ones(country):
    c = catalog_for(country)
    assert [m.mechanism_id for m in c.mechanisms] == PINNED["mechanism_ids"]
    assert c.version == PINNED["tracks_version"] == "builtin-v2.4"
    assert c.mechanisms is tracks.MECHANISMS  # the module's own list, untouched


def test_a_us_catalog_is_the_built_in_one_plus_the_pack():
    c = catalog_for("US")
    ids = [m.mechanism_id for m in c.mechanisms]
    assert ids == PINNED["mechanism_ids"] + US_IDS
    assert c.version == "builtin-v2.4+us-1" and c.region == "us"
    assert [m.mechanism_id for m in tracks.MECHANISMS] == PINNED["mechanism_ids"]  # the base is not extended


def test_check_passes_for_the_base_alone_and_with_the_us_pack():
    tracks.check()
    tracks.check(catalog_for("US").mechanisms)


def test_the_pack_uses_the_metrics_specs_own_keys_and_segments():
    metrics = {(cat, m["key"]): m for cat, ms in SPEC["metrics"].items() for m in ms}
    segments = set(SPEC["dimensions"]["segment"]["values"])
    spec_category = {"savings": "savings", "business_loan": "business_loan"}
    for m in US:
        for key in m.metrics:
            assert (spec_category[m.product_type], key) in metrics, (m.mechanism_id, key)
        if m.segment_value:
            assert m.segment_value in segments
        if m.segment_dim:
            assert all(m.segment_dim in metrics[(spec_category[m.product_type], k)]["breakdowns"] for k in m.metrics)
    # the options mirror the closest built-in rules
    pack = {m.mechanism_id: m for m in US}
    assert tracks.BY_ID["business_loan.repayment_stress.sector"].segment_dim == pack[
        "business_loan.utilization.sector"].segment_dim == "sector"


# ---------------------------------------------------------------- a construction sector shock

CONSTRUCTION = ThemeTag(theme="sector", direction="shock", sector="construction")
PRODUCTS = {"contractor_lines": ("business_loan", 1.0, "working_capital"),
            "business_deposits": ("savings", 1.0, "current_account")}
NO_CAPS = Limits(max_types_per_event=13, max_angles_per_type=5)


def event() -> Event:
    return Event.model_validate({"event_id": "evt-1", "finding_ids": ["f-1"], "themes": [CONSTRUCTION.model_dump()],
                                 "country": "home", "anchor": "2026-11-18T00:00:00Z",
                                 "anchor_basis": "published_at"})


def listed(country: str) -> set[str]:
    listing = list_candidates(event(), PRODUCTS, NO_CAPS, mechanisms=catalog_for(country).mechanisms)
    return {m.mechanism_id for c in listing.to_screen + listing.context for m in c.mechanisms}


def test_a_construction_shock_lists_the_us_rules_for_a_us_bank_only():
    assert {"business_loan.utilization.sector", "savings.flows.sector_burn"} <= listed("US")
    assert not set(US_IDS) & listed("LK")
    assert "business_loan.repayment_stress.sector" in listed("LK")  # the base still reacts as before


def test_every_metric_of_a_us_rule_moves_the_rules_way():
    adverse = {m["key"]: m.get("adverse") or [] for ms in SPEC["metrics"].values() for m in ms}
    for m in US:
        for key in m.metrics:  # a fallback metric inherits the rule's direction
            assert adverse[key] == [m.expect], (m.mechanism_id, key, adverse[key])


def test_sector_burn_reads_falling_balances_on_business_accounts_only():
    m = next(m for m in US if m.mechanism_id == "savings.flows.sector_burn")
    assert m.metrics == ("large_depositor_net_flow", "balance") and m.expect == "fall"  # cash burn
    assert m.only_spec_types == ("current_account",) and m.segment_value == "domestic_business"
    staff_savings = {"employee_savings": ("savings", 1.0, "savings_account")}
    listing = list_candidates(event(), staff_savings, NO_CAPS, mechanisms=catalog_for("US").mechanisms)
    assert "savings.flows.sector_burn" not in {m.mechanism_id for c in listing.to_screen + listing.context
                                               for m in c.mechanisms}


US_BANK = {
    "name": "Austin Tech Bank", "institution_type": "bank", "country": "US", "country_name": "United States",
    "currency": "USD", "time_zone": "America/Chicago",
    "summary": "Synthetic mid-size Dallas commercial bank, built from the public product mix of Texas lenders.",
}
LK_BANK = {**US_BANK, "name": "Serendib Commercial Bank", "country": "LK", "country_name": "Sri Lanka",
           "currency": "LKR", "time_zone": "Asia/Colombo", "summary": "A Sri Lankan commercial bank."}
CATALOG = json.loads((FIXTURES / "catalog_bank.json").read_text())


def _metric(product_id: str, metric: str, dims: dict) -> dict:
    p = next(p for p in CATALOG["products"] if p["product_id"] == product_id)
    return {**copy.deepcopy(next(m for m in p["metrics"] if m["metric"] == metric)), "dimensions": dims}


US_COVERAGE = json.loads((FIXTURES / "coverage_us_bank.json").read_text())


def _us_metric(product_id: str, metric: str, dims: dict) -> dict:
    p = next(p for p in US_COVERAGE["products"] if p["product_id"] == product_id)
    return {**copy.deepcopy(next(m for m in p["metrics"] if m["metric"] == metric)), "dimensions": dims}


class Coverage:
    """amiri-server's coverage for a contractor credit line cut by ISIC sector and segment."""

    async def coverage(self, req):
        return {"data_source": {"data_source_id": "metrics-spec", "catalog_version": "test"}, "products": [
            {"product_id": "contractor_lines", "source_product_id": "contractor_lines",
             "book_size": {"value": 2.0e9, "unit": req.institution.currency},
             "metrics": [_metric("sme_loan", "facility_utilization",
                                 {"sector": ["C", "F", "J", "unknown"],
                                  "segment": ["domestic_business", "non_bank_financial"]})]}]}

    async def calendar(self, req, start, until):
        from datetime import timedelta

        from app.data_client import Calendar

        days, d = [], start
        while d < until:
            if d.isoweekday() < 6:
                days.append(d)
            d += timedelta(days=1)
        return Calendar(days, "weekdays")


def investigate(institution: dict):
    req = InvestigationRequest.model_validate({
        "run_id": f"us-test-{institution['country'].lower()}", "institution_id": "bank", "server_url": "http://server",
        "institution": institution,
        "products": [{"product_id": "contractor_lines", "name": "Contractor credit lines", "category": "business_loan",
                      "product_type": "working_capital"}],
        "findings": [finding("f-dc", "Dallas data-center construction pauses as AI build-out slows",
                             "Several Dallas-Fort Worth data-center projects were paused.",
                             headlines=[headline("Dallas data-center construction pauses as AI build-out slows",
                                                 "2026-11-17T14:00:00Z", "Dallas Morning News")])],
    })
    answer = reading("sector:shock")
    answer["themes"][0]["sector"] = "construction"
    return asyncio.run(Investigation(req, CorrectModel([answer]), Coverage()).run())


def test_a_us_data_center_pause_yields_contractor_credit_line_stress():
    r = investigate(US_BANK)
    assert r.tracks_version == "builtin-v2.4+us-1"
    listed_ids = {m for s in r.screening for m in s.mechanism_ids}
    assert "business_loan.utilization.sector" in listed_ids
    assert "business_loan.utilization.sector" in {h.mechanism_id for h in r.hypotheses}


def test_the_same_event_for_a_sri_lankan_bank_has_no_us_rule():
    r = investigate(LK_BANK)
    assert r.tracks_version == "builtin-v2.4"
    seen = {m for s in r.screening for m in s.mechanism_ids} | {h.mechanism_id for h in r.hypotheses}
    assert not set(US_IDS) & seen


# ------------------------------------------------- each US rule, end to end: owner and label resolve

class Choosing(CorrectModel):
    """As CorrectModel, but chooses this mechanism when it is offered."""

    def __init__(self, answers: list[dict], mechanism_id: str):
        super().__init__(answers)
        self.mechanism_id = mechanism_id

    async def __call__(self, step, prompt, schema):
        props = schema["properties"]
        if step == "choose" and "mechanism_id" in props and self.mechanism_id in props["mechanism_id"]["enum"]:
            return {"mechanism_id": self.mechanism_id}, "correct-model"
        return await super().__call__(step, prompt, schema)


class BothProducts(Coverage):
    """Contractor credit lines by sector and segment, and business deposits by segment."""

    async def coverage(self, req):
        got = await super().coverage(req)
        got["products"].append(
            {"product_id": "business_deposits", "source_product_id": "business_deposits",
             "book_size": {"value": 3.0e9, "unit": req.institution.currency},
             "metrics": [_us_metric("startup-deposits", "balance", {"segment": ["domestic_business", "retail"]})]})
        return got


US_RUNS = {
    "savings.flows.sector_burn": ("sector:shock", "business_deposits", "retail_banking"),
    "business_loan.utilization.sector": ("sector:shock", "contractor_lines", "business_credit"),
    "business_loan.utilization.nbfi_stress": ("trust:rival", "contractor_lines", "business_credit"),
}


@pytest.mark.parametrize("mechanism_id", US_IDS)
def test_each_us_rule_gives_a_hypothesis_and_task_with_its_owner_and_label(mechanism_id):
    reading_theme, product_id, owner = US_RUNS[mechanism_id]
    req = InvestigationRequest.model_validate({
        "run_id": "us-test-owner", "institution_id": "bank", "server_url": "http://server", "institution": US_BANK,
        "products": [{"product_id": "contractor_lines", "name": "Contractor credit lines", "category": "business_loan",
                      "product_type": "working_capital"},
                     {"product_id": "business_deposits", "name": "Business deposits", "category": "savings",
                      "product_type": "current_account"}],
        "findings": [finding("f-us", "Dallas data-center construction pauses; a private-credit lender halts withdrawals",
                             "Several Dallas-Fort Worth projects were paused.",
                             headlines=[headline("Dallas data-center construction pauses", "2026-11-17T14:00:00Z",
                                                 "Dallas Morning News")])],
    })
    answer = reading(reading_theme)
    if reading_theme == "sector:shock":
        answer["themes"][0]["sector"] = "construction"
    r = asyncio.run(Investigation(req, Choosing([answer], mechanism_id), BothProducts()).run())
    hyps = [h for h in r.hypotheses if h.mechanism_id == mechanism_id]
    assert hyps, [h.mechanism_id for h in r.hypotheses]
    m = next(m for m in US if m.mechanism_id == mechanism_id)
    for h in hyps:
        assert h.product_id == product_id and h.chain_label == m.text[0].upper() + m.text[1:]
        task = next(t for t in r.tasks if t.hypothesis_id == h.hypothesis_id)
        assert task.owner == owner
        if mechanism_id == "savings.flows.sector_burn":
            assert (h.expected.metric, h.expected.direction) == ("balance", "fall")
    assert hyps[0].chain_label in r.report  # the report shows the rule's label
