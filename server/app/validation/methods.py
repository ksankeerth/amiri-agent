"""The four test methods. Code only; every number is traceable.

Each method takes a MethodInput (the series, the snapped watch, the break
rules, the thresholds) and returns a MethodOutput: the statistics, what they
were compared with, the placebo values (the same statistics at on-grid dates in
the past 24 months with no event), and any reason it couldn't judge.

Common rules:
- A comparison uses only data on or after `regime_start` (the last lasting break
  before the watch) and touching no episode (floods, relief).
- Percentiles are empirical when n_eff ≥ 20 (≥ 40 for a provisional look),
  otherwise from a t prediction interval on non-overlapping spans.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import fmean, median, stdev
from typing import Any

from app.validation import stats
from app.validation.contract import Threshold
from app.validation.periods import DAY, WEEK, Agg, Series, add_months, period_start

HISTORY_MONTHS = (
    24  # distributions and placebos come from the 24 months before the watch
)
MIN_NON_OVERLAPPING = 6
PRIOR_SPANS = 8
GROWTH_MONTHS = 3
POSITION_TOLERANCE = 3  # business days, for "the same position in the month"


@dataclass
class MethodInput:
    series: Series
    watch: tuple[date, date]  # snapped; for a provisional look, the published part
    expected_direction: str
    provisional: bool
    regime_start: date | None = None
    episodes: list[tuple[date, date]] = field(default_factory=list)
    growth_end: date | None = None  # seasonal_ratio: min(watch start, announcement)
    min_base: float | None = None
    counts: bool = False
    min_denominator: float | None = None
    change_statistic: str | None = None  # level_change: pct_change or pp_change, as the task's thresholds name it


@dataclass
class MethodOutput:
    values: dict[str, float | None] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)
    implicit: list[Threshold] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    watch: dict[str, Any] = field(default_factory=dict)
    baseline: dict[str, Any] = field(default_factory=dict)
    change: dict[str, Any] = field(default_factory=dict)
    placebo_values: list[dict[str, float | None]] = field(default_factory=list)
    p_value: float | None = None
    look_percentile: float | None = None  # for alert hysteresis
    observed_direction: str | None = None
    dominance_windows: tuple[tuple[date, date], tuple[date, date]] | None = None


def _clean(x: MethodInput, start: date, end: date) -> bool:
    """Data from start to end may be used: after the regime start, clear of episodes."""
    if x.regime_start and start < x.regime_start:
        return False
    return not any(e0 < end and start < e1 for e0, e1 in x.episodes)


def _direction(change: float | None) -> str | None:
    if change is None:
        return None
    return "rise" if change > 0 else "fall" if change < 0 else "flat"


def _percentile(
    value: float,
    sample: list[float],
    independent: list[float],
    n_eff: float,
    provisional: bool,
) -> tuple[float | None, str]:
    need = 40 if provisional else 20
    if n_eff >= need and sample:
        return stats.empirical_percentile(value, sample), "empirical"
    return stats.t_prediction_percentile(value, independent), "t_prediction"


def _non_overlapping(
    starts: list[tuple[date, Any]], length: Callable[[date], date]
) -> list[Any]:
    """From the most recent back: keep a span only if it ends on or before the last kept start."""
    kept, last = [], None
    for s, v in sorted(starts, key=lambda t: t[0], reverse=True):
        if last is None or length(s) <= last:
            kept.append(v)
            last = s
    return kept


def _p_value(value: float, sample: list[float], expected: str) -> float | None:
    if not sample:
        return None
    hits = sum(1 for s in sample if (s <= value if expected == "fall" else s >= value))
    return hits / len(sample)


def _base_size(agg: Agg, kind: str) -> float:
    if kind in ("ratio", "rate"):
        return agg.numerator or 0.0
    if kind == "count":
        return agg.value * (agg.weekdays if agg.weekdays else 1)
    return float(agg.volume_min)


def _spills(series: Series, a: date, b: date) -> bool:
    """Holiday flows cross the window's edges: a weekday holiday just before `b` is
    booked on the first business day after it, or one just before `a` lands inside."""
    for edge in (a, b):
        for i in range(1, 6):
            d = edge - timedelta(days=i)
            info = series.calendar.get(d)
            if info is None or d.weekday() >= 5 or info.get("business"):
                continue
            nxt = series.business_days_from(d, 1)
            if nxt and nxt[0] >= edge:
                return True
    return False


def _alignment(series: Series, a: date, b: date, back: Callable[[date], date]) -> float:
    days = (b - a).days
    if not days:
        return 1.0
    same = 0
    for i in range(days):
        d = a + timedelta(days=i)
        here, there = series.calendar.get(d, {}), series.calendar.get(back(d), {})
        same += here.get("business") == there.get("business")
    return round(same / days, 3)


# ---------------------------------------------------------------- seasonal_ratio


def seasonal_ratio(x: MethodInput) -> MethodOutput:
    out = MethodOutput()
    s_ = x.series
    a, b = x.watch
    monthly = a.day == 1 and b.day == 1 and s_.grain in ("monthly", "daily")
    if monthly:
        months = (b.year - a.year) * 12 + b.month - a.month

        def back(d: date) -> date:
            return add_months(d, -12)

        def span_end(s: date) -> date:
            return add_months(s, months)

        def growth_start(e: date) -> date:
            return add_months(e, -GROWTH_MONTHS)

        starts = [add_months(a, -k) for k in range(months, HISTORY_MONTHS + 1)]
        step_over_length = 1 / months
    else:
        length = b - a

        def back(d: date) -> date:
            return d - timedelta(days=364)

        def span_end(s: date) -> date:
            return s + length

        def growth_start(e: date) -> date:
            return e - timedelta(weeks=13)

        weeks = max(1, length.days // 7)
        starts = [a - WEEK * k for k in range(weeks, HISTORY_MONTHS * 52 // 12 + 1)]
        step_over_length = 7 / length.days
    s_.per_weekday = s_.grain == "daily" and monthly
    grows = s_.kind in ("flow", "count")

    def ratio(s: date, e: date, g_end: date) -> tuple[str, dict[str, Any] | None]:
        cur, prev = s_.window(s, e), s_.window(back(s), back(e))
        earliest = back(s)
        g = 1.0
        if grows:
            g0 = growth_start(g_end)
            gc, gp = s_.window(g0, g_end), s_.window(back(g0), back(g_end))
            earliest = min(earliest, back(g0))
            if gc is None or gp is None or not gp.value:
                cur = None if gc is None or gp is None else cur
                g = None  # type: ignore[assignment]
            else:
                g = gc.value / gp.value
        if not _clean(x, earliest, e):
            return "break", None
        if s_.suppressed_in(s, e) or s_.suppressed_in(back(s), back(e)):
            return "suppressed", None
        if cur is None or prev is None or g is None:
            return "missing", None
        if x.min_base is not None and _base_size(prev, s_.kind) < x.min_base:
            return "zero_base", None
        if not prev.value:
            return "zero_base", None
        return "ok", {
            "r": cur.value / (prev.value * g),
            "cur": cur,
            "prev": prev,
            "g": g,
        }

    # The watch itself.
    g_end = min(a, x.growth_end or a)
    status, w = ratio(a, b, g_end)
    if status != "ok":
        out.reasons.append(
            {"break": "break_in_baseline", "missing": "too_few_spans"}.get(
                status, status
            )
        )
        return out

    # The distribution: rolling spans in the prior 24 months.
    spans: list[tuple[date, float]] = []
    dropped = {"break": 0, "suppressed": 0, "missing": 0, "zero_base": 0, "holidays": 0}
    min_align = 1.0
    for s in starts:
        e = span_end(s)
        if e > a:
            continue
        if monthly and (_spills(s_, s, e) or _spills(s_, back(s), back(e))):
            dropped["holidays"] += 1
            continue
        st, v = ratio(s, e, s)
        if st != "ok" or v is None:
            dropped[st] += 1
            continue
        spans.append((s, v["r"]))
        if not monthly:
            min_align = min(min_align, _alignment(s_, s, e, back))
    if dropped["suppressed"] > 0.1 * (len(spans) + dropped["suppressed"]):
        out.reasons.append("suppressed")
    independent = _non_overlapping(spans, span_end)
    n = len(spans)
    n_eff = n * step_over_length
    r_w = w["r"]
    out.watch = {
        "from": a.isoformat(),
        "until": b.isoformat(),
        "periods": w["cur"].periods,
        "value": round(w["cur"].value, 4),
        "per_weekday": s_.per_weekday,
    }
    out.baseline = {
        "basis": "rolling_seasonal_ratio",
        "same_span_last_year": {"from": back(a).isoformat(), "until": back(b).isoformat(),
                                "value": round(w["prev"].value, 4)},
        "growth": {"value": round(w["g"], 4), "window": [growth_start(g_end).isoformat(),
                                                         g_end.isoformat()]} if grows else None,
        "spans": n,
        "n_eff": round(n_eff, 1),
        "non_overlapping": len(independent),
        "dropped": {k: v for k, v in dropped.items() if v},
        "holiday_spill": monthly and (_spills(s_, a, b) or _spills(s_, back(a), back(b))),
        "alignment_score_min": None if monthly else min_align,
        "alignment_score_watch": None if monthly else _alignment(s_, a, b, back),
    }  # fmt: skip
    out.change = {"ratio": round(r_w, 4), "pct": round((r_w - 1) * 100, 2)}
    out.observed_direction = _direction(r_w - 1)
    out.dominance_windows = ((back(a), back(b)), (a, b))
    if len(independent) < MIN_NON_OVERLAPPING:
        out.reasons.append("too_few_spans")
        return out
    logs = [math.log(r) for r in independent if r > 0]
    out.baseline["log_ratio"] = {
        "mean": round(fmean(logs), 4),
        "sd": round(stdev(logs), 4),
    }
    sample = [r for _, r in spans]
    pct, source = _percentile(r_w, sample, independent, n_eff, x.provisional)
    if source == "t_prediction":
        pct = stats.t_prediction_percentile(math.log(r_w), logs)
    out.values = {"percentile": None if pct is None else round(pct, 2),
                  "pct_change": round((r_w - 1) * 100, 2)}  # fmt: skip
    out.sources["percentile"] = source
    out.look_percentile = out.values["percentile"]
    out.p_value = _p_value(r_w, sample, x.expected_direction)
    for i, (_, r) in enumerate(spans):
        others = sample[:i] + sample[i + 1 :]
        if source == "empirical":
            p = stats.empirical_percentile(r, others)
        else:
            p = stats.t_prediction_percentile(math.log(r), logs) if r > 0 else None
        out.placebo_values.append({"percentile": p, "pct_change": (r - 1) * 100})
    return out


# --------------------------------------------------------------- recent_vs_prior


def recent_vs_prior(x: MethodInput) -> MethodOutput:
    out = MethodOutput()
    s_ = x.series
    a, b = x.watch
    days = s_.expected(a, b)
    n_days = len(days)
    if not n_days:
        out.reasons.append("too_few_spans")
        return out

    def span(start: date) -> tuple[date, date] | None:
        ds = s_.business_days_from(start, n_days)
        return (ds[0], ds[-1] + DAY) if len(ds) == n_days else None

    def value(w: tuple[date, date] | None) -> tuple[str, float | None]:
        if w is None:
            return "missing", None
        if not _clean(x, w[0], w[1]):
            return "break", None
        if s_.suppressed_in(*w):
            return "suppressed", None
        agg = s_.window(*w)
        return ("ok", agg.value) if agg else ("missing", None)

    def look(start: date, years: tuple[int, ...]) -> tuple[str, dict[str, Any] | None]:
        """The watch-like window at `start` against its 8 prior spans, adjusted."""
        st, v0 = value(span(start))
        if st != "ok" or v0 is None:
            return st, None
        priors = []
        for k in range(1, PRIOR_SPANS + 1):
            st, v = value(span(add_months(start, -k)))
            if st != "ok" or v is None:
                return "too_few", None
            priors.append(v)
        q = []
        for y in years:
            st, wy = value(span(add_months(start, -12 * y)))
            py = [
                value(span(add_months(start, -12 * y - k)))
                for k in range(1, PRIOR_SPANS + 1)
            ]
            if st == "ok" and wy is not None and all(p[0] == "ok" for p in py):
                q.append(wy / median(p[1] for p in py))  # type: ignore[type-var]
        if not q:
            return "too_few", None
        adj = fmean(q)
        adjusted = [p * adj for p in priors]
        med = median(adjusted)
        floor = max(math.sqrt(med) if s_.kind == "count" else 0.0, 0.01 * med)
        scale = max(1.4826 * stats.mad(adjusted), floor)
        return "ok", {
            "value": v0,
            "median": med,
            "scale": scale,
            "adjustment": adj,
            "years": len(q),
            "z": (v0 - med) / scale if scale else 0.0,
            "pct": (v0 / med - 1) * 100 if med else 0.0,
        }

    status, w = look(a, (1, 2))
    if status != "ok" or w is None:
        out.reasons.append({"break": "break_in_baseline"}.get(status, "too_few_spans")
                           if status != "suppressed" else "suppressed")  # fmt: skip
        return out
    out.watch = {"from": a.isoformat(), "until": b.isoformat(), "business_days": n_days,
                 "value": round(w["value"], 4)}  # fmt: skip
    out.baseline = {
        "basis": "aligned_prior_spans",
        "spans": PRIOR_SPANS,
        "aligned_by": "month position (each span starts k months earlier)",
        "seasonal_adjustment": round(w["adjustment"], 4),
        "adjustment_years": w["years"],
        "median_adjusted": round(w["median"], 4),
        "scale": round(w["scale"], 4),
    }
    out.change = {"pct": round(w["pct"], 2)}
    out.values = {"robust_z": round(w["z"], 3), "pct_change": round(w["pct"], 2)}
    out.look_percentile = round(100 * stats.normal_cdf(w["z"]), 2)
    out.observed_direction = _direction(w["pct"])
    out.dominance_windows = (span(add_months(a, -1)) or (a, b), (a, b))
    zs = []
    for m in range(1, 13):
        st, p = look(add_months(a, -m), (1,))
        if st == "ok" and p is not None:
            out.placebo_values.append({"robust_z": p["z"], "pct_change": p["pct"]})
            zs.append(p["z"])
    out.p_value = _p_value(w["z"], zs, x.expected_direction)
    return out


# ------------------------------------------------------------------ level_change


def _position(s_: Series, p: tuple[date, date]) -> tuple[int | None, bool]:
    """(business days from the month's end of the period's first business day, holds month end)."""
    days = s_.expected(p[0], p[1]) if s_.grain == "daily" else [
        (d, d + DAY) for d in s_.business_days_from(p[0], 7) if d < p[1]
    ]  # fmt: skip
    first = s_.calendar.get(days[0][0]) if days else None
    holds = any("month_end" in s_.calendar.get(d, {}).get("flags", []) for d, _ in days)
    return (first.get("month_bday_from_end") if first else None), holds


def _match(
    s_: Series, anchor: tuple[date, date], candidates: list[tuple[date, date]]
) -> tuple[tuple[date, date] | None, bool]:
    """The latest candidate at the anchor's position in the month."""
    if s_.grain != "weekly":
        return (candidates[-1], True) if candidates else (None, False)
    pa, ha = _position(s_, anchor)
    for c in reversed(candidates):
        pc, hc = _position(s_, c)
        if (
            hc == ha
            and pa is not None
            and pc is not None
            and abs(pc - pa) <= POSITION_TOLERANCE
        ):
            return c, True
    return (candidates[-1], False) if candidates else (None, False)


def level_change(x: MethodInput) -> MethodOutput:
    out = MethodOutput()
    s_ = x.series
    a, b = x.watch
    g = s_.grain
    anchor = (period_start(a - DAY, g), a)
    cands = [p for p in s_.expected(a, b) if p[0] in s_.points]
    target, matched = _match(s_, anchor, cands)
    if target is None:
        out.reasons.append("too_few_spans")
        return out
    pa, pt = s_.points.get(anchor[0]), s_.points[target[0]]
    if pa is None:
        out.reasons.append("too_few_spans")
        return out
    if pa.suppressed or pt.suppressed or pa.value is None or pt.value is None:
        out.reasons.append("suppressed")
        return out
    if not _clean(x, anchor[0], target[1]):
        out.reasons.append("break_in_baseline")
        return out
    # the task's thresholds say how a level moves; without them a rate or ratio moves in points, the rest in percent
    stat = x.change_statistic or ("pp_change" if s_.kind in ("ratio", "rate") else "pct_change")

    def delta(va: float, vt: float) -> float:
        return (vt / va - 1) * 100 if stat == "pct_change" else vt - va

    d = delta(pa.value, pt.value)
    h = len(s_.expected(anchor[0], target[1])) - 1  # periods from anchor to target

    # Same-position changes over the same horizon in the past 24 months.
    history = s_.expected(period_start(add_months(a, -HISTORY_MONTHS), g), anchor[0])
    pairs: list[tuple[date, float]] = []
    for i, a2 in enumerate(history):
        near = (
            history[i + max(1, h - 1) : i + h + 2]
            if g == "weekly"
            else history[i + h : i + h + 1]
        )
        t2, ok = _match(s_, a2, near)
        if t2 is None or not ok:
            continue
        p1, p2 = s_.points.get(a2[0]), s_.points.get(t2[0])
        if (
            p1 and p2 and not p1.suppressed and not p2.suppressed
            and p1.value is not None and p2.value is not None and _clean(x, a2[0], t2[1])
        ):  # fmt: skip
            pairs.append((a2[0], delta(p1.value, p2.value)))
    n = len(pairs)
    n_eff = n / max(1, h)
    independent = _non_overlapping(
        pairs, lambda s0: s0 + (WEEK * h if g == "weekly" else timedelta(days=31 * h))
    )
    out.watch = {"from": a.isoformat(), "until": b.isoformat(),
                 "target": {"from": target[0].isoformat(), "until": target[1].isoformat(),
                            "value": pt.value}, "position_matched": matched}  # fmt: skip
    out.baseline = {
        "basis": "anchor_level",
        "anchor": {
            "from": anchor[0].isoformat(),
            "until": anchor[1].isoformat(),
            "value": pa.value,
        },
        "same_position_changes": n,
        "horizon_periods": h,
        "n_eff": round(n_eff, 1),
        "non_overlapping": len(independent),
    }
    out.change = {stat.removesuffix("_change"): round(d, 4)}
    out.observed_direction = _direction(d)
    out.dominance_windows = (anchor, target)
    if x.counts:
        xa, na = round(pa.numerator or 0), round(pa.denominator or 0)
        xt, nt = round(pt.numerator or 0), round(pt.denominator or 0)
        small = x.min_denominator is not None and min(na, nt) < x.min_denominator
        if na > 0 and nt > 0:
            lo, hi = stats.newcombe_difference(xa, na, xt, nt)
            out.change["interval_pp"] = [round(lo * 100, 2), round(hi * 100, 2)]
            small = small or lo <= 0 <= hi
        else:
            small = True
        out.baseline["counts"] = {"anchor": [xa, na], "target": [xt, nt]}
        if small:
            out.reasons.append("small_denominator")
    if len(independent) < MIN_NON_OVERLAPPING:
        out.reasons.append("too_few_spans")
        return out
    sample = [v for _, v in pairs]
    pct, source = _percentile(d, sample, independent, n_eff, x.provisional)
    out.values = {
        stat: round(d, 4),
        "percentile": None if pct is None else round(pct, 2),
    }
    out.sources["percentile"] = source
    out.look_percentile = out.values["percentile"]
    out.implicit = [_implicit_percentile(x)]
    out.p_value = _p_value(d, sample, x.expected_direction)
    for i, (_, v) in enumerate(pairs):
        others = sample[:i] + sample[i + 1 :]
        p = (stats.empirical_percentile(v, others) if source == "empirical"
             else stats.t_prediction_percentile(v, independent))  # fmt: skip
        out.placebo_values.append({stat: v, "percentile": p})
    return out


def _implicit_percentile(x: MethodInput) -> Threshold:
    tail = 2.5 if x.provisional else 5.0
    if x.expected_direction == "rise":
        return Threshold(statistic="percentile", op=">=", value=100 - tail)
    return Threshold(statistic="percentile", op="<=", value=tail)


# ------------------------------------------------------------------------- trend


def trend(x: MethodInput) -> MethodOutput:
    out = MethodOutput()
    s_ = x.series
    a, b = x.watch
    watch = [p for p in s_.expected(a, b) if p[0] in s_.points]
    if not watch:
        out.reasons.append("too_few_spans")
        return out
    k = len(watch)

    def good(p: tuple[date, date]) -> bool:
        pt = s_.points.get(p[0])
        return bool(
            pt and not pt.suppressed and pt.value is not None and _clean(x, p[0], p[1])
        )

    if any(s_.points[p[0]].suppressed for p in watch):
        out.reasons.append("suppressed")
        return out

    def gap_at(
        start: date, months: list[tuple[date, date]]
    ) -> tuple[float, float, float] | None:
        base = s_.expected(add_months(start, -12), start)
        usable = [p for p in base if good(p)]
        cut = x.regime_start is not None and any(p[0] < x.regime_start for p in base)
        if len(usable) < (6 if cut else 12) or not all(good(p) for p in months):
            return None
        xs = [float(_months_between(start, p[0])) for p in usable]
        ys = [s_.points[p[0]].value for p in usable]
        a0, slope, _ = stats.line_fit(xs, ys)  # type: ignore[arg-type]
        wx = [float(_months_between(start, p[0])) for p in months]
        wy = [s_.points[p[0]].value for p in months]
        gap = fmean(y - (a0 + slope * xi) for xi, y in zip(wx, wy, strict=True))  # type: ignore[operator]
        wslope = stats.line_fit(wx, wy)[1] if len(months) >= 2 else math.nan  # type: ignore[arg-type]
        return gap, slope, wslope

    res = gap_at(a, watch)
    if res is None:
        out.reasons.append(
            "too_few_spans" if all(good(p) for p in watch) else "break_in_baseline"
        )
        return out
    gap, slope, wslope = res
    placebo: list[tuple[date, float]] = []
    for j in range(k, HISTORY_MONTHS + 1):
        s = add_months(a, -j)
        months = s_.expected(s, add_months(s, k))
        r = gap_at(s, months)
        if r is not None:
            placebo.append((s, r[0]))
    n = len(placebo)
    n_eff = n / k
    independent = _non_overlapping(placebo, lambda s0: add_months(s0, k))
    out.watch = {"from": a.isoformat(), "until": b.isoformat(), "months": k,
                 "values": [s_.points[p[0]].value for p in watch]}  # fmt: skip
    out.baseline = {
        "basis": "baseline_slope",
        "months": 12,
        "slope_pp_per_month": round(slope, 4),
        "placebo_starts": n,
        "n_eff": round(n_eff, 1),
        "non_overlapping": len(independent),
    }
    out.change = {"forecast_gap_pp": round(gap, 4)}
    out.observed_direction = _direction(gap)
    out.dominance_windows = ((add_months(a, -12), a), (a, b))
    out.values = {
        "forecast_gap_pp": round(gap, 4),
        "slope_change": None if math.isnan(wslope) else round(wslope - slope, 4),
    }
    if len(independent) < MIN_NON_OVERLAPPING:
        out.reasons.append("too_few_spans")
        return out
    sample = [v for _, v in placebo]
    pct, source = _percentile(gap, sample, independent, n_eff, x.provisional)
    out.values["percentile"] = None if pct is None else round(pct, 2)
    out.sources["percentile"] = source
    out.look_percentile = out.values["percentile"]
    out.implicit = [_implicit_percentile(x)]
    out.p_value = _p_value(gap, sample, x.expected_direction)
    for i, (_, v) in enumerate(placebo):
        others = sample[:i] + sample[i + 1 :]
        p = (stats.empirical_percentile(v, others) if source == "empirical"
             else stats.t_prediction_percentile(v, independent))  # fmt: skip
        out.placebo_values.append(
            {"forecast_gap_pp": v, "percentile": p, "slope_change": None}
        )
    return out


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + b.month - a.month


METHODS: dict[str, Callable[[MethodInput], MethodOutput]] = {
    "seasonal_ratio": seasonal_ratio,
    "recent_vs_prior": recent_vs_prior,
    "level_change": level_change,
    "trend": trend,
}
