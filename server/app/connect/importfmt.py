"""The import format for the institution's own data (amiri-institution-data/1), checked strictly on upload.

A file is a snapshot of what the institution's Metrics Spec reference API would answer: its catalog, its primary
business calendar, its breaks, and one series per product, metric and filter, with the rows the API would return
(plus, where a value was revised, the values it had before). IMPORT_FORMAT.md describes it for people.

`read(doc, today)` returns the cleaned document or raises Invalid with every problem found (up to MAX_ERRORS),
each saying where (series[3].rows[12].value) and what. Upload checks that the data can be served as the reference
API; whether it is conformant and covers the profile is the connector's Check."""

import math
import re
from dataclasses import dataclass, field
from datetime import date
from itertools import product as cartesian
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.connect.checker import schema_errors
from app.connect.refapi import MAX_FILTERS, next_start, on_grid

FORMAT = "amiri-institution-data/1"
SPEC_MAJOR = "1"
MAX_ERRORS = 50
MAX_SERIES = 5000
MAX_ROWS = 5000            # rows in one series
TOP = {"format", "metrics_spec", "as_of", "about", "catalog", "calendar", "breaks", "series"}
TOP_REQUIRED = ("format", "metrics_spec", "as_of", "catalog", "calendar", "breaks", "series")
SERIES_KEYS = {"product_id", "metric", "filter", "currency", "rows"}
ROW_KEYS = {"from", "until", "value", "numerator", "denominator", "exposure", "volume", "suppressed",
            "suppression_reason", "published_at", "backfilled", "extras", "vintages"}
NUMBERS = ("value", "numerator", "denominator", "exposure")
VINTAGE_KEYS = {"superseded_on", "value", "numerator", "denominator", "exposure", "volume"}
SUPPRESSION = {"small_count", "dominance", "numerator_dominance", "complementary", "segment_difference", "local_rule"}
CURRENCY = re.compile(r"^[A-Z]{3}$")


class Invalid(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__(f"{len(errors)} problem(s)")
        self.errors = errors


@dataclass
class Errors:
    items: list[dict] = field(default_factory=list)
    more: int = 0

    def add(self, where: str, message: str) -> None:
        if len(self.items) < MAX_ERRORS:
            self.items.append({"field": where, "message": message})
        else:
            self.more += 1

    @property
    def full(self) -> bool:
        return len(self.items) >= MAX_ERRORS


def series_key(product_id: str, metric: str, filt: dict[str, str]) -> str:
    """One series' identity: product/metric?dim=value&… (dimensions sorted)."""
    q = "&".join(f"{k}={v}" for k, v in sorted(filt.items()))
    return f"{product_id}/{metric}" + (f"?{q}" if q else "")


def _date(x: Any) -> date | None:
    if not isinstance(x, str) or len(x) != 10:
        return None
    try:
        return date.fromisoformat(x)
    except ValueError:
        return None


def _num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _schema(e: Errors, where: str, name: str, body: Any) -> bool:
    found = schema_errors(name, body)
    for msg in found[:10]:
        path, _, what = msg.partition(": ")
        e.add(where if path == "(the whole body)" else f"{where}.{_dotted(path)}", what)
    return not found


def _dotted(path: str) -> str:
    """products/0/metrics/2/grain → products[0].metrics[2].grain"""
    out = ""
    for part in path.split("/"):
        out += f"[{part}]" if part.isdigit() else (f".{part}" if out else part)
    return out


def read(doc: Any, today: date) -> dict:
    """The file, checked; raises Invalid. Returns {as_of, about, catalog (filter_sets filled in), calendar, breaks,
    series: [{key, product_id, metric, filter, currency, rows}], summary}."""
    e = Errors()
    if not isinstance(doc, dict):
        raise Invalid([{"field": "(the file)", "message": "must be a JSON object"}])
    for k in TOP_REQUIRED:
        if k not in doc:
            e.add(k, "is missing")
    for k in sorted(set(doc) - TOP):
        e.add(k, "isn't part of the format")
    if doc.get("format") not in (None, FORMAT):
        e.add("format", f"must be {FORMAT}; got {str(doc.get('format'))[:40]}")
    ms = doc.get("metrics_spec")
    if "metrics_spec" in doc and (not isinstance(ms, str) or ms.split(".")[0] != SPEC_MAJOR):
        e.add("metrics_spec", f"must be a Metrics Spec {SPEC_MAJOR}.x version, such as 1.0.0")
    as_of = _date(doc.get("as_of"))
    if "as_of" in doc and as_of is None:
        e.add("as_of", "must be a date (YYYY-MM-DD)")
    elif as_of and as_of >= today:
        e.add("as_of", f"must be before today ({today}): the last day the data covers, all of it closed")
    if "about" in doc and not isinstance(doc["about"], (str, type(None))):
        e.add("about", "must be text")
    if e.items:
        raise Invalid(e.items)

    cat = doc["catalog"]
    if not isinstance(cat, dict):
        raise Invalid([{"field": "catalog", "message": "must be an object (the GET /catalog answer)"}])
    _schema(e, "catalog", "Catalog", cat)
    if e.items:
        raise Invalid(e.items)
    if str(cat.get("spec_version")).split(".")[0] != SPEC_MAJOR:
        e.add("catalog.spec_version", f"must be a Metrics Spec {SPEC_MAJOR}.x version")
    prof = cat["profile"]
    try:
        ZoneInfo(prof.get("time_zone") or "")
    except (ZoneInfoNotFoundError, ValueError):
        e.add("catalog.profile.time_zone", "must be an IANA time zone name, such as Asia/Colombo")
    primary = [c for c in prof.get("business_calendars") or [] if c.get("primary")]
    if len(primary) != 1:
        e.add("catalog.profile.business_calendars", "exactly one calendar must be primary")
    metrics: dict[tuple[str, str], tuple[str, dict]] = {}  # (product, key) → (where, offered metric)
    seen_products: set[str] = set()
    for i, p in enumerate(cat["products"]):
        if p["product_id"] in seen_products:
            e.add(f"catalog.products[{i}].product_id", f"{p['product_id']} is listed twice")
        seen_products.add(p["product_id"])
        for j, m in enumerate(p["metrics"]):
            where = f"catalog.products[{i}].metrics[{j}]"
            if (p["product_id"], m["key"]) in metrics:
                e.add(f"{where}.key", f"{m['key']} is listed twice for {p['product_id']}")
            metrics[(p["product_id"], m["key"])] = (where, m)
            if _date(m["history_from"]) is None:
                e.add(f"{where}.history_from", "must be a date (YYYY-MM-DD)")
            for dim, values in m["breakdowns"].items():
                if len(set(values)) != len(values) or not values:
                    e.add(f"{where}.breakdowns.{dim}", "must list each value once (and at least one)")

    cal = doc["calendar"]
    if not isinstance(cal, dict):
        e.add("calendar", "must be an object (the GET /calendar answer for the primary calendar)")
    elif _schema(e, "calendar", "CalendarResponse", cal):
        if primary and cal["calendar_id"] != primary[0].get("id"):
            e.add("calendar.calendar_id", f"must be the primary calendar's id, {primary[0].get('id')}")
        prev = None
        for i, d in enumerate(cal["days"]):
            day = _date(d["date"])
            if day is None:
                e.add(f"calendar.days[{i}].date", "must be a date (YYYY-MM-DD)")
                break
            if prev and day != date.fromordinal(prev.toordinal() + 1):
                e.add(f"calendar.days[{i}].date", f"must follow {prev} with no gap or repeat; got {day}")
                break
            prev = day
        if not cal["days"]:
            e.add("calendar.days", "must list the days from the start of history")

    breaks = doc["breaks"]
    if not isinstance(breaks, list):
        e.add("breaks", "must be a list (empty if there are none)")
        breaks = []
    for i, b in enumerate(breaks):
        _schema(e, f"breaks[{i}]", "Break", b)
    if e.items:
        raise Invalid(e.items)

    series = doc["series"]
    if not isinstance(series, list) or not series:
        raise Invalid([{"field": "series", "message": "must be a list with at least one series"}])
    if len(series) > MAX_SERIES:
        raise Invalid([{"field": "series", "message": f"at most {MAX_SERIES} series; got {len(series)}"}])
    out, keys = [], set()
    present: dict[tuple[str, str], set[frozenset]] = {}
    first, last, n_rows = None, None, 0
    for i, s in enumerate(series):
        if e.full:
            break
        got = _series(e, f"series[{i}]", s, metrics, as_of)
        if got is None:
            continue
        if got["key"] in keys:
            e.add(f"series[{i}]", f"{got['key']} is given twice")
            continue
        keys.add(got["key"])
        present.setdefault((got["product_id"], got["metric"]), set()).add(frozenset(got["filter"].items()))
        if got["rows"]:
            f0, u1 = got["rows"][0]["from"], got["rows"][-1]["until"]
            first, last = min(first or f0, f0), max(last or u1, u1)
        n_rows += len(got["rows"])
        out.append(got)
    if e.items:
        raise Invalid(e.items + ([{"field": "…", "message": f"and {e.more} more"}] if e.more else []))

    # every offered metric has its total; each filter combination given is given for every value
    for (pid, key), (where, m) in metrics.items():
        cells = present.get((pid, key), set())
        if frozenset() not in cells:
            e.add(where, f"{pid}/{key} has no series without a filter (its total)")
            continue
        sets = sorted({tuple(sorted(d for d, _ in c)) for c in cells}, key=lambda t: (len(t), t))
        for dims in sets:
            if not dims:
                continue
            for values in cartesian(*[m["breakdowns"][d] for d in dims]):
                want = frozenset(zip(dims, values, strict=True))
                if want not in cells:
                    e.add("series", f"{series_key(pid, key, dict(want))} is missing: a filter on "
                          f"{' and '.join(dims)} needs a series for every value")
                    break
        given = m.get("filter_sets")
        if given is not None and sorted(tuple(sorted(x)) for x in given) != sorted(sets):
            e.add(f"{where}.filter_sets", "must list exactly the filter combinations the file has series for "
                  "(or leave it null and it is filled in)")
        m["filter_sets"] = [list(x) for x in sets]
    if e.items:
        raise Invalid(e.items + ([{"field": "…", "message": f"and {e.more} more"}] if e.more else []))

    products = {p for p, _ in metrics}
    return {"as_of": as_of, "about": doc.get("about"), "catalog": cat, "calendar": cal, "breaks": breaks,
            "series": out,
            "summary": {"products": len(products), "metrics": len(metrics), "series": len(out), "rows": n_rows,
                        "from": first.isoformat() if first else None, "until": last.isoformat() if last else None, "as_of": as_of.isoformat() if as_of else None,
                        "institution": prof.get("legal_entity_name"),
                        "capability_level": prof.get("capability_level"),
                        "vintages_kept": bool(prof.get("vintages_kept"))}}


def _series(e: Errors, where: str, s: Any, metrics: dict, as_of: date) -> dict | None:
    if not isinstance(s, dict):
        e.add(where, "must be an object")
        return None
    for k in sorted(set(s) - SERIES_KEYS):
        e.add(f"{where}.{k}", "isn't part of a series (product_id, metric, filter, currency, rows)")
    pid, key = s.get("product_id"), s.get("metric")
    if not isinstance(pid, str) or not isinstance(key, str):
        e.add(where, "needs product_id and metric")
        return None
    hit = metrics.get((pid, key))
    if hit is None:
        e.add(where, f"{pid}/{key} isn't in the catalog")
        return None
    m = hit[1]
    filt = s.get("filter") or {}
    if not isinstance(filt, dict) or not all(isinstance(v, str) for v in filt.values()):
        e.add(f"{where}.filter", "must be an object of dimension → value")
        return None
    if len(filt) > MAX_FILTERS:
        e.add(f"{where}.filter", f"at most {MAX_FILTERS} dimensions")
        return None
    for dim, v in filt.items():
        if v not in (m["breakdowns"].get(dim) or []):
            e.add(f"{where}.filter.{dim}", f"{v} isn't a value of {dim} in the catalog for {pid}/{key}")
            return None
    cur = s.get("currency")
    if m["unit"] == "currency":
        if not isinstance(cur, str) or not CURRENCY.match(cur):
            e.add(f"{where}.currency", "is needed for an amount: an ISO 4217 code such as LKR")
    elif cur is not None:
        e.add(f"{where}.currency", f"must be null: {key} isn't an amount")
    rows = s.get("rows")
    if not isinstance(rows, list):
        e.add(f"{where}.rows", "must be a list")
        return None
    if len(rows) > MAX_ROWS:
        e.add(f"{where}.rows", f"at most {MAX_ROWS} rows in one series")
        return None
    grain = m["grain"]
    out, prev_until = [], None
    for j, r in enumerate(rows):
        if e.full:
            return None
        rw = f"{where}.rows[{j}]"
        row = _row(e, rw, r, grain, as_of)
        if row is None:
            continue
        if prev_until and row["from"] < prev_until:
            e.add(f"{rw}.from", f"rows must be in order with no overlap; {row['from']} comes before {prev_until}")
        prev_until = row["until"]
        out.append(row)
    return {"key": series_key(pid, key, filt), "product_id": pid, "metric": key, "filter": filt,
            "currency": cur if m["unit"] == "currency" else None, "rows": out}


def _row(e: Errors, where: str, r: Any, grain: str, as_of: date) -> dict | None:
    if not isinstance(r, dict):
        e.add(where, "must be an object")
        return None
    bad = sorted(set(r) - ROW_KEYS)
    if bad:
        e.add(f"{where}.{bad[0]}", "isn't part of a row" + (" (the server works it out)" if bad[0] in
                                                           ("data_as_of", "vintage", "revised", "revision_held") else ""))
        return None
    f, u = _date(r.get("from")), _date(r.get("until"))
    if f is None or u is None:
        e.add(where + (".from" if f is None else ".until"), "must be a date (YYYY-MM-DD)")
        return None
    if not on_grid(grain, f) or u != next_start(grain, f):
        e.add(where, f"{f} to {u} isn't one {grain} period (until is exclusive)")
        return None
    if u.toordinal() > as_of.toordinal() + 1:
        e.add(f"{where}.until", f"{u} is after as_of ({as_of}): the period isn't closed")
        return None
    if "value" not in r:
        e.add(f"{where}.value", "is missing (null only when suppressed)")
        return None
    suppressed = r.get("suppressed", False)
    if not isinstance(suppressed, bool):
        e.add(f"{where}.suppressed", "must be true or false")
        return None
    out: dict[str, Any] = {"from": f, "until": u, "suppressed": suppressed}
    for k in NUMBERS:
        v = r.get(k)
        if v is not None and not _num(v):
            e.add(f"{where}.{k}", "must be a number or null")
            return None
        out[k] = v
    if out["value"] is None and not suppressed:
        e.add(f"{where}.value", "must be a number (null only when suppressed)")
        return None
    vol = r.get("volume")
    if vol is not None and (not isinstance(vol, int) or isinstance(vol, bool) or vol < 0):
        e.add(f"{where}.volume", "must be a whole number, 0 or more, or null")
        return None
    out["volume"] = vol
    reason = r.get("suppression_reason")
    if reason is not None and reason not in SUPPRESSION:
        e.add(f"{where}.suppression_reason", f"must be one of {', '.join(sorted(SUPPRESSION))}, or null")
        return None
    out["suppression_reason"] = reason
    back = r.get("backfilled", False)
    if not isinstance(back, bool):
        e.add(f"{where}.backfilled", "must be true or false")
        return None
    out["backfilled"] = back
    pub = r.get("published_at")
    pd = _date(pub) if pub is not None else None
    if pub is not None and pd is None:
        e.add(f"{where}.published_at", "must be a date (YYYY-MM-DD) or null")
        return None
    if pd and pd > as_of:
        e.add(f"{where}.published_at", f"{pd} is after as_of ({as_of})")
        return None
    out["published_at"] = pd
    extras = r.get("extras")
    if extras is not None and (not isinstance(extras, dict) or not all(v is None or _num(v) for v in extras.values())):
        e.add(f"{where}.extras", "must be an object of numbers")
        return None
    out["extras"] = extras or {}
    vint = r.get("vintages")
    out["vintages"] = []
    if vint is not None:
        if not isinstance(vint, list):
            e.add(f"{where}.vintages", "must be a list of earlier values")
            return None
        last = pd
        for k, v in enumerate(vint):
            vw = f"{where}.vintages[{k}]"
            if not isinstance(v, dict) or set(v) - VINTAGE_KEYS:
                e.add(vw, "must be an object of superseded_on, value, numerator, denominator, exposure, volume")
                return None
            sd = _date(v.get("superseded_on"))
            if sd is None:
                e.add(f"{vw}.superseded_on", "must be a date (YYYY-MM-DD)")
                return None
            if (last and sd <= last) or sd > as_of:
                e.add(f"{vw}.superseded_on", f"{sd} must be after the row's publication and any earlier vintage, "
                      f"and on or before as_of ({as_of})")
                return None
            for n in NUMBERS:
                if v.get(n) is not None and not _num(v[n]):
                    e.add(f"{vw}.{n}", "must be a number or null")
                    return None
            if v.get("volume") is not None and (not isinstance(v["volume"], int) or v["volume"] < 0):
                e.add(f"{vw}.volume", "must be a whole number, 0 or more, or null")
                return None
            last = sd
            out["vintages"].append({"superseded_on": sd, **{n: v.get(n) for n in (*NUMBERS, "volume")}})
    return out
