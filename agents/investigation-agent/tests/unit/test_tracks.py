"""The tracks, normalisation and candidate listing against the stress-test findings.

tests/fixtures/investigation-test-findings.json gives, for 12 hard findings, the
themes a correct model reads and which product x angle must (or must not) be
considered. Here the readings are given (as a correct model would return them),
so these tests check the code half of the investigation: tracks, events,
direction-aware triggers, minimum sizes, country and implied themes.
"""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from app import tracks
from app.candidates import list_candidates
from app.contract import Finding, Institution, Limits, Size, ThemeTag
from app.normalize import Reading
from app.normalize import normalize as _normalize

CASES = json.loads(
    (
        Path(__file__).parents[1] / "fixtures" / "investigation-test-findings.json"
    ).read_text()
)["cases"]

BANK = {
    "youth_savings": "savings",
    "elders_savings": "savings",
    "child_savings": "savings",
    "term_deposit": "savings",
    "nrfc_pfca": "fc_deposit",
    "retirement_plan": "retirement",
    "pawning_loan": "pawning",
    "personal_loan": "retail_loan",
    "housing_loan": "retail_loan",
    "vehicle_leasing": "leasing",
    "credit_card": "credit_card",
    "corporate_loan": "business_loan",
    "sme_loan": "business_loan",
    "startup_loan": "business_loan",
}
INSURER = {
    "term_life": "life",
    "endowment": "life",
    "individual_health": "health",
    "family_health": "health",
    "motor": "motor",
    "travel": "travel",
    "migrant_worker_travel": "travel",
    "home_fire": "property",
    "business_property": "property",
}
SPEC_TYPES = {
    "term_deposit": "term_deposit",
    "endowment": "savings_life",
}  # for only_spec_types
PRODUCTS = {p: (t, 1.0, SPEC_TYPES.get(p)) for p, t in {**BANK, **INSURER}.items()}
NO_CAPS = Limits(max_types_per_event=13, max_angles_per_type=5)
INST = Institution(
    name="Bank",
    institution_type="bank",
    country="LK",
    currency="LKR",
    time_zone="Asia/Colombo",
    summary="A bank.",
)


def normalize(findings, readings):
    return _normalize(findings, readings, INST)


def finding(case: dict) -> Finding:
    f = case["finding"]
    signals, headlines = [], []
    if s := f.get("signal"):
        peak = datetime.fromisoformat(s["peak_at"])
        start = datetime.fromisoformat(s.get("from", s["peak_at"])) - timedelta(
            minutes=1
        )
        if "change_bp" in s:  # a yield: levels in %
            ref, obs = 8.10, 8.10 + s["change_bp"] / 100
        else:
            ref, obs = 100.0, 100.0 * (1 + s["change_pct"] / 100)
        signals.append(
            {
                "series_id": s["series"].lower().replace("/", "_"),
                "symbol": s["series"],
                "direction": "up",
                "start_at": start,
                "end_at": peak,
                "ref_level": ref,
                "obs_level": obs,
                "change_pct": (obs - ref) / ref * 100,
                "description": f["title"],
            }
        )
    if h := f.get("headline"):
        headlines.append(
            {
                "title": f["title"],
                "published_at": h["published_at"],
            }
        )
    h = f.get("headline") or {}
    period = (
        {"start": h["period_start"], "end": h["period_end"]}
        if "period_start" in h
        else None
    )
    return Finding(
        finding_id=f["id"],
        source="monitor",
        kind="news_match",
        title=f["title"],
        explanation=f["explanation"],
        score=50,
        evidence={"signals": signals, "headlines": headlines},
        effective_from=h.get("effective_from"),
        period=period,
        places=h.get("districts", []),
    )


def reading(case: dict, size: Size | None = None) -> Reading:
    themes = []
    for spec in case["expected"]["themes"]:
        theme, direction = spec.split(":")
        item = None
        if theme == "prices" and "electricity" in case["finding"]["title"].lower():
            item = "electricity"
        if theme == "commodities":
            item = "gold"
        if theme == "disaster":  # what a correct model reads from the title
            item = next(
                (
                    k
                    for k in ("flood", "storm", "earthquake", "drought")
                    if k in case["finding"]["title"].lower()
                ),
                None,
            )
        themes.append(ThemeTag(theme=theme, direction=direction, item=item))
    country = "other" if case["id"] == "T3" else "home"
    return Reading(case["finding"]["id"], themes, country=country, size=size)


SIZES = {"T12": Size(value=6, unit="pct")}  # read from "down 6% year on year"


def candidates_for(case: dict) -> set[tuple[str, str]] | None:
    f = finding(case)
    norm = normalize([f], {f.finding_id: reading(case, SIZES.get(case["id"]))})
    if not norm.events:
        return None
    listing = list_candidates(norm.events[0], PRODUCTS, NO_CAPS)
    return {
        (p, c.angle) for c in listing.to_screen + listing.context for p in c.product_ids
    }


def expand(entry: dict) -> list[tuple[str, str]]:
    product = entry["product"]
    if product.startswith("type:"):
        return [(p, entry["angle"]) for p, t in PRODUCTS.items() if t[0] == product[5:]]
    return [(product, entry["angle"])]


def test_tracks_agree_with_the_vocabulary():
    tracks.check()


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_must_screen_in_are_listed(case):
    listed = candidates_for(case)
    wanted = [pa for e in case["expected"]["must_screen_in"] for pa in expand(e)]
    if not wanted:
        return
    assert listed is not None, f"{case['id']}: no event"
    missing = [pa for pa in wanted if pa not in listed]
    assert not missing, f"{case['id']} not listed: {missing}"


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_must_screen_out_are_not_listed(case):
    listed = candidates_for(case) or set()
    for e in case["expected"]["must_screen_out"]:
        for pa in expand(e):
            assert pa not in listed, (
                f"{case['id']} listed {pa}: should not be ({e['why']})"
            )


def test_foreign_rate_cut_is_out_of_scope():
    case = next(c for c in CASES if c["id"] == "T3")
    f = finding(case)
    norm = normalize(
        [f],
        {
            f.finding_id: Reading(
                f.finding_id,
                [ThemeTag(theme="rates", direction="down")],
                country="other",
            )
        },
    )
    assert norm.events == []
    assert norm.out_of_scope[0].reason == "not_home_country"


def test_duplicate_findings_become_one_event():
    t1, t2 = (next(c for c in CASES if c["id"] == i) for i in ("T1", "T2"))
    f1, f2 = finding(t1), finding(t2)
    norm = normalize([f1, f2], {f1.finding_id: reading(t1), f2.finding_id: reading(t2)})
    assert len(norm.events) == 1
    event = norm.events[0]
    assert event.finding_ids == ["f1", "f2"]
    assert (
        event.anchor_basis == "move_start"
    )  # the signal's start, not the later headline
    assert event.size == Size(value=1.45, unit="pct")
    assert [o.reason for o in norm.out_of_scope] == ["merged_into_event"]


def test_anchor_rules():
    t8 = next(c for c in CASES if c["id"] == "T8")
    f = finding(t8)
    event = normalize([f], {f.finding_id: reading(t8)}).events[0]
    assert event.anchor_basis == "effective_from"
    assert event.anchor.date() == date(
        2027, 3, 31
    )  # midnight 1 Apr in Colombo is 31 Mar 18:30 UTC
    t12 = next(c for c in CASES if c["id"] == "T12")
    f = finding(t12)
    event = normalize([f], {f.finding_id: reading(t12)}).events[0]
    assert event.anchor_basis == "period_start"


def test_rates_size_is_read_in_basis_points():
    t7 = next(c for c in CASES if c["id"] == "T7")
    f = finding(t7)
    event = normalize([f], {f.finding_id: reading(t7)}).events[0]
    assert event.size == Size(value=85.0, unit="bp")
    assert ("markets", "bonds_down") in {(t.theme, t.direction) for t in event.themes}


def test_flood_with_moratorium_adds_central_bank_relief():
    t5 = next(c for c in CASES if c["id"] == "T5")
    f = finding(t5)
    only_disaster = Reading(
        f.finding_id, [ThemeTag(theme="disaster", direction="domestic")]
    )
    event = normalize([f], {f.finding_id: only_disaster}).events[0]
    assert ("regulation", "central_bank_relief") in {
        (t.theme, t.direction) for t in event.themes
    }


def test_opposite_fx_moves_are_netted():
    t1 = next(c for c in CASES if c["id"] == "T1")
    f1 = finding(t1)
    back = finding(
        {
            **t1,
            "finding": {
                **t1["finding"],
                "id": "f9",
                "title": "Rupee recovers",
                "signal": {**t1["finding"]["signal"], "change_pct": -0.9},
            },
        }
    )
    r1 = reading(t1)
    r9 = Reading("f9", [ThemeTag(theme="fx", direction="stronger")])
    events = normalize([f1, back], {"f1": r1, "f9": r9}).events
    assert len(events) == 1
    assert events[0].themes[0].direction == "weaker"
    assert events[0].size.value == pytest.approx(0.55, abs=0.01)


def test_caps_take_one_angle_per_type_first_and_report_the_rest():
    t5 = next(c for c in CASES if c["id"] == "T5")
    f = finding(t5)
    event = normalize([f], {f.finding_id: reading(t5)}).events[0]
    listing = list_candidates(
        event, PRODUCTS, Limits(max_types_per_event=3, max_angles_per_type=1)
    )
    types = [c.product_type for c in listing.to_screen]
    assert len(types) == len(set(types)) == 3
    assert listing.cut_by_cap
