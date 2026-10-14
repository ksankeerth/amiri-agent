"""Which product type x angle x mechanism each event touches.

Code only. A mechanism is listed when one of its triggers matches one of the
event's themes (theme, direction and, for prices and commodities, the item) and the event's
size meets its minimum (scaled to the series' typical move for market moves). An unknown
size doesn't block (the model judges); a size in another unit (bp vs pct) doesn't apply.
"""

from dataclasses import dataclass, field

from app.contract import Event, Limits
from app.tracks import MECHANISMS, TUNED_TYPICAL_DAILY_PCT, Mechanism


@dataclass
class Candidate:
    event_id: str
    product_type: str
    angle: str
    mechanisms: list[Mechanism]
    product_ids: list[str]
    book_size: float = 0.0

    @property
    def strength(self) -> str:
        return (
            "primary"
            if any(m.strength == "primary" for m in self.mechanisms)
            else "secondary"
        )

    @property
    def context_only(self) -> bool:
        return all(m.context for m in self.mechanisms)


@dataclass
class Listing:
    to_screen: list[Candidate] = field(default_factory=list)
    context: list[Candidate] = field(default_factory=list)
    cut_by_cap: list[Candidate] = field(default_factory=list)


def triggered(m: Mechanism, event: Event) -> bool:
    for trigger in m.triggers:
        for tag in event.themes:
            if (tag.theme, tag.direction) != (trigger.theme, trigger.direction):
                continue
            if trigger.items is not None:
                item = tag.item or ("general" if tag.theme == "prices" else None)
                # a disaster of unknown kind may be any of them
                if item not in trigger.items and not (
                    tag.theme == "disaster" and item is None
                ):
                    continue
            if m.min_size and event.size and event.size.unit == m.min_size[1]:
                if event.size.value < min_size(
                    m.min_size[0], m.min_size[1], trigger.theme, event
                ):
                    continue
            return True
    return False


def min_size(value: float, unit: str, theme: str, event: Event) -> float:
    """The mechanism's minimum, scaled to the moved series' own typical daily move."""
    tuned = TUNED_TYPICAL_DAILY_PCT.get(theme)
    if unit == "pct" and tuned and event.typical_daily_move_pct:
        return value * event.typical_daily_move_pct / tuned
    return value


def list_candidates(
    event: Event, products: dict[str, tuple[str, float, str | None]], limits: Limits
) -> Listing:
    """products: product_id -> (the tracks' product type, book size, Metrics Spec type)."""
    by_type: dict[str, list[str]] = {}
    book: dict[str, float] = {}
    spec_type: dict[str, str | None] = {}
    for pid, (ptype, size, stype) in products.items():
        by_type.setdefault(ptype, []).append(pid)
        book[ptype] = book.get(ptype, 0.0) + size
        spec_type[pid] = stype

    grouped: dict[tuple[str, str], Candidate] = {}
    for m in MECHANISMS:
        if m.product_type not in by_type or not triggered(m, event):
            continue
        pids = [
            p
            for p in by_type[m.product_type]
            if not m.only_spec_types or spec_type[p] in m.only_spec_types
        ]
        if not pids:
            continue
        key = (m.product_type, m.angle)
        c = grouped.setdefault(
            key,
            Candidate(
                event.event_id, m.product_type, m.angle, [], [], book[m.product_type]
            ),
        )
        c.mechanisms.append(m)
        c.product_ids = sorted(set(c.product_ids) | set(pids))

    listing = Listing()
    ranked = []
    for c in grouped.values():
        (listing.context if c.context_only else ranked).append(c)
    ranked.sort(
        key=lambda c: (c.strength != "primary", -c.book_size, c.product_type, c.angle)
    )

    # The best angle of each product type first, so no type is starved; then the rest.
    chosen: dict[str, list[Candidate]] = {}
    for c in ranked:
        if c.product_type not in chosen and len(chosen) < limits.max_types_per_event:
            chosen[c.product_type] = [c]
    for c in ranked:
        angles = chosen.get(c.product_type)
        if (
            angles is not None
            and c not in angles
            and len(angles) < limits.max_angles_per_type
        ):
            angles.append(c)
    picked = {id(c) for cs in chosen.values() for c in cs}
    for c in ranked:
        (listing.to_screen if id(c) in picked else listing.cut_by_cap).append(c)
    return listing
