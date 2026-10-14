"""The whole investigation with a scripted model and a fake amiri-server (coverage and
calendar) built from the real mock catalog."""

import asyncio
import copy
import json
from datetime import date
from pathlib import Path

import pytest
import yaml

from app.contract import InvestigationRequest, InvestigationResult
from app.data_client import Calendar, DataError
from app.investigate import Investigation

ROOT = Path(__file__).parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
SPEC = yaml.safe_load((ROOT / "openapi.yaml").read_text())
EXAMPLE = SPEC["paths"]["/investigations"]["post"]["requestBody"]["content"][
    "application/json"
]["example"]
CATALOG = {
    "bank": json.loads((FIXTURES / "catalog_bank.json").read_text()),
    "insurer": json.loads((FIXTURES / "catalog_insurer.json").read_text()),
}
DAYS = [
    date.fromisoformat(d["date"])
    for d in json.loads((FIXTURES / "calendar_2026.json").read_text())["days"]
    if d["business"]
]
# The profile's product ids -> the mock data source's.
SOURCE_IDS = {
    "migrant-savings": "migrant_savings",
    "youth-savings": "youth_savings",
    "term-deposits": "term_deposit",
    "pawning": "pawning_loan",
    "personal-loans": "personal_loan",
    "vehicle-leasing": "vehicle_leasing",
    "sme-loans": "sme_loan",
    "corporate-loans": "corporate_loan",
}


class FakeData:
    """amiri-server's coverage and calendar, from the mock bank catalog."""

    def __init__(self, down: bool = False):
        self.down = down
        self.calls: list[str] = []

    async def coverage(self, req):
        self.calls.append("coverage")
        if self.down:
            raise DataError("coverage: ConnectError")
        source = {p["product_id"]: p for p in CATALOG["bank"]["products"]}
        products = []
        for p in req.products:
            sp = source.get(SOURCE_IDS.get(p.product_id, ""))
            if sp:
                products.append(
                    {
                        "product_id": p.product_id,
                        "source_product_id": sp["product_id"],
                        "book_size": sp["book_size"],
                        "metrics": sp["metrics"],
                    }
                )
        return {
            "data_source": {"data_source_id": "mock-bank", "catalog_version": "test"},
            "products": products,
        }

    async def calendar(self, req, start, until):
        return Calendar([d for d in DAYS if start <= d < until], "lk-banks")


class ScriptedLlm:
    """classify -> the given themes; screen -> keep every product; choose -> the first option."""

    def __init__(self, themes=None, keep=True, delay=0.0):
        self.themes = themes or [{"theme": "fx", "direction": "weaker"}]
        self.keep, self.delay = keep, delay
        self.steps: list[str] = []

    async def __call__(self, step, prompt, schema):
        self.steps.append(step)
        if self.delay:
            await asyncio.sleep(self.delay)
        props = schema["properties"]
        if step == "classify":
            return {
                "themes": self.themes,
                "country": "home",
                "channel": "none",
                "size_value": None,
                "size_unit": "none",
            }, "fake-model"
        if step == "screen":
            pids = props["product_ids"]["items"]["enum"]
            return {
                "keep": self.keep,
                "product_ids": pids if self.keep else [],
                "reason": "Importers pay in dollars.",
            }, "fake-model"
        field, spec = next(iter(props.items()))
        return {field: spec["enum"][0]}, "fake-model"


def request(**changes) -> InvestigationRequest:
    body = copy.deepcopy(EXAMPLE)
    body.update(changes)
    return InvestigationRequest.model_validate(body)


def run(req, llm, data=None) -> InvestigationResult:
    return asyncio.run(Investigation(req, llm, data or FakeData()).run())


def series_finding(**changes) -> dict:
    return {**copy.deepcopy(EXAMPLE["findings"][0]), **changes}


def news(finding_id: str, title: str, published_at: str, **changes) -> dict:
    """A monitor's news match: no themes, so the agent classifies it."""
    return {
        "finding_id": finding_id,
        "source": "monitor",
        "source_ref": {"monitor_id": "mon"},
        "kind": "news_match",
        "title": title,
        "explanation": title + ".",
        "score": 60,
        "evidence": {"headlines": [{"title": title, "published_at": published_at}]},
        **changes,
    }


def products(*ids: str) -> list[dict]:
    known = {p["product_id"]: p for p in EXAMPLE["products"]}
    extra = {
        "youth-savings": {
            "product_id": "youth-savings",
            "name": "Youth Savings Account",
            "category": "savings",
            "product_type": "savings_account",
        },
        "vehicle-leasing": {
            "product_id": "vehicle-leasing",
            "name": "Vehicle Leasing",
            "category": "vehicle_finance",
            "product_type": "vehicle_lease",
        },
    }
    return [known.get(i) or extra[i] for i in ids]


# ---------------------------------------------------------------- market series


def test_a_series_move_needs_no_model_to_classify():
    llm = ScriptedLlm()
    result = run(request(), llm)
    assert result.stop_reason == "finished"
    assert "classify" not in llm.steps  # the series set fx: weaker, LKR
    assert [(c.finding_id, c.country) for c in result.classifications] == [
        ("f-ts-usd_lkr-2026100608", "home")
    ]
    event = result.events[0]
    assert (event.anchor_basis, event.size.value, event.places) == (
        "move_start",
        1.45,
        ["LK"],
    )
    kept = {(s.product_type, s.angle) for s in result.screening if s.decision == "kept"}
    assert ("business_loan", "fx_mismatch") in kept and (
        "business_loan",
        "utilization",
    ) in kept
    lc = next(
        t
        for t in result.tasks
        if (t.product_id, t.metric) == ("sme-loans", "lc_openings")
    )
    assert lc.filter == {"segment": "importer"} and lc.data_source_id == "mock-bank"
    assert lc.source_product_id == "sme_loan"
    h = next(h for h in result.hypotheses if h.hypothesis_id == lc.hypothesis_id)
    assert h.statement.startswith("The LKR weakened (1.45%). Expected: importers")
    assert (
        h.chain_label == "Importers' costs rise, so they open fewer letters of credit"
    )
    assert result.tool_trace[0].tool == "get_coverage"
    InvestigationResult.model_validate(result.model_dump(mode="json", by_alias=True))


def test_products_without_tracks_are_listed_not_dropped():
    debit = {
        "product_id": "debit-cards",
        "name": "Debit Cards",
        "category": "cards",
        "product_type": "debit_card",
    }
    result = run(request(products=[*EXAMPLE["products"], debit]), ScriptedLlm())
    assert [(u.product_id, u.product_type) for u in result.untracked_products] == [
        ("debit-cards", "debit_card")
    ]
    assert all("debit-cards" not in s.product_ids for s in result.screening)
    assert (
        "Debit Cards: No investigation tracks for cards / debit_card" in result.report
    )


def test_without_validation_it_stops_at_a_readable_investigation():
    result = run(request(validation=False), ScriptedLlm())
    assert result.mode == "report_only" and result.tasks == []
    assert result.hypotheses  # still formed, each naming what to watch
    sme = next(h for h in result.hypotheses if h.product_id == "sme-loans")
    assert sme.expected.metric in (
        "lc_openings",
        "facility_utilization",
        "installment_collection_rate",
    )
    r = result.report
    assert r.startswith("# Investigation for Serendib Commercial Bank")
    assert "Metrics validation is off" in r and "## The LKR weakened (1.45%)" in r
    assert "**SME Loans**:" in r and "expected to" in r and "Checked from" not in r
    # with validation on, the same run builds tasks and says what each one checks
    result = run(request(), ScriptedLlm())
    assert result.mode == "tasks" and result.tasks and "Checked from" in result.report


def test_good_news_lists_no_candidates_and_calls_no_model():
    f = series_finding(
        themes=[{"theme": "fx", "direction": "stronger", "currency": "LKR"}]
    )
    llm = ScriptedLlm()
    result = run(request(findings=[f]), llm)
    assert result.screening == [] and llm.steps == []


def test_a_foreign_move_with_no_way_home_is_out_of_scope_by_code():
    f = series_finding(
        finding_id="f-ts-usd_thb-2026100608",
        themes=[],
        places=["TH"],
        title="USD/THB up 1.2% in 1 trading day (4.0x typical)",
    )
    llm = ScriptedLlm()
    result = run(request(findings=[f]), llm)
    assert llm.steps == [] and result.events == []
    oos = result.out_of_scope[0]
    assert oos.reason == "not_home_country" and "TH: no flow to LK" in oos.note


def test_a_footprint_currency_counts_for_that_country_s_book():
    f = series_finding(
        finding_id="f-ts-usd_inr-2026100608",
        places=["IN"],
        themes=[{"theme": "fx", "direction": "weaker", "currency": "INR"}],
        title="USD/INR up 1.2% in 1 trading day (4.0x typical)",
    )
    prods = [
        {**p, "countries": ["LK"]} if p["product_id"] == "sme-loans" else p
        for p in EXAMPLE["products"]
    ]  # sme-loans is booked in Sri Lanka only
    result = run(request(findings=[f], products=prods), ScriptedLlm())
    event = result.events[0]
    assert (event.country, event.country_code) == ("footprint", "IN")
    assert result.tasks and all("IN" in t.scope_note for t in result.tasks)
    assert all(t.product_id != "sme-loans" for t in result.tasks)  # not booked in India
    h = result.hypotheses[0]
    assert h.statement.startswith("The INR weakened")


def test_a_currency_it_does_not_book_in_is_set_aside():
    f = series_finding(
        finding_id="f-ts-usd_thb-2026100608",
        places=[],
        themes=[{"theme": "fx", "direction": "weaker", "currency": "THB"}],
    )
    result = run(request(findings=[f]), ScriptedLlm())
    assert result.events == []
    assert (result.out_of_scope[0].reason, result.out_of_scope[0].note) == (
        "not_home_country",
        "THB: a currency the institution doesn't book in",
    )


def test_minimums_scale_with_the_series_typical_move():
    # 1.45% on a series that typically moves 1% a day is under 4 typical days: no importer effect
    sig = {
        **EXAMPLE["findings"][0]["evidence"]["signals"][0],
        "typical_daily_move_pct": 1.0,
    }
    f = series_finding(evidence={"signals": [sig]})
    result = run(request(findings=[f]), ScriptedLlm())
    assert not any(s.angle == "fx_mismatch" for s in result.screening)
    # the same move on a currency that typically moves 0.1% a day is 14 typical days
    sig = {**sig, "typical_daily_move_pct": 0.1}
    result = run(
        request(findings=[series_finding(evidence={"signals": [sig]})]), ScriptedLlm()
    )
    assert any(s.angle == "fx_mismatch" for s in result.screening)


def test_local_dates_follow_the_institution_s_time_zone():
    f = news(
        "f-tax",
        "Deposit tax from 1 January 2027",
        "2026-10-12T05:00:00Z",
        effective_from="2027-01-01",
        themes=[{"theme": "regulation", "direction": "tax"}],
    )
    for zone, utc in [
        ("Asia/Colombo", "2026-12-31T18:30:00+00:00"),
        ("Asia/Manila", "2026-12-31T16:00:00+00:00"),
    ]:
        inst = {**EXAMPLE["institution"], "time_zone": zone}
        event = run(request(findings=[f], institution=inst), ScriptedLlm()).events[0]
        assert event.anchor.isoformat() == utc


def test_a_remittance_corridor_brings_foreign_news_home():
    f = news(
        "f-mon-kw",
        "Kuwait tightens work visas for Asian workers",
        "2026-10-12T05:00:00Z",
        places=["KW"],
        themes=[{"theme": "remittance", "direction": "down"}],
    )
    inst = {**EXAMPLE["institution"], "corridors": ["AE", "SA", "KW"]}
    result = run(request(findings=[f], institution=inst), ScriptedLlm())
    c = result.classifications[0]
    assert (c.country, c.channel) == ("other", "remittance")
    assert result.events and result.events[0].themes[0].theme == "remittance"
    # without the corridor it stays out
    result = run(request(findings=[f]), ScriptedLlm())
    assert result.out_of_scope[0].reason == "not_home_country"


def test_place_info_resolves_gazetteer_codes():
    f = series_finding(places=["city:jaffna"])
    result = run(
        request(
            findings=[f],
            place_info={
                "city:jaffna": {
                    "country": "LK",
                    "region_l1": "LK-4",
                    "region_l2": "LK-41",
                }
            },
        ),
        ScriptedLlm(),
    )
    assert result.classifications[0].country == "home" and result.events


# ---------------------------------------------------------------- news (classified)


def test_news_is_classified_once_and_merges_with_the_move():
    move = series_finding()
    story = news(
        "f-mon-1",
        "Rupee falls past 333 as importer dollar demand surges",
        "2026-10-06T08:06:00Z",
    )
    llm = ScriptedLlm()
    result = run(request(findings=[move, story]), llm)
    assert llm.steps.count("classify") == 1
    assert len(result.events) == 1 and result.events[0].finding_ids == [
        "f-ts-usd_lkr-2026100608",
        "f-mon-1",
    ]
    assert {(o.finding_id, o.reason) for o in result.out_of_scope} == {
        ("f-mon-1", "merged_into_event")
    }


def test_a_rejected_screening_creates_nothing():
    result = run(request(), ScriptedLlm(keep=False))
    assert {s.decision for s in result.screening} == {"rejected"}
    assert result.hypotheses == [] and result.tasks == []


def test_call_limit_stops_with_the_result_so_far():
    findings = [news(f"f-{i}", "Rupee falls", "2026-10-06T08:06:00Z") for i in range(6)]
    req = request(findings=findings, limits={"max_model_calls": 5})
    result = run(req, ScriptedLlm())
    assert result.stop_reason == "call_limit"
    assert result.usage.model_calls == 5
    assert result.classifications  # what was done is kept


def test_timeout_stops_with_the_result_so_far():
    req = request(
        findings=[news("f-1", "Rupee falls", "2026-10-06T08:06:00Z")],
        limits={"timeout_seconds": 30},
    )
    inv = Investigation(req, ScriptedLlm(delay=0.2), FakeData())
    inv.limits = inv.limits.model_copy(update={"timeout_seconds": 0.3})
    result = asyncio.run(inv.run())
    assert result.stop_reason == "timeout"


def test_an_unreachable_server_is_traced_and_nothing_gets_a_task():
    result = run(request(), ScriptedLlm(), FakeData(down=True))
    errors = [t for t in result.tool_trace if t.status == "error"]
    assert errors and errors[0].tool == "get_coverage"
    assert result.tasks == []
    # Hypotheses are still formed; without coverage there is nothing to measure.
    assert any(h.product_id == "sme-loans" for h in result.hypotheses)


def test_invalid_model_answers_are_dropped():
    llm = ScriptedLlm(
        themes=[
            {"theme": "fx", "direction": "up"},
            {"theme": "nonsense", "direction": "x"},
        ]
    )
    result = run(request(findings=[news("f-1", "Rupee", "2026-10-06T08:06:00Z")]), llm)
    assert result.classifications[0].themes == []
    assert result.events == [] and result.out_of_scope[0].reason == "no_theme"


# ---------------------------------------------------------------- regions and segments


def test_a_flood_gets_one_task_per_affected_region():
    f = news(
        "f-90",
        "Floods in Ratnapura and Kalutara; the central bank asks banks to offer a moratorium",
        "2026-11-25T04:00:00Z",
        places=["LK-91", "LK-13"],
    )
    result = run(
        request(findings=[f], products=products("personal-loans")),
        ScriptedLlm(
            themes=[{"theme": "disaster", "direction": "domestic", "item": "flood"}]
        ),
    )
    restructure = [t for t in result.tasks if t.metric == "restructure_requests"]
    assert sorted(t.filter["region_l2"] for t in restructure) == ["LK-13", "LK-91"]
    assert ("regulation", "central_bank_relief") in {
        (t.theme, t.direction) for t in result.events[0].themes
    }


class PromptRecorder(ScriptedLlm):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.prompts: list[tuple[str, str]] = []

    async def __call__(self, step, prompt, schema):
        self.prompts.append((step, prompt))
        return await super().__call__(step, prompt, schema)


def _remittance_request():
    f = news(
        "f-remit",
        "Workers' remittances down 6% in September",
        "2026-10-12T05:00:00Z",
        period={"start": "2026-09-01", "end": "2026-09-30"},
    )
    return request(
        findings=[f],
        products=products("migrant-savings", "youth-savings", "corporate-loans"),
    )


def test_screening_shows_what_would_be_measured():
    llm = PromptRecorder(themes=[{"theme": "remittance", "direction": "down"}])
    run(_remittance_request(), llm)
    screen = next(p for step, p in llm.prompts if step == "screen" and "segment" in p)
    assert (
        "migrant-savings: Migrant Family Savings; would check inward_remittance_credits (remittance_linked)"
        in screen
    )
    assert "youth-savings" not in screen  # no remittance metric: not offered


def test_an_angle_no_product_can_measure_is_rejected_without_a_model_call():
    llm = PromptRecorder(themes=[{"theme": "sector", "direction": "shock"}])
    result = run(_remittance_request(), llm)
    unmeasurable = [s for s in result.screening if s.product_type == "business_loan"]
    assert unmeasurable and all(s.decision == "rejected" for s in unmeasurable)
    assert "offers a metric" in unmeasurable[0].reason
    assert not any(
        step == "screen" and "Corporate Loans" in p for step, p in llm.prompts
    )


def test_regional_effects_need_a_region_breakdown():
    f = news("f-90", "Floods in Ratnapura", "2026-11-25T04:00:00Z", places=["LK-91"])
    result = run(
        request(findings=[f], products=products("youth-savings", "personal-loans")),
        ScriptedLlm(
            themes=[{"theme": "disaster", "direction": "domestic", "item": "flood"}]
        ),
    )
    assert not any(
        t.product_id == "youth-savings" for t in result.tasks
    )  # no region breakdown
    assert any(t.filter.get("region_l2") == "LK-91" for t in result.tasks)


@pytest.mark.parametrize(
    ("spec_type", "anticipation"), [("term_deposit", True), ("savings_account", False)]
)
def test_mechanisms_limited_to_a_spec_type(spec_type, anticipation):
    f = news(
        "f-tax",
        "Tax on deposit interest to rise from 1 January 2027",
        "2026-10-12T05:00:00Z",
        effective_from="2027-01-01",
    )
    p = {
        "product_id": "term-deposits",
        "name": "Term Deposits",
        "category": "savings",
        "product_type": spec_type,
    }
    result = run(
        request(findings=[f], products=[p]),
        PromptRecorder(themes=[{"theme": "regulation", "direction": "tax"}]),
    )
    listed = {m for s in result.screening for m in s.mechanism_ids}
    assert ("savings.flows.tax_anticipation" in listed) is anticipation


def test_an_oil_move_reaches_the_fuel_mechanisms():
    sig = {
        **EXAMPLE["findings"][0]["evidence"]["signals"][0],
        "series_id": "bno",
        "symbol": "BNO",
        "change_pct": 12.0,
        "typical_daily_move_pct": 1.5,
    }
    f = series_finding(
        finding_id="f-ts-bno-2026100608",
        title="Brent (BNO) up 12% in 3 trading days",
        themes=[{"theme": "commodities", "direction": "up", "item": "oil"}],
        evidence={"signals": [sig]},
    )
    prods = [
        *EXAMPLE["products"],
        {
            "product_id": "vehicle-leasing",
            "name": "Vehicle Leasing",
            "category": "vehicle_finance",
            "product_type": "vehicle_lease",
        },
    ]
    result = run(request(findings=[f], products=prods), ScriptedLlm())
    tags = {(t.theme, t.direction, t.item, t.implied) for t in result.events[0].themes}
    assert ("prices", "up", "fuel", True) in tags
    assert any(
        s.product_type == "leasing" and s.angle == "repayment_stress"
        for s in result.screening
    )


# ---------------------------------------------------------------- JAPAC coverage


def spec_coverage(groups=(), products=None):
    """A fake server answering with whole-category groups as well."""

    class Data(FakeData):
        async def coverage(self, req):
            body = await super().coverage(req)
            body["groups"] = list(groups)
            if products:
                body["products"] += products
            return body

    return Data()


def test_whole_category_metrics_are_measured_on_their_group():
    trust = news(
        "f-out",
        "Serendib's app and ATMs down for six hours",
        "2026-10-12T05:00:00Z",
        themes=[{"theme": "trust", "direction": "own"}],
    )
    group = {
        "group_id": "group-payments",
        "category": "payments",
        "name": "All payments and digital channels",
        "institution_wide": True,
        "metrics": [
            {
                "metric": "failed_transactions_own",
                "name": "Failed transactions",
                "kind": "ratio",
                "unit": "percent",
                "currency": None,
                "grain": "daily",
                "lag_days": 1,
                "adverse": "rise",
                "method": "recent_vs_prior",
                "min_volume": None,
                "dimensions": {"channel": ["mobile", "atm"]},
                "thresholds": {},
            }
        ],
    }
    result = run(request(findings=[trust]), ScriptedLlm(), spec_coverage([group]))
    t = next(t for t in result.tasks if t.metric == "failed_transactions_own")
    assert t.product_id == "group-payments" and "whole category" in t.scope_note
    h = next(h for h in result.hypotheses if h.hypothesis_id == t.hypothesis_id)
    assert h.product_id in (
        "migrant-savings",
        "term-deposits",
    )  # the product the effect is about


def test_a_disaster_item_becomes_the_spec_peril():
    storm = news(
        "f-storm",
        "Typhoon hits the Visayas",
        "2026-10-12T05:00:00Z",
        places=["PH-07"],
        themes=[{"theme": "disaster", "direction": "domestic", "item": "storm"}],
    )
    inst = {
        **EXAMPLE["institution"],
        "country": "PH",
        "country_name": "Philippines",
        "currency": "PHP",
        "time_zone": "Asia/Manila",
        "footprint": [],
        "flows": [],
        "corridors": [],
    }
    crop = {
        "product_id": "crop-cover",
        "name": "Crop Index Cover",
        "category": "agriculture",
        "product_type": "crop_index",
    }
    cover = {
        "product_id": "crop-cover",
        "book_size": None,
        "metrics": [
            {
                "metric": "claims_per_1000",
                "name": "Claims per 1,000",
                "kind": "rate",
                "unit": "per_1000",
                "currency": None,
                "grain": "weekly",
                "lag_days": 7,
                "adverse": "rise",
                "method": "recent_vs_prior",
                "min_volume": 50,
                "dimensions": {
                    "peril": ["flood", "storm", "drought"],
                    "region_l1": ["PH-07", "PH-08"],
                },
                "thresholds": {},
            }
        ],
    }
    req = request(
        findings=[storm],
        institution={**inst, "institution_type": "insurer"},
        products=[crop],
    )
    result = run(req, ScriptedLlm(), spec_coverage(products=[cover]))
    t = next(t for t in result.tasks if t.product_id == "crop-cover")
    assert (
        t.filter == {"peril": "storm", "region_l1": "PH-07"}
        and t.time_zone == "Asia/Manila"
    )


def test_remittances_from_the_affected_country():
    visas = news(
        "f-kw",
        "Kuwait tightens work visas for Asian workers",
        "2026-10-12T05:00:00Z",
        places=["KW"],
        themes=[{"theme": "remittance", "direction": "down"}],
    )
    inst = {**EXAMPLE["institution"], "corridors": ["AE", "SA", "KW"]}
    remit = {
        "product_id": "inward-remittances",
        "name": "Inward Remittances",
        "category": "remittances",
        "product_type": "inward_remittance",
    }
    cover = {
        "product_id": "inward-remittances",
        "book_size": None,
        "metrics": [
            {
                "metric": "inward_remittances",
                "name": "Inward remittances",
                "kind": "flow",
                "unit": "USD",
                "currency": "USD",
                "grain": "monthly",
                "lag_days": 10,
                "adverse": "fall",
                "method": "seasonal_ratio",
                "min_volume": 30,
                "dimensions": {"corridor": ["AE", "SA", "KW", "unknown"]},
                "thresholds": {},
            }
        ],
    }
    result = run(
        request(
            findings=[visas], institution=inst, products=[*EXAMPLE["products"], remit]
        ),
        ScriptedLlm(),
        spec_coverage(products=[cover]),
    )
    corridor = [
        t
        for t in result.tasks
        if t.product_id == "inward-remittances" and t.filter.get("corridor")
    ]
    assert [t.filter["corridor"] for t in corridor] == ["KW"]


def test_as_of_sets_aside_findings_from_its_future():
    late = news(
        "f-late",
        "Rupee falls",
        "2026-11-20T05:00:00Z",
        themes=[{"theme": "fx", "direction": "weaker"}],
    )
    result = run(request(findings=[late], as_of="2026-10-12T00:00:00Z"), ScriptedLlm())
    assert result.events == [] and result.out_of_scope[0].reason == "after_as_of"
    assert (
        result.as_of.isoformat() == "2026-10-12T00:00:00+00:00"
        and result.report.count("As of 12 Oct 2026")
    )


def test_extend_adds_only_the_new_themes_to_the_open_event():
    f = series_finding(
        themes=[
            {"theme": "fx", "direction": "weaker", "currency": "LKR"},
            {"theme": "remittance", "direction": "up"},
        ]
    )
    ext = {
        "event_id": "ev-20261012-0001-1",
        "themes": [{"theme": "remittance", "direction": "up"}],
    }
    remit = {
        "product_id": "inward-remittances",
        "name": "Inward Remittances",
        "category": "remittances",
        "product_type": "inward_remittance",
    }
    result = run(
        request(findings=[f], extend=ext, products=[*EXAMPLE["products"], remit]),
        ScriptedLlm(),
    )
    assert result.extended_event_id == "ev-20261012-0001-1"
    assert [e.event_id for e in result.events] == ["ev-20261012-0001-1"]
    assert {t.theme for t in result.events[0].themes} == {"remittance"}
    assert all(
        s.product_type == "remittance" for s in result.screening
    )  # no fx candidates again


def test_bad_news_in_a_remittance_corridor_means_fewer_remittances():
    cuts = news(
        "f-sa",
        "Saudi Arabia cuts quotas for foreign construction workers",
        "2026-10-15T06:00:00Z",
        places=["SA"],
        themes=[{"theme": "sector", "direction": "shock", "sector": "construction"}],
    )
    result = run(request(findings=[cuts]), ScriptedLlm())
    e = result.events[0]
    assert (e.country, [(t.theme, t.direction, t.implied) for t in e.themes]) == (
        "other",
        [("remittance", "down", True)],
    )
