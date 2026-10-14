"""Whether an event is good, bad, mixed or neutral for the institution, by code: from the Metrics
Spec's adverse direction of each metric its hypotheses expect to move. Shared by the Overview,
the Events pages and the Scenario Studio."""

from functools import cache

from app import spec


@cache
def adverse() -> dict[str, frozenset[str]]:
    out: dict[str, set[str]] = {}
    for metrics in spec.spec()["metrics"].values():
        for m in metrics:
            out.setdefault(m["key"], set()).update(m.get("adverse") or [])
    return {k: frozenset(v) for k, v in out.items()}


def tone(hypotheses: list[dict]) -> str:
    """good, bad, mixed or neutral. A hypothesis is bad when its expected move is the metric's adverse one."""
    adv = adverse()
    marks = set()
    for h in hypotheses:
        e = h.get("expected") or {}
        if e.get("metric") in adv and e.get("direction"):
            marks.add("bad" if e["direction"] in adv[e["metric"]] else "good")
    return "mixed" if len(marks) > 1 else marks.pop() if marks else "neutral"
