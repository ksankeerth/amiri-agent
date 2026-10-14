"""Builds a validation task from a chosen hypothesis. Code only.

Everything comes from the tracks, the data coverage (the source's catalog joined with the
Metrics Spec's validation rules, through amiri-server) and the business calendar:
the metric (the mechanism's first one the product offers), the filter (fixed
segment, or the value the model picked from the catalog), the watch window
(business days after the anchor, by timing), the baseline (by method), the
thresholds (by method and metric), masking, owner and book size.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, tzinfo

from app.contract import (
    Amount,
    Baseline,
    BusinessDates,
    Event,
    MaskRule,
    Threshold,
    ValidationTask,
)
from app.data_client import Calendar
from app.tracks import ITEM, MASKED_BY_MORATORIUM, MASKING_RISE_PP, Mechanism, owner
from app.vocab import DISASTER_PERIL

WATCH_BUSINESS_DAYS = {"days": 10, "weeks": 30}
WATCH_MONTHS = 3
PRIOR_SPANS = 8

# Default thresholds by method, and per-metric minimum changes.
MIN_PCT_CHANGE = {"recent_vs_prior": 15.0, "seasonal_ratio": 5.0}
METRIC_MIN_CHANGE = {
    "lc_openings": 5.0,
    "import_bills": 4.0,
    "new_pledges": 5.0,
    "inward_remittance_credits": 4.0,
    "claims_per_1000": 25.0,
    "restructure_requests": 30.0,
    "new_leases": 8.0,
    "td_non_renewal_outflow": 10.0,
    "td_placements": 10.0,
}
LEVEL_PP = {
    "facility_utilization": 0.6,
    "installment_collection_rate": 0.5,
    "card_payment_rate": 1.0,
    "loans_above_ltv_limit": 1.0,
    "overdue_pawns": 0.5,
}
LEVEL_PCT = 3.0  # indices
TREND_PP_PER_MONTH = {"roll_rate_to_30": 0.15, "revolving_share": 0.5}
AGGREGATION = {
    "flow": "sum over the period",
    "count": "count over the period",
    "ratio": "numerator / denominator",
    "rate": "count per 1,000 exposure",
    "level": "average",
}


@dataclass
class Choice:
    """What was decided for one hypothesis: the event, product, mechanism and segment."""

    event: Event
    data_source_id: str
    product_id: str
    product_type: str
    mechanism: Mechanism
    segment: tuple[str, str] | None  # (dimension, value)
    announced: date | None = None  # for anticipation: when the rule was announced
    source_product_id: str | None = None
    zone: tzinfo | None = None  # the institution's time zone (UTC if not given)
    scope_note: str | None = None
    extra_filter: dict[str, str] = field(
        default_factory=dict
    )  # e.g. a region, set by code


def fixed_filter(m: Mechanism, event: Event) -> dict[str, str]:
    """The mechanism's fixed filter, with {item} as the event's disaster item in the spec's words."""
    item = next(
        (t.item for t in event.themes if t.theme == "disaster" and t.item), None
    )
    out = {}
    for k, v in m.fixed_filter.items():
        if v == ITEM:
            v = DISASTER_PERIL.get(item or "")
        if v:
            out[k] = v
    return out


def local_date(t: datetime, zone: tzinfo | None) -> date:
    return t.astimezone(zone).date() if zone else t.date()


def pick_metric(m: Mechanism, metrics: dict[str, dict]) -> str | None:
    return next((k for k in m.metrics if k in metrics), None)


def _add_months(d: date, months: int) -> date:
    y, mo = divmod(d.month - 1 + months, 12)
    return (
        date(d.year + y, mo + 1, 1)
        if d.day == 1
        else date(d.year + y, mo + 1, min(d.day, 28))
    )


def _nth_business_day_after(day: date, n: int, cal: Calendar) -> date:
    later = [b for b in cal.business_days if b > day]
    if len(later) < n:  # calendar too short: every day outside the calendar's weekend
        d, count = day, 0
        while count < n:
            d += timedelta(days=1)
            if d.isoweekday() not in cal.weekend_days:
                count += 1
        return d
    return later[n - 1]


def _align(d: date, grain: str, up: bool) -> date:
    if grain == "weekly":
        monday = d - timedelta(days=d.weekday())
        return monday if (not up or monday == d) else monday + timedelta(days=7)
    if grain == "monthly":
        first = d.replace(day=1)
        return first if (not up or first == d) else _add_months(first, 1)
    return d


def _starts_early(anchor_day: date, grain: str) -> bool:
    if grain == "weekly":
        return anchor_day.weekday() <= 1  # Monday or Tuesday
    if grain == "monthly":
        return anchor_day.day <= 3
    return False


def _from_set(magnitudes: dict[str, float], expect: str) -> list[Threshold]:
    """A catalog threshold set (magnitudes per statistic), signed by the expected direction."""
    sign, op = (1, ">=") if expect == "rise" else (-1, "<=")
    out = []
    for stat, v in magnitudes.items():
        if stat == "percentile":
            out.append(
                Threshold(
                    statistic=stat, op=op, value=100 - v if expect == "rise" else v
                )
            )
        else:
            out.append(Threshold(statistic=stat, op=op, value=v * sign))
    return out


def _thresholds(method: str, metric: str, kind: str, expect: str) -> list[Threshold]:
    sign, op = (1, ">=") if expect == "rise" else (-1, "<=")
    if method == "recent_vs_prior":
        pct = METRIC_MIN_CHANGE.get(metric, MIN_PCT_CHANGE[method])
        return [
            Threshold(statistic="robust_z", op=op, value=3 * sign),
            Threshold(statistic="pct_change", op=op, value=pct * sign),
        ]
    if method == "seasonal_ratio":
        pct = METRIC_MIN_CHANGE.get(metric, MIN_PCT_CHANGE[method])
        return [
            Threshold(
                statistic="percentile", op=op, value=95 if expect == "rise" else 5
            ),
            Threshold(statistic="pct_change", op=op, value=pct * sign),
        ]
    if method == "level_change":
        if kind == "level":
            return [Threshold(statistic="pct_change", op=op, value=LEVEL_PCT * sign)]
        return [
            Threshold(
                statistic="pp_change", op=op, value=LEVEL_PP.get(metric, 1.0) * sign
            )
        ]
    return [
        Threshold(
            statistic="forecast_gap_pp",
            op=op,
            value=TREND_PP_PER_MONTH.get(metric, 0.2) * sign,
        )
    ]


def build_task(
    task_id: str,
    hypothesis_id: str,
    choice: Choice,
    catalog_product: dict,
    cal: Calendar,
    catalog_version: str | None = None,
) -> ValidationTask | None:
    """None when the product offers none of the mechanism's metrics."""
    metrics = {m["metric"]: m for m in catalog_product["metrics"]}
    metric = pick_metric(choice.mechanism, metrics)
    if metric is None:
        return None
    spec = metrics[metric]
    dims = spec["dimensions"]
    m = choice.mechanism

    filter: dict[str, str] = {
        k: v for k, v in fixed_filter(m, choice.event).items() if v in dims.get(k, [])
    }
    if m.segment_value:
        dim = next((d for d, values in dims.items() if m.segment_value in values), None)
        if dim:
            filter[dim] = m.segment_value
    if choice.segment and choice.segment[1] in dims.get(choice.segment[0], []):
        filter[choice.segment[0]] = choice.segment[1]
    filter.update(
        {k: v for k, v in choice.extra_filter.items() if v in dims.get(k, [])}
    )
    business_days = cal.business_days

    anchor_day = local_date(choice.event.anchor, choice.zone)
    grain = spec["grain"]
    if m.phase == "anticipation" and choice.announced and choice.announced < anchor_day:
        start = _nth_business_day_after(choice.announced, 1, cal)
        until = anchor_day
    elif m.timing in WATCH_BUSINESS_DAYS:
        start = _nth_business_day_after(anchor_day, 1, cal)
        last = _nth_business_day_after(anchor_day, WATCH_BUSINESS_DAYS[m.timing], cal)
        until = last + timedelta(days=1)
    else:
        start = _nth_business_day_after(anchor_day, 1, cal)
        until = _add_months(start, WATCH_MONTHS)
    start, until = _align(start, grain, up=True), _align(until, grain, up=True)
    # A move early in its week (or month) is watched from that week (or month): most of the
    # period is after the move, and it's where a "days" or "weeks" effect starts.
    if m.phase == "effect" and _starts_early(anchor_day, grain):
        start = _align(anchor_day, grain, up=False)
    if until <= start:
        until = _align(start + timedelta(days=1), grain, up=True)

    method = spec["method"]
    base_until = min(_align(anchor_day, grain, up=False), start)
    if method == "recent_vs_prior":
        span = max(1, sum(1 for b in business_days if start <= b < until))
        earlier = [b for b in business_days if b < base_until]
        base_from = (
            earlier[-span * PRIOR_SPANS]
            if len(earlier) >= span * PRIOR_SPANS
            else (base_until - timedelta(days=span * PRIOR_SPANS * 7 // 5))
        )
        basis = "aligned_prior_spans"
    elif method == "seasonal_ratio":
        base_from, basis = (
            _add_months(start.replace(day=1), -24),
            "rolling_seasonal_ratio",
        )
    elif method == "level_change":
        base_from, basis = base_until - timedelta(days=14), "anchor_level"
    else:  # trend
        base_from, basis = _add_months(base_until.replace(day=1), -12), "baseline_slope"
    if base_from >= base_until:
        base_from = base_until - timedelta(days=7)

    sets = spec.get("thresholds") or {}
    if m.size in sets:
        thresholds = _from_set(sets[m.size], m.expect)
        threshold_set_id = f"{metric}.{m.size}"
    else:
        thresholds = _thresholds(method, metric, spec["kind"], m.expect)
        threshold_set_id = None
    # Segment membership is frozen at the start of the week before the event: the
    # same date for every task of the event, whatever its grain.
    frozen = _align(anchor_day, "weekly", up=False) - timedelta(days=7)

    masking = []
    if metric in MASKED_BY_MORATORIUM and "moratorium_enrolled" in metrics:
        masking.append(MaskRule(metric="moratorium_enrolled", rise_pp=MASKING_RISE_PP))
    book = catalog_product.get("book_size")
    return ValidationTask(
        task_id=task_id,
        hypothesis_id=hypothesis_id,
        event_id=choice.event.event_id,
        finding_ids=choice.event.finding_ids,
        data_source_id=choice.data_source_id,
        product_id=choice.product_id,
        source_product_id=choice.source_product_id,
        metric=metric,
        unit=spec["unit"],
        currency=spec.get("currency"),
        aggregation=AGGREGATION.get(spec["kind"], spec["kind"]),
        filter=filter,
        anchor=choice.event.anchor,
        time_zone=str(choice.zone) if choice.zone else "UTC",
        calendar_id=cal.calendar_id,
        announced_at=choice.announced if m.phase == "anticipation" else None,
        watch=BusinessDates(from_=start, until=until),
        baseline=Baseline(from_=base_from, until=base_until, basis=basis),
        reporting_lag_days=spec["lag_days"],
        method=method,
        thresholds=thresholds,
        threshold_set_id=threshold_set_id,
        expected_direction=m.expect,
        adverse_direction=spec.get("adverse") or m.expect,
        expected_size=m.size,
        min_volume=spec.get("min_volume"),
        phase=m.phase,
        currency_basis="original",
        segment_frozen_at=frozen,
        masking=masking,
        dominance_limit=0.5,
        catalog_version=catalog_version,
        owner=owner(choice.product_type, m.angle),
        book_size=Amount(value=book["value"] / 1e9, unit=f"{book['unit']} bn")
        if book
        else None,
        scope_note=choice.scope_note,
    )
