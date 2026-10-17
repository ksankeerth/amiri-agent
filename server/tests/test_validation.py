"""The validator against the sample bank: each planted condition gives the verdict a correct validator
should give (confirms, contradicts, no effect, insufficient data, masked, not yet, error), with the
numbers it rests on; and the tick judges an investigation's tasks once validation is on."""

from datetime import date

import httpx
import pytest

from app import spec
from app.connect.client import InstitutionData
from app.validation import explain, validate
from app.validation.contract import ValidationTask
from app.validation.history import MemoryHistory
from app.validation.reader import RunReader
from tests.test_institutions_api import seed

ME = {"X-Amiri-Actor": "admin@x"}
TODAY = date(2026, 10, 7)  # the test clock


def thresholds(category: str, metric: str, expect: str, size: str = "small") -> list[dict]:
    """The spec's threshold set, signed by the expected direction (as the investigation does it)."""
    m = next(x for x in spec.metrics(category) if x["key"] == metric)
    sign, op = (1, ">=") if expect == "rise" else (-1, "<=")
    out = []
    for stat, v in m["validation"]["thresholds"][size].items():
        out.append({"statistic": stat, "op": op, "value": (100 - v if expect == "rise" else v) if stat == "percentile"
                    else v * sign})
    return out


def task(product: str, category: str, metric: str, expect: str, watch: tuple[str, str], baseline: tuple[str, str],
         filter: dict | None = None, adverse: str | None = None, tid: str = "vt-test-1") -> ValidationTask:
    m = next(x for x in spec.metrics(category) if x["key"] == metric)
    v = m["validation"]
    basis = {"seasonal_ratio": "rolling_seasonal_ratio", "recent_vs_prior": "aligned_prior_spans",
             "level_change": "anchor_level", "trend": "baseline_slope"}[v["method"]]
    return ValidationTask.model_validate({
        "task_id": tid, "hypothesis_id": "hy-test-1", "event_id": "ev-test-1", "finding_ids": ["fd-test-1"],
        "data_source_id": "sample-bank", "product_id": product, "metric": metric, "unit": m["unit"],
        "aggregation": m["kind"], "filter": filter or {}, "time_zone": "Asia/Colombo",
        "anchor": f"{watch[0]}T03:00:00+00:00",
        "watch": {"from": watch[0], "until": watch[1]},
        "baseline": {"from": baseline[0], "until": baseline[1], "basis": basis},
        "reporting_lag_days": m["max_lag_days"], "method": v["method"],
        "thresholds": thresholds(category, metric, expect), "threshold_set_id": f"{metric}.small",
        "expected_direction": expect, "adverse_direction": adverse or (m["adverse"] or [expect])[0],
        "expected_size": "small", "min_volume": v.get("min_volume"), "owner": "business_credit",
    })


async def reader_for(client, app, conditions=()) -> RunReader:
    r = await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": list(conditions)})
    assert r.status_code == 200, r.text
    await client.put("/api/v1/data-connection", json={"source": "sample", "sample": "bank"})
    data, target, _ = await app.state.data_connection.client()
    return RunReader(data, target)


async def judge(client, app, t: ValidationTask, conditions=(), as_of=TODAY):
    reader = await reader_for(client, app, conditions)
    try:
        return await validate.evaluate(t, as_of, reader, MemoryHistory())
    finally:
        await reader.data.aclose()


LC = {"product": "trade-finance", "category": "trade_finance", "metric": "lc_openings",
          "watch": ("2026-08-17", "2026-09-28"), "baseline": ("2024-08-01", "2026-08-17")}
SLIDE = [{"id": "currency_slide_importers", "start": "2026-08-17", "size": 25}]


@pytest.fixture
async def bank(client):
    await seed(client, "bank-a")  # the installation's bank: the sample is shaped by it


async def test_a_planted_fall_confirms(client, app, bank):
    r = await judge(client, app, task(**LC, expect="fall"), SLIDE)
    assert r.verdict == "confirms", (r.reasons, r.observation)
    assert r.final and r.observed_direction == "fall" and "thresholds_met" in r.reasons
    obs = r.observation
    assert obs.change["pct"] < -15 and all(c.met for c in obs.statistics)
    assert r.alert == "adverse" and r.data["spec_version"] == "1.0.0" and r.data["vintage_rule"] == "same_age"
    assert any(c.tool == "/series" for c in r.tool_trace)  # every number comes from a recorded call
    words = explain.describe(r.model_dump(mode="json"), {"metric": "lc_openings", "filter": {}})
    assert words["line"].startswith("Letters of credit opened: \u221225.1% against the same period last year (usual range ")
    assert words["line"].endswith(": confirms") and words["final"], words["line"]
    assert words["what"] == words["line"].removesuffix(": confirms")
    assert words["checks"] == ["percentile 0, needed 5 or lower: met", "change \u221225.1%, needed \u22125.0% or lower: met"]
    assert words["versions"]["catalog"] == "1.0.0/2026-10-07" and words["versions"]["data"].startswith("as known on 6 Oct 2026")


async def test_the_opposite_expectation_contradicts(client, app, bank):
    r = await judge(client, app, task(**LC, expect="rise", adverse="fall"), SLIDE)
    assert r.verdict == "contradicts", r.reasons
    assert r.alert == "adverse" and r.alert_basis == "unexplained"  # it fell, which is the adverse way


async def test_normal_data_has_no_effect(client, app, bank):
    r = await judge(client, app, task(**LC, expect="fall"))
    assert r.verdict == "no_effect", (r.reasons, r.observation.change if r.observation else None)
    assert any(x.startswith("threshold_not_met") for x in r.reasons) and r.alert == "none"


async def test_remittances_fall_confirms_on_daily_data(client, app, bank):
    t = task(product="inward-remittances", category="remittances", metric="inward_remittances", expect="fall",
             watch=("2026-07-01", "2026-09-01"), baseline=("2024-07-01", "2026-07-01"))
    r = await judge(client, app, t, [{"id": "remittances_fall", "start": "2026-07-01", "size": 12}])
    assert r.verdict == "confirms", (r.reasons, r.observation.change if r.observation else None)
    assert r.observation.watch["per_weekday"] is True  # a month of daily flows compared per weekday


async def test_one_obligor_driving_the_move_is_insufficient(client, app, bank):
    t = task(product="sme-loans", category="business_loan", metric="facility_utilization", expect="rise",
             watch=("2026-08-31", "2026-09-28"), baseline=("2026-08-17", "2026-08-31"))
    r = await judge(client, app, t, [{"id": "dominant_obligor", "start": "2026-08-31", "size": 3.4}])
    assert r.verdict == "insufficient_data" and "dominated" in r.reasons, r.reasons
    assert explain.describe(r.model_dump(mode="json"), {"metric": "facility_utilization"})["line"] == (
        "Credit-line utilisation: not enough data (one customer drives most of the move)")
    assert r.attention == "dominated" and r.observation is None  # the numbers aren't shown when one obligor drives them
    assert r.data["top_share_band"] == "from_0.8"


async def test_relief_masks_collections(client, app, bank):
    t = task(product="personal-loans", category="retail_loan", metric="installment_collection_rate", expect="fall",
             watch=("2026-08-24", "2026-09-28"), baseline=("2026-08-10", "2026-08-24"))
    r = await judge(client, app, t, [{"id": "floods", "start": "2026-08-24"}])
    assert r.verdict == "masked", r.reasons
    assert "relief_period" in r.reasons or "masked" in r.reasons
    assert r.attention == "relief_active"
    assert any(m.get("triggered") for m in r.data["masking"])


async def test_too_few_customers_is_insufficient(client, app, bank):
    t = task(product="vehicle-leasing", category="vehicle_finance", metric="installment_collection_rate", expect="fall",
             watch=("2026-08-31", "2026-09-28"), baseline=("2026-08-17", "2026-08-31"))
    r = await judge(client, app, t, [{"id": "few_customers"}])
    assert r.verdict == "insufficient_data" and "suppressed" in r.reasons, r.reasons


async def test_not_yet_published(client, app, bank):
    rr = {"product": "personal-loans", "category": "retail_loan", "metric": "roll_rate_to_30", "expect": "rise",
              "watch": ("2026-07-01", "2026-09-01"), "baseline": ("2025-07-01", "2026-07-01")}
    late = await judge(client, app, task(**rr), [{"id": "reporting_lag"}])
    assert late.verdict == "not_yet" and "not_published" in late.reasons, late.reasons
    assert late.next_check_after and late.next_check_reason == "next_period"
    on_time = await judge(client, app, task(**rr))
    assert on_time.verdict != "not_yet"
    future = await judge(client, app, task(**{**LC, "watch": ("2026-10-12", "2026-11-09"),
                                              "baseline": ("2024-10-01", "2026-10-12")}, expect="fall"))
    assert future.verdict == "not_yet" and "watch_not_started" in future.reasons


async def test_unreachable_is_a_transient_error():
    def refuse(request):
        raise httpx.ConnectError("refused")
    reader = RunReader(InstitutionData("http://bank.test/metrics/v1", transport=httpx.MockTransport(refuse)), "bank.test")
    r = await validate.evaluate(task(**LC, expect="fall"), TODAY, reader, MemoryHistory())
    assert r.verdict == "error" and r.error_kind == "transient" and "source_unreachable" in r.reasons
    assert r.next_check_after == date(2026, 10, 8) and r.next_check_reason == "transient_error"


async def test_a_metric_the_catalog_lacks_is_a_permanent_error(client, app, bank):
    r = await judge(client, app, task(**{**LC, "product": "no-such-product"}, expect="fall"))
    assert r.verdict == "error" and r.error_kind == "permanent" and "metric_dropped" in r.reasons


async def test_the_tick_judges_an_investigations_tasks(client, app, bank, sql, env):
    t = task(**LC, expect="fall", tid="vt-run1-1")
    await sql("""INSERT INTO cases.investigations (run_id, institution_id, world, status, trigger, finding_ids, validation,
                   request, created_at) VALUES ('run1', 'bank-a', 'live', 'completed', 'tick', '{fd-test-1}', true, '{}', now())""")
    await sql("""INSERT INTO cases.events (event_id, run_id, institution_id, world, title, themes, country, anchor,
                   anchor_basis, finding_ids, created_at, open_until)
                 VALUES ('ev-test-1', 'run1', 'bank-a', 'live', 'Rupee slides', '[]', 'Sri Lanka', now(), 'finding',
                   '{fd-test-1}', now(), now())""")
    await sql("""INSERT INTO cases.hypotheses (hypothesis_id, event_id, run_id, product_id, product_type, angle,
                   mechanism_id, chain_label, statement, expected)
                 VALUES ('hy-test-1', 'ev-test-1', 'run1', 'trade-finance', 'import_lc', 'volume', 'm1', 'chain',
                   'Importers open fewer LCs', '{}')""")
    from psycopg.types.json import Jsonb
    await sql("""INSERT INTO cases.validation_tasks (task_id, hypothesis_id, event_id, run_id, task, created_at)
                 VALUES ('vt-run1-1', 'hy-test-1', 'ev-test-1', 'run1', %s, now())""",
              (Jsonb(t.model_dump(mode="json", by_alias=True)),))
    await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": SLIDE})
    await client.put("/api/v1/data-connection", json={"source": "sample", "sample": "bank"}, headers=ME)
    step = next(s for s in (await client.post("/internal/tick")).json()["ran"] if s["step"] == "validate")
    assert step["evaluated"] == 0 and step["skipped"]  # validation isn't on yet
    await client.post("/api/v1/data-connection:check", headers=ME)
    await client.post("/api/v1/data-connection:approve", headers=ME)
    env.setenv("METRICS_VALIDATION", "on")
    assert (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()["validation_enabled"]
    step = next(s for s in (await client.post("/internal/tick")).json()["ran"] if s["step"] == "validate")
    assert step["evaluated"] == 1 and step["verdicts"] == {"confirms": 1}, step
    items = (await client.get("/api/v1/validation/verdicts", params={"event_id": "ev-test-1"})).json()["items"]
    assert items[0]["verdict"] == "confirms" and items[0]["latest"]["observation"]["change"]["pct"] < -15
    rows = await sql("SELECT status, next_check_after, final FROM cases.validation_tasks WHERE task_id = 'vt-run1-1'")
    assert rows[0]["final"] is True and rows[0]["next_check_after"] > TODAY  # re-checked at stable age
    again = next(s for s in (await client.post("/internal/tick")).json()["ran"] if s["step"] == "validate")
    assert again["due"] == 0  # nothing due until then
    n = await sql("SELECT count(*) AS n FROM cases.validation_evaluations")
    assert n[0]["n"] == 1
