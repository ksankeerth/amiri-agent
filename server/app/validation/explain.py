"""A verdict in a banker's words: what moved, against what, whether it cleared the bar, and what the
verdict rests on (the four versions). Code only, from the stored result; the event page, the verdicts
API and the alerts all use the same text."""

import math
from datetime import date, timedelta
from functools import cache

from app import spec

MINUS = "\u2212"
VERDICT = {"confirms": "confirms", "contradicts": "moved the other way", "no_effect": "no effect",
           "insufficient_data": "not enough data", "masked": "hidden by relief", "not_yet": "not published yet",
           "error": "couldn't check"}
WHY = {
    "watch_not_started": "the period to watch hasn't started",
    "not_published": "the institution hasn't published enough of the period yet",
    "masked": "a relief measure changes this metric for now",
    "relief_period": "a relief measure changes this metric for now",
    "break_in_watch": "the data has a break in the period watched",
    "break_in_baseline": "the data has a break in the comparison period",
    "too_few_spans": "too little history to know what is usual",
    "below_min_volume": "too few cases to judge",
    "small_denominator": "too few accounts to judge",
    "dominated": "one customer drives most of the move",
    "suppressed": "the institution hides groups this small",
    "zero_base": "nothing to compare against",
    "metric_dropped": "the institution's catalog no longer has this metric",
    "source_unreachable": "the institution's API didn't answer",
    "source_rate_limited": "the institution's API asked us to slow down",
    "invalid_task": "the check doesn't fit the institution's catalog",
}
STAT = {"pct_change": "change", "pp_change": "change", "robust_z": "distance from usual", "percentile": "percentile",
        "pct_of_gross_inflow": "share of gross inflow", "slope_change": "slope change",
        "forecast_gap_pp": "gap to trend"}
AGAINST = {"seasonal_ratio": "the same period last year", "recent_vs_prior": "the prior periods, seasonally adjusted",
           "level_change": "the level before the event", "trend": "the 12-month trend"}


@cache
def metric_names() -> dict[str, str]:
    out: dict[str, str] = {}
    for metrics in spec.spec()["metrics"].values():
        for m in metrics:
            out.setdefault(m["key"], m["name"])
    return out


def num(v: float, unit: str = "", digits: int = 1) -> str:
    s = f"{abs(v):,.{digits}f}"
    return f"{MINUS if v < 0 else ''}{s}{unit}"


def signed(v: float, unit: str, digits: int = 1) -> str:
    return num(v, unit, digits) if v < 0 else f"+{num(v, unit, digits)}"


def _unit(stat: str) -> str:
    return {"pct_change": "%", "pp_change": " pp", "forecast_gap_pp": " pp", "slope_change": " pp"}.get(stat, "")


def _day(d: str | date) -> str:
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return f"{d.day} {d:%b %Y}"


def _scope(metric: str, filter: dict | None) -> str:
    name = metric_names().get(metric, metric.replace("_", " "))
    parts = [f"{k.replace('_', ' ')}: {str(v).replace('_', ' ')}" for k, v in (filter or {}).items()]
    return f"{name} ({', '.join(parts)})" if parts else name


def _change(method: str, obs: dict) -> tuple[str | None, str | None]:
    """The move and the usual range around it, in the method's own unit."""
    ch, base = obs.get("change") or {}, obs.get("baseline") or {}
    if method == "seasonal_ratio" and "pct" in ch:
        lr = base.get("log_ratio")
        usual = None
        if lr and lr.get("sd") is not None:
            lo, hi = (math.exp(lr["mean"] + k * lr["sd"]) * 100 - 100 for k in (-2, 2))
            usual = f"{signed(lo, '%')} to {signed(hi, '%')}"
        return signed(ch["pct"], "%"), usual
    if method == "recent_vs_prior" and "pct" in ch:
        med, scale = base.get("median_adjusted"), base.get("scale")
        usual = f"{signed(-200 * scale / med, '%')} to {signed(200 * scale / med, '%')}" if med and scale else None
        return signed(ch["pct"], "%"), usual
    if method == "level_change":
        if "pp" in ch:
            iv = ch.get("interval_pp")
            return signed(ch["pp"], " pp", 2), f"{signed(iv[0], ' pp', 2)} to {signed(iv[1], ' pp', 2)}" if iv else None
        if "pct" in ch:
            return signed(ch["pct"], "%"), None
    if method == "trend" and "forecast_gap_pp" in ch:
        return signed(ch["forecast_gap_pp"], " pp", 2), None
    return None, None


def _value(stat: str, v: float) -> str:
    if stat == "percentile":
        return num(v, "", 0)
    unit = _unit(stat)
    return signed(v, unit, 2 if "pp" in unit else 1) if unit else num(v, "", 2)


def _checks(obs: dict) -> list[str]:
    out = []
    for c in obs.get("statistics") or []:
        t, v = c["threshold"], c.get("value")
        if v is None:
            continue
        word = "or lower" if t["op"] in ("<=", "<") else "or higher"
        out.append(f"{STAT.get(c['statistic'], c['statistic'])} {_value(c['statistic'], v)}, needed "
                   f"{_value(c['statistic'], t['value'])} {word}: {'met' if c['met'] else 'not met'}")
    return out


def versions(result: dict) -> dict:
    data = result.get("data") or {}
    as_of = result.get("evaluated_as_of")
    known = None
    if as_of:
        known = f"as known on {_day(date.fromisoformat(as_of) - timedelta(days=1))}"
        if data.get("vintage_rule") == "same_age" and data.get("same_age_days") is not None:
            known += f" (each period at the same age, {data['same_age_days']} days)"
        elif data.get("vintage_rule") == "latest":
            known += " (latest figures)"
        if any(p.get("revised") for p in data.get("periods") or []):
            known += "; some periods revised"
    return {"spec": data.get("spec_version"), "catalog": data.get("catalog_version") or result.get("catalog_version"),
            "validator": result.get("validator_version"), "data": known}


def describe(result: dict | None, task: dict) -> dict | None:
    """What a stored result says, in words; None before the first check."""
    if not result:
        return None
    verdict = result["verdict"]
    metric = result.get("metric") or task.get("metric", "")
    scope = _scope(metric, task.get("filter"))
    obs = result.get("observation") or {}
    change, usual = _change(result.get("method") or task.get("method", ""), obs) if obs else (None, None)
    why = next((WHY[r] for r in result.get("reasons", []) if r in WHY), None)
    words = VERDICT.get(verdict, verdict)
    if change:  # what: the sentence without the verdict, for beside a verdict badge
        what = f"{scope}: {change} against {AGAINST.get(result.get('method', ''), 'the usual level')}"
        what += f" (usual range {usual})" if usual else ""
        line = f"{what}: {words}"
    else:
        what = f"{scope}" + (f": {why}" if why else "")
        line = f"{scope}: {words}" + (f" ({why})" if why else "")
    tail = ""
    if verdict == "contradicts" and result.get("alert_basis") == "unexplained" and result.get("alert") != "none":
        tail += "; it moved the adverse way, for a reason the event doesn't explain"
    if not result.get("final") and verdict not in ("error", "not_yet"):
        tail += " (provisional: more data to come)"
    line, what = line + tail, what + tail
    sup = result.get("supersedes")
    return {
        "verdict": verdict, "verdict_text": words, "final": bool(result.get("final")), "line": line, "what": what,
        "change": change, "usual": usual, "checks": _checks(obs) if obs else [], "why": why,
        "as_of": result.get("evaluated_as_of"), "next_check_after": result.get("next_check_after"),
        "alert": result.get("alert", "none"), "alert_basis": result.get("alert_basis"),
        "supersedes": {**sup, "text": f"replaces the {VERDICT.get(sup['verdict'], sup['verdict'])} of "
                                      f"{_day(sup['as_of'])}, after the data was revised"} if sup else None,
        "versions": versions(result), "spec_link": f"/spec#metric-{metric}",
    }


async def latest(conn, event_id: str) -> dict[str, dict]:
    """The event's tasks by task id: status, the next look, and the latest result in words."""
    cur = await conn.execute(
        """SELECT t.task_id, t.hypothesis_id, t.status, t.next_check_after, t.task,
                  (SELECT e.result FROM cases.validation_evaluations e WHERE e.task_id = t.task_id
                   ORDER BY e.as_of DESC, e.computed_at DESC LIMIT 1) AS result
           FROM cases.validation_tasks t WHERE t.event_id = %s""", (event_id,))
    return {r["task_id"]: {"hypothesis_id": r["hypothesis_id"], "status": r["status"],
                           "next_check_after": r["next_check_after"], "check": describe(r["result"], r["task"])}
            for r in await cur.fetchall()}
