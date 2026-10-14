"""Abnormal-move detection for a market series. Pure code, no model.

From closed hourly bars:
- a trading day is a UTC date with bars; its close is its last bar's close;
- the typical daily move (sigma) is the standard deviation of daily log changes
  over the last `sigma_days` completed trading days;
- for each window of L trading days (L x bars-per-day bars back),
  z = ln(close now / close then) / (sigma x sqrt(L));
- the series fires when the largest |z| reaches `z_threshold`.

Windows count bars, not calendar hours, so weekends and overnight closes don't
inflate a move.
"""

import itertools
import math
import statistics
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

BAR = timedelta(hours=1)


@dataclass(frozen=True)
class Params:
    z_threshold: float
    sigma_days: int
    min_sigma_days: int
    windows_days: list[int]


def daily_closes(bars: list[tuple[datetime, float]]) -> "OrderedDict[date, float]":
    out: OrderedDict[date, float] = OrderedDict()
    for ts, close in bars:
        out[ts.astimezone(UTC).date()] = close
    return out


def bars_per_day(bars: list[tuple[datetime, float]]) -> int:
    counts: OrderedDict[date, int] = OrderedDict()
    for ts, _ in bars:
        d = ts.astimezone(UTC).date()
        counts[d] = counts.get(d, 0) + 1
    full = list(counts.values())[1:-1]  # first and last days may be partial
    if not full:
        return 24
    return max(1, round(statistics.median(full)))


def evaluate(bars: list[tuple[datetime, float]], p: Params, name: str) -> dict:
    """Evaluates the latest bar. `bars` are closed bars, oldest first."""
    if not bars:
        return {"warming_up": True, "reason": "no_data", "windows": [], "spark": []}
    ts_last, close_last = bars[-1]
    closes = daily_closes(bars)
    days = list(closes.items())
    completed = days[:-1]  # the latest day may still be trading
    rets = [
        math.log(b / a)
        for (_, a), (_, b) in itertools.pairwise(completed)
        if a > 0 and b > 0
    ][-p.sigma_days :]
    bpd = bars_per_day(bars)
    sigma = statistics.stdev(rets) if len(rets) >= 2 else 0.0
    out: dict = {
        "bar_ts": ts_last.isoformat(),
        "bar_end": (ts_last + BAR).isoformat(),
        "close": close_last,
        "bars_per_day": bpd,
        "sigma_days_used": len(rets),
        "sigma_daily": sigma,
        "typical_daily_move_pct": round((math.exp(sigma) - 1) * 100, 4) if sigma else None,
        "spark": [{"date": d.isoformat(), "close": c} for d, c in days[-14:]],
        "windows": [],
        "warming_up": False,
        "reason": None,
        "max": None,
        "fires": False,
    }
    for L in p.windows_days:
        n = L * bpd
        if len(bars) <= n:
            continue
        ref_ts, ref_close = bars[-1 - n]
        if ref_close <= 0:
            continue
        change = math.log(close_last / ref_close)
        z = change / (sigma * math.sqrt(L)) if sigma > 0 else None
        out["windows"].append({
            "days": L,
            "bars": n,
            "ref_ts": ref_ts.isoformat(),
            "ref_close": ref_close,
            "change_pct": round((close_last / ref_close - 1) * 100, 4),
            "z": round(z, 3) if z is not None else None,
        })
    one = next((w for w in out["windows"] if w["days"] == 1), None)
    out["change_1d_pct"] = one["change_pct"] if one else None
    if len(rets) < p.min_sigma_days:
        out["warming_up"] = True
        out["reason"] = "too_few_days"
        return out
    if sigma == 0:
        out["warming_up"] = True
        out["reason"] = "no_movement"
        return out
    scored = [w for w in out["windows"] if w["z"] is not None]
    if scored:
        top = max(scored, key=lambda w: abs(w["z"]))
        out["max"] = {"days": top["days"], "z": top["z"]}
        out["fires"] = abs(top["z"]) >= p.z_threshold
    out["name"] = name
    return out


def weekday_hours_between(a: datetime, b: datetime) -> float:
    """Hours from a to b, not counting Saturdays and Sundays (UTC)."""
    if b <= a:
        return 0.0
    total = 0.0
    cur = a
    while cur < b:
        day_end = datetime.combine(cur.date() + timedelta(days=1), datetime.min.time(), UTC)
        seg_end = min(day_end, b)
        if cur.weekday() < 5:
            total += (seg_end - cur).total_seconds() / 3600
        cur = seg_end
    return total


def stale_hours(last_bar_end: datetime, now: datetime, around_the_clock: bool, crypto: bool) -> float:
    """How long without a new bar, as the staleness rule counts it."""
    if crypto:
        return max(0.0, (now - last_bar_end).total_seconds() / 3600)
    return weekday_hours_between(last_bar_end, now)


def _local(t: datetime, tz: str) -> str:
    """A time as the page shows times: in the institution's zone, no zone name (UTC says so)."""
    from zoneinfo import ZoneInfo

    return f"{t:%d %b %H:%M} UTC" if tz == "UTC" else t.astimezone(ZoneInfo(tz)).strftime("%d %b %H:%M")


def finding_text(name: str, d: dict, threshold: float, tz: str = "UTC") -> tuple[str, str, dict]:
    """Title and explanation of a fired move (templates, no model), plus its window."""
    w = next(x for x in d["windows"] if x["days"] == d["max"]["days"])
    up = w["change_pct"] > 0
    L = w["days"]
    span = "1 trading day" if L == 1 else f"{L} trading days"
    z = abs(w["z"])
    end = datetime.fromisoformat(d["bar_end"])
    ref = datetime.fromisoformat(w["ref_ts"]) + BAR
    title = f"{name} {'up' if up else 'down'} {abs(w['change_pct']):.2f}% in {span} ({z:.1f}x typical)"
    explanation = (
        f"{name} was {fmt(d['close'])} at {_local(end, tz)}, "
        f"{'up' if up else 'down'} {abs(w['change_pct']):.2f}% from {fmt(w['ref_close'])} "
        f"at {_local(ref, tz)}. A typical trading day moves "
        f"{d['typical_daily_move_pct']:.2f}%, so a {span} move this size is "
        f"{z:.1f} times typical (it fires at {threshold:g})."
    )
    return title, explanation, w


def signal_description(name: str, d: dict, w: dict, tz: str = "UTC") -> str:
    """One line for the finding's signal evidence (template)."""
    up = w["change_pct"] > 0
    span = "1 trading day" if w["days"] == 1 else f"{w['days']} trading days"
    end = datetime.fromisoformat(d["bar_end"])
    return (f"{name} {'rose' if up else 'fell'} from {fmt(w['ref_close'])} to {fmt(d['close'])} "
            f"({w['change_pct']:+.2f}%) over {span} to {_local(end, tz)}, "
            f"{abs(w['z']):.1f}x its typical move.")


def fmt(x: float) -> str:
    return f"{x:,.4f}".rstrip("0").rstrip(".") if abs(x) < 10 else f"{x:,.2f}"


def score(z: float, threshold: float) -> int:
    """50 at the threshold, 100 at twice the threshold."""
    return max(0, min(100, round(50 + 50 * (abs(z) - threshold) / threshold)))
