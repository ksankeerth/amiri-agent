"""Validation tasks are built by code from the hypothesis, the data coverage and the calendar."""

import json
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.contract import Event, Size, ThemeTag
from app.data_client import Calendar
from app.tasks import Choice, build_task
from app.tracks import BY_ID

FIXTURES = Path(__file__).parents[1] / "fixtures"
BANK = {
    p["product_id"]: p
    for p in json.loads((FIXTURES / "catalog_bank.json").read_text())["products"]
}
INSURER = {
    p["product_id"]: p
    for p in json.loads((FIXTURES / "catalog_insurer.json").read_text())["products"]
}
BUSINESS = [
    date.fromisoformat(d["date"])
    for d in json.loads((FIXTURES / "calendar_2026.json").read_text())["days"]
    if d["business"]
]

COLOMBO = ZoneInfo("Asia/Colombo")
CAL = Calendar(BUSINESS, "lk-banks")

FX_EVENT = Event(
    event_id="e-1",
    finding_ids=["f-81"],
    themes=[ThemeTag(theme="fx", direction="weaker", currency="LKR")],
    country="home",
    anchor="2026-10-05T08:30:00Z",
    anchor_basis="move_start",
    size=Size(value=1.45, unit="pct"),
)
FLOOD_EVENT = Event(
    event_id="e-2",
    finding_ids=["f-90"],
    themes=[ThemeTag(theme="disaster", direction="domestic", item="flood")],
    country="home",
    anchor="2026-11-25T04:00:00Z",
    anchor_basis="published_at",
    places=["LK-91", "LK-13"],
    regions=["LK-13", "LK-91"],
)


def task(
    event,
    product_id,
    product_type,
    mechanism_id,
    catalog=BANK,
    segment=None,
    server="bank",
):
    choice = Choice(
        event,
        server,
        product_id,
        product_type,
        BY_ID[mechanism_id],
        segment,
        zone=COLOMBO,
    )
    return build_task("t-1", "h-1", choice, catalog[product_id], CAL)


def test_fx_importer_task_follows_the_catalog_and_calendar():
    t = task(FX_EVENT, "sme_loan", "business_loan", "business_loan.fx_mismatch.imports")
    assert (t.metric, t.filter, t.method) == (
        "lc_openings",
        {"segment": "importer"},
        "seasonal_ratio",
    )
    # Weekly metric, anchor on a Monday: watch runs over whole weeks from the anchor's week.
    assert t.watch.from_ == date(2026, 10, 5) and t.watch.from_.weekday() == 0
    assert t.watch.until.weekday() == 0 and (t.watch.until - t.watch.from_).days >= 35
    assert t.baseline.basis == "rolling_seasonal_ratio"
    assert t.baseline.until <= date(2026, 10, 5) and t.baseline.from_ == date(
        2024, 10, 1
    )
    assert [(x.statistic, x.op, x.value) for x in t.thresholds] == [
        ("percentile", "<=", 5),
        ("pct_change", "<=", -5.0),
    ]
    assert (t.expected_direction, t.adverse_direction) == ("fall", "fall")
    assert t.owner == "business_credit" and t.book_size.value == 140.0
    # Membership is frozen at the start of the week before the event (Tue 6 Oct).
    assert t.segment_frozen_at == date(2026, 9, 28)
    assert t.reporting_lag_days == 1 and t.min_volume == 10


def test_flood_task_uses_the_region_code_picked():
    t = task(
        FLOOD_EVENT,
        "personal_loan",
        "retail_loan",
        "retail_loan.repayment_stress.disaster",
        segment=("region_l2", "LK-91"),
    )
    assert (t.metric, t.filter) == ("restructure_requests", {"region_l2": "LK-91"})
    assert (t.time_zone, t.calendar_id, t.date_basis) == (
        "Asia/Colombo",
        "lk-banks",
        "local_business_date",
    )
    assert t.masking == []  # restructure requests are what a moratorium can't hide


def test_loan_stress_tasks_are_masked_by_moratorium():
    t = task(
        FX_EVENT,
        "sme_loan",
        "business_loan",
        "business_loan.fx_mismatch.importer_collections",
    )
    assert t.metric == "installment_collection_rate"
    assert (
        t.masking == []
    )  # the SME product has no moratorium metric in the mock catalog
    rates = Event(
        **{
            **FX_EVENT.model_dump(),
            "themes": [ThemeTag(theme="rates", direction="up")],
            "size": Size(value=85, unit="bp"),
        }
    )
    t = task(
        rates, "personal_loan", "retail_loan", "retail_loan.repayment_stress.rates_up"
    )
    assert [(m.metric, m.rise_pp) for m in t.masking] == [("moratorium_enrolled", 2.0)]
    assert t.method == "level_change" and t.thresholds[0].statistic == "pp_change"


def test_flood_claims_add_the_fixed_peril_filter():
    t = task(
        FLOOD_EVENT,
        "home_fire",
        "property",
        "property.catastrophe.disaster",
        catalog=INSURER,
        segment=("region_l2", "LK-13"),
        server="insurer",
    )
    assert t.filter == {"peril": "flood", "region_l2": "LK-13"}
    assert t.owner == "claims"
    # Weeks timing past the end of the calendar falls back to weekdays.
    assert t.watch.until > date(2026, 12, 31)


def test_days_timing_uses_ten_business_days_and_prior_spans():
    rival = Event(
        **{
            **FX_EVENT.model_dump(),
            "themes": [ThemeTag(theme="trust", direction="rival")],
            "anchor": "2026-10-21T13:00:00Z",
            "size": None,
        }
    )
    t = task(rival, "youth_savings", "savings", "savings.flows.rival_trust_inflow")
    assert t.metric == "deposit_inflow" and t.method == "recent_vs_prior"
    watch_days = [b for b in BUSINESS if t.watch.from_ <= b < t.watch.until]
    assert len(watch_days) == 10
    assert t.baseline.basis == "aligned_prior_spans"
    assert len([b for b in BUSINESS if t.baseline.from_ <= b < t.baseline.until]) >= 80
    assert (t.expected_direction, t.adverse_direction) == (
        "rise",
        "fall",
    )  # an opportunity


def test_a_late_week_anchor_starts_the_watch_the_following_week():
    late = Event(
        **{**FX_EVENT.model_dump(), "anchor": "2026-10-08T08:30:00Z"}
    )  # a Thursday
    t = task(late, "sme_loan", "business_loan", "business_loan.fx_mismatch.imports")
    assert t.watch.from_ == date(2026, 10, 12)
    assert t.baseline.until <= date(2026, 10, 5)


def test_fx_utilisation_is_measured_for_importers():
    t = task(
        FX_EVENT, "sme_loan", "business_loan", "business_loan.utilization.importers"
    )
    assert (t.metric, t.filter) == ("facility_utilization", {"segment": "importer"})


def test_no_task_when_the_product_offers_none_of_the_metrics():
    assert (
        task(FX_EVENT, "youth_savings", "savings", "savings.lifecycle.own_trust")
        is None
    )


def test_anticipation_watches_from_the_announcement_to_the_effective_date():
    product = {
        "product_id": "term_deposit",
        "book_size": {"value": 310e9, "unit": "LKR"},
        "metrics": [
            {
                "metric": "td_placements",
                "kind": "flow",
                "unit": "LKR",
                "currency": "LKR",
                "grain": "daily",
                "lag_days": 1,
                "adverse": "fall",
                "method": "seasonal_ratio",
                "min_volume": 30,
                "dimensions": {},
                "exposure_dims": [],
            }
        ],
    }
    tax = Event(
        **{
            **FX_EVENT.model_dump(),
            "themes": [ThemeTag(theme="regulation", direction="tax")],
            "anchor": "2026-12-31T18:30:00Z",
            "anchor_basis": "effective_from",
            "size": None,
        }
    )
    choice = Choice(
        tax,
        "bank",
        "term_deposit",
        "savings",
        BY_ID["savings.flows.tax_anticipation"],
        None,
        announced=date(2026, 11, 13),
        zone=COLOMBO,
    )
    t = build_task("t-1", "h-1", choice, product, CAL)
    assert t.phase == "anticipation"
    assert (t.watch.from_, t.watch.until) == (date(2026, 11, 16), date(2027, 1, 1))


@pytest.mark.parametrize("mechanism_id", sorted(BY_ID))
def test_every_mechanism_builds_a_valid_task_when_its_metric_exists(mechanism_id):
    m = BY_ID[mechanism_id]
    product = {
        "product_id": "prod",
        "book_size": {"value": 1e9, "unit": "LKR"},
        "metrics": [
            {
                "metric": m.metrics[0],
                "kind": "ratio",
                "unit": "%",
                "currency": None,
                "grain": g,
                "lag_days": 2,
                "adverse": m.expect,
                "method": method,
                "min_volume": 10,
                "dimensions": {},
                "exposure_dims": [],
            }
            for g, method in [("weekly", "seasonal_ratio")]
        ],
    }
    event = Event(
        **{
            **FX_EVENT.model_dump(),
            "themes": [
                ThemeTag(theme=t.theme, direction=t.direction) for t in m.triggers[:1]
            ],
        }
    )
    choice = Choice(
        event,
        "srv",
        "prod",
        m.product_type,
        m,
        None,
        announced=date(2026, 9, 1),
        zone=COLOMBO,
    )
    t = build_task("t-1", "h-1", choice, product, CAL)
    assert t is not None and t.watch.until > t.watch.from_ >= t.baseline.until
