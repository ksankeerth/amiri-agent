"""Statistics, the period grid, snapping, publication, thresholds (ported with the validator)."""

import math
from datetime import date, timedelta

import pytest

from app.validation import stats
from app.validation.contract import Threshold
from app.validation.periods import grid, published, snap
from app.validation.validate import mirror, tighten

# ------------------------------------------------------------------ stats


@pytest.mark.parametrize(
    ("t", "df", "cdf"),
    [
        (0.0, 5, 0.5),
        (2.228139, 10, 0.975),
        (-1.812461, 10, 0.05),
        (2.200985, 11, 0.975),
    ],
)
def test_t_cdf_matches_tables(t, df, cdf):
    assert stats.t_cdf(t, df) == pytest.approx(cdf, abs=1e-6)


def test_the_design_example_recomputes():
    """The design's worked example: 1342 / (1395 x 1.041) = 0.924 (-7.6%), percentile 1.5 (t, n=12)."""
    r = 1342 / (1395 * 1.041)
    assert round((r - 1) * 100, 1) == -7.6
    t = (math.log(r) - 0.002) / (0.031 * math.sqrt(1 + 1 / 12))
    assert round(100 * stats.t_cdf(t, 11), 1) == 1.5


def test_wilson_and_newcombe_catch_one_cheque_in_eleven():
    lo, hi = stats.wilson(1, 11)
    assert lo == pytest.approx(0.0162, abs=1e-3) and hi == pytest.approx(
        0.3775, abs=1e-3
    )
    d_lo, d_hi = stats.newcombe_difference(0, 14, 1, 11)
    assert d_lo < 0 < d_hi  # N5: the change can't be told from zero


def test_t_prediction_is_wider_than_the_empirical_tail_for_small_samples():
    sample = [0.01 * i for i in range(-4, 5)]
    assert (
        stats.t_prediction_percentile(0.05, sample)
        > stats.empirical_percentile(0.05, sample) - 30
    )


# ---------------------------------------------------------------- periods


def _calendar(start: date, days: int) -> dict[date, dict]:
    return {
        start + timedelta(days=i): {"business": (start + timedelta(days=i)).weekday() < 5,
                                    "flags": [], "holidays": []}
        for i in range(days)
    }  # fmt: skip


CAL = _calendar(date(2026, 9, 1), 200)


def test_weekly_watch_snaps_from_the_anchor_week_if_it_starts_early():
    # Tue 6 Oct 2026 is early in its week: watch from Mon 5 Oct.
    assert snap(date(2026, 10, 6), date(2026, 11, 17), "weekly", CAL) == (
        date(2026, 10, 5), date(2026, 11, 16))  # fmt: skip
    # Wed 7 Oct is not: from Mon 12 Oct.
    assert snap(date(2026, 10, 7), date(2026, 11, 17), "weekly", CAL)[0] == date(
        2026, 10, 12
    )


def test_monthly_watch_snaps_to_whole_months():
    # V8: 7 Oct is past the 3rd, so the watch starts in November.
    assert snap(date(2026, 10, 7), date(2027, 1, 1), "monthly", CAL) == (
        date(2026, 11, 1), date(2027, 1, 1))  # fmt: skip
    # V9: 7 Oct - 7 Jan keeps November and December only.
    assert snap(date(2026, 10, 7), date(2027, 1, 7), "monthly", CAL) == (
        date(2026, 11, 1), date(2027, 1, 1))  # fmt: skip
    assert snap(date(2026, 10, 2), date(2026, 10, 20), "monthly", CAL) is None


def test_publication_is_the_last_day_plus_the_lag():
    assert published(date(2026, 10, 1), 10) == date(2026, 10, 10)  # V8: September
    assert published(date(2026, 9, 1), 15) == date(2026, 9, 15)  # V4: August


def test_daily_grid_is_business_days():
    days = grid("daily", date(2026, 10, 2), date(2026, 10, 7), CAL)
    assert [d for d, _ in days] == [
        date(2026, 10, 2),
        date(2026, 10, 5),
        date(2026, 10, 6),
    ]


# ------------------------------------------------------------- thresholds


def test_provisional_thresholds_are_stricter_and_mirrors_flip():
    p5 = Threshold(statistic="percentile", op="<=", value=5)
    assert tighten(p5).value == 2.5
    assert tighten(Threshold(statistic="percentile", op=">=", value=95)).value == 97.5
    assert tighten(
        Threshold(statistic="robust_z", op=">=", value=3)
    ).value == pytest.approx(3.5)
    assert mirror(p5) == Threshold(statistic="percentile", op=">=", value=95)
    pct = Threshold(statistic="pct_change", op="<=", value=-5)
    assert mirror(pct) == Threshold(statistic="pct_change", op=">=", value=5)


# ------------------------------------------------------------------ level_change's statistic


def _monthly(kind: str, values: dict[str, float]):
    from app.validation.periods import Point, Series
    days = [date(2024, 1, 1) + timedelta(days=i) for i in range(3 * 366)]
    cal = {d: {"business": d.weekday() < 5} for d in days}
    pts = {}
    for start, v in values.items():
        a = date.fromisoformat(start)
        b = date(a.year + (a.month == 12), a.month % 12 + 1, 1)
        pts[a] = Point(start=a, until=b, value=v, numerator=None, denominator=None, volume=500, top_share=0.1,
                       suppressed=False, published_at=b, data_as_of=b, vintage="latest", revised=False)
    return Series(kind, "monthly", cal, pts)


@pytest.mark.parametrize(("kind", "stat", "key", "change"), [
    ("stock", "pct_change", "pct", -10.0),  # a savings balance: 1000 -> 900 is -10%
    ("level", "pp_change", "pp", -100.0),   # a return in percent moves in points
    ("stock", None, "pct", -10.0),          # without thresholds: a stock still moves in percent
])
def test_level_change_measures_as_the_thresholds_say(kind, stat, key, change):
    from app.validation import methods
    months = [f"{y}-{m:02d}-01" for y in (2024, 2025, 2026) for m in range(1, 13)][:33]  # to Sep 2026
    s = _monthly(kind, {**dict.fromkeys(months, 1000.0), "2026-09-01": 900.0})
    out = methods.level_change(methods.MethodInput(series=s, watch=(date(2026, 9, 1), date(2026, 10, 1)),
                                                   expected_direction="fall", provisional=False, change_statistic=stat))
    assert key in out.change and round(out.change[key], 2) == change, (out.change, out.reasons)
