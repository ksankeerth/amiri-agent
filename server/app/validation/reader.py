"""The validator's view of the institution's data, read through InstitutionData (the same client the
connector checked), for one tick.

The catalog, calendar and breaks are read once and shared by the tick's tasks. A metric's validation
parameters (method, minimum volume, stable age, masking) come from the Metrics Spec, which owns them
(spec §6); the institution's catalog says what is served and how (grain, lag, breakdowns, history).

Reads are kept on the metric's grid (the reference API refuses off-grid dates), split to the API's
per-call limits, and followed through every page. Nothing waits in process: a rate-limited read is a
transient error, and the task is checked again on a later tick."""

import asyncio
from datetime import date, timedelta
from typing import Any

from app import spec
from app.connect.client import Answer, InstitutionData
from app.validation.contract import ToolCall
from app.validation.periods import add_months, next_period, period_start

MAX_DAILY_DAYS = 1100   # under the API's 1,200 days per call
MAX_MONTHS = 110        # under its 120 months per call
BAND_LOWER = {"below_0.5": 0.0, "from_0.5_below_0.8": 0.5, "from_0.8": 0.8}


class DataError(Exception):
    """The institution's API refused a read or couldn't be reached."""

    def __init__(self, message: str, transient: bool, rate_limited: bool = False):
        super().__init__(message)
        self.transient = transient
        self.rate_limited = rate_limited


def _raise_for(a: Answer, what: str) -> None:
    if a.status == 200 and isinstance(a.body, dict):
        return
    if a.status is None:
        raise DataError(f"{what}: {a.error}", transient=True)
    code = a.body.get("code") if isinstance(a.body, dict) else None
    detail = a.body.get("detail") if isinstance(a.body, dict) else a.text[:200]
    msg = f"{what}: HTTP {a.status}{f' {code}' if code else ''}: {detail}"
    if a.status in (429, 503):
        raise DataError(msg, transient=True, rate_limited=True)
    raise DataError(msg, transient=a.status >= 500)


def _grid_start(d: date, grain: str) -> date:
    """The first grid date on or before d (weeks start on Monday, months on the 1st)."""
    return d if grain == "daily" else period_start(d, grain if grain != "quarterly" else "monthly")


def _grid_until(d: date, grain: str) -> date:
    """The first grid date on or after d."""
    if grain == "daily":
        return d
    s = period_start(d, grain if grain != "quarterly" else "monthly")
    return s if s == d else next_period(s, grain if grain != "quarterly" else "monthly")


def _chunks(start: date, until: date, grain: str) -> list[tuple[date, date]]:
    out, s = [], start
    while s < until:
        e = s + timedelta(days=MAX_DAILY_DAYS) if grain == "daily" else _grid_until(add_months(s, MAX_MONTHS), grain)
        e = min(until, e)
        out.append((s, e))
        s = e
    return out


def _spec_metric(category: str, key: str) -> dict | None:
    return next((m for m in spec.metrics(category) if m["key"] == key), None)


class RunReader:
    """One tick's view of the connected institution, shared by its tasks."""

    def __init__(self, data: InstitutionData, source_id: str):
        self.data, self.source_id = data, source_id
        self._catalog: dict[str, Any] | None = None
        self._raw: dict[str, Any] | None = None
        self._grains: dict[tuple[str, str], str] = {}
        self._lock = asyncio.Lock()
        self._days: dict[date, dict[str, Any]] = {}
        self._calendar_spans: list[tuple[date, date]] = []
        self._breaks: list[dict[str, Any]] | None = None

    async def _get(self, trace: list[ToolCall] | None, step: str, path: str, params: dict[str, Any]) -> dict:
        a = await self.data.get(path, _flatten(params))
        try:
            _raise_for(a, f"GET {path}")
        except DataError as e:
            if trace is not None:
                trace.append(ToolCall(step=step, tool=path, args=params, status="error", error=str(e)))
            raise
        if trace is not None:
            trace.append(ToolCall(step=step, tool=path, args=params))
        return a.body

    # ---------------------------------------------------------------- the catalog, as the validator reads it

    async def catalog(self, trace: list[ToolCall] | None = None) -> dict[str, Any]:
        async with self._lock:
            if self._catalog is None:
                raw = await self._get(trace, "check", "/catalog", {})
                self._raw, self._catalog = raw, self._adapt(raw)
            elif trace is not None:
                trace.append(ToolCall(step="check", tool="/catalog", status="cached"))
        return self._catalog

    def _adapt(self, raw: dict) -> dict[str, Any]:
        prof = raw.get("profile") or {}
        products = []
        for p in raw.get("products") or []:
            metrics = []
            for m in p.get("metrics") or []:
                sm = _spec_metric(p.get("category"), m.get("key")) or {}
                v = sm.get("validation") or {}
                masked = v.get("masked_by") or {}  # {family, metrics: [{metric, rise, unit}], else_break_kind, ...}
                rises = {x["metric"]: float(x.get("rise") or 2.0) for x in masked.get("metrics") or [] if x.get("metric")}
                self._grains[(p["product_id"], m["key"])] = m.get("grain")
                metrics.append({
                    "metric": m["key"], "grain": m.get("grain"), "kind": sm.get("kind"), "unit": m.get("unit"),
                    "dimensions": m.get("breakdowns") or {}, "adverse": (sm.get("adverse") or [None])[0],
                    "adverse_allowed": v.get("adverse_allowed") or sm.get("adverse") or [],
                    "min_volume": v.get("min_volume"),
                    "lag_days": max(int(m.get("max_lag_days") or 0), int(sm.get("max_lag_days") or 0)),
                    "stable_age_days": v.get("stable_age_days") or 0, "history_from": m.get("history_from"),
                    "masked_by": list(rises), "mask_rises": rises,
                    "mask_family": bool(v.get("mask_family")), "min_base": v.get("min_base"),
                    "counts": bool(v.get("counts")), "min_denominator": v.get("min_denominator"),
                })
            products.append({"product_id": p["product_id"], "category": p.get("category"), "metrics": metrics})
        aliases = {a["old"]["key"]: a["new"]["key"] for a in raw.get("aliases") or []
                   if isinstance(a, dict) and isinstance(a.get("old"), dict) and isinstance(a.get("new"), dict)}
        primary = next((c.get("id") for c in prof.get("business_calendars") or [] if c.get("primary")), None)
        return {"catalog_version": f"{raw.get('spec_version')}/{str(raw.get('generated_at'))[:10]}",
                "spec_version": raw.get("spec_version"), "vintages_kept": bool(prof.get("vintages_kept", True)),
                "aliases": aliases, "products": products, "calendar_id": primary,
                "time_zone": prof.get("time_zone")}

    # ---------------------------------------------------------------- calendar and breaks

    async def calendar(self, start: date, until: date, trace: list[ToolCall] | None = None) -> dict[date, dict[str, Any]]:
        """Days in [start, until), keyed by date (the primary calendar)."""
        cal = (await self.catalog()).get("calendar_id")
        async with self._lock:
            if not any(s <= start and until <= e for s, e in self._calendar_spans):
                s = start
                while s < until:
                    e = min(until, s + timedelta(days=MAX_DAILY_DAYS))
                    body = await self._get(trace, "plan", "/calendar",
                                           {"calendar_id": cal, "start": s.isoformat(), "until": e.isoformat()})
                    for d in body.get("days") or []:
                        self._days[date.fromisoformat(d["date"])] = d
                    s = e
                self._calendar_spans.append((start, until))
            elif trace is not None:
                trace.append(ToolCall(step="plan", tool="/calendar", args={"start": start.isoformat(),
                                                                            "until": until.isoformat()}, status="cached"))
        return {d: v for d, v in self._days.items() if start <= d < until}

    async def breaks(self, product_id: str, metric: str, trace: list[ToolCall] | None = None) -> list[dict[str, Any]]:
        async with self._lock:
            if self._breaks is None:
                body = await self._get(trace, "breaks", "/breaks", {})
                self._breaks = body.get("breaks") or []
            elif trace is not None:
                trace.append(ToolCall(step="breaks", tool="/breaks", status="cached"))
        out = []
        for b in self._breaks:
            if b.get("product_ids") and product_id not in b["product_ids"]:
                continue
            if b.get("metrics") and metric not in b["metrics"]:
                continue
            out.append({**b, "note": b.get("description"), "applies_to": b.get("applies_to") or {}})
        return out

    # ---------------------------------------------------------------- series

    async def history(self, step: str, trace: list[ToolCall] | None, product_id: str, metric: str, start: date,
                      until: date, filter: dict[str, str], known_through: date, same_age_days: int | None = None,
                      segment_frozen_at: date | None = None, currency_basis: str = "original") -> dict[str, Any]:
        """GET /series over [start, until) on the metric's grid, split to the per-call limits, every page."""
        await self.catalog()
        grain = self._grains.get((product_id, metric), "daily")
        start, until = _grid_start(start, grain), _grid_until(until, grain)
        rows: list[dict] = []
        unpublished: list[str] = []
        vintages_kept = True
        for s, e in _chunks(start, until, grain):
            token = None
            while True:
                params: dict[str, Any] = {"product_id": product_id, "metric": metric, "start": s.isoformat(),
                                          "until": e.isoformat(), "known_through": known_through.isoformat(),
                                          "filter": filter}
                if same_age_days is not None:
                    params["same_age_days"] = same_age_days
                if segment_frozen_at is not None and segment_frozen_at.weekday() == 0:
                    params["segment_as_of"] = segment_frozen_at.isoformat()
                if currency_basis != "original":
                    params["currency_basis"] = currency_basis
                if token:
                    params["page_token"] = token
                body = await self._get(trace, step, "/series", params)
                rows += body.get("rows") or []
                unpublished += body.get("unpublished") or []
                vintages_kept = vintages_kept and bool(body.get("vintages_kept", True))
                token = body.get("next_page_token")
                if not token:
                    break
        return {"rows": rows, "unpublished": unpublished, "vintages_kept": vintages_kept}

    async def change_concentration(self, trace: list[ToolCall] | None, product_id: str, metric: str,
                                   a: tuple[date, date], b: tuple[date, date], filter: dict[str, str],
                                   known_through: date, same_age_days: int | None) -> dict[str, Any]:
        """The band for the largest contributor's share of the change, and its lower bound (None: no answer)."""
        params: dict[str, Any] = {"product_id": product_id, "metric": metric, "a_start": a[0].isoformat(),
                                  "a_until": a[1].isoformat(), "b_start": b[0].isoformat(), "b_until": b[1].isoformat(),
                                  "known_through": known_through.isoformat(), "filter": filter}
        if same_age_days is not None:
            params["same_age_days"] = same_age_days
        try:
            body = await self._get(trace, "data_quality", "/change-concentration", params)
        except DataError as e:
            if e.transient:
                raise
            return {"top_share_band": None, "top_share_lower": None, "unavailable": str(e)}  # L4 or below: not judged
        band = body.get("top_share_band")
        return {"top_share_band": band, "top_share_lower": BAND_LOWER.get(band) if band else None}


def _flatten(params: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in params.items() if k != "filter" and v is not None}
    for k, v in (params.get("filter") or {}).items():
        out[f"filter[{k}]"] = v
    return out
