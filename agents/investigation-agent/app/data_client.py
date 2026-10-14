"""Reads the institution's data coverage and business calendar through amiri-server,
never metric values (that's the validator's job).

    GET {server_url}/api/v1/internal/coverage?institution_id=…
        {data_source: {data_source_id, catalog_version}, products: [{product_id,
         source_product_id, book_size: {value, unit}, metrics: [{metric, kind, unit,
         currency, grain, lag_days, adverse, method, min_volume, dimensions, thresholds, …}]}]}
    GET {server_url}/api/v1/internal/calendar?institution_id=…&start=…&until=…
        {calendar_id, time_zone, weekend_days: [ISO weekday], days: [{date, business, …}]}

The server joins the data source's reference-API catalog (Metrics Spec) with the spec's
validation rules, and maps the profile's products to the source's. Each call has a
timeout (DATA_TIMEOUT_SECONDS).
"""

import asyncio
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

import httpx

from app import settings
from app.contract import InvestigationRequest


class DataError(Exception):
    """The server refused a call or couldn't be reached."""


@dataclass
class Calendar:
    """Business days of the data source's primary calendar (Metrics Spec business_calendars)."""

    business_days: list[date] = field(default_factory=list)
    calendar_id: str | None = None
    weekend_days: tuple[int, ...] = (
        6,
        7,
    )  # ISO weekdays; used only where the days run out
    known: bool = (
        True  # False: no calendar came back; weekdays outside weekend_days are used
    )


class Data(Protocol):
    async def coverage(self, req: InvestigationRequest) -> dict[str, Any]: ...

    async def calendar(
        self, req: InvestigationRequest, start: date, until: date
    ) -> Calendar: ...


class HttpData:
    async def _headers(self, audience: str) -> dict[str, str]:
        if settings.raw("DATA_AUTH") != "id_token":
            return {}
        import google.auth.transport.requests
        import google.oauth2.id_token

        try:
            token = await asyncio.to_thread(
                google.oauth2.id_token.fetch_id_token,
                google.auth.transport.requests.Request(),
                audience,
            )
        except Exception as e:  # no credentials, metadata server unreachable
            raise DataError(
                f"couldn't get an ID token for {audience}: {type(e).__name__}: {e}"
            ) from e
        return {"Authorization": f"Bearer {token}"}

    async def _get(self, req: InvestigationRequest, path: str, params: dict) -> dict:
        base = req.server_url.rstrip("/")
        url = f"{base}/api/v1/internal/{path}"
        try:
            async with httpx.AsyncClient(
                timeout=settings.number("DATA_TIMEOUT_SECONDS")
            ) as client:
                r = await client.get(
                    url,
                    params={"institution_id": req.institution_id, **params},
                    headers=await self._headers(base),
                )
        except httpx.HTTPError as e:  # connection refused, timeout
            raise DataError(f"{path}: {type(e).__name__}: {e}") from e
        if r.status_code != 200:
            raise DataError(f"{path}: HTTP {r.status_code}: {r.text[:300]}")
        return r.json()

    async def coverage(self, req: InvestigationRequest) -> dict[str, Any]:
        return await self._get(req, "coverage", {})

    async def calendar(
        self, req: InvestigationRequest, start: date, until: date
    ) -> Calendar:
        body = await self._get(
            req, "calendar", {"start": start.isoformat(), "until": until.isoformat()}
        )
        return Calendar(
            business_days=[
                date.fromisoformat(d["date"])
                for d in body.get("days", [])
                if d["business"]
            ],
            calendar_id=body.get("calendar_id"),
            weekend_days=tuple(body.get("weekend_days") or (6, 7)),
        )
