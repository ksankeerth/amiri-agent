"""Periods on the catalog grid, snapping, publication, and window values.

A period is a business day (daily), a Monday-to-Sunday week (weekly) or a
calendar month (monthly), `until` exclusive. A Series holds one metric's periods
as the server returned them; window() aggregates whole periods the way the
server does: flows and counts summed, ratios Σnumerator ÷ Σdenominator, rates
per 1,000 of exposure, levels averaged.
"""

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

WEEK = timedelta(days=7)
DAY = timedelta(days=1)


def local_date(t: datetime, time_zone: str) -> date:
    return t.astimezone(ZoneInfo(time_zone)).date()


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    days = [31, 29 if year % 4 == 0 and (year % 100 or year % 400 == 0) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]  # fmt: skip
    return date(year, month, min(d.day, days))


def last_day(until: date) -> date:
    return until - DAY


def period_start(d: date, grain: str) -> date:
    if grain == "weekly":
        return d - timedelta(days=d.weekday())
    if grain == "monthly":
        return d.replace(day=1)
    return d


def next_period(start: date, grain: str) -> date:
    if grain == "weekly":
        return start + WEEK
    if grain == "monthly":
        return add_months(start, 1)
    return start + DAY


def starts_early(d: date, grain: str, calendar: dict[date, dict]) -> bool:
    """The same rule as the investigation's _starts_early."""
    if grain == "weekly":
        return d.weekday() <= 1  # Monday or Tuesday
    if grain == "monthly":
        return d.day <= 3
    return True


def grid(
    grain: str, a: date, b: date, calendar: dict[date, dict]
) -> list[tuple[date, date]]:
    """Whole periods of the grain inside [a, b). Daily: business days."""
    if grain == "daily":
        return [
            (d, d + DAY)
            for d in sorted(calendar)
            if a <= d < b and calendar[d].get("business")
        ]
    out = []
    s = period_start(a, grain)
    if s < a:
        s = next_period(s, grain)
    while next_period(s, grain) <= b:
        out.append((s, next_period(s, grain)))
        s = next_period(s, grain)
    return out


def snap(
    start: date, until: date, grain: str, calendar: dict[date, dict]
) -> tuple[date, date] | None:
    """The watch on whole periods: the start's period if the start falls early in it,
    else the next; the last period ending on or before `until`. None if nothing fits."""
    if grain == "daily":
        days = grid(grain, start, until, calendar)
        return (days[0][0], days[-1][1]) if days else None
    s = period_start(start, grain)
    if s < start and not starts_early(start, grain, calendar):
        s = next_period(s, grain)
    e = s
    while next_period(e, grain) <= until:
        e = next_period(e, grain)
    return (s, e) if e > s else None


@dataclass
class Point:
    """One period of one metric, as metric_history returned it."""

    start: date
    until: date
    value: float | None
    numerator: float | None
    denominator: float | None
    volume: int
    top_share: float
    suppressed: bool
    published_at: date
    data_as_of: date
    vintage: str
    revised: bool

    @classmethod
    def from_row(cls, p: dict[str, Any]) -> "Point":
        """One row of GET /series. A rate's denominator is its exposure."""
        return cls(
            start=date.fromisoformat(p["from"]),
            until=date.fromisoformat(p["until"]),
            value=p.get("value"),
            numerator=p.get("numerator"),
            denominator=p.get("denominator") if p.get("denominator") is not None else p.get("exposure"),
            volume=int(p.get("volume") or 0),
            top_share=float(p.get("top_share") or 0.0),
            suppressed=bool(p.get("suppressed")),
            published_at=date.fromisoformat(p.get("published_at") or p["data_as_of"]),
            data_as_of=date.fromisoformat(p["data_as_of"]),
            vintage=p.get("vintage") or "latest",
            revised=bool(p.get("revised")),
        )


@dataclass
class Agg:
    value: float
    numerator: float | None
    denominator: float | None
    volume_min: int
    periods: int
    weekdays: int


@dataclass
class Series:
    kind: str
    grain: str
    calendar: dict[date, dict]
    points: dict[date, Point] = field(default_factory=dict)
    per_weekday: bool = False  # daily flows over month windows
    bdays: list[date] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.bdays = sorted(d for d, v in self.calendar.items() if v.get("business"))

    @classmethod
    def from_rows(
        cls, body: dict[str, Any], kind: str, grain: str, calendar: dict[date, dict]
    ) -> "Series":
        pts = [Point.from_row(p) for p in body.get("rows", [])]
        return cls(kind, grain, calendar, {p.start: p for p in pts})

    def expected(self, a: date, b: date) -> list[tuple[date, date]]:
        if self.grain == "daily":
            i, j = bisect_left(self.bdays, a), bisect_left(self.bdays, b)
            return [(d, d + DAY) for d in self.bdays[i:j]]
        return grid(self.grain, a, b, self.calendar)

    def business_days_from(self, start: date, n: int) -> list[date]:
        """The first n business days on or after start (fewer if the calendar ends)."""
        i = bisect_left(self.bdays, start)
        return self.bdays[i : i + n]

    def present(self, a: date, b: date) -> list[Point]:
        return [self.points[s] for s, _ in self.expected(a, b) if s in self.points]

    def complete(self, a: date, b: date) -> bool:
        exp = self.expected(a, b)
        return bool(exp) and all(s in self.points for s, _ in exp)

    def suppressed_in(self, a: date, b: date) -> bool:
        return any(p.suppressed for p in self.present(a, b))

    def window(self, a: date, b: date) -> Agg | None:
        """The aggregate over [a, b), or None unless every period is there and shown."""
        if not self.complete(a, b):
            return None
        pts = self.present(a, b)
        if any(p.suppressed or p.value is None for p in pts):
            return None
        num = den = None
        if self.kind in ("ratio", "rate"):
            num = sum(p.numerator or 0.0 for p in pts)
            den = sum(p.denominator or 0.0 for p in pts)
            if not den:
                return None
            value = num / den * (100 if self.kind == "ratio" else 1000)
        elif self.kind == "level":
            value = sum(p.value for p in pts) / len(pts)  # type: ignore[misc]
        else:
            value = sum(p.value for p in pts)  # type: ignore[misc]
        weekdays = sum(
            1 for i in range((b - a).days) if (a + timedelta(days=i)).weekday() < 5
        )
        if self.per_weekday and self.kind in ("flow", "count") and weekdays:
            value /= weekdays
        return Agg(value, num, den, min(p.volume for p in pts), len(pts), weekdays)


def published(p_until: date, lag_days: int) -> date:
    """When a period is published: its last day + the lag, in calendar days."""
    return last_day(p_until) + timedelta(days=lag_days)
