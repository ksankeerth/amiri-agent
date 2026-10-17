"""What a sample institution can be told to show, or to get wrong.

Each condition is switched on with a start date and one size number; nothing else to fill in.
"data" conditions change the numbers (the planted scenarios the validator should find);
"fault" conditions break the API on purpose, so the connector's report can be shown catching them.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Kind = Literal["bank", "insurer"]


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    group: Literal["data", "fault"]
    kinds: tuple[Kind, ...]
    size_label: str | None = None   # what the size number means, None: no size
    size: float | None = None       # default
    start_days_ago: int = 21        # default start, before today
    note: str = ""


PRESETS: list[Preset] = [
    # ---------------------------------------------------------------- what the data shows
    Preset("currency_slide_importers", "A currency slide hits importers", "data", ("bank",), "fall in LC openings, %", 8,
           note="Importers open fewer letters of credit and present fewer import bills; their facility use rises. "
                "For 8 weeks from the start."),
    Preset("remittances_fall", "Remittances fall", "data", ("bank",), "fall, %", 6,
           note="Inward remittances (in the sender's currency) fall from the start."),
    Preset("floods", "Floods, then relief", "data", ("bank", "insurer"), "rise in claims, %", 600, start_days_ago=28,
           note="Insurer: flood claims jump for 3 weeks. Bank: a repayment moratorium starts two weeks later "
                "(declared as a relief break) and collections dip, which the moratorium masks."),
    Preset("late_revision", "A late revision", "data", ("bank", "insurer"), "first estimate too high by, pp", 0.6,
           start_days_ago=10,
           note="The two months before the start were first published too high and revised down at the start."),
    Preset("dominant_obligor", "One customer drives a move", "data", ("bank",), "rise in facility use, pp", 3.4,
           note="Business-loan facility use rises, almost all of it from one obligor (change concentration from 0.8)."),
    Preset("few_customers", "Too few customers in a product", "data", ("bank", "insurer"), None,
           note="The smallest product has so few customers that its numbers are suppressed."),
    Preset("reporting_lag", "Late publication", "data", ("bank", "insurer"), None,
           note="Every metric is published three times later than usual, so recent periods are not out yet."),
    # ---------------------------------------------------------------- what the API gets wrong
    Preset("old_major_version", "An old spec version (0.9.0)", "fault", ("bank", "insurer"),
           note="The header and the catalog say 0.9.0: a different MAJOR, not accepted."),
    Preset("no_version_header", "No Metrics-Spec-Version header", "fault", ("bank", "insurer")),
    Preset("missing_metric", "A required metric is missing", "fault", ("bank", "insurer"),
           note="The first product's first required metric is left out of the catalog."),
    Preset("wrong_formats", "Wrong field formats", "fault", ("bank", "insurer"),
           note="published_at is written 2026/10/05 and value is a string."),
    Preset("suppression_off", "Suppression switched off", "fault", ("bank", "insurer"),
           note="Cells with fewer than 10 customers are returned with their values."),
    Preset("rate_limit_no_retry_after", "429 without Retry-After", "fault", ("bank", "insurer"),
           note="Every third request is refused with 429 and no Retry-After header."),
]
BY_ID = {p.id: p for p in PRESETS}


@dataclass(frozen=True)
class Active:
    id: str
    start: date
    size: float | None


def presets(kind: Kind) -> list[Preset]:
    return [p for p in PRESETS if kind in p.kinds]


def problems(kind: Kind, conditions: list[dict]) -> list[str]:
    """What is wrong with a list of conditions, as plain sentences (empty: fine)."""
    out = []
    seen = set()
    for i, c in enumerate(conditions):
        if not isinstance(c, dict) or not isinstance(c.get("id"), str):
            out.append(f"Condition {i + 1}: give an id.")
            continue
        p = BY_ID.get(c["id"])
        if p is None or kind not in p.kinds:
            out.append(f"{c['id']} is not a condition of the sample {kind}.")
            continue
        if c["id"] in seen:
            out.append(f"{c['id']} is listed twice.")
        seen.add(c["id"])
        if c.get("start") is not None:
            try:
                date.fromisoformat(c["start"])
            except (TypeError, ValueError):
                out.append(f"{c['id']}: start must be a date (YYYY-MM-DD).")
        if c.get("size") is not None and not isinstance(c["size"], (int, float)):
            out.append(f"{c['id']}: size must be a number.")
        unknown = set(c) - {"id", "on", "start", "size"}
        if unknown:
            out.append(f"{c['id']}: unknown fields {', '.join(sorted(unknown))}.")
    return out


def active(kind: Kind, conditions: list[dict], today: date) -> dict[str, Active]:
    """The conditions switched on, with their start and size filled in from the presets."""
    out = {}
    for c in conditions:
        p = BY_ID.get(c.get("id", ""))
        if p is None or kind not in p.kinds or not c.get("on", True):
            continue
        start = date.fromisoformat(c["start"]) if c.get("start") else today - timedelta(days=p.start_days_ago)
        size = c.get("size") if c.get("size") is not None else p.size
        out[p.id] = Active(p.id, start, size)
    return out
