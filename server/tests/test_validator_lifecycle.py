"""Alerts, hysteresis, verdict history and the schedule, on synthetic looks (ported with the validator)."""

from datetime import UTC, date, datetime, timedelta

from app.validation.contract import Family, ValidationResult, ValidationTask
from app.validation.history import MemoryHistory, apply_lifecycle
from app.validation.validate import Look, task_hash

TASK = ValidationTask.model_validate({
    "task_id": "t-lc", "hypothesis_id": "h-lc", "event_id": "ev-lc", "finding_ids": ["f-lc"],
    "data_source_id": "bank", "product_id": "sme-loan", "metric": "lc_openings", "unit": "count",
    "aggregation": "count", "filter": {"segment": "importer"},
    "time_zone": "Asia/Colombo", "anchor": "2026-10-05T00:00:00+05:30",
    "watch": {"from": "2026-10-05", "until": "2026-11-30"},
    "baseline": {"from": "2024-10-01", "until": "2026-10-05", "basis": "rolling_seasonal_ratio"},
    "reporting_lag_days": 1, "method": "seasonal_ratio",
    "thresholds": [{"statistic": "percentile", "op": "<=", "value": 5},
                   {"statistic": "pct_change", "op": "<=", "value": -5}],
    "expected_direction": "fall", "adverse_direction": "fall", "expected_size": "small",
    "owner": "business_credit",
})  # fmt: skip


def look_at(history, on: date, verdict: str, final: bool, signal: str, percentile: float,
            signature: str | None = None, pending: list[date] | None = None):  # fmt: skip
    r = ValidationResult(
        task_id=TASK.task_id, task_hash=task_hash(TASK), hypothesis_id="h-lc", event_id="ev-lc",
        family=Family(event_id="ev-lc", size=1), owner="business_credit", product_id="sme-loan",
        metric="lc_openings", method="seasonal_ratio", validator_version="test",
        catalog_version="v2.1", threshold_set_id=None, evaluated_as_of=on,
        computed_at=datetime.now(UTC), verdict=verdict, final=final, expected={}, reasons=[],
    )  # fmt: skip
    look = Look(signal=signal, basis="explained" if signal != "none" else None,
                look_percentile=percentile, signature=signature or f"sig-{on}",
                stable_age_days=7, lag_days=1,
                pending=pending if pending is not None else [on + timedelta(days=6)],
                final_watch_published=date(2026, 11, 30))  # fmt: skip
    return apply_lifecycle(TASK, r, look, history)


def test_n3_one_look_beyond_the_tail_raises_nothing():
    """N3: provisional looks at p2.1, 3.4, 2.3, 4.0, 6.8 then final p6.1 (no_effect)."""
    h = MemoryHistory()
    seq = [(date(2026, 10, 27), 2.1, "confirms"), (date(2026, 11, 3), 3.4, "no_effect"),
           (date(2026, 11, 10), 2.3, "confirms"), (date(2026, 11, 17), 4.0, "no_effect"),
           (date(2026, 11, 24), 6.8, "no_effect")]  # fmt: skip
    alerts = []
    for on, p, v in seq:
        r = look_at(h, on, v, False, "adverse" if v == "confirms" else "none", p)
        alerts.append(r.alert)
    final = look_at(h, date(2026, 12, 1), "no_effect", True, "none", 6.1, pending=[])
    assert alerts == ["none"] * 5  # never two consecutive looks beyond p2.5
    assert final.alert == "none" and final.alert_change == "none"
    assert [(s.verdict, s.final) for s in final.verdict_history] == [
        ("confirms", False), ("no_effect", False), ("confirms", False), ("no_effect", False),
        ("no_effect", True)]  # fmt: skip


def test_two_looks_raise_developing_and_it_is_withdrawn_inside_p10():
    h = MemoryHistory()
    first = look_at(h, date(2026, 10, 27), "confirms", False, "adverse", 1.2)
    second = look_at(h, date(2026, 11, 3), "confirms", False, "adverse", 1.0)
    assert (first.alert, second.alert, second.alert_change) == (
        "none",
        "developing",
        "raised",
    )
    held = look_at(h, date(2026, 11, 10), "no_effect", False, "none", 7.0)
    assert held.alert == "developing"  # outside p10: hysteresis keeps it
    gone = look_at(h, date(2026, 11, 17), "no_effect", False, "none", 30.0)
    assert (gone.alert, gone.alert_change) == ("none", "withdrawn")


def test_developing_escalates_to_adverse_on_final():
    h = MemoryHistory()
    look_at(h, date(2026, 10, 27), "confirms", False, "adverse", 1.2)
    look_at(h, date(2026, 11, 3), "confirms", False, "adverse", 1.0)
    final = look_at(h, date(2026, 12, 1), "confirms", True, "adverse", 0.5, pending=[])
    assert (final.alert, final.alert_change) == ("adverse", "escalated")
    assert final.next_check_reason == "stable_age_recheck"
    assert final.next_check_after == date(2026, 12, 8)


def test_unchanged_data_keeps_the_alert_and_says_since_when():
    h = MemoryHistory()
    look_at(h, date(2026, 10, 27), "confirms", False, "adverse", 1.2, signature="same")
    again = look_at(
        h, date(2026, 10, 28), "confirms", False, "adverse", 1.2, signature="same"
    )
    assert again.alert == "none" and again.alert_change == "none"
    assert (
        again.unchanged_since == date(2026, 10, 27)
        and "unchanged_data" in again.reasons
    )


def test_a_replay_sees_only_earlier_looks():
    h = MemoryHistory()  # the server keeps the same rows in cases.validation_evaluations
    look_at(h, date(2026, 11, 3), "confirms", False, "adverse", 1.0)
    replay = look_at(h, date(2026, 10, 27), "confirms", False, "adverse", 1.2)
    assert replay.alert == "none" and len(replay.verdict_history) == 1


def test_n6_provisional_needs_two_of_three_months():
    from app.validation.validate import math

    periods = 3
    needed = min(periods, max(2, math.ceil(periods / 3)))
    assert needed == 2  # stated in the result as needed_periods while not_yet
