"""The validator's loop for one task at one as_of.

    check → snap → ready? → plan → fetch → breaks → masking → data quality
          → compute → verdict, then the alert lifecycle and the schedule (§6).

Code only: no model. Every number in the result comes from the institution's API answers listed in
its tool_trace (reading the reference API: reader.py).
"""

import hashlib
import json
import math
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.validation import history as hist
from app.validation.contract import (
    BusinessDates,
    Check,
    Family,
    Observation,
    Placebo,
    PreMaskResult,
    Threshold,
    ToolCall,
    ValidationResult,
    ValidationTask,
    VerdictStep,
)
from app.validation.methods import METHODS, MethodInput, MethodOutput
from app.validation.periods import (
    DAY,
    Series,
    add_months,
    grid,
    last_day,
    local_date,
    next_period,
    period_start,
    published,
    snap,
)
from app.validation.reader import DataError, RunReader
from app.validation.vocab import REASONS, VALIDATOR_VERSION

PLAN_MONTHS = 39  # 24 months of spans + a year-ago span + a 3-month growth window
MASK_BEFORE_PERIODS = 4
DEFAULT_RISE_PP = 2.0
NOISY_FACTOR = 2.0  # a test that fires on more than 2x its nominal rate is noise
MIN_PLACEBOS = 10
SUPPRESSED_SHARE = 0.1
MISSING_VINTAGE_SHARE = 0.2


class InvalidTask(Exception):
    def __init__(self, message: str, reason: str = "invalid_task"):
        super().__init__(message)
        self.reason = reason


def task_hash(task: ValidationTask) -> str:
    canonical = json.dumps(task.model_dump(mode="json", by_alias=True), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


# ------------------------------------------------------------ thresholds


def tighten(t: Threshold) -> Threshold:
    """The stricter threshold for a provisional look."""
    if t.statistic == "percentile":
        v = t.value / 2 if t.value < 50 else 100 - (100 - t.value) / 2
        return Threshold(statistic=t.statistic, op=t.op, value=v)
    if t.statistic == "robust_z":
        return Threshold(statistic=t.statistic, op=t.op, value=t.value * 3.5 / 3)
    return t


def mirror(t: Threshold) -> Threshold:
    op = "<=" if t.op == ">=" else ">="
    value = 100 - t.value if t.statistic == "percentile" else -t.value
    return Threshold(statistic=t.statistic, op=op, value=value)


def holds(t: Threshold, value: float | None) -> bool:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return False
    return value >= t.value if t.op == ">=" else value <= t.value


def judge(
    thresholds: list[Threshold], implicit: list[Threshold], out: MethodOutput
) -> list[Check]:
    checks = []
    for t, is_implicit in [(t, False) for t in thresholds] + [
        (t, True) for t in implicit
    ]:
        v = out.values.get(t.statistic)
        m = mirror(t)
        checks.append(
            Check(
                statistic=t.statistic,
                value=v,
                threshold=t,
                mirror=m,
                met=holds(t, v),
                mirror_met=holds(m, v),
                source=out.sources.get(t.statistic),
                implicit=is_implicit,
            )
        )
    return checks


def test_verdict(checks: list[Check]) -> str:
    if checks and all(c.met for c in checks):
        return "confirms"
    if checks and all(c.mirror_met for c in checks):
        return "contradicts"
    return "no_effect"


# --------------------------------------------------------------- results


@dataclass
class Look:
    """What the lifecycle needs from one evaluation, beyond the result itself."""

    signal: str = "none"  # adverse | opportunity | none, before alert rules
    basis: str | None = None
    look_percentile: float | None = None
    signature: str = ""
    young: bool = False
    stable_age_days: int = 0
    lag_days: int = 0
    pending: list[date] = field(default_factory=list)  # publication dates still to come
    mask_pending: list[date] = field(default_factory=list)
    final_watch_published: date | None = None


def _expected(task: ValidationTask) -> dict[str, str]:
    return {
        "direction": task.expected_direction,
        "size": task.expected_size,
        "adverse_direction": task.adverse_direction,
    }


def _base(task: ValidationTask, as_of: date, family_size: int) -> dict[str, Any]:
    return {
        "task_id": task.task_id,
        "task_hash": task_hash(task),
        "hypothesis_id": task.hypothesis_id,
        "event_id": task.event_id,
        "family": Family(event_id=task.event_id, size=family_size),
        "owner": task.owner,
        "product_id": task.product_id,
        "metric": task.metric,
        "method": task.method,
        "validator_version": VALIDATOR_VERSION,
        "catalog_version": task.catalog_version,
        "threshold_set_id": task.threshold_set_id,
        "evaluated_as_of": as_of,
        "computed_at": datetime.now(UTC),
        "expected": _expected(task),
    }


def _verdict_from(reasons: list[str], fallback: str) -> str:
    leads = {REASONS.get(r.split(":")[0], "") for r in reasons}
    for v in ("error", "not_yet", "masked", "insufficient_data"):
        if v in leads:
            return v
    return fallback


def _applies(rule: dict, filter: dict[str, str]) -> bool:
    """A break or relief period applies unless the filter names a value outside the ones it's limited to."""
    for k, vs in rule.items():
        allowed = vs if isinstance(vs, list) else [vs]
        if k in filter and allowed and filter[k] not in allowed:
            return False
    return True


# ------------------------------------------------------------------ loop


async def evaluate(
    task: ValidationTask,
    as_of: date,
    reader: RunReader,
    history: hist.TaskHistory,
    family_size: int = 1,
) -> ValidationResult:
    trace: list[ToolCall] = []
    base = _base(task, as_of, family_size)
    look = Look()
    try:
        fields = await _evaluate(task, as_of, reader, trace, look)
    except DataError as e:
        reason = "source_rate_limited" if e.rate_limited else "source_unreachable"
        fields = {
            "verdict": "error",
            "final": not e.transient,
            "error_kind": "transient" if e.transient else "permanent",
            "reasons": [reason],
            "data": {"error": str(e)},
        }
    except InvalidTask as e:
        fields = {
            "verdict": "error",
            "final": True,
            "error_kind": "permanent",
            "reasons": [e.reason],
            "data": {"error": str(e)},
        }
    result = ValidationResult(**base, **fields, tool_trace=trace)
    return hist.apply_lifecycle(task, result, look, history)


async def _evaluate(
    task: ValidationTask,
    as_of: date,
    reader: RunReader,
    trace: list[ToolCall],
    look: Look,
) -> dict[str, Any]:
    known = as_of - DAY  # the last day this as_of can see (00:00 local cutoff)

    # 1. Check ----------------------------------------------------------------
    catalog = await reader.catalog(trace)
    aliases = catalog.get("aliases", {})
    pid = task.source_product_id or task.product_id  # the product in the institution's catalog
    product = next((p for p in catalog.get("products", []) if p["product_id"] == pid), None)
    if product is None:
        raise InvalidTask(f"product {pid} is not in the catalog of {reader.source_id}", "metric_dropped")
    metrics = {m["metric"]: m for m in product["metrics"]}
    key = aliases.get(task.metric, task.metric)
    spec = metrics.get(key)
    if spec is None:
        raise InvalidTask(
            f"{task.product_id} no longer has {task.metric}", "metric_dropped"
        )
    for dim, value in task.filter.items():
        if value not in spec["dimensions"].get(dim, []):
            raise InvalidTask(f"{key} has no {dim}={value}")
    allowed = spec.get("adverse_allowed") or [spec.get("adverse")]
    if task.adverse_direction not in [a for a in allowed if a]:
        raise InvalidTask(
            f"adverse_direction {task.adverse_direction} is not allowed for {key}"
        )
    min_volume = (
        task.min_volume if task.min_volume is not None else spec.get("min_volume")
    )
    if min_volume is None:
        raise InvalidTask(f"no min_volume for {key} in the task or the catalog")
    grain, kind = spec["grain"], spec["kind"]
    lag = int(spec.get("lag_days", task.reporting_lag_days))
    stable_age = int(spec.get("stable_age_days") or 0)
    vintages_kept = bool(catalog.get("vintages_kept", True))
    look.stable_age_days, look.lag_days = stable_age, lag
    data: dict[str, Any] = {"catalog_version": catalog.get("catalog_version"),
                            "spec_version": catalog.get("spec_version"), "source_product_id": pid,
                            "metric_used": key, "min_volume": min_volume}  # fmt: skip

    # 2. Snap -----------------------------------------------------------------
    history_from = date.fromisoformat(spec.get("history_from") or "1900-01-01")
    plan_from = max(history_from, add_months(task.watch.from_, -PLAN_MONTHS))
    calendar = await reader.calendar(
        period_start(plan_from, "monthly"), task.watch.until + timedelta(days=40), trace
    )
    snapped = snap(task.watch.from_, task.watch.until, grain, calendar)
    if snapped is None:
        raise InvalidTask(
            f"the watch {task.watch.from_}..{task.watch.until} holds no whole {grain} period"
        )
    a, b = snapped
    periods = grid(grain, a, b, calendar)
    data["watch_snapped"] = {
        "from": a.isoformat(),
        "until": b.isoformat(),
        "periods": len(periods),
    }
    look.final_watch_published = published(periods[-1][1], lag)

    # 3. Ready? ---------------------------------------------------------------
    probe = await reader.history(
        "ready", trace, pid, key, a, b, task.filter, known,
        segment_frozen_at=task.segment_frozen_at, currency_basis=task.currency_basis,
    )  # fmt: skip
    out_now = {date.fromisoformat(p["from"]) for p in probe.get("rows", [])}
    k = 0
    while k < len(periods) and periods[k][0] in out_now:
        k += 1
    look.pending = [published(p[1], lag) for p in periods[k:]]
    needed = min(len(periods), max(2, math.ceil(len(periods) / 3)))
    if k < needed:
        reason = "watch_not_started" if as_of <= a else "not_published"
        data["published_periods"] = k
        data["needed_periods"] = needed
        return {"verdict": "not_yet", "final": False, "reasons": [reason], "data": data}
    complete = k == len(periods)
    part = (a, periods[k - 1][1])
    newest_last = last_day(periods[k - 1][1])
    n_age = (known - newest_last).days
    provisional = not complete

    # 4-5. Plan and fetch -----------------------------------------------------
    trace.append(ToolCall(step="plan", status="planned", args={
        "method": task.method, "history_from": plan_from.isoformat(),
        "same_age_days": n_age if vintages_kept else None,
        "watch_part": [part[0].isoformat(), part[1].isoformat()]}))  # fmt: skip
    body = await reader.history(
        "fetch", trace, pid, key, plan_from, b, task.filter, known,
        same_age_days=n_age if vintages_kept else None,
        segment_frozen_at=task.segment_frozen_at, currency_basis=task.currency_basis,
    )  # fmt: skip
    series = Series.from_rows(body, kind, grain, calendar)
    if not series.points:
        return {"verdict": "insufficient_data", "final": False, "reasons": ["too_few_spans"],
                "data": data}  # fmt: skip
    missing = sum(1 for p in series.points.values() if p.vintage == "missing")
    vintage_rule = "same_age"
    if (
        not vintages_kept
        or not body.get("vintages_kept", True)
        or (missing > MISSING_VINTAGE_SHARE * len(series.points))
    ):
        vintage_rule = "latest"
    reasons: list[str] = []
    young = vintage_rule == "latest" and n_age < stable_age
    if young:
        reasons.append("young_data_risk")
    look.young = young

    # 6. Breaks ---------------------------------------------------------------
    breaks = [x for x in await reader.breaks(pid, key, trace)
              if _applies(x.get("applies_to", {}), task.filter)]  # fmt: skip
    regime_start, episodes, relief, used_breaks = None, [], [], []
    for x in breaks:
        on = date.fromisoformat(x["date"])
        until = date.fromisoformat(x["until"]) if x.get("until") else None
        mine = x.get("event_id") and x["event_id"] == task.event_id
        used_breaks.append(
            {k2: x.get(k2) for k2 in ("date", "until", "kind", "note", "event_id")}
        )
        if until is None:  # a lasting shift
            if a <= on < b and not mine:
                reasons.append("break_in_watch")
            elif on < a and not mine:
                regime_start = max(regime_start or on, on)
        else:  # an episode
            overlaps = on < b and a < until
            if x.get("kind") == "relief" and overlaps:
                relief.append((max(on, a), until))
            elif overlaps and not mine:
                reasons.append("break_in_watch")
            elif not overlaps and not mine:
                episodes.append((on, until))
    data["breaks"] = used_breaks

    # 7. Masking --------------------------------------------------------------
    masks, mask_start, mask_incomplete = [], None, False
    rules = {m.metric: m.rise_pp for m in task.masking}
    for m in spec.get("masked_by") or []:
        rules.setdefault(m, (spec.get("mask_rises") or {}).get(m, DEFAULT_RISE_PP))
    for metric, rise_pp in rules.items():
        mspec = metrics.get(metric)
        if mspec is None:
            masks.append({"metric": metric, "available": False})
            continue
        mapped = {
            d: v for d, v in task.filter.items() if v in mspec["dimensions"].get(d, [])
        }
        mgrain = mspec["grain"]
        m0 = period_start(a, mgrain)
        for _ in range(MASK_BEFORE_PERIODS):
            m0 = period_start(m0 - DAY, mgrain)
        m1 = period_start(b - DAY, mgrain)
        m1 = next_period(m1, mgrain)
        mbody = await reader.history(
            "masking", trace, pid, metric, m0, m1, mapped, known
        )
        mpts = {date.fromisoformat(p["from"]): p for p in mbody.get("rows", [])}
        mperiods = grid(mgrain, m0, m1, calendar)
        before = [mpts[s]["value"] for s, e in mperiods if e <= a and s in mpts
                  and mpts[s]["value"] is not None][-MASK_BEFORE_PERIODS:]  # fmt: skip
        # Mask periods mostly inside the watch (a week straddling a month's end counts
        # for the month that holds most of it).
        inside = [(s, e) for s, e in mperiods if a <= s + (e - s) / 2 < b]
        base_level = sum(before) / len(before) if before else None
        rises = []
        start_here = None
        for s, _e in inside:
            p = mpts.get(s)
            if p is None or p["value"] is None or base_level is None:
                continue
            rise = p["value"] - base_level
            rises.append(rise)
            if rise > rise_pp and start_here is None:
                start_here = s
        published_inside = [s for s, _ in inside if s in mpts]
        done = len(published_inside) == len(inside)
        if not done:
            mask_incomplete = True
            look.mask_pending += [published(e, int(mspec["lag_days"])) for s, e in inside
                                  if s not in mpts]  # fmt: skip
        triggered = start_here is not None
        if triggered:
            mask_start = min(mask_start or start_here, start_here)
        last_pub = max((mpts[s]["until"] for s in published_inside), default=None)
        masks.append({
            "metric": metric, "filter_used": mapped,
            "filter_dropped": sorted(set(task.filter) - set(mapped)),
            "before": None if base_level is None else round(base_level, 3),
            "max_watch": None if not rises else round(base_level + max(rises), 3),  # type: ignore[operator]
            "rise_pp": None if not rises else round(max(rises), 3), "limit_pp": rise_pp,
            "published_through": last_pub, "triggered": triggered,
        })  # fmt: skip
    if spec.get("mask_family") and relief:
        mask_start = min([mask_start] if mask_start else [] + [r[0] for r in relief])
        masks.append({"relief": [[r0.isoformat(), r1.isoformat()] for r0, r1 in relief],
                      "triggered": True})  # fmt: skip
        reasons.append("relief_period")
    if any(m.get("triggered") for m in masks if "metric" in m):
        reasons.append("masked")
    if mask_incomplete:
        reasons.append("mask_not_published")
    data["masking"] = masks

    # 8. Data quality (watch) -------------------------------------------------
    watch_pts = series.present(*part)
    if any(p.suppressed for p in watch_pts):
        reasons.append("suppressed")
    shown = [p for p in watch_pts if not p.suppressed]
    volume_min = min((p.volume for p in shown), default=0)
    if shown and volume_min < min_volume:
        reasons.append("below_min_volume")

    # 9. Compute --------------------------------------------------------------
    growth_end = a
    if task.announced_at:
        growth_end = min(a, period_start(task.announced_at, grain))
    method_in = MethodInput(
        series=series,
        watch=part,
        expected_direction=task.expected_direction,
        provisional=provisional,
        regime_start=regime_start,
        episodes=episodes,
        growth_end=growth_end,
        min_base=spec.get("min_base"),
        counts=bool(spec.get("counts")),
        min_denominator=spec.get("min_denominator"),
        change_statistic=next((t.statistic for t in task.thresholds if t.statistic in ("pct_change", "pp_change")),
                              None),
    )
    run = METHODS[task.method]
    out = run(method_in)
    for r in out.reasons:
        if r not in reasons:
            reasons.append(r)
    top_change = None
    if out.dominance_windows and "suppressed" not in reasons:
        cc = await reader.change_concentration(
            trace, pid, key, out.dominance_windows[0], out.dominance_windows[1],
            task.filter, known, n_age if vintage_rule == "same_age" else None,
        )  # fmt: skip
        top_change = cc.get("top_share_band")
        # a band whose lower bound is at or above the limit counts as dominated (spec: ChangeConcentration)
        if cc.get("top_share_lower") is not None and cc["top_share_lower"] >= task.dominance_limit:
            reasons.append("dominated")

    thresholds = (
        [tighten(t) for t in task.thresholds] if provisional else list(task.thresholds)
    )
    implicit = (
        [] if any(t.statistic == "percentile" for t in thresholds) else out.implicit
    )
    checks = judge(thresholds, implicit, out) if out.values else []
    for c in checks:
        if not c.met and not c.implicit:
            reasons.append(f"threshold_not_met:{c.statistic}")
    fired = sum(
        1 for pv in out.placebo_values
        if all(holds(t, pv.get(t.statistic)) for t in thresholds + implicit)
    )  # fmt: skip
    anchors = len(out.placebo_values)
    placebo = Placebo(
        anchors=anchors,
        fired=fired,
        fire_rate=round(fired / anchors, 4) if anchors else None,
        p_value=None if out.p_value is None else round(out.p_value, 4),
    )

    # 10. Verdict -------------------------------------------------------------
    verdict = test_verdict(checks) if checks else "no_effect"
    if verdict == "confirms":
        reasons.append("thresholds_met")
    elif verdict == "contradicts":
        reasons.append("mirrored_thresholds_met")
    nominal = 0.025 if provisional else 0.05
    if (
        verdict in ("confirms", "contradicts")
        and anchors >= MIN_PLACEBOS
        and (placebo.fire_rate or 0) > NOISY_FACTOR * nominal
    ):
        reasons.append("noisy_metric")
        verdict = "no_effect"
    test_result = verdict
    verdict = _verdict_from(reasons, verdict)
    if verdict in ("masked", "insufficient_data"):  # the test didn't decide it
        reasons = [r for r in reasons if not r.startswith("threshold_not_met")
                   and r not in ("thresholds_met", "mirrored_thresholds_met")]  # fmt: skip

    pre_mask = None
    if verdict == "masked" and mask_start and mask_start > a:
        before_mask = [p for p in periods[:k] if p[1] <= mask_start]
        if before_mask and len(before_mask) >= math.ceil(len(periods) / 3):
            pin = MethodInput(**{**method_in.__dict__, "watch": (a, before_mask[-1][1]),
                                 "provisional": False})  # fmt: skip
            pout = run(pin)
            pchecks = judge(list(task.thresholds), [] if any(
                t.statistic == "percentile" for t in task.thresholds) else pout.implicit,
                pout) if pout.values else []  # fmt: skip
            pre_mask = PreMaskResult(
                watch=BusinessDates(from_=a, until=before_mask[-1][1]),
                verdict=_verdict_from(pout.reasons, test_verdict(pchecks) if pchecks
                                      else "no_effect"),  # type: ignore[arg-type]
                statistics=pchecks,
            )  # fmt: skip

    final = complete and not mask_incomplete and not young and verdict != "not_yet"

    # Signal for the alert lifecycle.
    if test_result == "confirms" and verdict == "confirms":
        look.signal = (
            "adverse"
            if task.expected_direction == task.adverse_direction
            else "opportunity"
        )
        look.basis = "explained"
    elif test_result == "contradicts" and verdict == "contradicts":
        observed = "fall" if task.expected_direction == "rise" else "rise"
        look.signal = "adverse" if observed == task.adverse_direction else "none"
        look.basis = "unexplained"
    look.look_percentile = out.look_percentile
    look.signature = hashlib.sha256(
        json.dumps(
            [[p.start.isoformat(), p.data_as_of.isoformat(), p.value]
             for p in series.points.values()] + [masks, vintage_rule, final],
            default=str,
        ).encode()
    ).hexdigest()[:16]  # fmt: skip

    hidden = "dominated" in reasons or "suppressed" in reasons
    observation = None
    if not hidden and (out.watch or out.change):
        observation = Observation(
            watch={
                **out.watch,
                "snapped_from": a.isoformat(),
                "snapped_until": b.isoformat(),
            },
            baseline=out.baseline,
            change=out.change,
            statistics=checks,
            placebo=placebo if anchors else None,
        )
    data.update({
        "vintage_rule": vintage_rule,
        "same_age_days": n_age if vintage_rule == "same_age" else None,
        "periods": [{"from": p.start.isoformat(), "until": p.until.isoformat(),
                     "data_as_of": p.data_as_of.isoformat(),
                     "age_days": (known - last_day(p.until)).days,
                     "published_at": p.published_at.isoformat(), "vintage": p.vintage,
                     "revised": p.revised} for p in watch_pts],
        "volume": {"min": volume_min} if not hidden else {"below_min": volume_min < min_volume},
        "top_share_band": top_change,
        "suppressed_periods": [p.start.isoformat() for p in watch_pts if p.suppressed],
        "provisional_thresholds": provisional,
    })  # fmt: skip
    return {
        "verdict": verdict,
        "final": final,
        "reasons": reasons,
        "pre_mask_result": pre_mask,
        "observed_direction": None if hidden else out.observed_direction,
        "observation": observation,
        "data": data,
    }


def resolve_as_of(as_of: date | None, time_zone: str) -> date:
    """The as_of to judge at: the given date, or today in the institution's time zone."""
    return as_of or local_date(datetime.now(UTC), time_zone)


__all__ = ["VerdictStep", "evaluate", "resolve_as_of", "task_hash"]
