"""Business days for the investigation: GET /api/v1/internal/calendar.

No data source is connected yet, so the calendar is the home country's public holidays
(the `holidays` package) and its weekend. A connected source's own calendar (Metrics Spec
`business_calendars`, reference API /metrics/v1/calendar) will replace it.
"""

from datetime import date, timedelta

import holidays

from app.problems import Problem

MAX_DAYS = 1200


def calendar(country: str, time_zone: str, start: date, until: date) -> dict:
    if until <= start:
        raise Problem(422, "invalid", "until must be after start.")
    if (until - start).days > MAX_DAYS:
        raise Problem(422, "invalid", f"At most {MAX_DAYS} days at once.")
    try:
        years = range(start.year, until.year + 1)
        cls = holidays.country_holidays(country, years=years)
        english = next((lang for lang in ("en_US", "en_GB", "en") if lang in getattr(cls, "supported_languages", ())), None)
        public = holidays.country_holidays(country, years=years, language=english) if english else cls
        known = True
    except NotImplementedError:
        public, known = {}, False
    weekend = sorted(d + 1 for d in getattr(public, "weekend", {5, 6}))  # ISO weekdays
    days, d = [], start
    while d < until:
        names = [n.strip() for n in public.get(d, "").split(";") if n.strip()] if public else []
        days.append({"date": d.isoformat(), "business": d.isoweekday() not in weekend and not names,
                     "holidays": names})
        d += timedelta(days=1)
    return {"calendar_id": f"{country.lower()}-public-holidays" if known else f"{country.lower()}-weekdays",
            "time_zone": time_zone, "weekend_days": weekend, "holidays_known": known, "days": days}
