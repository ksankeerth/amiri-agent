"""The connector: checks that an institution's API is the Metrics Spec reference API, and says what is
missing, before anything depends on it.

Five steps, stopping at the first one that blocks: reach it; compare its OpenAPI document with the
reference; validate every answer's body against the reference schemas; run the conformance checks the
connector can run from the outside (spec §9), each with the spec's fix; and the coverage for this
institution's profile. Only aggregates are read, and the report keeps no data rows."""

import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import cache
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pycountry
from jsonschema import Draft202012Validator, FormatChecker

from app import spec
from app.connect.client import Answer, InstitutionData, OutOfCalls
from app.connect.coverage import coverage

SPEC_VERSION = "1.0.0"
PATHS = ("/metrics/v1/catalog", "/metrics/v1/series", "/metrics/v1/change-concentration", "/metrics/v1/breaks",
         "/metrics/v1/calendar")
MAX_SERIES_METRICS = 60   # metrics read in step 3 (each one call)
MAX_FINDINGS = 8          # per check; the rest are counted

# (level, what is checked, the fix): spec §9.
CHECKS: dict[str, tuple[str, str, str]] = {
    "C01": ("L1", "Profile complete", "Fill the profile; use IANA names such as Asia/Dubai, never offsets like +04:00; "
            "declare a calendar for every region whose holidays or weekend differ."),
    "C02": ("L1", "Products mapped", "Map the product to the nearest type, or leave it out of the catalog; rename keys "
            "to spec keys."),
    "C03": ("L1", "Grid periods", "Compute periods in the profile's time zone with until exclusive; never return "
            "partial periods."),
    "C04": ("L1", "No relative, off-grid or over-filtered requests", "Validate dates and filters before querying; drop "
            "'last N days' and 'month to date' parameters."),
    "C05": ("L1", "Units and currency", "Use the spec's unit for each metric and ISO 4217 currency codes; store the "
            "original amount and currency per transaction."),
    "C06": ("L2", "Ratio and rate arithmetic", "Return the numerator and denominator the value was computed from, not "
            "separately rounded figures."),
    "C07": ("L2", "Additivity", "Use one set of inclusion rules and one booking date for every grain and breakdown; send "
            "records without the attribute to unknown instead of dropping them."),
    "C08": ("L2", "Stock consistency", "Read stocks from the end-of-day snapshot of the last business day."),
    "C09": ("L2", "Suppression", "Apply suppression to every returned aggregate, after filtering, on the requested "
            "period, counting customers rather than accounts."),
    "C10": ("L2", "Complementary suppression", "Run secondary suppression over the full set of served combinations."),
    "C11": ("L3", "History depth", "Back-fill from the system of record, flagging the rows backfilled: true; declare "
            "launch dates and any system migration as a break."),
    "C12": ("L3", "Publication", "Record the local date each period's value was first produced; if your lag is longer, "
            "declare it in the catalog."),
    "C13": ("L3", "Breaks declared", "Declare past migrations, product changes, relief schemes and large portfolio moves; "
            "lasting shifts have no until."),
    "C14": ("L4", "Vintages", "Keep every published value with the date it was produced, or reconstruct vintages from "
            "posting timestamps."),
    "C15": ("L2", "Frozen segments and the cohort rule", "Keep dated history of customer attributes, or weekly snapshots."),
    "C16": ("L5", "Change concentration", "Compute per-contributor changes inside your systems and return only the band."),
    "C17": ("L1", "Calendars", "Serve /calendar per calendar_id, or declare the public calendars and their sources."),
    "C18": ("L1", "Limits and speed", "Pre-aggregate per period and breakdown; page by period; send Retry-After with "
            "429 and 503."),
    "C19": ("L1", "No personal data", "Remove the field or text; replace identifiers by spec dimension values."),
    "C20": ("L1", "Spec-version header and aliases", "Add the Metrics-Spec-Version header from configuration; serve the "
            "spec's alias table."),
    "C21": ("L2", "Booking-date self-test", "Run the spec's test transactions yourself (C21)."),
    "C22": ("L4", "Revision and segment-date guards", "Compare each new vintage and each segment date with the last served "
            "one before releasing it."),
}
BLOCKING = {"C01", "C02", "C19"}  # a failure here means not ready
NOT_RUN = {
    "C08": "needs the same stock at two grains; not in this version of the checker",
    "C10": "rebuilding suppressed cells takes many calls; not in this version of the checker",
    "C15": "needs test customers with known attribute changes",
    "C22": "needs test data around a revision",
}
PERSONAL = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "an email address"),
    (re.compile(r"(?<!\d)\d{12,19}(?!\d)"), "a long number (an account or card number?)"),
    (re.compile(r"(?<![\w-])\d{9}[VvXx](?!\w)"), "a national identity number"),
]


# ---------------------------------------------------------------- the report


@dataclass
class Report:
    target: str
    started_at: datetime
    steps: list[dict] = field(default_factory=list)
    checks: dict[str, dict] = field(default_factory=dict)
    formats: list[dict] = field(default_factory=list)
    coverage: dict | None = None
    server_version: str | None = None
    stopped: str | None = None

    def __post_init__(self):
        for cid, (level, title, fix) in CHECKS.items():
            self.checks[cid] = {"id": cid, "level": level, "title": title, "status": "not_run", "findings": [],
                                "more": 0, "fix": fix, "note": None}

    def step(self, step: str, status: str, title: str, detail: str | None = None, items: list[str] | None = None):
        self.steps.append({"step": step, "status": status, "title": title, "detail": detail, "items": items or []})

    def ok(self, cid: str):
        if self.checks[cid]["status"] == "not_run":
            self.checks[cid]["status"] = "pass"

    def bad(self, cid: str, finding: str):
        c = self.checks[cid]
        c["status"] = "fail"
        if len(c["findings"]) < MAX_FINDINGS:
            c["findings"].append(finding)
        else:
            c["more"] += 1

    def na(self, cid: str, why: str):
        self.checks[cid].update(status="not_applicable", note=why)

    def skip(self, cid: str, why: str):
        self.checks[cid].update(status="not_run", note=why)

    def format_errors(self, where: str, errors: list[str]):
        if errors:
            self.formats.append({"where": where, "errors": errors[:MAX_FINDINGS], "more": max(0, len(errors) - MAX_FINDINGS)})

    def status(self) -> str:
        if self.stopped or self.formats or any(self.checks[c]["status"] == "fail" for c in BLOCKING):
            return "not_ready"
        gaps = any(c["status"] == "fail" for c in self.checks.values())
        if self.coverage and any(p["status"] != "full" for p in self.coverage["products"]):
            gaps = True
        return "ready_with_gaps" if gaps else "ready"

    def view(self, calls, finished_at: datetime) -> dict:
        status = self.status()
        failed = [c for c in self.checks.values() if c["status"] == "fail"]
        partial = sum(p["status"] != "full" for p in (self.coverage or {}).get("products", []))
        if status == "ready":
            headline = "Ready: the API is the reference API and serves everything this profile needs."
        elif status == "ready_with_gaps":
            parts = ([f"{', '.join(c['id'] for c in failed)} failed"] if failed else []) + \
                    ([f"{partial} product(s) not fully covered"] if partial else [])
            headline = (f"Ready with gaps: {'; '.join(parts)}. It can be approved; checks that need what's "
                        "missing stay off.")
        elif self.stopped:
            headline = f"Not ready: {self.stopped}"
        elif self.formats:
            headline = f"Not ready: {len(self.formats)} answer(s) don't match the spec's formats."
        else:
            ids = ", ".join(c["id"] for c in failed if c["id"] in BLOCKING)
            headline = f"Not ready: {ids} failed, and these must pass before the connection can be approved."
        return {
            "target": self.target, "started_at": self.started_at.isoformat(), "finished_at": finished_at.isoformat(),
            "status": status, "headline": headline, "spec_version": SPEC_VERSION, "server_version": self.server_version,
            "accepted": self.server_version is not None and self.server_version.split(".")[0] == SPEC_VERSION.split(".")[0],
            "steps": self.steps, "missing_for_profile": (self.coverage or {}).get("sentences", []),
            "coverage": self.coverage, "checks": list(self.checks.values()), "formats": self.formats,
            "calls": [{"method": c.method, "path": c.path, "query": c.query, "status": c.status, "ms": c.ms,
                       "bytes": c.bytes, "error": c.error} for c in calls],
            "summary": {"calls": len(calls), "seconds": round((finished_at - self.started_at).total_seconds(), 1),
                        "passed": sum(c["status"] == "pass" for c in self.checks.values()),
                        "failed": len(failed), "format_problems": len(self.formats)},
        }


# ---------------------------------------------------------------- schemas


@cache
def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": f"#/components/schemas/{name}", "components": spec.reference_openapi()["components"]},
                                format_checker=FormatChecker())


def schema_errors(name: str, body: Any) -> list[str]:
    out = []
    for e in sorted(_validator(name).iter_errors(body), key=lambda e: list(e.absolute_path)):
        where = "/".join(map(str, e.absolute_path)) or "(the whole body)"
        out.append(f"{where}: {e.message[:200]}")
    return out


def _resolve(doc: dict, node: Any, depth: int = 0) -> Any:
    while isinstance(node, dict) and "$ref" in node and depth < 20:
        ref = node["$ref"]
        if not ref.startswith("#/"):
            return {}
        cur: Any = doc
        for part in ref[2:].split("/"):
            cur = cur.get(part, {}) if isinstance(cur, dict) else {}
        node, depth = cur, depth + 1
    return node


def _types(doc: dict, s: dict) -> set[str]:
    s = _resolve(doc, s)
    if not isinstance(s, dict):
        return set()
    t = s.get("type")
    if isinstance(t, list):
        return set(t)
    if isinstance(t, str):
        return {t}
    out = set()
    for alt in s.get("oneOf", []) + s.get("anyOf", []):
        out |= _types(doc, alt)
    return out


def _compare_schema(ref: dict, rs: Any, theirs: dict, ts: Any, where: str, depth: int, out: list[tuple[str, bool]]):
    rs, ts = _resolve(ref, rs), _resolve(theirs, ts)
    if not isinstance(rs, dict) or not isinstance(ts, dict) or depth > 3:
        return
    rt, tt = _types(ref, rs), _types(theirs, ts)
    if rt and tt and not (rt - {"null"}) <= tt and not (tt - {"null"}) <= rt:
        out.append((f"{where} is {'/'.join(sorted(tt))}; the spec says {'/'.join(sorted(rt))}", True))
        return
    rprops, tprops = rs.get("properties") or {}, ts.get("properties") or {}
    required = set(rs.get("required") or [])
    for name, sub in rprops.items():
        if name not in tprops:
            if name in required:
                out.append((f"{where}.{name} is missing (the spec requires it)", True))
            else:
                out.append((f"{where}.{name} isn't described", False))
            continue
        if name in required and name not in set(ts.get("required") or []):
            out.append((f"{where}.{name} is optional; the spec requires it", False))
        _compare_schema(ref, sub, theirs, tprops[name], f"{where}.{name}", depth + 1, out)
    if rs.get("items") and ts.get("items"):
        _compare_schema(ref, rs["items"], theirs, ts["items"], f"{where}[]", depth + 1, out)


def compare_openapi(theirs: dict) -> list[tuple[str, bool]]:
    """Differences from the reference API: (sentence, blocking)."""
    ref = spec.reference_openapi()
    out: list[tuple[str, bool]] = []
    tpaths = theirs.get("paths") or {}
    for path in PATHS:
        rop = ref["paths"][path]["get"]
        item = tpaths.get(path) or {}
        top = item.get("get")
        if not top:
            out.append((f"GET {path} isn't in the document", True))
            continue
        tparams = {}
        for p in (item.get("parameters") or []) + (top.get("parameters") or []):
            p = _resolve(theirs, p)
            if isinstance(p, dict):
                tparams[(p.get("name"), p.get("in"))] = p
        for p in rop.get("parameters", []):
            p = _resolve(ref, p)
            q = tparams.get((p["name"], p["in"]))
            if q is None:
                out.append((f"GET {path}: the {p['in']} parameter {p['name']} is missing", bool(p.get("required"))))
            elif bool(q.get("required")) != bool(p.get("required")):
                out.append((f"GET {path}: {p['name']} is {'required' if q.get('required') else 'optional'}; "
                            f"the spec says {'required' if p.get('required') else 'optional'}", bool(q.get("required"))))
        rschema = rop["responses"]["200"]["content"]["application/json"]["schema"]
        tresp = _resolve(theirs, (top.get("responses") or {}).get("200") or {})
        tschema = ((tresp.get("content") or {}).get("application/json") or {}).get("schema") if isinstance(tresp, dict) else None
        if not tschema:
            out.append((f"GET {path}: no JSON schema for the 200 answer", True))
            continue
        _compare_schema(ref, rschema, theirs, tschema, f"GET {path} answer", 0, out)
    return out


# ---------------------------------------------------------------- the grid


def _next(grain: str, d: date) -> date:
    if grain == "daily":
        return d + timedelta(days=1)
    if grain == "weekly":
        return d + timedelta(days=7)
    step = 3 if grain == "quarterly" else 1
    y, m = divmod(d.year * 12 + d.month - 1 + step, 12)
    return date(y, m + 1, 1)


def _on_grid(grain: str, d: date) -> bool:
    return {"weekly": d.weekday() == 0, "monthly": d.day == 1,
            "quarterly": d.day == 1 and d.month in (1, 4, 7, 10)}.get(grain, True)


def recent(grain: str, today: date, n: int = 6) -> tuple[date, date]:
    """n whole closed periods of the grain, ending on or before today."""
    if grain == "daily":
        return today - timedelta(days=14), today
    if grain == "weekly":
        until = today - timedelta(days=today.weekday())
        return until - timedelta(days=7 * n), until
    step = 3 if grain == "quarterly" else 1
    m = (today.month - 1) // step * step + 1
    until = date(today.year, m, 1)
    y, mm = divmod(until.year * 12 + until.month - 1 - step * n, 12)
    return date(y, mm + 1, 1), until


def _months_back(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    return date(y, m + 1, 1)


# ---------------------------------------------------------------- the checks


def _strings(x: Any):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


def _personal(r: Report, where: str, body: Any):
    for s in _strings(body):
        for rx, what in PERSONAL:
            if rx.search(s):
                r.bad("C19", f"{where}: {what} in “{s[:60]}”")


def _version(r: Report, a: Answer, where: str):
    v = a.headers.get("metrics-spec-version")
    if a.status is None:
        return
    if not v:
        r.bad("C20", f"{where}: no Metrics-Spec-Version header")
    elif v.split(".")[0] != SPEC_VERSION.split(".")[0]:
        r.bad("C20", f"{where}: Metrics-Spec-Version {v} has a different MAJOR from {SPEC_VERSION}")


def _rate(r: Report, a: Answer, where: str):
    if a.status in (429, 503) and not a.headers.get("retry-after"):
        r.bad("C18", f"{where}: {a.status} without Retry-After")


def _rows_checks(r: Report, where: str, m: dict, spec_m: dict | None, body: dict, today: date, min_contrib: int,
                 business: set[date] | None):
    grain, rows = body.get("grain") or m["grain"], body.get("rows") or []
    if spec_m and body.get("unit") not in (None, spec_m["unit"]):
        r.bad("C05", f"{where}: unit {body.get('unit')}, the spec says {spec_m['unit']}")
    cur = body.get("currency")
    if cur and not pycountry.currencies.get(alpha_3=cur):
        r.bad("C05", f"{where}: currency {cur} isn't an ISO 4217 code")
    prev_until = None
    for row in rows:
        try:
            f, u = date.fromisoformat(row["from"]), date.fromisoformat(row["until"])
        except (KeyError, TypeError, ValueError):
            continue  # reported as a format problem
        if not _on_grid(grain, f) or u != _next(grain, f):
            r.bad("C03", f"{where}: row {f} to {u} isn't one {grain} period")
        if u > today:
            r.bad("C04", f"{where}: row {f} to {u} is a period still open on {today}")
        if prev_until and f < prev_until:
            r.bad("C03", f"{where}: rows overlap at {f}")
        if prev_until and grain != "daily" and f > prev_until:
            r.bad("C03", f"{where}: a gap between {prev_until} and {f}")
        if business is not None and grain == "daily" and m.get("day_basis") == "business" and f not in business:
            r.bad("C03", f"{where}: a row on {f}, not a business day of the declared calendar")
        prev_until = u
        if row.get("suppressed"):
            if any(row.get(k) is not None for k in ("value", "numerator", "denominator", "exposure", "volume")):
                r.bad("C09", f"{where}: suppressed row {f} still has values")
        else:
            vol = row.get("volume")
            if isinstance(vol, (int, float)) and vol < min_contrib:
                r.bad("C09", f"{where}: row {f} has {vol} contributors, below the minimum of {min_contrib}, unsuppressed")
            v, num = row.get("value"), row.get("numerator")
            if isinstance(v, (int, float)) and isinstance(num, (int, float)):
                kind = body.get("kind")
                den, exp = row.get("denominator"), row.get("exposure")
                if kind == "ratio" and isinstance(den, (int, float)) and den:
                    if abs(v - num / den * 100) > 0.01 + 1e-6 * abs(v):
                        r.bad("C06", f"{where}: row {f}: {v} isn't {num} ÷ {den} × 100")  # noqa: RUF001
                if kind == "rate" and isinstance(exp, (int, float)) and exp:
                    if abs(v - num / exp * 1000) > 0.01 + 1e-6 * abs(v):
                        r.bad("C06", f"{where}: row {f}: {v} isn't {num} ÷ {exp} × 1,000")  # noqa: RUF001
    for k in ("C03", "C05", "C06", "C09"):
        r.ok(k)


async def run(data: InstitutionData, profile: dict | None, now: datetime, target: str,
              openapi_url: str | None = None) -> dict:
    r = Report(target, now)
    started = time.monotonic()
    try:
        await _run(r, data, profile, now, openapi_url)
    except OutOfCalls as e:
        r.step("limits", "warn", "Stopped early", str(e))
    return r.view(data.calls, now + timedelta(seconds=time.monotonic() - started))


async def _run(r: Report, data: InstitutionData, profile: dict | None, now: datetime, openapi_url: str | None):
    # 1. reach
    a = await data.catalog()
    if a.status is None:
        r.stopped = f"the API didn't answer ({a.error})."
        r.step("reach", "fail", "Couldn't reach the API", a.error)
        return
    if a.status in (401, 403):
        r.stopped = f"the API refused the key (HTTP {a.status})."
        r.step("reach", "fail", f"The key was refused: HTTP {a.status}", a.text[:300])
        return
    if a.status != 200 or not isinstance(a.body, dict):
        r.stopped = f"GET /catalog answered HTTP {a.status}" + ("" if a.status != 200 else " without a JSON body") + "."
        r.step("reach", "fail", f"GET /catalog answered HTTP {a.status}", a.text[:300])
        return
    ms = data.calls[-1].ms
    r.step("reach", "pass", f"Reached the API ({ms} ms)", None)
    cat = a.body
    r.server_version = a.headers.get("metrics-spec-version") or cat.get("spec_version")
    if r.server_version and r.server_version.split(".")[0] != SPEC_VERSION.split(".")[0]:
        r.stopped = f"it implements Metrics Spec {r.server_version}; this connector accepts {SPEC_VERSION.split('.')[0]}.x."
        r.step("version", "fail", f"Metrics Spec {r.server_version} isn't accepted", f"Same MAJOR needed ({SPEC_VERSION}).")
        _version(r, a, "GET /catalog")
        return
    _version(r, a, "GET /catalog")
    r.step("version", "pass" if a.headers.get("metrics-spec-version") else "warn",
           f"Metrics Spec {r.server_version or 'version not stated'}",
           None if a.headers.get("metrics-spec-version") else "No Metrics-Spec-Version header (C20).")

    # 2. is it the reference API?
    oa = await data.get("", absolute=openapi_url or f"{data.root}/openapi.json")
    if oa.status == 200 and isinstance(oa.body, dict):
        diffs = compare_openapi(oa.body)
        blocking = [d for d, b in diffs if b]
        if blocking:
            r.stopped = "it isn't the reference API (see the differences)."
            r.step("reference_api", "fail", "Not the reference API", f"{len(blocking)} difference(s) that matter.",
                   [d for d, _ in diffs][:40])
            return
        r.step("reference_api", "pass" if not diffs else "warn", "The OpenAPI document matches the reference API",
               f"{len(diffs)} minor difference(s)." if diffs else None, [d for d, _ in diffs][:40])
    else:
        r.step("reference_api", "warn", "No OpenAPI document found",
               f"Tried {openapi_url or data.root + '/openapi.json'} (HTTP {oa.status}). Only the answers were compared.")

    # 3. body formats, and the checks on each answer
    errs = schema_errors("Catalog", cat)
    r.format_errors("GET /catalog", errs)
    prof = cat.get("profile") or {}
    tz_name = prof.get("time_zone") or "UTC"
    try:
        today = now.astimezone(ZoneInfo(tz_name)).date()
    except (ZoneInfoNotFoundError, ValueError):
        today = now.date()
        r.bad("C01", f"time_zone {tz_name} isn't an IANA time zone")
    _check_profile(r, prof, cat)
    _check_products(r, cat)
    _personal(r, "GET /catalog", cat)
    if not isinstance(cat.get("aliases"), list) or not isinstance(cat.get("deprecations"), list):
        r.bad("C20", "GET /catalog: aliases and deprecations must be listed (empty lists are fine)")
    min_contrib = int((prof.get("suppression") or {}).get("min_contributors") or 10)

    business = None
    cal_id = next((c.get("id") for c in prof.get("business_calendars") or [] if c.get("primary")), None)
    earliest = min((date.fromisoformat(m["history_from"]) for p in cat.get("products") or [] for m in p.get("metrics") or []
                    if isinstance(m.get("history_from"), str) and _isodate(m["history_from"])), default=today - timedelta(days=365))
    cstart = max(earliest, today - timedelta(days=1199))
    ca = await data.calendar(calendar_id=cal_id, start=cstart.isoformat(), until=(today + timedelta(days=1)).isoformat())
    _version(r, ca, "GET /calendar")
    _rate(r, ca, "GET /calendar")
    if ca.status == 200 and isinstance(ca.body, dict):
        r.format_errors("GET /calendar", schema_errors("CalendarResponse", ca.body))
        days = [d for d in ca.body.get("days") or [] if isinstance(d, dict)]
        business = {date.fromisoformat(d["date"]) for d in days if d.get("business") and _isodate(d.get("date"))}
        if len(days) < (today + timedelta(days=1) - cstart).days:
            r.bad("C17", f"GET /calendar: {len(days)} days for a {(today + timedelta(days=1) - cstart).days}-day range")
        if not any(d.get("holidays") for d in days):
            r.bad("C17", "GET /calendar: no holidays at all in the range")
        r.ok("C17")
    elif ca.status == 404:
        r.na("C17", "the calendar isn't served; the profile must name its public calendars")
    elif ca.status in (429, 503):
        r.skip("C17", f"the calendar wasn't read: HTTP {ca.status}")
    else:
        r.bad("C17", f"GET /calendar answered HTTP {ca.status}")

    offered = [(p, m) for p in cat.get("products") or [] if isinstance(p, dict)
               for m in p.get("metrics") or [] if isinstance(m, dict) and m.get("key")]
    by_cat = {(c, m["key"]): m for c in spec.spec()["metrics"] for m in spec.metrics(c)}
    read, limited = 0, []
    sample_rows: dict[tuple[str, str], dict] = {}
    for p, m in offered[:MAX_SERIES_METRICS]:
        grain = m.get("grain") or "monthly"
        start, until = recent(grain, today)
        where = f"GET /series {p.get('product_id')}/{m['key']}"
        s = await data.series(product_id=p.get("product_id"), metric=m["key"], start=start.isoformat(),
                              until=until.isoformat())
        _version(r, s, where)
        _rate(r, s, where)
        if s.status in (429, 503):
            limited.append(f"{p.get('product_id')}/{m['key']}")
            continue
        if s.status != 200 or not isinstance(s.body, dict):
            r.format_errors(where, [f"HTTP {s.status}: {s.text[:200]}"])
            continue
        read += 1
        r.format_errors(where, schema_errors("SeriesResponse", s.body))
        _rows_checks(r, where, m, by_cat.get((p.get("category"), m["key"])), s.body, today, min_contrib, business)
        sample_rows[(p.get("product_id"), m["key"])] = s.body
    if limited:
        r.step("limits", "warn", f"{len(limited)} metric(s) not read: the API limited the rate (429 or 503)",
               "The connector doesn't wait between calls; check again later.", limited[:20])
    if len(offered) > MAX_SERIES_METRICS:
        r.step("formats", "warn", f"Read {MAX_SERIES_METRICS} of {len(offered)} metrics", "The rest weren't read in this check.")
    r.step("formats", "pass" if not r.formats else "fail",
           f"Answers checked against the reference schemas: {read} series, the catalog and the calendar",
           f"{len(r.formats)} answer(s) don't match." if r.formats else None)

    br = await data.breaks()
    _version(r, br, "GET /breaks")
    if br.status == 200 and isinstance(br.body, dict):
        e = schema_errors("BreaksResponse", br.body)
        r.format_errors("GET /breaks", e)
        if e:
            r.bad("C13", "GET /breaks: the answer doesn't match the spec's Break schema")
        for b in br.body.get("breaks") or []:
            if isinstance(b, dict) and b.get("type") == "lasting" and b.get("until"):
                r.bad("C13", f"break {b.get('break_id')}: a lasting shift has an until date")
        _personal(r, "GET /breaks", br.body)
        r.ok("C13")
    elif br.status in (429, 503):
        _rate(r, br, "GET /breaks")
        r.skip("C13", f"the breaks weren't read: HTTP {br.status}")
    else:
        r.bad("C13", f"GET /breaks answered HTTP {br.status}")

    await _requests_refused(r, data, offered, today)
    await _history_and_publication(r, data, offered, by_cat, today)
    await _additivity(r, data, offered, sample_rows)
    await _vintages(r, data, cat, offered, sample_rows, today)
    await _concentration(r, data, offered, today)
    for cid, why in NOT_RUN.items():
        r.skip(cid, why)
    r.na("C21", "the institution's own self-test with test transactions; run it before onboarding")
    for c in data.calls:
        if c.ms > 30_000:
            r.bad("C18", f"{c.path}: {c.ms / 1000:.0f} s, over the 30 s the spec allows")
    for cid in ("C18", "C19", "C20", "C01", "C02"):
        r.ok(cid)

    # 5. coverage for this profile
    r.coverage = coverage(profile, cat)
    gaps = sum(p["status"] != "full" for p in r.coverage["products"])
    r.step("coverage", "pass" if not gaps else "warn",
           f"Coverage for {len(r.coverage['products'])} product(s) in your profile",
           f"{gaps} not fully covered." if gaps else None)


def _isodate(s: Any) -> bool:
    try:
        date.fromisoformat(s)
        return True
    except (TypeError, ValueError):
        return False


def _check_profile(r: Report, prof: dict, cat: dict):
    for k in ("time_zone", "business_calendars", "base_currency", "pivot_currency", "fx_reference_sources",
              "region_levels", "accounting_framework", "suppression", "capability_level", "spec_version"):
        if not prof.get(k):
            r.bad("C01", f"profile.{k} is missing")
    tz = prof.get("time_zone") or ""
    if re.match(r"^[+-]\d|^UTC[+-]", tz):
        r.bad("C01", f"profile.time_zone {tz} is an offset, not an IANA name")
    for k in ("base_currency", "pivot_currency"):
        v = prof.get(k)
        if v and not pycountry.currencies.get(alpha_3=v):
            r.bad("C01", f"profile.{k} {v} isn't an ISO 4217 code")
    cals = prof.get("business_calendars") or []
    if cals and sum(1 for c in cals if isinstance(c, dict) and c.get("primary")) != 1:
        r.bad("C01", "exactly one business calendar must be primary")


def _check_products(r: Report, cat: dict):
    cats = {c["id"]: c for c in spec.spec()["categories"]}
    kind = (cat.get("profile") or {}).get("institution_type")
    for p in cat.get("products") or []:
        if not isinstance(p, dict):
            continue
        c = cats.get(p.get("category"))
        pid = p.get("product_id")
        if c is None:
            r.bad("C02", f"{pid}: {p.get('category')} isn't a spec category")
            continue
        if kind and c["institution"] != kind:
            r.bad("C02", f"{pid}: {c['id']} is an {c['institution']} category, but the profile is a {kind}")
        types = {t["id"] for t in c["product_types"]}
        if p.get("product_type") is not None and p["product_type"] not in types:
            r.bad("C02", f"{pid}: {p['product_type']} isn't a product type of {c['id']}")
        keys = {m["key"] for m in spec.metrics(c["id"])}
        for m in p.get("metrics") or []:
            if isinstance(m, dict) and m.get("key") not in keys:
                r.bad("C02", f"{pid}: {m.get('key')} isn't a {c['id']} metric of the spec")


async def _requests_refused(r: Report, data: InstitutionData, offered, today: date):
    """C04: off-grid, relative and over-filtered requests are refused with the right codes."""
    pm = next(((p, m) for p, m in offered if m.get("grain") in ("weekly", "monthly")), None)
    if pm is None:
        r.skip("C04", "no weekly or monthly metric to try an off-grid request on")
        return
    p, m = pm
    start, until = recent(m["grain"], today)
    base = {"product_id": p["product_id"], "metric": m["key"]}
    tries = [
        ({**base, "start": (start + timedelta(days=2)).isoformat(), "until": until.isoformat()}, "off_grid", 400),
        ({**base, "start": start.isoformat(), "until": until.isoformat(), "last_days": "7"}, "relative_window", 400),
        ({**base, "start": start.isoformat(), "until": until.isoformat(),
          "filter": {f"d{i}": "x" for i in range(4)}}, "too_many_filters", 400),
        ({**base, "product_id": "no-such-product-xyz", "start": start.isoformat(), "until": until.isoformat()},
         "unknown_product", 404),
    ]
    for params, code, status in tries:
        a = await data.series(**params)
        where = f"GET /series asking for {code}"
        _version(r, a, where)
        if a.status != status or not isinstance(a.body, dict) or a.body.get("code") != code:
            got = a.body.get("code") if isinstance(a.body, dict) else None
            r.bad("C04", f"{where}: got HTTP {a.status}{f' {got}' if got else ''}; the spec says {status} {code}")
            continue
        if not a.content_type.startswith("application/problem+json"):
            r.format_errors(where, [f"content type {a.content_type}; errors are application/problem+json"])
        r.format_errors(where, schema_errors("Problem", a.body))
    r.ok("C04")


async def _history_and_publication(r: Report, data: InstitutionData, offered, by_cat, today: date):
    """C11 and C12 on up to three metrics (one per grain), each read over its whole history."""
    picked, seen = [], set()
    for p, m in offered:
        if m.get("grain") not in seen and _isodate(m.get("history_from")):
            seen.add(m.get("grain"))
            picked.append((p, m))
    for p, m in picked[:3]:
        grain = m["grain"]
        hist = date.fromisoformat(m["history_from"])
        _, until = recent(grain, today)
        start = hist if grain != "daily" else max(hist, until - timedelta(days=1199))
        if grain != "daily":
            start = date(start.year, start.month, 1)
            if grain == "weekly":
                start = start + timedelta(days=(7 - start.weekday()) % 7)
        rows, token = [], None
        while True:
            a = await data.series(product_id=p["product_id"], metric=m["key"], start=start.isoformat(),
                                  until=until.isoformat(), page_token=token)
            if a.status != 200 or not isinstance(a.body, dict):
                r.bad("C11", f"{p['product_id']}/{m['key']}: the full history answered HTTP {a.status}")
                break
            rows += a.body.get("rows") or []
            token = a.body.get("next_page_token")
            if not token:
                break
        if not rows:
            continue
        prev_until = None
        for x in rows:  # the whole history on the grid too, not just the recent periods (C03)
            if not (_isodate(x.get("from")) and _isodate(x.get("until"))):
                continue
            f, u = date.fromisoformat(x["from"]), date.fromisoformat(x["until"])
            if not _on_grid(grain, f) or u != _next(grain, f):
                r.bad("C03", f"{p['product_id']}/{m['key']} history: row {f} to {u} isn't one {grain} period")
                break
            if prev_until and f < prev_until:
                r.bad("C03", f"{p['product_id']}/{m['key']} history: rows overlap at {f}")
                break
            prev_until = u
        spec_m = by_cat.get((p.get("category"), m["key"])) or {}
        months = spec_m.get("history_months") or 39
        need = _months_back(until, months)
        launched = date.fromisoformat(p["launched_on"]) if _isodate(p.get("launched_on")) else None
        first = date.fromisoformat(rows[0]["from"]) if _isodate(rows[0].get("from")) else None
        if first and first > need + timedelta(days=31) and not (launched and launched >= need):
            r.bad("C11", f"{p['product_id']}/{m['key']}: history starts {first}; {months} months needs {need}")
        lag = max(int(m.get("max_lag_days") or 0), int(spec_m.get("max_lag_days") or 0))
        live = [x for x in rows if not x.get("backfilled")]
        missing = [x for x in live if not x.get("published_at")]
        if missing:
            r.bad("C12", f"{p['product_id']}/{m['key']}: {len(missing)} live row(s) without published_at")
        recent_rows = [x for x in live if _isodate(x.get("published_at")) and _isodate(x.get("until"))
                       and date.fromisoformat(x["until"]) > _months_back(today, 12)]
        late = [x for x in recent_rows if (date.fromisoformat(x["published_at"])
                                            - (date.fromisoformat(x["until"]) - timedelta(days=1))).days > lag]
        if recent_rows and len(late) / len(recent_rows) > 0.05:
            r.bad("C12", f"{p['product_id']}/{m['key']}: {len(late)} of {len(recent_rows)} recent periods published "
                  f"later than {lag} days")
    r.ok("C11")
    r.ok("C12")


async def _additivity(r: Report, data: InstitutionData, offered, sample_rows):
    """C07: a flow or count summed over one breakdown's values equals the total."""
    for p, m in offered:
        body = sample_rows.get((p.get("product_id"), m["key"]))
        if not body or body.get("kind") not in ("flow", "count") or not m.get("breakdowns"):
            continue
        dim, values = next(iter(m["breakdowns"].items()))
        rows = [x for x in body.get("rows") or [] if not x.get("suppressed")]
        if not rows or not isinstance(values, list) or len(values) > 12:
            continue
        last = rows[-1]
        total = 0.0
        any_suppressed = False
        for v in values:
            a = await data.series(product_id=p["product_id"], metric=m["key"], start=last["from"], until=last["until"],
                                  filter={dim: v})
            if a.status != 200 or not isinstance(a.body, dict):
                r.bad("C07", f"{p['product_id']}/{m['key']} filtered by {dim}={v}: HTTP {a.status}")
                return
            for x in a.body.get("rows") or []:
                if x.get("suppressed"):
                    any_suppressed = True
                elif isinstance(x.get("value"), (int, float)):
                    total += x["value"]
        want = last.get("value")
        if isinstance(want, (int, float)) and not any_suppressed and abs(total - want) > max(1.0, 0.005 * abs(want)):
            r.bad("C07", f"{p['product_id']}/{m['key']} on {last['from']}: the {dim} values sum to {total:,.2f}, "
                  f"the total is {want:,.2f}")
        r.ok("C07")
        return
    r.skip("C07", "no flow or count with a breakdown to add up")


async def _vintages(r: Report, data: InstitutionData, cat: dict, offered, sample_rows, today: date):
    """C14: read the day before a period was published, and it must be unpublished then."""
    if not (cat.get("profile") or {}).get("vintages_kept"):
        r.na("C14", "the profile says no vintages are kept (capability below L4)")
        return
    for p, m in offered:
        body = sample_rows.get((p.get("product_id"), m["key"]))
        rows = [x for x in (body or {}).get("rows") or [] if _isodate(x.get("published_at"))]
        if not rows:
            continue
        last = rows[-1]
        before = date.fromisoformat(last["published_at"]) - timedelta(days=1)
        a = await data.series(product_id=p["product_id"], metric=m["key"], start=body["rows"][0]["from"],
                              until=last["until"], known_through=before.isoformat())
        if a.status != 200 or not isinstance(a.body, dict):
            r.bad("C14", f"{p['product_id']}/{m['key']} known_through {before}: HTTP {a.status}")
            return
        if any(x.get("from") == last["from"] for x in a.body.get("rows") or []):
            r.bad("C14", f"{p['product_id']}/{m['key']}: the period {last['from']} was published {last['published_at']}, "
                  f"yet known_through {before} returns it")
        elif last["from"] not in (a.body.get("unpublished") or []):
            r.bad("C14", f"{p['product_id']}/{m['key']}: known_through {before} should list {last['from']} as unpublished")
        r.ok("C14")
        return
    r.skip("C14", "no published row to test a vintage on")


async def _concentration(r: Report, data: InstitutionData, offered, today: date):
    """C16: overlapping windows are refused; a valid request answers with a band only."""
    pm = next(((p, m) for p, m in offered if m.get("grain") == "weekly"
               and m.get("unit") in ("count", "currency", "percent")), None)
    if pm is None:
        r.skip("C16", "no weekly metric to ask about")
        return
    p, m = pm
    _, until = recent("weekly", today)
    b0, a0 = until - timedelta(days=14), until - timedelta(days=28)
    bad = await data.change_concentration(product_id=p["product_id"], metric=m["key"], a_start=a0.isoformat(),
                                          a_until=(b0 + timedelta(days=7)).isoformat(), b_start=b0.isoformat(),
                                          b_until=until.isoformat())
    if bad.status == 501:
        r.na("C16", "change concentration isn't implemented (capability L4 or below)")
        return
    if bad.status != 400 or not isinstance(bad.body, dict) or bad.body.get("code") != "windows_invalid":
        r.bad("C16", f"overlapping windows: got HTTP {bad.status}; the spec says 400 windows_invalid")
    good = await data.change_concentration(product_id=p["product_id"], metric=m["key"], a_start=a0.isoformat(),
                                           a_until=(a0 + timedelta(days=14)).isoformat(), b_start=b0.isoformat(),
                                           b_until=until.isoformat())
    if good.status == 200 and isinstance(good.body, dict):
        r.format_errors("GET /change-concentration", schema_errors("ChangeConcentration", good.body))
        extra = set(good.body) - set(spec.reference_openapi()["components"]["schemas"]["ChangeConcentration"]["properties"])
        if extra:
            r.bad("C16", f"the answer has fields beyond the band: {', '.join(sorted(extra))}")
    elif good.status != 422:
        r.bad("C16", f"a valid request answered HTTP {good.status}")
    r.ok("C16")
