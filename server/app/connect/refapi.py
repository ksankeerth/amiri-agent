"""The Metrics Spec reference API's request rules, shared by the server that serves imported data (imported.py):
its errors (RFC 9457 with the spec's codes, each with its own status), the grid, the per-call limits, and the
parsing of dates, numbers, filters, vintage parameters and page tokens."""

import base64
import json
from datetime import date, timedelta
from typing import ClassVar

from fastapi.responses import JSONResponse

SPEC_VERSION = "1.0.0"
MAX_DAILY_DAYS = 1200
MAX_MONTHS = 120
PAGE_MAX = 500
MAX_FILTERS = 3
RELATIVE = {"last", "last_days", "last_n", "window", "period", "mtd", "ytd", "to_date", "since"}
SERIES_PARAMS = {"product_id", "metric", "start", "until", "known_through", "same_age_days", "segment_as_of",
                 "currency_basis", "page_size", "page_token"}


class Fail(Exception):
    """A Metrics Spec problem (RFC 9457, spec code, the same status per code)."""

    STATUS: ClassVar[dict[str, int]] = {
        "off_grid": 400, "relative_window": 400, "range_too_large": 400, "invalid_parameter": 400,
        "too_many_filters": 400, "segment_date_not_on_grid": 400, "windows_invalid": 400,
        "alias_filter_conflict": 400, "known_through_in_future": 400, "unsupported_version": 400,
        "unauthorized": 401, "forbidden": 403, "unknown_product": 404, "unknown_metric": 404,
        "unknown_breakdown": 422, "value_not_allowed": 422, "filter_set_not_allowed": 422,
        "unsupported_capability": 422, "rate_limited": 429, "internal": 500, "not_implemented": 501,
        "unavailable": 503}
    TITLES: ClassVar[dict[int, str]] = {
        400: "Invalid request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 422: "Can't be served",
        429: "Too many requests", 500: "Internal error", 501: "Not implemented", 503: "Unavailable"}

    def __init__(self, code: str, detail: str, parameter: str | None = None):
        self.code, self.detail, self.parameter = code, detail, parameter
        self.status = self.STATUS[code]


def problem(f: Fail) -> JSONResponse:
    body = {"type": f"https://metrics-spec.example/problems/{f.code}", "title": Fail.TITLES[f.status],
            "status": f.status, "code": f.code, "detail": f.detail, "parameter": f.parameter}
    headers = {"Metrics-Spec-Version": SPEC_VERSION}
    if f.status in (429, 503):
        headers["Retry-After"] = "30"
    return JSONResponse(body, status_code=f.status, headers=headers, media_type="application/problem+json")


def answer(body: dict) -> JSONResponse:
    return JSONResponse(body, headers={"Metrics-Spec-Version": SPEC_VERSION})


def check_version(expected: str | None) -> None:
    """The Metrics-Spec-Version a client sends must have our MAJOR."""
    if expected and expected.split(".")[0] != SPEC_VERSION.split(".")[0]:
        raise Fail("unsupported_version", f"This server implements Metrics Spec {SPEC_VERSION}; "
                   f"{expected} has a different MAJOR.")


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


def periods_in_months(start: date, until: date) -> int:
    return (until.year - start.year) * 12 + until.month - start.month


# ---------------------------------------------------------------- parameters


def parse_date(q, name: str, required: bool = True) -> date | None:
    v = q.get(name)
    if v is None or v == "":
        if required:
            raise Fail("invalid_parameter", f"{name} is required.", name)
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise Fail("invalid_parameter", f"{name} must be a local date (YYYY-MM-DD); got {v}.", name) from None


def parse_int(q, name: str, lo: int, hi: int) -> int | None:
    v = q.get(name)
    if v is None or v == "":
        return None
    try:
        n = int(v)
    except ValueError:
        raise Fail("invalid_parameter", f"{name} must be a whole number.", name) from None
    if not lo <= n <= hi:
        raise Fail("invalid_parameter", f"{name} must be between {lo} and {hi}.", name)
    return n


def parse_filter(q) -> dict[str, str]:
    out = {}
    for k, v in q.multi_items():
        if k.startswith("filter[") and k.endswith("]"):
            out[k[7:-1]] = v
    return out


def check_filter(key: str, breakdowns: dict[str, list[str]], filt: dict[str, str]) -> None:
    if len(filt) > MAX_FILTERS:
        raise Fail("too_many_filters", f"At most {MAX_FILTERS} breakdowns per request; got {len(filt)}.", "filter")
    for dim, v in filt.items():
        if dim not in breakdowns:
            raise Fail("unknown_breakdown", f"{key} has no breakdown {dim} here "
                       f"({', '.join(breakdowns) or 'none'}).", f"filter[{dim}]")
        if v not in breakdowns[dim]:
            raise Fail("value_not_allowed", f"{v} is not a value of {dim} ({', '.join(breakdowns[dim])}).",
                       f"filter[{dim}]")


def check_window(key: str, grain: str, start: date, until: date, names=("start", "until")) -> None:
    for d, n in ((start, names[0]), (until, names[1])):
        if not on_grid(grain, d):
            rule = {"weekly": "a Monday", "monthly": "the 1st of a month",
                    "quarterly": "the 1st of a quarter"}.get(grain, "a date")
            raise Fail("off_grid", f"{key} is {grain}; {n} must be {rule}. Got {d} ({d.strftime('%A')}).", n)
    if until <= start:
        raise Fail("invalid_parameter", f"{names[1]} must be after {names[0]}.", names[1])
    if grain == "daily" and (until - start).days > MAX_DAILY_DAYS:
        raise Fail("range_too_large", f"At most {MAX_DAILY_DAYS} days per call for daily metrics.", names[1])
    if grain != "daily" and periods_in_months(start, until) > MAX_MONTHS:
        raise Fail("range_too_large", f"At most {MAX_MONTHS} months per call.", names[1])


def vintage_params(q, today: date) -> tuple[date, bool, int | None]:
    """(known_through, whether it was given, same_age_days). known_through is inclusive: today's own data isn't
    complete, so the latest view is as of yesterday."""
    kt = parse_date(q, "known_through", required=False)
    if kt and kt > today:
        raise Fail("known_through_in_future", f"known_through {kt} is after today ({today}).", "known_through")
    seg = parse_date(q, "segment_as_of", required=False)
    if seg and seg.weekday() != 0:
        raise Fail("segment_date_not_on_grid", f"segment_as_of must be a Monday; got {seg} ({seg.strftime('%A')}).",
                   "segment_as_of")
    basis = q.get("currency_basis", "original")
    if basis not in ("original", "base"):
        raise Fail("invalid_parameter", "currency_basis is original or base.", "currency_basis")
    return kt or today - timedelta(days=1), kt is not None, parse_int(q, "same_age_days", 0, 730)


def page_token(offset: int, kt: date, version: int) -> str:
    """A page token pins the vintage of the first page (C18) and the data it was read from."""
    return base64.urlsafe_b64encode(json.dumps({"o": offset, "k": kt.isoformat(), "v": version}).encode()).decode()


def read_page_token(token: str, version: int) -> tuple[int, date]:
    try:
        tok = json.loads(base64.urlsafe_b64decode(token).decode())
        offset, kt, v = int(tok["o"]), date.fromisoformat(tok["k"]), int(tok["v"])
    except (ValueError, KeyError, TypeError):
        raise Fail("invalid_parameter", "page_token isn't one this server gave.", "page_token") from None
    if v != version:
        raise Fail("invalid_parameter", "page_token is from data that has since been replaced; start again.",
                   "page_token")
    return offset, kt
