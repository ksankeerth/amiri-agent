"""A simulation's price path and its detector.

The path is a seeded random walk at the template's frozen daily move (never read from a live
series, so a run repeats exactly), BASE_DAYS before the start, then the template's shock. One
bar per business day at the step time (18:00 local). The market-series detector runs on it as a
pure function; nothing touches the live series' row, state or cooldown.
"""

import math
import random
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app import settings
from app.series import detect


def _business_days(first: date, last: date) -> list[date]:
    out, d = [], first
    while d <= last:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def path(built: dict) -> list[tuple[datetime, float]]:
    """Every bar of the simulation, oldest first: the base, then the scenario's days."""
    p, c = built["prices"], built["clock"]
    tz = ZoneInfo(built["institution"]["time_zone"])
    start = datetime.fromisoformat(c["start_at"]).astimezone(tz).date()
    end = start + timedelta(days=c["steps"] - 1)
    days = _business_days(start - timedelta(days=p["base_days"]), end)
    rnd = random.Random(p["seed"])
    sigma = p["sigma_daily_pct"] / 100
    walk, level = [], 1.0
    for _ in days:
        level *= math.exp(rnd.gauss(0, sigma))
        walk.append(level)
    at_start = next(i for i, d in enumerate(days) if d >= start) - 1  # the last base day
    scale = p["level"] / walk[max(at_start, 0)]
    s = p["shock"]
    out, b = [], 0
    for d, w in zip(days, walk, strict=True):
        close = w * scale
        if d >= start and not p.get("off"):
            b += 1
            close *= 1 + s["size_pct"] / 100 * min(b, s["ramp_business_days"]) / s["ramp_business_days"]
        hh, mm = (int(x) for x in c["step_time"].split(":"))
        out.append((datetime.combine(d, time(hh, mm), tz).astimezone(ZoneInfo("UTC")), round(close, 6)))
    return out


def params() -> detect.Params:
    return detect.Params(settings.number("SERIES_Z_THRESHOLD"), settings.integer("SERIES_SIGMA_DAYS"),
                         settings.integer("SERIES_MIN_SIGMA_DAYS"),
                         [int(x) for x in settings.names("SERIES_WINDOWS_DAYS")])


def evaluate(bars: list[tuple[datetime, float]], name: str) -> dict:
    """The detector on the bars up to now (the latest is the step's close)."""
    return detect.evaluate(bars, params(), name)
