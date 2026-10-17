"""The sample institutions over HTTP: the Metrics Spec reference API at /mock/{bank,insurer}/metrics/v1
(exactly as the spec's OpenAPI describes it, errors included), their OpenAPI document, and the
Platform Admin's switches at /api/v1/mock-institutions."""

import base64
import json
from datetime import date, datetime, timedelta
from typing import Annotated, Any, ClassVar

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import spec
from app.institutions.api import Actor, who
from app.mockinst import data
from app.mockinst.model import FX_TO_BASE, Institution, Metric, Product
from app.mockinst.service import KINDS, MockInstitutions

SPEC_VERSION = "1.0.0"
OLD_VERSION = "0.9.0"
MAX_DAILY_DAYS = 1200
MAX_MONTHS = 120
PAGE_MAX = 500
RELATIVE = {"last", "last_days", "last_n", "window", "period", "mtd", "ytd", "to_date", "since"}
SERIES_PARAMS = {"product_id", "metric", "start", "until", "known_through", "same_age_days", "segment_as_of",
                 "currency_basis", "page_size", "page_token"}
router = APIRouter(prefix="/mock/{kind}", tags=["sample institutions"], include_in_schema=False)
admin = APIRouter(prefix="/api/v1", tags=["sample institutions"])


class Fail(Exception):
    """A Metrics Spec problem (RFC 9457, spec code, the same status per code)."""

    STATUS: ClassVar[dict[str, int]] = {"off_grid": 400, "relative_window": 400, "range_too_large": 400, "invalid_parameter": 400,
              "too_many_filters": 400, "segment_date_not_on_grid": 400, "windows_invalid": 400,
              "alias_filter_conflict": 400, "known_through_in_future": 400, "unsupported_version": 400,
              "unauthorized": 401, "forbidden": 403, "unknown_product": 404, "unknown_metric": 404,
              "unknown_breakdown": 422, "value_not_allowed": 422, "filter_set_not_allowed": 422,
              "unsupported_capability": 422, "rate_limited": 429, "internal": 500, "not_implemented": 501,
              "unavailable": 503}
    TITLES: ClassVar[dict[int, str]] = {400: "Invalid request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 422: "Can't be served",
              429: "Too many requests", 500: "Internal error", 501: "Not implemented", 503: "Unavailable"}

    def __init__(self, code: str, detail: str, parameter: str | None = None):
        self.code, self.detail, self.parameter = code, detail, parameter
        self.status = self.STATUS[code]


def svc(request: Request) -> MockInstitutions:
    return request.app.state.mock_institutions


# ---------------------------------------------------------------- shared request handling


def _problem(f: Fail, version: str | None, retry_after: bool = True) -> JSONResponse:
    body = {"type": f"https://metrics-spec.example/problems/{f.code}", "title": Fail.TITLES[f.status],
            "status": f.status, "code": f.code, "detail": f.detail, "parameter": f.parameter}
    headers = {"Metrics-Spec-Version": version} if version else {}
    if f.status in (429, 503) and retry_after:
        headers["Retry-After"] = "30"
    return JSONResponse(body, status_code=f.status, headers=headers, media_type="application/problem+json")


async def _serve(request: Request, kind: str, expected: str | None, make) -> JSONResponse:
    """Runs one reference-API request: the switch, the faults, the version check, then make(...)."""
    s = svc(request)
    if kind not in KINDS or not s.allowed() or not (await s.state(kind))["enabled"]:
        return JSONResponse({"detail": f"The sample {kind} isn't switched on."}, status_code=404)
    inst, active, today, faults, _ = await s.institution(kind)
    version = None if "no_version_header" in faults else OLD_VERSION if "old_major_version" in faults else SPEC_VERSION
    s.calls[kind] = s.calls.get(kind, 0) + 1
    if "rate_limit_no_retry_after" in faults and s.calls[kind] % 3 == 0:
        return _problem(Fail("rate_limited", "Too many requests; try again shortly."), version, retry_after=False)
    try:
        if expected and expected.split(".")[0] != SPEC_VERSION.split(".")[0]:
            raise Fail("unsupported_version", f"This server implements Metrics Spec {SPEC_VERSION}; "
                       f"{expected} has a different MAJOR.")
        body = make(inst, active, today, faults, version)
    except Fail as f:
        return _problem(f, version)
    return JSONResponse(body, headers={"Metrics-Spec-Version": version} if version else {})


def _date(q, name: str, required: bool = True) -> date | None:
    v = q.get(name)
    if v is None or v == "":
        if required:
            raise Fail("invalid_parameter", f"{name} is required.", name)
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise Fail("invalid_parameter", f"{name} must be a local date (YYYY-MM-DD); got {v}.", name) from None


def _int(q, name: str, lo: int, hi: int) -> int | None:
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


def _filter(q) -> dict[str, str]:
    out = {}
    for k, v in q.multi_items():
        if k.startswith("filter[") and k.endswith("]"):
            out[k[7:-1]] = v
    return out


def _product_metric(inst: Institution, q, faults: set[str]) -> tuple[Product, Metric]:
    pid, key = q.get("product_id"), q.get("metric")
    if not pid:
        raise Fail("invalid_parameter", "product_id is required.", "product_id")
    if not key:
        raise Fail("invalid_parameter", "metric is required.", "metric")
    prod = inst.product(pid)
    if prod is None:
        raise Fail("unknown_product", f"No product {pid} in the catalog.", "product_id")
    m = prod.metrics.get(key)
    if m is None or (("missing_metric" in faults) and _missing(inst) == (pid, key)):
        raise Fail("unknown_metric", f"{pid} doesn't offer {key}.", "metric")
    return prod, m


def _missing(inst: Institution) -> tuple[str, str] | None:
    """The metric the missing_metric fault drops: the first product's first required one."""
    for p in inst.products:
        for m in p.metrics.values():
            if m.spec["tier"] == "required":
                return p.id, m.key
    return None


def _check_filter(m: Metric, filt: dict[str, str]) -> None:
    if len(filt) > 3:
        raise Fail("too_many_filters", f"At most 3 breakdowns per request; got {len(filt)}.", "filter")
    for dim, v in filt.items():
        if dim not in m.breakdowns:
            raise Fail("unknown_breakdown", f"{m.key} has no breakdown {dim} here "
                       f"({', '.join(m.breakdowns) or 'none'}).", f"filter[{dim}]")
        if v not in m.breakdowns[dim]:
            raise Fail("value_not_allowed", f"{v} is not a value of {dim} ({', '.join(m.breakdowns[dim])}).",
                       f"filter[{dim}]")


def _check_window(m: Metric, start: date, until: date, names=("start", "until")) -> None:
    grain = m.spec["grain"]
    for d, n in ((start, names[0]), (until, names[1])):
        if not data.on_grid(grain, d):
            rule = {"weekly": "a Monday", "monthly": "the 1st of a month",
                    "quarterly": "the 1st of a quarter"}.get(grain, "a date")
            raise Fail("off_grid", f"{m.key} is {grain}; {n} must be {rule}. Got {d} ({d.strftime('%A')}).", n)
    if until <= start:
        raise Fail("invalid_parameter", f"{names[1]} must be after {names[0]}.", names[1])
    if grain == "daily" and (until - start).days > MAX_DAILY_DAYS:
        raise Fail("range_too_large", f"At most {MAX_DAILY_DAYS} days per call for daily metrics.", names[1])
    if grain != "daily" and data.periods_in_months(grain, start, until) > MAX_MONTHS:
        raise Fail("range_too_large", f"At most {MAX_MONTHS} months per call.", names[1])


def _vintage_params(q, today: date) -> tuple[date, bool, int | None]:
    kt = _date(q, "known_through", required=False)
    if kt and kt > today:
        raise Fail("known_through_in_future", f"known_through {kt} is after today ({today}).", "known_through")
    seg = _date(q, "segment_as_of", required=False)
    if seg and seg.weekday() != 0:
        raise Fail("segment_date_not_on_grid", f"segment_as_of must be a Monday; got {seg} ({seg.strftime('%A')}).",
                   "segment_as_of")
    basis = q.get("currency_basis", "original")
    if basis not in ("original", "base"):
        raise Fail("invalid_parameter", "currency_basis is original or base.", "currency_basis")
    # known_through is inclusive: today's own data isn't complete, so the latest view is as of yesterday
    return kt or today - timedelta(days=1), kt is not None, _int(q, "same_age_days", 0, 730)


def _fmt_date(d: date | None, faults: set[str]) -> str | None:
    if d is None:
        return None
    return d.strftime("%Y/%m/%d") if "wrong_formats" in faults else d.isoformat()


def _contributor(inst: Institution, prod: Product) -> str:
    if inst.kind == "insurer":
        return "policyholder"
    if prod.category.endswith("_loan") or prod.category in ("vehicle_finance", "cards", "trade_finance"):
        return "obligor"
    return "customer"


# ---------------------------------------------------------------- the reference API


@router.get("/openapi.json")
async def openapi(request: Request, kind: str):
    if kind not in KINDS or not (await svc(request).state(kind))["enabled"]:
        return JSONResponse({"detail": f"The sample {kind} isn't switched on."}, status_code=404)
    doc = dict(spec.reference_openapi())
    doc["servers"] = [{"url": f"{str(request.base_url).rstrip('/')}/mock/{kind}",
                       "description": f"The sample {kind} served by Amiri Agent."}]
    return doc


@router.get("/metrics/v1/catalog")
async def catalog(request: Request, kind: str, expected: Annotated[str | None, Header(alias="Metrics-Spec-Version")] = None):
    def make(inst: Institution, active, today: date, faults: set[str], version):
        missing = _missing(inst) if "missing_metric" in faults else None
        products = []
        for p in inst.products:
            metrics = []
            for m in p.metrics.values():
                if (p.id, m.key) == missing:
                    continue
                metrics.append({
                    "key": m.key, "grain": m.spec["grain"], "day_basis": m.spec.get("day_basis"),
                    "unit": m.spec["unit"], "currency_rule": m.spec["currency_rule"], "capability_level": "L4",
                    "history_from": m.history_from.isoformat(), "max_lag_days": data.lag_days(m, active),
                    "breakdowns": m.breakdowns, "filter_sets": None, "extras": [], "notes": None})
            products.append({
                "product_id": p.id, "name": p.name, "category": p.category, "product_type": p.product_type,
                "scope": "product", "shariah_compliant": p.islamic,
                "launched_on": p.launched_on.isoformat() if p.launched_on else None,
                "book_size": {"value": p.book, "unit": "currency", "currency": p.currency,
                              "as_of": (today - timedelta(days=today.day)).isoformat()},
                "metrics": metrics})
        cal_id = f"{inst.country.lower()}-banks"
        first = min((m.history_from for p in inst.products for m in p.metrics.values()), default=today)
        return {
            "spec_version": version or SPEC_VERSION,
            "generated_at": datetime.combine(today, datetime.min.time()).isoformat() + "Z",
            "profile": {
                "institution_type": inst.kind, "legal_entity_name": inst.legal_name, "lei": inst.lei,
                "country": inst.country, "spec_version": version or SPEC_VERSION, "time_zone": inst.time_zone,
                "business_calendars": [{"id": cal_id, "primary": True, "weekend_days": data.weekend_days(inst),
                                        "regions": [], "source": "served", "url": None}],
                "base_currency": inst.currency, "base_currency_history": [], "pivot_currency": "USD",
                "fx_reference_sources": [{"use": "default", "name": "central bank daily reference rate",
                                          "rate_type": "mid", "fixing_time": None}],
                "inflation_regime": "normal", "region_basis": "home_branch" if inst.kind == "bank" else None,
                "region_levels": {"l1": "iso_3166_2", "l2": "mapped"}, "sector_classification": "ISIC Rev.4",
                "accounting_framework": {"framework": "IFRS 9", "dpd_materiality": None,
                                         "dpd_reset_on_restructure": False, "dpd_note": None},
                "suppression": {"min_contributors": 10, "dominance_one": 0.5, "dominance_two": 0.85,
                                "local_rule": None},
                "renewal_grace_days": 30 if inst.kind == "insurer" else None,
                "free_look_days": 15 if inst.kind == "insurer" else None,
                "capability_level": "L4", "vintages_kept": True,
                "vintage_history_from": date(first.year + 1, first.month, 1).isoformat(),
                "segment_snapshot": "weekly_snapshot", "shariah_compliant": inst.islamic},
            "products": products,
            "dimension_values": {"region_l1": [{"value": c, "label": label, "parent": None, "official_code": c,
                                                "calendar_id": cal_id} for c, label in inst.region_labels.items()]},
            "aliases": [], "deprecations": [],
            "declarations": {"cost_index_baskets": [], "gold_reference": None, "mcc_to_isic": None,
                             "micro_insurance_ceiling": None, "remittance_currency_source": [],
                             "offered_rate_reference_tenors": []}}
    return await _serve(request, kind, expected, make)


@router.get("/metrics/v1/series")
async def series(request: Request, kind: str, expected: Annotated[str | None, Header(alias="Metrics-Spec-Version")] = None):
    q = request.query_params

    def make(inst: Institution, active, today: date, faults: set[str], version):
        for k in q:
            if k in RELATIVE:
                raise Fail("relative_window", f"{k} is a relative window; this API takes start and until only.", k)
            if k not in SERIES_PARAMS and not k.startswith("filter["):
                raise Fail("invalid_parameter", f"Unknown parameter {k}.", k)
        prod, m = _product_metric(inst, q, faults)
        start, until = _date(q, "start"), _date(q, "until")
        _check_window(m, start, until)
        filt = _filter(q)
        _check_filter(m, filt)
        kt, kt_given, same_age = _vintage_params(q, today)
        size = _int(q, "page_size", 1, PAGE_MAX) or PAGE_MAX
        offset = 0
        if q.get("page_token"):
            try:
                tok = json.loads(base64.urlsafe_b64decode(q["page_token"]).decode())
                offset, kt = int(tok["o"]), date.fromisoformat(tok["k"])
            except (ValueError, KeyError, TypeError):
                raise Fail("invalid_parameter", "page_token isn't one this server gave.", "page_token") from None
        rows, unpublished = data.series(inst, prod, m, filt, start, min(until, kt + timedelta(days=1)), kt, same_age,
                                        kt_given, active, suppress="suppression_off" not in faults)
        rate = FX_TO_BASE.get(inst.currency, 1.0) if (q.get("currency_basis") == "base"
                                                     and m.spec["currency_rule"] == "original") else 1.0
        page = rows[offset:offset + size]
        nxt = None
        if offset + size < len(rows):
            nxt = base64.urlsafe_b64encode(json.dumps({"o": offset + size, "k": kt.isoformat()}).encode()).decode()

        def num(x: float | None) -> Any:
            if x is None:
                return None
            v = round(x * rate, 4)
            return str(v) if "wrong_formats" in faults else v

        return {
            "product_id": prod.id, "metric": m.key, "kind": m.spec["kind"], "unit": m.spec["unit"],
            "currency": (inst.currency if rate != 1.0 else m.currency), "currency_rule": m.spec["currency_rule"],
            "currency_basis": q.get("currency_basis", "original"), "grain": m.spec["grain"],
            "day_basis": m.spec.get("day_basis"), "time_zone": inst.time_zone, "filter": filt,
            "known_through": kt.isoformat() if kt_given else None, "same_age_days": same_age,
            "segment_as_of": q.get("segment_as_of"), "vintages_kept": True,
            "rows": [{"from": r.start.isoformat(), "until": r.until.isoformat(), "value": num(r.value),
                      "numerator": r.numerator, "denominator": r.denominator, "exposure": r.exposure,
                      "volume": r.volume, "suppressed": r.suppressed, "suppression_reason": r.suppression_reason,
                      "published_at": _fmt_date(r.published_at, faults), "backfilled": r.backfilled,
                      "data_as_of": r.data_as_of.isoformat(), "vintage": r.vintage, "revised": r.revised,
                      "revision_held": False, "extras": {}} for r in page],
            "unpublished": [d.isoformat() for d in unpublished], "next_page_token": nxt}
    return await _serve(request, kind, expected, make)


@router.get("/metrics/v1/change-concentration")
async def change_concentration(request: Request, kind: str,
                               expected: Annotated[str | None, Header(alias="Metrics-Spec-Version")] = None):
    q = request.query_params

    def make(inst: Institution, active, today: date, faults: set[str], version):
        prod, m = _product_metric(inst, q, faults)
        if m.spec["kind"] in ("level", "stock"):
            raise Fail("unsupported_capability", f"Change concentration isn't defined for a {m.spec['kind']} metric.",
                       "metric")
        a0, a1, b0, b1 = (_date(q, n) for n in ("a_start", "a_until", "b_start", "b_until"))
        _check_window(m, a0, a1, ("a_start", "a_until"))
        _check_window(m, b0, b1, ("b_start", "b_until"))
        pa, pb = data.periods(inst, m, a0, a1), data.periods(inst, m, b0, b1)
        if a1 > b0 or len(pa) != len(pb) or not pa:
            raise Fail("windows_invalid", "Windows a and b must be disjoint, b after a, with the same number of "
                       "grid periods.", "b_start")
        filt = _filter(q)
        _check_filter(m, filt)
        kt, kt_given, same_age = _vintage_params(q, today)
        if b1 > kt + timedelta(days=1):
            raise Fail("invalid_parameter", "Window b must have closed by known_through.", "b_until")
        ra, _ = data.series(inst, prod, m, filt, a0, a1, kt, same_age, kt_given, active)
        rb, _ = data.series(inst, prod, m, filt, b0, b1, kt, same_age, kt_given, active)
        few = any(r.suppressed for r in ra + rb) or not ra or not rb
        total = sum(r.value or 0 for r in rb) - sum(r.value or 0 for r in ra)
        c = active.get("dominant_obligor")
        band, reason = None, None
        if few:
            reason = "too_few_contributors"
        elif abs(total) < 1e-9:
            reason = "no_change"
        elif c and m.key == "facility_utilization" and prod.category == "business_loan" and b1 > c.start:
            band = "from_0.8"
        else:
            band = "below_0.5"
        return {"product_id": prod.id, "metric": m.key, "filter": filt, "time_zone": inst.time_zone,
                "windows": {"a": {"from": a0.isoformat(), "until": a1.isoformat()},
                            "b": {"from": b0.isoformat(), "until": b1.isoformat()}},
                "known_through": kt.isoformat() if kt_given else None, "same_age_days": same_age,
                "segment_as_of": q.get("segment_as_of"), "contributor_basis": _contributor(inst, prod),
                "top_share_band": band, "suppressed": few, "reason": reason}
    return await _serve(request, kind, expected, make)


@router.get("/metrics/v1/breaks")
async def breaks(request: Request, kind: str, expected: Annotated[str | None, Header(alias="Metrics-Spec-Version")] = None):
    q = request.query_params

    def make(inst: Institution, active, today: date, faults: set[str], version):
        start, until = _date(q, "start", required=False), _date(q, "until", required=False)
        out = []
        for b in data.breaks(inst, active):
            if q.get("product_id") and b["product_ids"] and q["product_id"] not in b["product_ids"]:
                continue
            if q.get("metric") and b["metrics"] and q["metric"] not in b["metrics"]:
                continue
            end = date.fromisoformat(b["until"]) if b["until"] else None
            if start and end and end <= start:
                continue
            if until and date.fromisoformat(b["date"]) >= until:
                continue
            out.append(b)
        return {"time_zone": inst.time_zone, "breaks": out}
    return await _serve(request, kind, expected, make)


@router.get("/metrics/v1/calendar")
async def calendar(request: Request, kind: str, expected: Annotated[str | None, Header(alias="Metrics-Spec-Version")] = None):
    q = request.query_params

    def make(inst: Institution, active, today: date, faults: set[str], version):
        cal_id = f"{inst.country.lower()}-banks"
        if q.get("calendar_id") not in (None, "", cal_id):
            raise Fail("invalid_parameter", f"No calendar {q['calendar_id']}; this institution serves {cal_id}.",
                       "calendar_id")
        start, until = _date(q, "start"), _date(q, "until")
        if until <= start:
            raise Fail("invalid_parameter", "until must be after start.", "until")
        if (until - start).days > MAX_DAILY_DAYS:
            raise Fail("range_too_large", f"At most {MAX_DAILY_DAYS} days per call.", "until")
        out = []
        for d in data.days(inst, start, until):
            out.append({"date": d.date.isoformat(), "business": d.business, "partial": False,
                        "holidays": [{"name": n, "moving": False, "kind": "public"} for n in d.holidays],
                        "flags": list(d.flags), "month_bday": d.month_bday,
                        "month_bday_from_end": d.month_bday_from_end})
        return {"calendar_id": cal_id, "primary": True, "regions": [], "time_zone": inst.time_zone,
                "weekend_days": data.weekend_days(inst), "days": out}
    return await _serve(request, kind, expected, make)


# ---------------------------------------------------------------- the Platform Admin's switches


class SampleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    conditions: Annotated[list[dict], Field(max_length=20)] = []


@admin.get("/mock-institutions", summary="The sample bank and insurer: on or off, conditions, and what shapes them")
async def list_samples(request: Request):
    return {"allowed": MockInstitutions.allowed(), "items": [await svc(request).view(k) for k in KINDS]}


@admin.put("/mock-institutions/{kind}", summary="Switch a sample on or off and set its conditions")
async def put_sample(request: Request, kind: str, body: SampleIn, actor: Actor = None):
    return await svc(request).put(kind, body.enabled, body.conditions, who(actor, None)[0])
