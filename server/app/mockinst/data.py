"""The numbers a sample institution serves: grid periods, values per cell, vintages, suppression and the
effects of the conditions switched on. Pure functions over model.Institution; no database.

A value is the "mature" one first (what the period settles at). Vintages then say what was known on
a given date: nothing before publication, claims still coming in (development), a late revision."""

import math
from dataclasses import dataclass
from datetime import date, timedelta
from functools import cache
from itertools import pairwise

from app.investigation.calendar import calendar as public_calendar
from app.mockinst.conditions import Active
from app.mockinst.model import (
    DEVELOPS,
    MIN_CONTRIBUTORS,
    Institution,
    Metric,
    Product,
    rng,
)

DEVELOPMENT = ((0, 0.55), (7, 0.7), (14, 0.82), (30, 0.93), (60, 0.985), (90, 1.0))  # (age in days, share reported)
WEEKDAY = {0: 1.15, 1: 1.0, 2: 0.95, 3: 0.95, 4: 1.1, 5: 0.6, 6: 0.5}
# Flows that follow local pay days (a remittance follows the sender's pay day abroad, so it doesn't)
SALARY_LINKED = {"deposit_inflow", "withdrawals", "card_spend", "cash_withdrawals", "digital_transactions",
                 "td_placements", "contributions", "premium_collection_rate"}
GROWTH = 0.05      # a year
EPOCH = date(2023, 1, 1)


# ---------------------------------------------------------------- the calendar


@dataclass(frozen=True)
class Day:
    date: date
    business: bool
    holidays: tuple[str, ...]
    flags: tuple[str, ...]
    month_bday: int | None
    month_bday_from_end: int | None


@cache
def _year_days(country: str, time_zone: str, year: int) -> tuple[Day, ...]:
    raw = public_calendar(country, time_zone, date(year, 1, 1), date(year + 1, 1, 1))
    weekend = set(raw["weekend_days"])
    rows = raw["days"]
    out: list[Day] = []
    by_month: dict[int, list[int]] = {}
    for i, r in enumerate(rows):
        if r["business"]:
            by_month.setdefault(date.fromisoformat(r["date"]).month, []).append(i)
    for i, r in enumerate(rows):
        d = date.fromisoformat(r["date"])
        flags = []
        if d.isoweekday() in weekend:
            flags.append("weekend")
        if r["holidays"]:
            flags += ["public_holiday"]
        month = by_month.get(d.month, [])
        rank = from_end = None
        if r["business"]:
            rank = month.index(i) + 1
            from_end = len(month) - rank
            if from_end == 0:
                flags.append("month_end")
                if d.month in (3, 6, 9, 12):
                    flags.append("quarter_end")
            if from_end <= 1:
                flags.append("salary_day")
            if i > 0 and not rows[i - 1]["business"] and rows[i - 1]["holidays"]:
                flags.append("after_holiday")
        if d.month == 12 and r["business"]:
            flags.append("season:year_end")
        out.append(Day(d, r["business"], tuple(r["holidays"]), tuple(flags), rank, from_end))
    return tuple(out)


@cache
def _day_map(country: str, time_zone: str, year: int) -> dict[date, Day]:
    return {d.date: d for d in _year_days(country, time_zone, year)}


def days(inst: Institution, start: date, until: date) -> list[Day]:
    out, d = [], start
    while d < until:
        out.append(_day_map(inst.country, inst.time_zone, d.year)[d])
        d += timedelta(days=1)
    return out


def weekend_days(inst: Institution) -> list[int]:
    return sorted(set(public_calendar(inst.country, inst.time_zone, EPOCH, EPOCH + timedelta(days=7))["weekend_days"]))


# ---------------------------------------------------------------- the grid


def on_grid(grain: str, d: date) -> bool:
    if grain == "weekly":
        return d.weekday() == 0
    if grain == "monthly":
        return d.day == 1
    if grain == "quarterly":
        return d.day == 1 and d.month in (1, 4, 7, 10)
    return True


def next_start(grain: str, d: date) -> date:
    if grain == "daily":
        return d + timedelta(days=1)
    if grain == "weekly":
        return d + timedelta(days=7)
    step = 3 if grain == "quarterly" else 1
    y, m = divmod(d.year * 12 + d.month - 1 + step, 12)
    return date(y, m + 1, 1)


def first_on_grid(grain: str, d: date) -> date:
    """The first grid date on or after d."""
    while not on_grid(grain, d):
        d += timedelta(days=1)
    return d


def periods(inst: Institution, m: Metric, start: date, until: date) -> list[tuple[date, date]]:
    """Closed periods [from, until) of the metric's grid inside [start, until)."""
    grain = m.spec["grain"]
    business_only = grain == "daily" and m.spec.get("day_basis") == "business"
    biz = {d.date for d in days(inst, start, until) if d.business} if business_only else None
    out, d = [], first_on_grid(grain, start)
    while d < until:
        e = next_start(grain, d)
        if e > until:
            break
        if biz is None or d in biz:
            out.append((d, e))
        d = e
    return out


def periods_in_months(grain: str, start: date, until: date) -> int:
    return (until.year - start.year) * 12 + until.month - start.month


# ---------------------------------------------------------------- mature values


@dataclass
class Cell:
    value: float
    numerator: float | None
    denominator: float | None   # ratios
    exposure: float | None      # rates
    volume: int


def _season(inst: Institution, m: Metric, p: tuple[date, date]) -> float:
    return _season_of(inst.country, inst.time_zone, m.spec.get("day_basis") or "business", m.key in SALARY_LINKED,
                      p[0], p[1])


@cache
def _season_of(country: str, time_zone: str, day_basis: str, salary: bool, start: date, until: date) -> float:
    """Calendar effect for flows and counts: weekdays, salary days, the year end; a period's effect is the
    sum over its days (so a period's size follows how many business days it has)."""
    total, d = 0.0, start
    span = []
    while d < until:
        span.append(_day_map(country, time_zone, d.year)[d])
        d += timedelta(days=1)
    def factor(d: Day) -> float:
        f = WEEKDAY[d.date.weekday()] if day_basis == "calendar" else 1.0
        if salary and "salary_day" in d.flags:
            f *= 1.35
        if d.date.month == 12:
            f *= 1.1
        return f

    for d in span:
        if day_basis == "business" and not d.business:
            continue
        total += factor(d)
        if day_basis == "business":
            # flows on the weekday holidays just before are booked on this business day (spec R2)
            back = d.date - timedelta(days=1)
            while True:
                prev = _day_map(country, time_zone, back.year)[back]
                if prev.business:
                    break
                if prev.holidays and back.weekday() < 5:
                    total += factor(prev)
                back -= timedelta(days=1)
    return total


def _effects(inst: Institution, prod: Product, m: Metric, dims: dict[str, str], p: tuple[date, date],
             active: dict[str, Active]) -> tuple[float, float]:
    """(multiplier, added pp or level) from the data conditions on this cell and period."""
    mult, add = 1.0, 0.0
    key, start = m.key, p[0]

    def within(c: Active, days_: int | None, lag: int = 0) -> bool:
        s = c.start + timedelta(days=lag)
        return start >= s and (days_ is None or start < s + timedelta(days=days_))

    c = active.get("currency_slide_importers")
    if c and within(c, 56) and dims.get("segment", "importer") == "importer":
        if key in ("lc_openings", "import_bills"):
            mult *= 1 - (c.size or 0) / 100
        if key == "facility_utilization" and prod.category in ("business_loan", "trade_finance"):
            add += (c.size or 0) / 8
    c = active.get("remittances_fall")
    if c and within(c, None) and key in ("inward_remittance_credits", "inward_remittances"):
        mult *= 1 - (c.size or 0) / 100
    c = active.get("floods")
    if c:
        flood = dims.get("peril") == "flood" or dims.get("claim_type") == "flood"
        if key == "claims_per_1000" and within(c, 21):
            mult *= 1 + (c.size or 0) / 100 * (1.0 if flood else 0.05)
        if key == "moratorium_enrolled" and within(c, 70, lag=14):
            add += 12.0
        if key == "installment_collection_rate" and within(c, 70):
            add -= 3.0
    c = active.get("dominant_obligor")
    if c and within(c, None) and key == "facility_utilization" and prod.category == "business_loan":
        add += c.size or 0
    return mult, add


def mature(inst: Institution, prod: Product, m: Metric, dims: dict[str, str], share: float, p: tuple[date, date],
           active: dict[str, Active]) -> Cell:
    r = rng(prod.id, m.key, sorted(dims.items()), p[0])
    g = (1 + GROWTH) ** ((p[0] - EPOCH).days / 365.25)
    volume = max(0, round(m.volume * share * g))
    if "few_customers" in active and prod is min(inst.products, key=lambda x: x.book):
        volume = round(6 * share)  # about 6 customers in the whole product: below the minimum of 10
    mult, add = _effects(inst, prod, m, dims, p, active)
    k = m.spec["kind"]
    if k in ("flow", "count"):
        v = m.level * share * g * _season(inst, m, p) * (1 + r.gauss(0, 0.05)) * mult
        v = max(0.0, v)
        return Cell(float(round(v)) if k == "count" else round(v, 2), None, None, None, volume)
    if k == "stock":
        wave = 1 + 0.02 * math.sin((p[0] - EPOCH).days / 58.0)
        return Cell(round(m.level * share * g * wave * (1 + r.gauss(0, 0.004)) * mult, 2), None, None, None, volume)
    if k == "ratio":
        den = m.exposure * share * g
        v = m.level + add + r.gauss(0, max(0.02 * m.level, 0.03))
        v = min(100.0, max(0.0, v)) if m.spec["unit"] == "percent" else max(0.0, v)
        return Cell(round(v, 4), round(v / 100 * den, 2), round(den, 2), None, volume)
    if k == "rate":
        units = max(1.0, m.exposure * share * g)
        weeks = (p[1] - p[0]).days / 7
        expected = m.level * weeks * units / 1000 * mult
        num = float(max(0, round(expected + r.gauss(0, math.sqrt(max(expected, 0.0))))))
        return Cell(round(num / units * 1000, 4), num, None, round(units, 2), volume)
    v = m.level * (1.06 ** ((p[0] - EPOCH).days / 365.25) if m.spec["unit"] == "index" else 1.0)
    return Cell(round(v * (1 + r.gauss(0, 0.005)) + add, 4), None, None, None, volume)


# ---------------------------------------------------------------- vintages and rows


def lag_days(m: Metric, active: dict[str, Active]) -> int:
    lag = int(m.spec.get("max_lag_days") or 1)
    return lag * 3 if "reporting_lag" in active else lag


def _dev(age: int) -> float:
    """The share of a period's claims reported by an age, interpolated between the development points."""
    if age <= DEVELOPMENT[0][0]:
        return DEVELOPMENT[0][1]
    for (a0, s0), (a1, s1) in pairwise(DEVELOPMENT):
        if age <= a1:
            return s0 + (s1 - s0) * (age - a0) / (a1 - a0)
    return 1.0


def revision_metric(prod: Product) -> str | None:
    """The metric a late revision lands on: the product's first monthly ratio, else its first ratio."""
    ratios = [m for m in prod.metrics.values() if m.spec["kind"] == "ratio"]
    monthly = [m for m in ratios if m.spec["grain"] == "monthly"]
    pick = (monthly or ratios or [None])[0]
    return pick.key if pick else None


@dataclass
class Row:
    start: date
    until: date
    value: float | None
    numerator: float | None
    denominator: float | None
    exposure: float | None
    volume: int | None
    suppressed: bool
    suppression_reason: str | None
    published_at: date | None
    backfilled: bool
    data_as_of: date
    vintage: str
    revised: bool


def series(inst: Institution, prod: Product, m: Metric, filt: dict[str, str], start: date, until: date,
           known_through: date, same_age: int | None, kt_given: bool, active: dict[str, Active],
           suppress: bool = True) -> tuple[list[Row], list[date]]:
    """Rows for one product and metric, aggregated over the cells matching the filter, as known then."""
    lag = lag_days(m, active)
    cells = [(d, s) for d, s in m.cells if all(d.get(k) == v for k, v in filt.items())]
    live_from = date(m.history_from.year + 1, m.history_from.month, 1)  # earlier rows were back-filled at onboarding
    rev = active.get("late_revision")
    rev_here = rev is not None and revision_metric(prod) == m.key
    rows, unpublished = [], []
    for p in periods(inst, m, max(start, m.history_from), until):
        last = p[1] - timedelta(days=1)
        published = last + timedelta(days=lag)
        if published > known_through:
            if p[1] <= known_through + timedelta(days=1):
                unpublished.append(p[0])
            continue
        read, vintage = known_through, "known_through" if kt_given else "latest"
        if same_age is not None:
            at = last + timedelta(days=same_age)
            if at < published:
                vintage = "missing"
            else:
                read, vintage = min(known_through, at), "same_age"
        agg = _aggregate(inst, prod, m, cells, p, active)
        revised = False
        if m.key in DEVELOPS and agg.numerator is not None:
            age_read, age_pub = (read - last).days, (published - last).days
            f = _dev(age_read)
            agg = Cell(round(agg.value * f, 4), round(agg.numerator * f), None, agg.exposure, agg.volume)
            revised = _dev(age_read) != _dev(age_pub)
        if rev_here and rev.start - timedelta(days=61) <= last < rev.start:
            if read < rev.start:
                bump = rev.size or 0
                v = agg.value + bump
                agg = Cell(round(v, 4), round(v / 100 * agg.denominator, 2) if agg.denominator else agg.numerator,
                           agg.denominator, agg.exposure, agg.volume)
            else:
                revised = True
        small = agg.volume < MIN_CONTRIBUTORS
        sup = suppress and small
        backfilled = last < live_from
        rows.append(Row(p[0], p[1], None if sup else agg.value, None if sup else agg.numerator,
                        None if sup else agg.denominator, None if sup else agg.exposure,
                        None if sup else agg.volume, sup, "small_count" if sup else None,
                        None if backfilled else published, backfilled, read, vintage, revised))
    return rows, unpublished


def _aggregate(inst: Institution, prod: Product, m: Metric, cells, p, active) -> Cell:
    parts = [mature(inst, prod, m, d, s, p, active) for d, s in cells]
    vol = sum(c.volume for c in parts)
    k = m.spec["kind"]
    if not parts:
        return Cell(0.0, None, None, None, 0)
    if k in ("flow", "count", "stock"):
        return Cell(round(sum(c.value for c in parts), 2), None, None, None, vol)
    if k == "ratio":
        num, den = sum(c.numerator for c in parts), sum(c.denominator for c in parts)
        return Cell(round(num / den * 100, 4) if den else 0.0, round(num, 2), round(den, 2), None, vol)
    if k == "rate":
        num, units = sum(c.numerator for c in parts), sum(c.exposure for c in parts)
        return Cell(round(num / units * 1000, 4) if units else 0.0, num, None, round(units, 2), vol)
    shares = [s for _, s in cells]
    return Cell(round(sum(c.value * s for c, s in zip(parts, shares, strict=True)) / sum(shares), 4), None, None, None, vol)


def breaks(inst: Institution, active: dict[str, Active]) -> list[dict]:
    out = []
    c = active.get("floods")
    if c and inst.kind == "bank":
        start = c.start + timedelta(days=14)
        out.append({"break_id": f"brk-relief-{start.isoformat()}", "kind": "relief", "type": "episode",
                    "date": start.isoformat(), "until": (start + timedelta(days=70)).isoformat(),
                    "product_ids": [], "metrics": [], "applies_to": {}, "relief_kind": "credit_moratorium",
                    "factor": None, "event_id": None,
                    "description": "Repayment moratorium offered to borrowers in flood-hit areas.",
                    "declared_at": f"{start.isoformat()}T09:00:00+00:00"})
    return out
