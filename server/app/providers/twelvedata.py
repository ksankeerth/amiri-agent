"""Twelve Data client (time series and symbol search).

The key goes in the Authorization header, never in the URL, so it can't reach
logs. Every failure becomes a ProviderError with one of a few codes, and keeps
the provider's own message as raised.
"""

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app import settings

PROVIDER = "twelvedata"
logger = logging.getLogger("amiri.twelvedata")

# What one call costs. Twelve Data's `api-credits-used` header is the running total for the
# current minute (across every client of the key), not this call's cost, so it is only logged.
CREDITS = {"/time_series": 1, "/symbol_search": 1}


@dataclass(frozen=True)
class Bar:
    ts: datetime  # bar start, UTC
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal | None


@dataclass
class TimeSeries:
    meta: dict[str, Any]
    bars: list[Bar]  # oldest first
    credits: int = 1
    http_status: int = 200


@dataclass
class ProviderError(Exception):
    # not_configured | auth_failed | symbol_not_found | symbol_not_on_plan |
    # no_data | rate_limited | bad_request | unavailable
    code: str
    message: str
    http_status: int | None = None
    credits: int = 1
    retry_after: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"


def _classify(status: int, message: str) -> str:
    m = message.lower()
    if status == 401:
        return "auth_failed"
    if status == 429:
        return "rate_limited"
    if status == 403 or ("plan" in m and ("available" in m or "upgrade" in m)):
        return "symbol_not_on_plan"
    if "no data is available" in m or "no data" in m:
        return "no_data"
    if status in (400, 404) and "symbol" in m and ("not found" in m or "invalid" in m or "missing" in m):
        return "symbol_not_found"
    if status == 404:
        return "symbol_not_found"
    if status >= 500:
        return "unavailable"
    return "bad_request"


def _parse_ts(value: str) -> datetime:
    fmt = "%Y-%m-%d %H:%M:%S" if " " in value else "%Y-%m-%d"
    return datetime.strptime(value, fmt).replace(tzinfo=UTC)


def _dec(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        return None


class TwelveDataClient:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None):
        self._client = httpx.AsyncClient(
            base_url=settings.raw("TWELVEDATA_BASE_URL"),
            timeout=settings.number("TWELVEDATA_TIMEOUT_SECONDS"),
            transport=transport,
        )

    @staticmethod
    def configured() -> bool:
        return bool(settings.raw("TWELVEDATA_API_KEY"))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict[str, Any]) -> tuple[dict[str, Any], int, int]:
        key = settings.raw("TWELVEDATA_API_KEY")
        if not key:
            raise ProviderError("not_configured", "TWELVEDATA_API_KEY is not set", credits=0)
        try:
            r = await self._client.get(path, params=params, headers={"Authorization": f"apikey {key}"})
        except httpx.TimeoutException as e:
            raise ProviderError("unavailable", f"timeout: {type(e).__name__}", credits=0) from e
        except httpx.HTTPError as e:
            raise ProviderError("unavailable", f"{type(e).__name__}: {e}", credits=0) from e
        credits = CREDITS.get(path, 1)
        logger.debug("%s %s: credits used this minute %s", path, r.status_code, r.headers.get("api-credits-used", "?"))
        try:
            body = r.json()
        except ValueError:
            body = {}
        if r.status_code >= 400 or body.get("status") == "error" or not body:
            status = int(body.get("code") or r.status_code)
            message = str(body.get("message") or r.text[:300] or f"HTTP {r.status_code}")
            code = _classify(status, message)
            raise ProviderError(
                code, message, http_status=status, credits=credits,
                retry_after=60 if code == "rate_limited" else None,
            )
        return body, credits, r.status_code

    async def time_series(
        self,
        symbol: str,
        interval: str = "1h",
        start: datetime | None = None,
        outputsize: int | None = None,
    ) -> TimeSeries:
        params: dict[str, Any] = {"symbol": symbol, "interval": interval, "timezone": "UTC", "order": "asc"}
        if start is not None:
            params["start_date"] = start.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")
            params["outputsize"] = 5000
        else:
            params["outputsize"] = outputsize or 30
        body, credits, status = await self._get("/time_series", params)
        bars = []
        for v in body.get("values") or []:
            o, h, lo, c = (_dec(v.get(k)) for k in ("open", "high", "low", "close"))
            if c is None:
                continue
            bars.append(Bar(_parse_ts(v["datetime"]), o or c, h or c, lo or c, c, _dec(v.get("volume"))))
        bars.sort(key=lambda b: b.ts)
        return TimeSeries(meta=body.get("meta") or {}, bars=bars, credits=credits, http_status=status)

    async def symbol_search(self, query: str) -> tuple[list[dict[str, Any]], int]:
        body, credits, _ = await self._get(
            "/symbol_search", {"symbol": query, "outputsize": 20, "show_plan": "true"}
        )
        return list(body.get("data") or []), credits
