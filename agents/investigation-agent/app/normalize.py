"""From classified findings to events. Code only, no model.

- where a finding is about, for this institution, is read from its place codes, the
  footprint and the flows when it has places (`where`); else from the model:
  home, a footprint country (it operates there), or abroad with a channel or none,
- an fx move counts for the book in that currency: the base currency's (home), a
  footprint country's, or none (a currency the institution doesn't book in),
- findings about neither home nor the footprint (and with no channel) are set aside,
- implied themes are added (rates up => bond prices down; crude oil up => fuel prices
  up; a flood with a moratorium => central_bank_relief),
- each event gets a size, read from its signals where possible, and the moved
  series' typical daily move,
- an anchor time: a market move's start; else effective_from, else the period's start
  (local midnight in the institution's time zone), else the start of a move, else the
  headline's time,
- findings about the same move (same theme, direction and country, anchors
  within 48 hours) become one event, and opposite fx moves are netted.
"""

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta, tzinfo

from app.contract import (
    Event,
    Finding,
    Institution,
    OutOfScope,
    PlaceInfo,
    Size,
    ThemeTag,
)
from app.tracks import IMPLIED, ITEM_IMPLIED

SAME_EVENT = timedelta(hours=48)
CHANNEL_THEMES = {"remittance": {"remittance"}, "sector": {"sector"}}
# Abroad, in a remittance corridor: what cuts migrant workers' jobs or pay.
HURTS_MIGRANT_WORK = {
    ("sector", "shock"),
    ("macro", "worse"),
    ("disaster", "abroad"),
    ("disaster", "domestic"),
    ("regulation", "central_bank_direction"),
    ("regulation", "tax"),
}
RELIEF_WORDS = re.compile(r"\b(moratorium|relief|concession|reschedul)", re.IGNORECASE)
IN_SCOPE = ("home", "footprint")


@dataclass
class Reading:
    """What the model read from one finding (classify step), already checked by code."""

    finding_id: str
    themes: list[ThemeTag]
    country: str = "home"
    channel: str = "none"
    size: Size | None = None  # only if the number appears in the finding's text
    effective_from: date | None = None
    why: str | None = None  # how country and channel were set, when by code
    country_code: str | None = None  # the footprint country, when country is footprint


@dataclass
class _Member:
    finding: Finding
    reading: Reading
    themes: list[ThemeTag]
    anchor: datetime
    basis: str
    size: Size | None


@dataclass
class Normalized:
    events: list[Event] = field(default_factory=list)
    out_of_scope: list[OutOfScope] = field(default_factory=list)


ISO_PLACE = re.compile(r"^([A-Z]{2})(?:-([A-Z0-9]{1,3}))?$")
REMITTANCE_FLOWS = ("remittances_in", "remittances_out")
TRADE_FLOWS = ("exports", "imports")


def country_of(code: str, info: dict[str, PlaceInfo]) -> str | None:
    """The ISO country of a place code: ISO 3166 itself, or the server's gazetteer for other codes."""
    if code in info:
        return info[code].country
    m = ISO_PLACE.match(code)
    return m.group(1) if m else None


def regions_of(places: list[str], info: dict[str, PlaceInfo]) -> list[str]:
    """ISO 3166-2 codes the places are in (the codes themselves, and the gazetteer's regions)."""
    out = set()
    for p in places:
        m = ISO_PLACE.match(p)
        if m and m.group(2):
            out.add(p)
        if p in info:
            out |= {r for r in (info[p].region_l1, info[p].region_l2) if r}
    return sorted(out)


def where(
    places: list[str], inst: Institution, info: dict[str, PlaceInfo]
) -> tuple[str, str, str, str | None] | None:
    """(country, channel, why, footprint country) from a finding's places, by code; None when
    no place can be read.

    home: a place in the home country. footprint: in a country where the institution
    operates. Abroad: remittance when the country is a remittance corridor or the far end
    of a remittance flow; sector when it is a trade partner; else none.
    """
    countries = sorted({c for p in places if (c := country_of(p, info))})
    if not countries:
        return None
    if inst.country in countries:
        return "home", "none", f"place in {inst.country}", None
    if hit := sorted(set(countries) & inst.footprint_countries()):
        return "footprint", "none", f"{hit[0]}: the institution operates there", hit[0]
    ends = {kind: {country_of(f.counterpart, info) for f in inst.flows if f.kind in kind}
            for kind in (REMITTANCE_FLOWS, TRADE_FLOWS)}  # fmt: skip
    remit = set(ends[REMITTANCE_FLOWS]) | set(inst.corridors)
    if hit := sorted(set(countries) & remit):
        return (
            "other",
            "remittance",
            f"{', '.join(hit)}: remittances to {inst.country}",
            None,
        )
    if hit := sorted(set(countries) & ends[TRADE_FLOWS]):
        return (
            "other",
            "sector",
            f"{', '.join(hit)}: a trade partner of {inst.country}",
            None,
        )
    return (
        "other",
        "none",
        f"{', '.join(countries)}: no flow to {inst.country} in the profile",
        None,
    )


def fx_book(r: Reading, inst: Institution) -> str | None:
    """Applies the currency rule to an fx reading: the move counts for the book in that currency.
    Returns why the fx themes were dropped, or None."""
    fx = [t for t in r.themes if t.theme == "fx"]
    if not fx:
        return None
    currency = fx[0].currency or inst.currency
    book = inst.currency_country(currency)
    if book == "home":
        return None
    if book:  # a footprint country's currency
        if r.country not in IN_SCOPE or r.country_code is None:
            r.country, r.country_code, r.channel = "footprint", book, "none"
            r.why = (
                f"{currency}: the currency of {book}, where the institution operates"
            )
        return None
    r.themes = [t for t in r.themes if t.theme != "fx"]
    return f"{currency}: a currency the institution doesn't book in"


def local_midnight(d: date, zone: tzinfo | None) -> datetime:
    return datetime.combine(d, time(0, 0), zone or UTC).astimezone(UTC)


def _anchor(f: Finding, r: Reading, zone: tzinfo | None) -> tuple[datetime, str] | None:
    if (
        f.kind == "signal_move" and f.evidence.signals
    ):  # a market move starts when it starts, not at midnight
        return min(s.start_at for s in f.evidence.signals), "move_start"
    effective = f.effective_from or r.effective_from
    if effective:
        return local_midnight(effective, zone), "effective_from"
    if f.period:
        return local_midnight(f.period.start, zone), "period_start"
    if f.evidence.signals:
        return min(s.start_at for s in f.evidence.signals), "move_start"
    if f.evidence.headlines:
        return min(h.published_at for h in f.evidence.headlines), "published_at"
    return None


def _size(f: Finding, theme: str, given: Size | None) -> Size | None:
    """The driver's size from the finding's signals, else what the model read from its text."""
    for s in f.evidence.signals:
        if theme == "rates" and max(abs(s.ref_level), abs(s.obs_level)) < 50:
            return Size(value=round(abs(s.obs_level - s.ref_level) * 100, 1), unit="bp")
        if theme in ("fx", "commodities", "prices", "markets"):
            return Size(value=round(abs(s.change_pct), 2), unit="pct")
    return given


def _with_implied(themes: list[ThemeTag], f: Finding) -> list[ThemeTag]:
    out = list(themes)
    have = {(t.theme, t.direction) for t in out}
    for t in themes:
        for theme, direction in IMPLIED.get((t.theme, t.direction), []):
            if (theme, direction) not in have:
                out.append(ThemeTag(theme=theme, direction=direction, implied=True))
                have.add((theme, direction))
    for t in themes:
        if (implied := ITEM_IMPLIED.get((t.theme, t.item or ""))) and (
            implied[0],
            t.direction,
        ) not in have:
            out.append(
                ThemeTag(
                    theme=implied[0],
                    direction=t.direction,
                    item=implied[1],
                    implied=True,
                )
            )
            have.add((implied[0], t.direction))
    text = f"{f.title} {f.explanation}"
    if ("disaster", "domestic") in have and (
        "regulation",
        "central_bank_relief",
    ) not in have:
        if RELIEF_WORDS.search(text):
            out.append(
                ThemeTag(
                    theme="regulation", direction="central_bank_relief", implied=True
                )
            )
    return out


def normalize(
    findings: list[Finding],
    readings: dict[str, Reading],
    inst: Institution,
    info: dict[str, PlaceInfo] | None = None,
    as_of: datetime | None = None,
) -> Normalized:
    info = info or {}
    zone = inst.zone()
    result = Normalized()
    members: list[_Member] = []
    for f in findings:
        r = readings.get(f.finding_id)
        dropped = fx_book(r, inst) if r else None
        if r is None or (not r.themes and r.country in IN_SCOPE):
            result.out_of_scope.append(
                OutOfScope(
                    finding_id=f.finding_id,
                    reason="not_home_country" if dropped else "no_theme",
                    note=dropped,
                )
            )
            continue
        themes = r.themes
        if r.country not in IN_SCOPE:
            keep = CHANNEL_THEMES.get(r.channel, set())
            if (
                r.channel == "remittance"
                and not any(t.theme == "remittance" for t in themes)
                and any((t.theme, t.direction) in HURTS_MIGRANT_WORK for t in themes)
            ):
                # bad news where the senders work reaches home as fewer remittances
                themes = [
                    *themes,
                    ThemeTag(theme="remittance", direction="down", implied=True),
                ]
            themes = [t for t in themes if t.theme in keep]
            if not themes:
                result.out_of_scope.append(
                    OutOfScope(
                        finding_id=f.finding_id,
                        reason="not_home_country",
                        note=(r.why or f"country {r.country}, channel {r.channel}")[
                            :400
                        ],
                    )
                )
                continue
        anchored = _anchor(f, r, zone)
        if (
            anchored is not None
            and as_of is not None
            and anchored[0] > as_of + timedelta(hours=1)
        ):
            result.out_of_scope.append(
                OutOfScope(
                    finding_id=f.finding_id,
                    reason="after_as_of",
                    note=f"anchored {anchored[0]:%Y-%m-%d %H:%M} UTC, after the run's time {as_of:%Y-%m-%d %H:%M} UTC",
                )
            )
            continue
        if anchored is None:
            result.out_of_scope.append(
                OutOfScope(
                    finding_id=f.finding_id,
                    reason="no_theme",
                    note="no time to anchor to",
                )
            )
            continue
        themes = _with_implied(themes, f)
        size = _size(f, themes[0].theme, r.size)
        members.append(_Member(f, r, themes, anchored[0], anchored[1], size))

    groups: list[list[_Member]] = []
    for m in sorted(members, key=lambda m: m.anchor):
        lead = m.themes[0]
        for g in groups:
            first = g[0]
            same_move = (
                (first.themes[0].theme, first.themes[0].direction)
                == (lead.theme, lead.direction)
                and (first.reading.country, first.reading.country_code)
                == (m.reading.country, m.reading.country_code)
                and abs(m.anchor - first.anchor) <= SAME_EVENT
            )
            if same_move:
                g.append(m)
                break
        else:
            groups.append([m])

    groups, netted = _net_opposite_fx(groups)
    for i, g in enumerate(groups, start=1):
        event_id = f"e-{i}"
        first = g[0]
        themes: list[ThemeTag] = list(first.themes)
        for m in g[1:]:
            for t in m.themes:
                if all(t.theme != x.theme for x in themes):
                    themes.append(t)
        sizes = [m.size for m in g if m.size]
        size = (
            first.size
            if id(g) in netted
            else (max(sizes, key=lambda s: s.value) if sizes else None)
        )
        places = sorted({p for m in g for p in m.finding.places})
        typical = [
            s.typical_daily_move_pct
            for m in g
            for s in m.finding.evidence.signals
            if s.typical_daily_move_pct
        ]
        result.events.append(
            Event(
                event_id=event_id,
                finding_ids=[m.finding.finding_id for m in g],
                themes=themes,
                country=first.reading.country,
                country_code=first.reading.country_code,
                anchor=first.anchor,
                anchor_basis=first.basis,
                size=size,
                typical_daily_move_pct=typical[0] if typical else None,
                places=places,
                regions=regions_of(places, info),
                countries=sorted({c for p in places if (c := country_of(p, info))}),
            )
        )
        for m in g[1:]:
            result.out_of_scope.append(
                OutOfScope(
                    finding_id=m.finding.finding_id,
                    reason="merged_into_event",
                    event_id=event_id,
                )
            )
    return result


def _net_opposite_fx(
    groups: list[list[_Member]],
) -> tuple[list[list[_Member]], set[int]]:
    """A currency weaker, then stronger within 48 hours: one move, the net of the two, at the first anchor."""
    out: list[list[_Member]] = []
    netted: set[int] = set()
    for g in groups:
        lead = g[0].themes[0]
        partner = next(
            (
                o
                for o in out
                if lead.theme == "fx" == o[0].themes[0].theme
                and o[0].themes[0].direction != lead.direction
                and o[0].themes[0].currency == lead.currency
                and abs(g[0].anchor - o[0].anchor) <= SAME_EVENT
            ),
            None,
        )
        if partner is None:
            out.append(g)
            continue
        first, a, b = partner[0], partner[0].size, g[0].size
        if a and b and a.unit == b.unit:
            net = a.value - b.value
            direction = first.themes[0].direction if net >= 0 else lead.direction
            first.themes = [
                ThemeTag(theme="fx", direction=direction, currency=lead.currency),
                *first.themes[1:],
            ]
            first.size = Size(value=round(abs(net), 2), unit=a.unit)
        partner.extend(g)
        netted.add(id(partner))
    return out, netted


def extend_into(norm: Normalized, event_id: str, themes: list[ThemeTag]) -> Normalized:
    """One event under the open event's id, carrying only the new themes (and what they imply)."""
    if not norm.events:
        return norm
    wanted = {(t.theme, t.direction, t.currency, t.item) for t in themes}
    keep = [
        t
        for e in norm.events
        for t in e.themes
        if (t.theme, t.direction, t.currency, t.item) in wanted
    ]
    keep += [t for e in norm.events for t in e.themes if t.implied and keep]
    if not keep:
        return Normalized(
            out_of_scope=norm.out_of_scope
            + [
                OutOfScope(
                    finding_id=f, reason="no_theme", note="none of the new themes"
                )
                for e in norm.events
                for f in e.finding_ids
            ]
        )
    first = min(norm.events, key=lambda e: e.anchor)
    merged = first.model_copy(
        update={
            "event_id": event_id,
            "themes": list({(t.theme, t.direction): t for t in keep}.values()),
            "finding_ids": [f for e in norm.events for f in e.finding_ids],
            "places": sorted({p for e in norm.events for p in e.places}),
            "regions": sorted({p for e in norm.events for p in e.regions}),
            "countries": sorted({p for e in norm.events for p in e.countries}),
        }
    )
    out = [o for o in norm.out_of_scope if o.reason != "merged_into_event"]
    return Normalized(events=[merged], out_of_scope=out)
