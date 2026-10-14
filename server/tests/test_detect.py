"""The detector's arithmetic, on hand-made bars."""

import math
from datetime import UTC, datetime, timedelta

from app.series import detect

P = detect.Params(z_threshold=3, sigma_days=60, min_sigma_days=20, windows_days=[1, 3])


def days_of_bars(daily_changes: list[float], per_day: int = 24, start=datetime(2026, 6, 1, tzinfo=UTC)):
    """Bars whose daily closes follow daily_changes (log), flat within each day."""
    bars, price, t = [], 100.0, start
    for ch in daily_changes:
        price *= math.exp(ch)
        for h in range(per_day):
            bars.append((t + timedelta(hours=h), price))
        t += timedelta(days=1)
    return bars


def test_sigma_and_z_follow_the_formula():
    alt = [0.01 if i % 2 else -0.01 for i in range(40)]
    bars = days_of_bars(alt)
    d = detect.evaluate(bars, P, "X")
    rets = alt[1:-1]  # completed days only; the first day has no prior close
    sigma = math.sqrt(sum((r - sum(rets) / len(rets)) ** 2 for r in rets) / (len(rets) - 1))
    assert abs(d["sigma_daily"] - sigma) < 1e-12
    assert d["bars_per_day"] == 24
    w1 = d["windows"][0]
    assert w1["days"] == 1 and abs(w1["z"] - math.log(bars[-1][1] / bars[-25][1]) / sigma) < 1e-3


def test_fires_on_a_large_move_and_warms_up_on_short_history():
    calm = [0.002 if i % 2 else -0.002 for i in range(40)]
    d = detect.evaluate(days_of_bars([*calm, 0.03]), P, "X")
    assert d["fires"] and d["max"]["days"] == 1 and d["max"]["z"] > 3
    d = detect.evaluate(days_of_bars(calm[:10]), P, "X")
    assert d["warming_up"] and d["reason"] == "too_few_days" and not d["fires"]
    d = detect.evaluate(days_of_bars([0.0] * 30), P, "X")
    assert d["warming_up"] and d["reason"] == "no_movement"
    assert detect.evaluate([], P, "X")["reason"] == "no_data"


def test_session_markets_count_bars_not_hours():
    calm = [0.002 if i % 2 else -0.002 for i in range(40)]
    d = detect.evaluate(days_of_bars(calm, per_day=7), P, "X")
    assert d["bars_per_day"] == 7 and d["windows"][0]["bars"] == 7


def test_weekday_hours_skip_weekends():
    fri = datetime(2026, 10, 2, 21, tzinfo=UTC)
    mon = datetime(2026, 10, 5, 2, tzinfo=UTC)
    assert detect.weekday_hours_between(fri, mon) == 3 + 2
    assert detect.weekday_hours_between(mon, fri) == 0


def test_finding_text_and_score():
    calm = [0.002 if i % 2 else -0.002 for i in range(40)]
    d = detect.evaluate(days_of_bars([*calm, -0.03]), P, "USD/LKR")
    title, text, _ = detect.finding_text("USD/LKR", d, 3)
    assert title.startswith("USD/LKR down 2.96% in 1 trading day (")
    assert "A typical trading day moves" in text and "it fires at 3" in text
    assert detect.score(3, 3) == 50 and detect.score(6, 3) == 100 and detect.score(-4.5, 3) == 75
