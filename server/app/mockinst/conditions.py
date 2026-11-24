"""What a sample institution's data can be made to show: the planted scenarios the validator should find
(the example file's `scenario`). Each condition has a start date and one size number; nothing else to fill in.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Kind = Literal["bank", "insurer"]


@dataclass(frozen=True)
class Preset:
    id: str
    label: str
    kinds: tuple[Kind, ...]
    size_label: str | None = None   # what the size number means, None: no size
    size: float | None = None       # default
    start_days_ago: int = 21        # default start, before today
    note: str = ""


PRESETS: list[Preset] = [
    Preset("currency_slide_importers", "A currency slide hits importers", ("bank",), "fall in LC openings, %", 8,
           note="Importers open fewer letters of credit and present fewer import bills; their facility use rises. "
                "For 8 weeks from the start."),
    Preset("remittances_fall", "Remittances fall", ("bank",), "fall, %", 6,
           note="Inward remittances (in the sender's currency) fall from the start."),
    Preset("floods", "Floods, then relief", ("bank", "insurer"), "rise in claims, %", 600, start_days_ago=28,
           note="Insurer: flood claims jump for 3 weeks. Bank: a repayment moratorium starts two weeks later "
                "(declared as a relief break) and collections dip, which the moratorium masks."),
    Preset("late_revision", "A late revision", ("bank", "insurer"), "first estimate too high by, pp", 0.6,
           start_days_ago=10,
           note="The two months before the start were first published too high and revised down at the start."),
    Preset("dominant_obligor", "One customer drives a move", ("bank",), "rise in facility use, pp", 3.4,
           note="Business-loan facility use rises, almost all of it from one obligor (change concentration from 0.8)."),
    Preset("few_customers", "Too few customers in a product", ("bank", "insurer"), None,
           note="The smallest product has so few customers that its numbers are suppressed."),
    Preset("reporting_lag", "Late publication", ("bank", "insurer"), None,
           note="Every metric is published three times later than usual, so recent periods are not out yet."),
]
BY_ID = {p.id: p for p in PRESETS}


@dataclass(frozen=True)
class Active:
    id: str
    start: date
    size: float | None


def presets(kind: Kind) -> list[Preset]:
    return [p for p in PRESETS if kind in p.kinds]


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
