"""The imported data, stored and served as the Metrics Spec reference API at /imported/metrics/v1, in-process.

The connector's check and the validator read it through the same InstitutionData client they would use for any
reference API, over an in-process transport. Only those in-process calls are answered: each carries this process's
token (IN_PROCESS_HEADER), so the data is never served to a browser or another host.

What a snapshot can honestly serve is served: the catalog, the calendar, breaks, and series with ranges, filters
(the combinations the file has), pagination, known_through and same_age_days (from each row's publication date and
earlier values). Change concentration needs per-contributor changes, which a file of aggregates doesn't have: it
answers 501 not_implemented, so the check reports C16 as not applicable (L4 at most). currency_basis=base is
served only where it equals the original (metrics not kept in the customer's currency)."""

import secrets
from collections import OrderedDict
from datetime import date, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import spec
from app.connect.importfmt import series_key
from app.connect.refapi import (
    MAX_DAILY_DAYS,
    PAGE_MAX,
    RELATIVE,
    SERIES_PARAMS,
    Fail,
    answer,
    check_filter,
    check_version,
    check_window,
    first_on_grid,
    next_start,
    page_token,
    parse_date,
    parse_filter,
    parse_int,
    problem,
    read_page_token,
    vintage_params,
)

PREFIX = "/imported"
IN_PROCESS_HEADER = "X-Amiri-In-Process"
IN_PROCESS_TOKEN = secrets.token_urlsafe(24)  # this process's own calls only
CACHED_SERIES = 48

router = APIRouter(prefix=PREFIX, include_in_schema=False)


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def stored_row(r: dict) -> dict:
    """A checked row (importfmt) as it is stored: ISO dates, null and false fields left out."""
    out: dict[str, Any] = {"from": r["from"].isoformat(), "until": r["until"].isoformat()}
    for k in ("value", "numerator", "denominator", "exposure", "volume", "suppression_reason", "published_at"):
        v = r.get(k)
        if v is not None:
            out[k] = v.isoformat() if isinstance(v, date) else v
    if r.get("value") is None:
        out["value"] = None
    for k in ("suppressed", "backfilled"):
        if r.get(k):
            out[k] = True
    if r.get("extras"):
        out["extras"] = r["extras"]
    if r.get("vintages"):
        out["vintages"] = [{**v, "superseded_on": v["superseded_on"].isoformat()} for v in r["vintages"]]
    return out


class ImportedStore:
    """ops.imported_data and ops.imported_series: written in the import's transaction, read with a cache per
    connection version (a new import is a new version, so nothing stale is served)."""

    def __init__(self, pool: AsyncConnectionPool):
        self.pool = pool
        self._head: tuple[int, dict] | None = None
        self._series: OrderedDict[tuple[int, str], dict | None] = OrderedDict()

    @staticmethod
    async def write(conn, data: dict, file_name: str | None, size: int, sha: str, now: datetime, actor: str) -> None:
        await conn.execute("TRUNCATE ops.imported_series")
        await conn.execute(
            """INSERT INTO ops.imported_data (id, file_name, bytes, sha256, as_of, about, catalog, calendar, breaks, summary,
                 imported_at, imported_by) VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET file_name = excluded.file_name, bytes = excluded.bytes,
                 sha256 = excluded.sha256, as_of = excluded.as_of, about = excluded.about, catalog = excluded.catalog,
                 calendar = excluded.calendar, breaks = excluded.breaks, summary = excluded.summary,
                 imported_at = excluded.imported_at, imported_by = excluded.imported_by""",
            (file_name, size, sha, data["as_of"], data["about"], Jsonb(data["catalog"]), Jsonb(data["calendar"]),
             Jsonb(data["breaks"]), Jsonb(data["summary"]), now, actor))
        async with conn.cursor() as cur:
            await cur.executemany(
                "INSERT INTO ops.imported_series (series_key, product_id, metric, filter, currency, rows) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                [(s["key"], s["product_id"], s["metric"], Jsonb(s["filter"]), s["currency"],
                  Jsonb([stored_row(r) for r in s["rows"]])) for s in data["series"]])

    async def meta(self) -> dict | None:
        """What was imported (no data): for the page."""
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT file_name, bytes, sha256, as_of, about, summary, imported_at, imported_by "
                                     "FROM ops.imported_data WHERE id = 1")
            return await cur.fetchone()

    async def version(self) -> int | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT version FROM ops.data_connection WHERE id = 1 AND source = 'imported'")
            r = await cur.fetchone()
        return r["version"] if r else None

    async def head(self) -> tuple[int, dict] | None:
        v = await self.version()
        if v is None:
            return None
        if self._head and self._head[0] == v:
            return self._head
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT as_of, catalog, calendar, breaks FROM ops.imported_data WHERE id = 1")
            r = await cur.fetchone()
        if r is None:
            return None
        cat = r["catalog"]
        products = {p["product_id"]: p for p in cat.get("products") or []}
        metrics = {(p["product_id"], m["key"]): m for p in products.values() for m in p.get("metrics") or []}
        days = {d["date"]: d for d in (r["calendar"].get("days") or [])}
        kinds = {k: _kind(products[k[0]], m) for k, m in metrics.items()}
        self._head = (v, {**r, "products": products, "metrics": metrics, "days": days, "kinds": kinds,
                          "tz": (cat.get("profile") or {}).get("time_zone") or "UTC"})
        self._series.clear()
        return self._head

    async def series(self, version: int, key: str) -> dict | None:
        hit = self._series.get((version, key), False)
        if hit is not False:
            self._series.move_to_end((version, key))
            return hit
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT currency, rows FROM ops.imported_series WHERE series_key = %s", (key,))
            r = await cur.fetchone()
        self._series[(version, key)] = r
        while len(self._series) > CACHED_SERIES:
            self._series.popitem(last=False)
        return r


# ---------------------------------------------------------------- serving


def _store(request: Request) -> ImportedStore:
    return request.app.state.data_connection.imported


async def _serve(request: Request, expected: str | None, make) -> JSONResponse:
    if request.headers.get(IN_PROCESS_HEADER) != IN_PROCESS_TOKEN:
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    head = await _store(request).head()
    if head is None:
        return JSONResponse({"detail": "No data has been imported."}, status_code=404)
    version, h = head
    today = request.app.state.data_connection.clock.now().astimezone(ZoneInfo(h["tz"])).date()
    try:
        check_version(expected)
        body = await make(version, h, today)
    except Fail as f:
        return problem(f)
    return answer(body)


Version = Annotated[str | None, Header(alias="Metrics-Spec-Version")]


@router.get("/openapi.json")
async def openapi(request: Request):
    if request.headers.get(IN_PROCESS_HEADER) != IN_PROCESS_TOKEN:
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    doc = dict(spec.reference_openapi())
    doc["servers"] = [{"url": PREFIX, "description": "The institution's imported data, served by AMIRI Agent."}]
    return doc


@router.get("/metrics/v1/catalog")
async def catalog(request: Request, expected: Version = None):
    async def make(version, h, today):
        return h["catalog"]
    return await _serve(request, expected, make)


def _product_metric(h: dict, q) -> tuple[dict, dict]:
    pid, key = q.get("product_id"), q.get("metric")
    if not pid:
        raise Fail("invalid_parameter", "product_id is required.", "product_id")
    if not key:
        raise Fail("invalid_parameter", "metric is required.", "metric")
    prod = h["products"].get(pid)
    if prod is None:
        raise Fail("unknown_product", f"No product {pid} in the catalog.", "product_id")
    m = h["metrics"].get((pid, key))
    if m is None:
        raise Fail("unknown_metric", f"{pid} doesn't offer {key}.", "metric")
    return prod, m


def _business(h: dict, d: date) -> bool:
    day = h["days"].get(d.isoformat())
    if day is not None:
        return bool(day.get("business"))
    return d.isoweekday() not in set(h["calendar"].get("weekend_days") or [6, 7])


def _grid(h: dict, m: dict, start: date, until: date) -> list[date]:
    """Starts of the closed grid periods inside [start, until)."""
    grain = m["grain"]
    business = grain == "daily" and m.get("day_basis") == "business"
    out, d = [], first_on_grid(grain, start)
    while d < until:
        e = next_start(grain, d)
        if e > until:
            break
        if not business or _business(h, d):
            out.append(d)
        d = e
    return out


def _state(row: dict, read: date) -> tuple[dict, bool]:
    """The row's values as known on `read`, and whether they were revised by then (an earlier value existed)."""
    vints = row.get("vintages") or []
    for i, v in enumerate(vints):
        if date.fromisoformat(v["superseded_on"]) > read:
            return v, i > 0
    return row, bool(vints)


@router.get("/metrics/v1/series")
async def series(request: Request, expected: Version = None):
    q = request.query_params

    async def make(version, h, today):
        for k in q:
            if k in RELATIVE:
                raise Fail("relative_window", f"{k} is a relative window; this API takes start and until only.", k)
            if k not in SERIES_PARAMS and not k.startswith("filter["):
                raise Fail("invalid_parameter", f"Unknown parameter {k}.", k)
        prod, m = _product_metric(h, q)
        start, until = parse_date(q, "start"), parse_date(q, "until")
        check_window(m["key"], m["grain"], start, until)
        filt = parse_filter(q)
        check_filter(m["key"], m.get("breakdowns") or {}, filt)
        if sorted(filt) not in [sorted(s) for s in m.get("filter_sets") or [[]]]:
            raise Fail("filter_set_not_allowed", f"{m['key']} isn't served filtered on {' and '.join(sorted(filt))} "
                       "together (see the catalog's filter_sets).", "filter")
        kt, kt_given, same_age = vintage_params(q, today)
        basis = q.get("currency_basis", "original")
        if basis == "base" and m.get("currency_rule") == "original":
            raise Fail("unsupported_capability", f"{m['key']} is kept in the customer's currency here; the imported "
                       "data has no base-currency figures.", "currency_basis")
        size = parse_int(q, "page_size", 1, PAGE_MAX) or PAGE_MAX
        offset = 0
        if q.get("page_token"):
            offset, kt = read_page_token(q["page_token"], version)
        kept = bool((h["catalog"].get("profile") or {}).get("vintages_kept"))
        s = await _store(request).series(version, series_key(prod["product_id"], m["key"], filt))
        stored = s["rows"] if s else []
        lag = int(m.get("max_lag_days") or 0)
        end = min(until, kt + timedelta(days=1))
        rows, unpublished, last_until = [], [], None
        for r in stored:
            f, u = date.fromisoformat(r["from"]), date.fromisoformat(r["until"])
            last_until = u
            if f < start or u > end:
                continue
            last = u - timedelta(days=1)
            pub = date.fromisoformat(r["published_at"]) if r.get("published_at") else None
            published = pub or last + timedelta(days=lag)  # back-filled or undated: at its maximum lag
            if published > kt:
                unpublished.append(f)
                continue
            read, vintage = kt, "known_through" if kt_given else "latest"
            if kept and same_age is not None:
                at = last + timedelta(days=same_age)
                if at < published:
                    vintage = "missing"
                else:
                    read, vintage = min(kt, at), "same_age"
            state, revised = _state(r, read) if kept else (r, False)
            if not kept:
                vintage = "latest" if not kt_given else "known_through"
            sup = bool(r.get("suppressed"))
            rows.append({"from": r["from"], "until": r["until"], "value": state.get("value"),
                         "numerator": state.get("numerator"), "denominator": state.get("denominator"),
                         "exposure": state.get("exposure"), "volume": state.get("volume"), "suppressed": sup,
                         "suppression_reason": r.get("suppression_reason"), "published_at": r.get("published_at"),
                         "backfilled": bool(r.get("backfilled")), "data_as_of": read.isoformat(), "vintage": vintage,
                         "revised": revised, "revision_held": False, "extras": r.get("extras") or {}})
        # closed periods after the file's last row: not published (to AMIRI Agent) by known_through
        after = max(start, last_until or date.fromisoformat(m["history_from"]))
        if after < end:
            unpublished += _grid(h, m, after, end)
        page = rows[offset:offset + size]
        nxt = page_token(offset + size, kt, version) if offset + size < len(rows) else None
        cur = s["currency"] if s else None
        return {"product_id": prod["product_id"], "metric": m["key"], "kind": h["kinds"][(prod["product_id"], m["key"])],
                "unit": m["unit"], "currency": cur, "currency_rule": m["currency_rule"], "currency_basis": basis,
                "grain": m["grain"], "day_basis": m.get("day_basis"), "time_zone": h["tz"], "filter": filt,
                "known_through": kt.isoformat() if kt_given else None, "same_age_days": same_age if kept else None,
                "segment_as_of": q.get("segment_as_of"), "vintages_kept": kept, "rows": page,
                "unpublished": [d.isoformat() for d in sorted(set(unpublished))], "next_page_token": nxt}
    return await _serve(request, expected, make)


def _kind(prod: dict, m: dict) -> str:
    """The metric's kind, from the Metrics Spec (the catalog doesn't repeat it)."""
    sm = next((x for x in spec.metrics(prod.get("category")) if x["key"] == m["key"]), None) if prod.get("category") \
        else None
    if sm:
        return sm["kind"]
    return {"count": "count", "currency": "flow", "per_1000": "rate", "percent": "ratio"}.get(m.get("unit"), "level")


@router.get("/metrics/v1/change-concentration")
async def change_concentration(request: Request, expected: Version = None):
    async def make(version, h, today):
        raise Fail("not_implemented", "The imported data holds aggregates only; change concentration needs "
                   "per-contributor changes inside the institution's systems (L5).")
    return await _serve(request, expected, make)


@router.get("/metrics/v1/breaks")
async def breaks(request: Request, expected: Version = None):
    q = request.query_params

    async def make(version, h, today):
        start, until = parse_date(q, "start", required=False), parse_date(q, "until", required=False)
        out = []
        for b in h["breaks"]:
            if q.get("product_id") and b.get("product_ids") and q["product_id"] not in b["product_ids"]:
                continue
            if q.get("metric") and b.get("metrics") and q["metric"] not in b["metrics"]:
                continue
            end = date.fromisoformat(b["until"]) if b.get("until") else None
            if start and end and end <= start:
                continue
            if until and date.fromisoformat(b["date"]) >= until:
                continue
            out.append(b)
        return {"time_zone": h["tz"], "breaks": out}
    return await _serve(request, expected, make)


@router.get("/metrics/v1/calendar")
async def calendar(request: Request, expected: Version = None):
    q = request.query_params

    async def make(version, h, today):
        cal = h["calendar"]
        if q.get("calendar_id") not in (None, "", cal["calendar_id"]):
            raise Fail("invalid_parameter", f"No calendar {q['calendar_id']}; the imported data has "
                       f"{cal['calendar_id']}.", "calendar_id")
        start, until = parse_date(q, "start"), parse_date(q, "until")
        if until <= start:
            raise Fail("invalid_parameter", "until must be after start.", "until")
        if (until - start).days > MAX_DAILY_DAYS:
            raise Fail("range_too_large", f"At most {MAX_DAILY_DAYS} days per call.", "until")
        days, d = [], start
        while d < until:
            x = h["days"].get(d.isoformat())
            if x is not None:
                days.append(x)
            d += timedelta(days=1)
        return {"calendar_id": cal["calendar_id"], "primary": True, "regions": cal.get("regions") or [],
                "time_zone": cal.get("time_zone") or h["tz"], "weekend_days": cal["weekend_days"], "days": days}
    return await _serve(request, expected, make)
