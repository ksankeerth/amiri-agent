"""Market series: what the API and the tick do. Code only; no model.

Scheduling: each series row carries `next_fetch_at` (on the hour for a 60-minute
interval). The tick fetches series that are due, within the provider's credit
budget; the rest wait for the next tick. A fetch holds a lease on the row
(`fetch_started_at`), so a manual refresh and the tick never fetch the same
series at once, and a crashed fetch stops blocking after the lease time.

Credits: every provider call is a row in signals.provider_calls, written before
the call under an advisory lock, so concurrent requests can't overspend the
per-minute or per-day budget.
"""

import math
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import reference, settings
from app.clock import Clock
from app.problems import Problem
from app.providers.twelvedata import PROVIDER, ProviderError, TwelveDataClient
from app.series import detect

BUDGET_LOCK = 7_310_002
SERIES_LIMIT_LOCK = 7_310_003
INTERVAL = "1h"
BAR = timedelta(hours=1)
AROUND_THE_CLOCK_TYPES = {"physical currency", "digital currency", "commodity", "precious metal"}
LOOKUP_TTL = timedelta(hours=24)


@dataclass
class Fetched:
    status: str  # ok | no_new_data | error
    trigger: str
    bars_received: int = 0
    bars_new: int = 0
    latest_bar_ts: datetime | None = None
    finding_id: str | None = None
    error: ProviderError | None = None


# ---------------------------------------------------------------- helpers


def detector_defaults(instrument_type: str | None = None) -> dict[str, Any]:
    around = (instrument_type or "").lower() in AROUND_THE_CLOCK_TYPES or instrument_type is None
    return {
        "z_threshold": settings.number("SERIES_Z_THRESHOLD"),
        "sigma_days": settings.integer("SERIES_SIGMA_DAYS"),
        "windows_days": [int(x) for x in settings.names("SERIES_WINDOWS_DAYS")],
        "cooldown_hours": settings.integer("SERIES_COOLDOWN_HOURS"),
        "stale_after_hours": settings.integer(
            "SERIES_STALE_AFTER_HOURS_24H" if around else "SERIES_STALE_AFTER_HOURS_SESSION"
        ),
    }


def series_id_for(symbol: str) -> str:
    sid = re.sub(r"[^a-z0-9]+", "_", symbol.lower()).strip("_")
    return sid[:40] or "series"


def next_slot(now: datetime) -> datetime:
    """The next fetch time on the interval's grid (on the hour for 60 minutes)."""
    every = settings.integer("SERIES_FETCH_EVERY_MINUTES") * 60
    epoch = int(now.timestamp())
    return datetime.fromtimestamp((epoch // every + 1) * every, UTC)


def day_start(now: datetime) -> datetime:
    return datetime.combine(now.astimezone(UTC).date(), datetime.min.time(), UTC)


def _f(x: Any) -> float | None:
    return None if x is None else float(x)


def provider_problem(e: ProviderError, *, adding: bool = False) -> Problem:
    """Maps a provider failure to the API's answer. The provider's message is kept."""
    extra = {"provider": PROVIDER, "provider_code": e.code, "provider_message": e.message,
             "provider_http_status": e.http_status}
    if e.code == "not_configured":
        return Problem(503, "provider_not_configured", "Twelve Data isn't configured: set TWELVEDATA_API_KEY.", **extra)
    if e.code == "rate_limited":
        return Problem(503, "provider_rate_limited", "Twelve Data refused the call: too many requests.", retry_after=e.retry_after or 60, **extra)
    if adding and e.code == "symbol_not_found":
        return Problem(422, "symbol_not_found", "Twelve Data doesn't know this symbol.", **extra)
    if adding and e.code == "symbol_not_on_plan":
        return Problem(422, "symbol_not_on_plan", "This symbol isn't available on the Twelve Data plan in use.", **extra)
    if adding and e.code == "no_data":
        return Problem(422, "symbol_has_no_data", "Twelve Data has no hourly prices for this symbol.", **extra)
    if e.code == "auth_failed":
        return Problem(502, "provider_auth_failed", "Twelve Data rejected the API key.", **extra)
    if e.code == "unavailable":
        return Problem(502, "provider_unavailable", "Twelve Data didn't answer.", **extra)
    return Problem(502, "provider_error", "Twelve Data returned an error.", **extra)


# ---------------------------------------------------------------- service


class MarketSeries:
    def __init__(self, pool: AsyncConnectionPool, provider: TwelveDataClient, clock: Clock):
        self.pool, self.provider, self.clock = pool, provider, clock
        self._lookup_cache: dict[str, tuple[datetime, list[dict]]] = {}

    # ------------------------------------------------ credit budget

    async def credits(self, conn, now: datetime) -> dict[str, Any]:
        cur = await conn.execute(
            """SELECT
                 coalesce(sum(credits) FILTER (WHERE at > %(m)s), 0) AS minute,
                 min(at) FILTER (WHERE at > %(m)s) AS oldest,
                 coalesce(sum(credits) FILTER (WHERE at >= %(d)s), 0) AS day
               FROM signals.provider_calls WHERE provider = %(p)s AND at >= least(%(m)s, %(d)s)""",
            {"m": now - timedelta(seconds=60), "d": day_start(now), "p": PROVIDER},
        )
        r = await cur.fetchone()
        return {"minute": int(r["minute"]), "oldest": r["oldest"], "day": int(r["day"])}

    async def _reserve(self, endpoint: str, series_id: str | None, trigger: str) -> int:
        """Records a provider call before it is made, if the budget allows it."""
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(%s)", (BUDGET_LOCK,))
            used = await self.credits(conn, now)
            if used["day"] + 1 > settings.integer("TWELVEDATA_CREDITS_PER_DAY"):
                wait = math.ceil((day_start(now) + timedelta(days=1) - now).total_seconds())
                raise Problem(429, "provider_daily_budget_reached",
                              "Today's Twelve Data credits are used up; they reset at 00:00 UTC.",
                              retry_after=wait, credits_used_today=used["day"])
            if used["minute"] + 1 > settings.integer("TWELVEDATA_CREDITS_PER_MINUTE"):
                wait = max(1, math.ceil((used["oldest"] + timedelta(seconds=60) - now).total_seconds()))
                raise Problem(429, "provider_minute_budget_reached",
                              "This minute's Twelve Data credits are used up.",
                              retry_after=wait, credits_used_last_minute=used["minute"])
            cur = await conn.execute(
                """INSERT INTO signals.provider_calls (provider, endpoint, series_id, trigger, at, status)
                   VALUES (%s, %s, %s, %s, %s, 'started') RETURNING call_id""",
                (PROVIDER, endpoint, series_id, trigger, now),
            )
            return (await cur.fetchone())["call_id"]

    async def _finish_call(self, call_id: int, started: datetime, status: str, *,
                           credits: int = 1, error: ProviderError | None = None,
                           http_status: int | None = None, received: int | None = None,
                           new: int | None = None) -> None:
        now = self.clock.now()
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE signals.provider_calls SET finished_at = %s, status = %s, credits = %s,
                     http_status = %s, error_code = %s, error_message = %s, bars_received = %s,
                     bars_new = %s, duration_ms = %s WHERE call_id = %s""",
                (now, status, credits,
                 error.http_status if error else http_status,
                 error.code if error else None, error.message if error else None,
                 received, new, int((now - started).total_seconds() * 1000), call_id),
            )

    # ------------------------------------------------ reads

    async def _row(self, conn, series_id: str) -> dict:
        cur = await conn.execute(
            """SELECT s.*, f.title AS last_finding_title
               FROM signals.series s LEFT JOIN signals.findings f ON f.finding_id = s.last_finding_id
               WHERE s.series_id = %s AND s.world = 'live'""",
            (series_id,),
        )
        row = await cur.fetchone()
        if not row:
            raise Problem(404, "not_found", f"No series {series_id}.")
        return row

    async def _load_zone(self, conn) -> None:
        """The installation's time zone, for the times written into a series' state ("Fired 13 Oct 12:11")."""
        cur = await conn.execute("SELECT time_zone FROM core.institutions WHERE institution_id = %s",
                                 (settings.raw("INSTITUTION_ID"),))
        row = await cur.fetchone()
        self.zone = (row or {}).get("time_zone") or "UTC"

    def _at(self, t: datetime) -> str:
        from zoneinfo import ZoneInfo

        return t.astimezone(ZoneInfo(getattr(self, "zone", "UTC"))).strftime("%d %b %H:%M")

    async def get(self, series_id: str) -> dict:
        async with self.pool.connection() as conn:
            await self._load_zone(conn)
            return self.view(await self._row(conn, series_id))

    async def list_all(self) -> list[dict]:
        async with self.pool.connection() as conn:
            await self._load_zone(conn)
            cur = await conn.execute(
                """SELECT s.*, f.title AS last_finding_title
                   FROM signals.series s LEFT JOIN signals.findings f ON f.finding_id = s.last_finding_id
                   WHERE s.world = 'live' ORDER BY s.created_at, s.series_id"""
            )
            return [self.view(r) for r in await cur.fetchall()]

    def view(self, r: dict) -> dict:
        now = self.clock.now()
        det = r["detection"] or {}
        dcfg = r["detector"]
        lease = settings.integer("SERIES_FETCH_LEASE_SECONDS")
        in_progress = bool(r["fetch_started_at"] and r["fetch_started_at"] > now - timedelta(seconds=lease))
        cooldown = settings.integer("SERIES_REFRESH_COOLDOWN_SECONDS")
        refresh_at = None
        if r["last_manual_refresh_at"] and r["last_manual_refresh_at"] + timedelta(seconds=cooldown) > now:
            refresh_at = r["last_manual_refresh_at"] + timedelta(seconds=cooldown)

        latest = None
        if det.get("bar_ts"):
            latest = {
                "bar_ts": det["bar_ts"], "bar_end": det["bar_end"], "close": det["close"],
                "change_1d_pct": det.get("change_1d_pct"),
                "typical_daily_move_pct": det.get("typical_daily_move_pct"),
                "windows": det.get("windows", []),
                "max_z": (det.get("max") or {}).get("z"),
                "max_z_days": (det.get("max") or {}).get("days"),
            }
        state, reason = self._state(r, det, dcfg, now)
        err = r["last_fetch_error"]
        return {
            "series_id": r["series_id"], "symbol": r["symbol"], "name": r["name"],
            "provider": r["provider"], "interval": r["interval"],
            "instrument": r["instrument"] or {}, "theme": r["theme"], "places": r["places"] or [],
            "detector": dcfg, "enabled": r["enabled"],
            "state": state, "state_reason": reason,
            "latest": latest, "spark": det.get("spark", []),
            "fetch": {
                "last_at": r["last_fetch_at"], "last_status": r["last_fetch_status"],
                "last_error": err if r["last_fetch_status"] == "error" else None,
                "in_progress": in_progress,
                "next_scheduled_at": r["next_fetch_at"] if r["enabled"] else None,
                "refresh_available_at": refresh_at,
            },
            "last_finding": {"finding_id": r["last_finding_id"], "at": r["last_finding_at"],
                             "title": r.get("last_finding_title") or ""} if r["last_finding_id"] else None,
            "version": r["version"], "created_at": r["created_at"], "updated_at": r["updated_at"],
        }

    def _state(self, r: dict, det: dict, dcfg: dict, now: datetime) -> tuple[str, str]:
        if not r["enabled"]:
            return "paused", "Paused: not fetched until resumed."
        if not det.get("bar_ts"):
            return "pending", "No prices yet."
        itype = ((r["instrument"] or {}).get("type") or "").lower()
        hours = detect.stale_hours(datetime.fromisoformat(det["bar_end"]), now,
                                   around_the_clock=itype in AROUND_THE_CLOCK_TYPES,
                                   crypto=itype == "digital currency")
        if hours > dcfg["stale_after_hours"]:
            end = datetime.fromisoformat(det["bar_end"])
            return "stale", (f"No new bar since {self._at(end)} ({hours:.0f} market hours; "
                             f"stale after {dcfg['stale_after_hours']}).")
        if det.get("warming_up"):
            if det.get("reason") == "no_movement":
                return "warming_up", "The price hasn't moved in the history read, so there is no typical move yet."
            return "warming_up", (f"{det.get('sigma_days_used', 0)} of {settings.integer('SERIES_MIN_SIGMA_DAYS')} "
                                  "trading days needed to know a typical move.")
        if r["last_finding_at"] and r["last_finding_at"] > now - timedelta(hours=dcfg["cooldown_hours"]):
            until = r["last_finding_at"] + timedelta(hours=dcfg["cooldown_hours"])
            return "moved", f"Flagged {self._at(r['last_finding_at'])}; quiet until {self._at(until)}."
        mx = det.get("max")
        if mx:
            return "normal", f"Largest move {abs(mx['z']):.1f}x typical ({mx['days']} day); fires at {dcfg['z_threshold']:g}."
        return "normal", "Within normal range."

    async def status(self) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn:
            used = await self.credits(conn, now)
            cur = await conn.execute(
                """SELECT count(*) AS n, min(next_fetch_at) FILTER (WHERE enabled) AS next_at
                   FROM signals.series WHERE world = 'live'"""
            )
            s = await cur.fetchone()
            cur = await conn.execute(
                "SELECT max(at) AS last FROM signals.provider_calls WHERE trigger = 'scheduled'"
            )
            last = (await cur.fetchone())["last"]
        mx = settings.integer("SERIES_MAX")
        every = settings.integer("SERIES_FETCH_EVERY_MINUTES")
        cooldown = settings.integer("SERIES_REFRESH_COOLDOWN_SECONDS")
        return {
            "prototype": True,
            "notes": [
                f"Prototype: prices come from Twelve Data every {every} minutes, not live.",
                f"Refresh pulls a series now; at most once every {cooldown} seconds per series.",
                f"At most {mx} series can be watched.",
                "Only closed hourly bars are used; the current hour shows once it closes.",
            ],
            "limits": {"max_series": mx, "used": s["n"], "available": max(0, mx - s["n"])},
            "schedule": {"every_minutes": every, "next_run_at": s["next_at"], "last_run_at": last,
                         "tick": "the server's /internal/tick, every 15 minutes"},
            "refresh": {"cooldown_seconds": cooldown},
            "provider": {
                "name": PROVIDER, "configured": self.provider.configured(),
                "credits": {
                    "per_minute": settings.integer("TWELVEDATA_CREDITS_PER_MINUTE"),
                    "used_last_minute": used["minute"],
                    "per_day": settings.integer("TWELVEDATA_CREDITS_PER_DAY"),
                    "used_today": used["day"],
                    "day_resets_at": day_start(now) + timedelta(days=1),
                },
            },
            "detector_defaults": detector_defaults(),
        }

    async def bars(self, series_id: str, start: datetime, until: datetime, interval: str) -> dict:
        for t in (start, until):
            if t.tzinfo is None:
                raise Problem(400, "bad_request", "Timestamps need a time zone (RFC 3339, e.g. 2026-10-01T00:00:00Z).")
        if until <= start:
            raise Problem(422, "invalid_window", "until must be after from.")
        hours = (until - start).total_seconds() / 3600
        if (interval == "1h" and hours > 5000) or (interval == "1d" and hours > 24 * 1100):
            raise Problem(400, "range_too_large",
                          "At most 5000 hours of hourly bars, or 1100 days of daily bars, per call.")
        async with self.pool.connection() as conn:
            await self._row(conn, series_id)
            if interval == "1h":
                cur = await conn.execute(
                    """SELECT ts, open, high, low, close, volume, NULL::int AS bars FROM signals.price_bars
                       WHERE series_id = %s AND interval = '1h' AND ts >= %s AND ts < %s ORDER BY ts""",
                    (series_id, start, until),
                )
            else:
                cur = await conn.execute(
                    """SELECT date_trunc('day', ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS ts,
                              (array_agg(open ORDER BY ts))[1] AS open, max(high) AS high, min(low) AS low,
                              (array_agg(close ORDER BY ts DESC))[1] AS close, sum(volume) AS volume,
                              count(*)::int AS bars
                       FROM signals.price_bars
                       WHERE series_id = %s AND interval = '1h' AND ts >= %s AND ts < %s
                       GROUP BY 1 ORDER BY 1""",
                    (series_id, start, until),
                )
            rows = await cur.fetchall()
        return {
            "series_id": series_id, "interval": interval, "from": start, "until": until,
            "items": [{"ts": x["ts"], "open": _f(x["open"]), "high": _f(x["high"]), "low": _f(x["low"]),
                       "close": _f(x["close"]), "volume": _f(x["volume"]), "bars": x["bars"]} for x in rows],
        }

    async def fetches(self, series_id: str, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            await self._row(conn, series_id)
            cur = await conn.execute(
                """SELECT call_id, at, finished_at, trigger, status, credits, http_status, error_code,
                          error_message, bars_received, bars_new, duration_ms
                   FROM signals.provider_calls WHERE series_id = %s ORDER BY at DESC, call_id DESC LIMIT %s""",
                (series_id, limit),
            )
            return await cur.fetchall()

    async def findings(self, series_id: str, limit: int) -> list[dict]:
        async with self.pool.connection() as conn:
            await self._row(conn, series_id)
            cur = await conn.execute(
                """SELECT * FROM signals.findings WHERE source = 'timeseries'
                   AND source_ref ->> 'series_id' = %s ORDER BY created_at DESC LIMIT %s""",
                (series_id, limit),
            )
            return await cur.fetchall()

    # ------------------------------------------------ writes

    async def create(self, body: dict) -> dict:
        symbol = re.sub(r"\s+", "", body["symbol"]).upper()
        sid = body.get("series_id") or series_id_for(symbol)
        mx = settings.integer("SERIES_MAX")
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT count(*) AS n,
                          bool_or(series_id = %s) AS id_taken,
                          bool_or(provider = %s AND symbol = %s AND interval = %s) AS symbol_taken
                   FROM signals.series WHERE world = 'live'""",
                (sid, PROVIDER, symbol, INTERVAL),
            )
            c = await cur.fetchone()
        if c["symbol_taken"]:
            raise Problem(409, "series_exists", f"{symbol} is already watched.")
        if c["id_taken"]:
            raise Problem(409, "series_exists", f"The id {sid} is taken; give another series_id.")
        if c["n"] >= mx:
            raise Problem(409, "series_limit_reached",
                          f"The prototype watches at most {mx} series. Delete one to add another.",
                          max_series=mx)
        if not self.provider.configured():
            raise provider_problem(ProviderError("not_configured", "TWELVEDATA_API_KEY is not set"))

        call_id = await self._reserve("time_series", sid, "backfill")
        started = self.clock.now()
        try:
            ts = await self.provider.time_series(symbol, INTERVAL, outputsize=settings.integer("SERIES_BACKFILL_BARS"))
        except ProviderError as e:
            await self._finish_call(call_id, started, "no_new_data" if e.code == "no_data" else "error",
                                    credits=e.credits, error=e)
            raise provider_problem(e, adding=True) from e
        now = self.clock.now()
        closed = [b for b in ts.bars if b.ts + BAR <= now]
        await self._finish_call(call_id, started, "ok" if closed else "no_new_data", credits=ts.credits,
                                http_status=ts.http_status, received=len(ts.bars), new=len(closed))
        if len(closed) < 2:
            raise Problem(422, "symbol_has_no_data", "Twelve Data has too few hourly prices for this symbol.",
                          bars_received=len(ts.bars))

        meta = ts.meta
        instrument = {k: meta.get(k) for k in ("type", "exchange", "currency_base", "currency_quote",
                                               "currency", "exchange_timezone") if meta.get(k)}
        if "theme" not in body:
            async with self.pool.connection() as conn:
                body["theme"] = default_theme(symbol, await self._home_currency(conn), instrument.get("type"))
        if "places" not in body:
            body["places"] = default_places(body.get("theme"))
        dcfg = detector_defaults(instrument.get("type"))
        dcfg.update({k: v for k, v in (body.get("detector") or {}).items() if v is not None})
        try:
            async with self.pool.connection() as conn, conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(%s)", (SERIES_LIMIT_LOCK,))
                cur = await conn.execute("SELECT count(*) AS n FROM signals.series WHERE world = 'live'")
                if (await cur.fetchone())["n"] >= mx:
                    raise Problem(409, "series_limit_reached",
                                  f"The prototype watches at most {mx} series. Delete one to add another.",
                                  max_series=mx)
                await conn.execute(
                    """INSERT INTO signals.series (series_id, provider, symbol, interval, name, instrument, theme,
                         places, detector, enabled, next_fetch_at, last_fetch_at, last_fetch_status,
                         created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, true, %s, %s, 'ok', %s, %s)""",
                    (sid, PROVIDER, symbol, INTERVAL, body.get("name") or symbol, Jsonb(instrument),
                     Jsonb(body["theme"]) if body.get("theme") else None, body.get("places") or [],
                     Jsonb(dcfg), next_slot(now), now, now, now),
                )
                await self._upsert_bars(conn, sid, closed, now)
        except pg_errors.UniqueViolation as e:
            raise Problem(409, "series_exists", f"{symbol} is already watched.") from e
        await self._evaluate(sid, allow_finding=False)
        return await self.get(sid)

    async def update(self, series_id: str, patch: dict, fields: set[str], if_match: str | None) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT * FROM signals.series WHERE series_id = %s AND world = 'live' FOR UPDATE", (series_id,)
            )
            r = await cur.fetchone()
            if not r:
                raise Problem(404, "not_found", f"No series {series_id}.")
            if if_match is not None and if_match.strip('"') != str(r["version"]):
                raise Problem(409, "conflict", f"The series changed (version {r['version']}); reload and retry.",
                              current_version=r["version"])
            dcfg = dict(r["detector"])
            if "detector" in fields and patch.get("detector"):
                dcfg.update({k: v for k, v in patch["detector"].items() if v is not None})
            enabled = r["enabled"] if patch.get("enabled") is None else patch["enabled"]
            next_at = r["next_fetch_at"]
            if enabled and not r["enabled"]:
                next_at = now  # resumed: due on the next tick
            await conn.execute(
                """UPDATE signals.series SET name = %s, theme = %s, places = %s, detector = %s, enabled = %s,
                     next_fetch_at = %s, updated_at = %s, version = version + 1 WHERE series_id = %s""",
                (patch["name"] if patch.get("name") else r["name"],
                 (Jsonb(patch["theme"]) if patch["theme"] else None) if "theme" in fields else
                 (Jsonb(r["theme"]) if r["theme"] else None),
                 patch["places"] if patch.get("places") is not None else r["places"],
                 Jsonb(dcfg), enabled, next_at, now, series_id),
            )
        if "detector" in fields:
            await self._evaluate(series_id, allow_finding=False)
        return await self.get(series_id)

    async def delete(self, series_id: str) -> None:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "DELETE FROM signals.series WHERE series_id = %s AND world = 'live' RETURNING series_id",
                (series_id,),
            )
            if not await cur.fetchone():
                raise Problem(404, "not_found", f"No series {series_id}.")

    async def refresh(self, series_id: str) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn:
            r = await self._row(conn, series_id)
        if not r["enabled"]:
            raise Problem(409, "series_paused", "The series is paused; resume it to fetch.")
        cooldown = settings.integer("SERIES_REFRESH_COOLDOWN_SECONDS")
        if r["last_manual_refresh_at"] and r["last_manual_refresh_at"] + timedelta(seconds=cooldown) > now:
            wait = math.ceil((r["last_manual_refresh_at"] + timedelta(seconds=cooldown) - now).total_seconds())
            raise Problem(429, "refresh_too_soon", f"Refreshed less than {cooldown} seconds ago.",
                          retry_after=max(1, wait))
        if not self.provider.configured():
            raise provider_problem(ProviderError("not_configured", "TWELVEDATA_API_KEY is not set"))
        if not await self._take_lease(series_id, now):
            raise Problem(409, "fetch_in_progress", "A fetch of this series is already running.")
        try:
            call_id = await self._reserve("time_series", series_id, "manual")
            async with self.pool.connection() as conn:
                await conn.execute(
                    "UPDATE signals.series SET last_manual_refresh_at = %s WHERE series_id = %s", (now, series_id)
                )
            out = await self._fetch(r, "manual", call_id)
        finally:
            await self._release_lease(series_id)
        if out.error:
            raise provider_problem(out.error)
        return {"series": await self.get(series_id), "fetch": self._outcome(out)}

    @staticmethod
    def _outcome(f: Fetched) -> dict:
        return {"status": f.status, "trigger": f.trigger, "bars_received": f.bars_received,
                "bars_new": f.bars_new, "latest_bar_ts": f.latest_bar_ts, "finding_id": f.finding_id}

    async def lookup(self, query: str) -> dict:
        q = query.strip()
        if not q or len(q) > 40:
            raise Problem(422, "validation_error", "q is 1 to 40 characters.")
        now = self.clock.now()
        key = q.lower()
        cached = self._lookup_cache.get(key)
        if cached and cached[0] > now:
            items, hit = cached[1], True
        else:
            if not self.provider.configured():
                raise provider_problem(ProviderError("not_configured", "TWELVEDATA_API_KEY is not set"))
            call_id = await self._reserve("symbol_search", None, "lookup")
            started = self.clock.now()
            try:
                data, credits = await self.provider.symbol_search(q)
            except ProviderError as e:
                await self._finish_call(call_id, started, "error", credits=e.credits, error=e)
                raise provider_problem(e) from e
            await self._finish_call(call_id, started, "ok", credits=credits, received=len(data))
            items = [{
                "symbol": d.get("symbol"), "name": d.get("instrument_name"), "type": d.get("instrument_type"),
                "exchange": d.get("exchange"), "country": d.get("country"), "currency": d.get("currency"),
                "plan": (d.get("access") or {}).get("plan"),
            } for d in data if d.get("symbol")]
            self._lookup_cache[key] = (now + LOOKUP_TTL, items)
            hit = False
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT symbol FROM signals.series WHERE world = 'live'")
            watched = {x["symbol"] for x in await cur.fetchall()}
        return {"query": q, "cached": hit,
                "items": [{**i, "watched": (i["symbol"] or "").upper() in watched} for i in items]}

    # ------------------------------------------------ the tick step

    async def run_due(self) -> dict:
        now = self.clock.now()
        step: dict[str, Any] = {"step": "market_series", "due": 0, "claimed": 0, "done": 0,
                                "failed": 0, "waiting_for_credits": 0}
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT count(*) AS n FROM signals.series
                   WHERE world = 'live' AND enabled AND next_fetch_at <= %s""", (now,))
            step["due"] = (await cur.fetchone())["n"]
            used = await self.credits(conn, now)
        if not step["due"]:
            return step
        if not self.provider.configured():
            step["skipped"] = "provider_not_configured"
            return step
        room = min(settings.integer("TWELVEDATA_CREDITS_PER_MINUTE") - used["minute"],
                   settings.integer("TWELVEDATA_CREDITS_PER_DAY") - used["day"])
        if room <= 0:
            step["waiting_for_credits"] = step["due"]
            return step
        lease = timedelta(seconds=settings.integer("SERIES_FETCH_LEASE_SECONDS"))
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE signals.series SET fetch_started_at = %(now)s
                   WHERE series_id IN (
                     SELECT series_id FROM signals.series
                     WHERE world = 'live' AND enabled AND next_fetch_at <= %(now)s
                       AND (fetch_started_at IS NULL OR fetch_started_at < %(stale)s)
                     ORDER BY next_fetch_at, series_id LIMIT %(n)s FOR UPDATE SKIP LOCKED)
                   RETURNING *""",
                {"now": now, "stale": now - lease, "n": room},
            )
            claimed = await cur.fetchall()
        step["claimed"] = len(claimed)
        for i, r in enumerate(claimed):
            try:
                try:
                    call_id = await self._reserve("time_series", r["series_id"], "scheduled")
                except Problem:
                    step["waiting_for_credits"] += len(claimed) - i
                    break
                out = await self._fetch(r, "scheduled", call_id)
                retry_soon = out.error is not None and out.error.code in ("unavailable", "rate_limited")
                next_at = now + timedelta(minutes=15) if retry_soon else next_slot(now)
                async with self.pool.connection() as conn:
                    await conn.execute(
                        "UPDATE signals.series SET next_fetch_at = %s WHERE series_id = %s",
                        (next_at, r["series_id"]),
                    )
                step["failed" if out.error else "done"] += 1
            finally:
                await self._release_lease(r["series_id"])
        for r in claimed[step["done"] + step["failed"]:]:
            await self._release_lease(r["series_id"])
        step["waiting_for_credits"] += max(0, step["due"] - step["claimed"])
        return step

    # ------------------------------------------------ fetch and evaluate

    async def _take_lease(self, series_id: str, now: datetime) -> bool:
        lease = timedelta(seconds=settings.integer("SERIES_FETCH_LEASE_SECONDS"))
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """UPDATE signals.series SET fetch_started_at = %s WHERE series_id = %s
                   AND (fetch_started_at IS NULL OR fetch_started_at < %s) RETURNING series_id""",
                (now, series_id, now - lease),
            )
            return bool(await cur.fetchone())

    async def _release_lease(self, series_id: str) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE signals.series SET fetch_started_at = NULL WHERE series_id = %s", (series_id,))

    async def _fetch(self, r: dict, trigger: str, call_id: int) -> Fetched:
        sid = r["series_id"]
        started = self.clock.now()
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT max(ts) AS last FROM signals.price_bars WHERE series_id = %s AND interval = %s",
                (sid, INTERVAL),
            )
            last = (await cur.fetchone())["last"]
        try:
            if last is None:
                ts = await self.provider.time_series(r["symbol"], INTERVAL,
                                                     outputsize=settings.integer("SERIES_BACKFILL_BARS"))
            else:
                ts = await self.provider.time_series(r["symbol"], INTERVAL, start=last)
        except ProviderError as e:
            now = self.clock.now()
            if e.code == "no_data":
                await self._finish_call(call_id, started, "no_new_data", credits=e.credits, error=e)
                await self._set_fetch_result(sid, now, "no_new_data", None)
                await self._evaluate(sid, allow_finding=False)
                return Fetched("no_new_data", trigger)
            await self._finish_call(call_id, started, "error", credits=e.credits, error=e)
            await self._set_fetch_result(sid, now, "error", {
                "code": e.code, "message": e.message, "http_status": e.http_status, "at": now.isoformat()})
            return Fetched("error", trigger, error=e)
        now = self.clock.now()
        closed = [b for b in ts.bars if b.ts + BAR <= now]
        try:
            async with self.pool.connection() as conn, conn.transaction():
                new = await self._upsert_bars(conn, sid, closed, now)
        except pg_errors.ForeignKeyViolation:
            new = 0  # the series was deleted while fetching
        status = "ok" if new else "no_new_data"
        await self._finish_call(call_id, started, status, credits=ts.credits, http_status=ts.http_status,
                                received=len(ts.bars), new=new)
        await self._set_fetch_result(sid, now, status, None)
        finding = await self._evaluate(sid, allow_finding=bool(new) and trigger != "backfill",
                                       new_since=last)
        return Fetched(status, trigger, len(ts.bars), new, closed[-1].ts if closed else last, finding)

    async def _upsert_bars(self, conn, sid: str, bars: list, now: datetime) -> int:
        if not bars:
            return 0
        cur = await conn.execute(
            """SELECT ts FROM signals.price_bars WHERE series_id = %s AND interval = %s AND ts >= %s""",
            (sid, INTERVAL, bars[0].ts),
        )
        existing = {x["ts"] for x in await cur.fetchall()}
        async with conn.cursor() as c:
            await c.executemany(
                """INSERT INTO signals.price_bars (series_id, interval, ts, open, high, low, close, volume, fetched_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (series_id, interval, ts) DO UPDATE SET open = EXCLUDED.open,
                     high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
                     volume = EXCLUDED.volume, fetched_at = EXCLUDED.fetched_at""",
                [(sid, INTERVAL, b.ts, b.open, b.high, b.low, b.close, b.volume, now) for b in bars],
            )
        return sum(1 for b in bars if b.ts not in existing)

    async def _set_fetch_result(self, sid: str, now: datetime, status: str, error: dict | None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE signals.series SET last_fetch_at = %s, last_fetch_status = %s,
                     last_fetch_error = %s WHERE series_id = %s""",
                (now, status, Jsonb(error) if error else None, sid),
            )

    @staticmethod
    async def _recent_bars(conn, r: dict) -> list[tuple[datetime, float]]:
        """The closed bars the detector needs for the latest one."""
        dcfg = r["detector"]
        cur = await conn.execute(
            """SELECT ts, close FROM signals.price_bars WHERE series_id = %s AND interval = %s
               AND ts >= (SELECT max(ts) FROM signals.price_bars WHERE series_id = %s AND interval = %s)
                   - make_interval(days => %s)
               ORDER BY ts""",
            (r["series_id"], INTERVAL, r["series_id"], INTERVAL,
             int(dcfg["sigma_days"] * 1.6) + max(dcfg["windows_days"]) * 2 + 7),
        )
        return [(x["ts"], float(x["close"])) for x in await cur.fetchall()]

    @staticmethod
    def _params(dcfg: dict) -> detect.Params:
        return detect.Params(dcfg["z_threshold"], dcfg["sigma_days"],
                             settings.integer("SERIES_MIN_SIGMA_DAYS"), dcfg["windows_days"])

    async def _evaluate(self, sid: str, *, allow_finding: bool, new_since: datetime | None = None) -> str | None:
        """Re-evaluates the latest bar; writes a finding if it fired and may."""
        now = self.clock.now()
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM signals.series WHERE series_id = %s", (sid,))
            r = await cur.fetchone()
            if not r:
                return None
            dcfg = r["detector"]
            bars = await self._recent_bars(conn, r)
            d = detect.evaluate(bars, self._params(dcfg), r["name"])
            d["evaluated_at"] = now.isoformat()
            finding_id = None
            latest_is_new = bool(bars) and (new_since is None or bars[-1][0] > new_since)
            cooled = r["last_finding_at"] is None or r["last_finding_at"] <= now - timedelta(hours=dcfg["cooldown_hours"])
            if allow_finding and d.get("fires") and latest_is_new and cooled:
                finding_id = await self._write_finding(conn, r, d, now)
            await conn.execute(
                """UPDATE signals.series SET detection = %s,
                     last_finding_id = coalesce(%s, last_finding_id),
                     last_finding_at = CASE WHEN %s::text IS NULL THEN last_finding_at ELSE %s END
                   WHERE series_id = %s""",
                (Jsonb(d), finding_id, finding_id, now, sid),
            )
        return finding_id

    async def _write_finding(self, conn, r: dict, d: dict, now: datetime, world: str = "live") -> str:
        dcfg = r["detector"]
        await self._load_zone(conn)
        title, explanation, w = detect.finding_text(r["name"], d, dcfg["z_threshold"], self.zone)
        bar_ts = datetime.fromisoformat(d["bar_ts"])
        fid = (f"f-ts-{r['series_id']}-{bar_ts:%Y%m%d%H}" if world == "live"
               else f"f-sim-{r['series_id']}-{now:%Y%m%d%H%M%S}-{uuid.uuid4().hex[:4]}")
        if world != "live":
            title = f"Simulated: {title}"
        themes = []
        if r["theme"]:
            t = r["theme"]
            themes = [{"theme": t["theme"], "direction": t["direction_up"] if w["change_pct"] > 0 else t["direction_down"],
                       **({"item": t["item"]} if t.get("item") else {}),
                       **({"currency": t["currency"]} if t.get("currency") else {})}]
        ref_end = datetime.fromisoformat(w["ref_ts"]) + BAR
        evidence = {"signals": [{
            "series_id": r["series_id"], "symbol": r["symbol"], "interval": r["interval"],
            "direction": "up" if w["change_pct"] > 0 else "down",
            "start_at": ref_end.isoformat(), "end_at": d["bar_end"],
            "ref_level": w["ref_close"], "obs_level": d["close"],
            "change_pct": w["change_pct"], "z": w["z"],
            "typical_daily_move_pct": d["typical_daily_move_pct"], "window_days": w["days"],
            "description": detect.signal_description(r["name"], d, w, self.zone),
        }], "headlines": [], "web": []}
        await conn.execute(
            """INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title,
                 explanation, score, themes, effective_from, period, places, evidence, created_at)
               VALUES (%s, %s, %s, 'timeseries', %s, 'signal_move', %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (finding_id) DO NOTHING""",
            (fid, world, settings.raw("INSTITUTION_ID"),
             Jsonb({"series_id": r["series_id"], "detector": dcfg}), title, explanation,
             detect.score(w["z"], dcfg["z_threshold"]), Jsonb(themes),
             datetime.fromisoformat(d["bar_end"]).date(),
             Jsonb({"start": ref_end.date().isoformat(), "end": datetime.fromisoformat(d["bar_end"]).date().isoformat()}),
             r["places"] or [], Jsonb(evidence), now),
        )
        return fid

    # ------------------------------------------------ test moves (sandbox)

    async def simulate(self, series_id: str, change_pct: float) -> dict:
        """A made-up bar one hour after the latest real one, change_pct from its close, run through
        the same detector. If it fires, the finding is written with world = 'sandbox'; the series,
        its bars, state and cooldown are untouched."""
        now = self.clock.now()
        async with self.pool.connection() as conn:
            r = await self._row(conn, series_id)
            bars = await self._recent_bars(conn, r)
            if not bars:
                raise Problem(409, "no_prices", f"{r['name']} has no prices yet to move from.")
            last_ts, last_close = bars[-1]
            made_up = (last_ts + BAR, last_close * (1 + change_pct / 100))
            d = detect.evaluate([*bars, made_up], self._params(r["detector"]), r["name"])
            z = r["detector"]["z_threshold"]
            if d.get("warming_up"):
                return {"fired": False, "detection": d, "finding": None,
                        "note": f"{r['name']} is still warming up ({d.get('reason')}); it can't fire yet."}
            if not d.get("fires"):
                top = abs((d.get("max") or {}).get("z") or 0)
                return {"fired": False, "detection": d, "finding": None,
                        "note": f"A {change_pct:+g}% move is {top:.1f}x typical; it fires at {z:g}x. Try a bigger move."}
            fid = await self._write_finding(conn, r, d, now, world="sandbox")
            cur = await conn.execute("SELECT * FROM signals.findings WHERE finding_id = %s", (fid,))
            f = await cur.fetchone()
        return {"fired": True, "detection": d, "finding": f,
                "note": "A sandbox finding was written; live prices and the series' state are unchanged."}

    async def _home_currency(self, conn) -> str | None:
        cur = await conn.execute("SELECT base_currency FROM core.institutions WHERE institution_id = %s",
                                 (settings.raw("INSTITUTION_ID"),))
        row = await cur.fetchone()
        return row["base_currency"] if row else None


GOLD = {"XAU"}
OIL = {"WTI", "BRENT", "XBR", "XTI", "USOIL", "UKOIL", "BNO", "USO"}  # BNO, USO: oil ETFs


MAJORS = ("USD", "EUR", "GBP", "JPY", "CHF")


def default_places(theme: dict | None) -> list[str]:
    """Where a move matters, by code: an fx move, the country of its currency (when only one
    country uses it); otherwise none (the user adds them)."""
    if not theme or theme.get("theme") != "fx":
        return []
    countries = reference.countries_using(theme["currency"])
    return countries if len(countries) == 1 else []


def fx_theme(currency: str, up_is_weaker: bool) -> dict:
    up, down = ("weaker", "stronger") if up_is_weaker else ("stronger", "weaker")
    return {"theme": "fx", "direction_up": up, "direction_down": down, "currency": currency}


def default_theme(symbol: str, home_currency: str | None, instrument_type: str | None = None) -> dict | None:
    """What a move means, by code: gold or oil; a stock index; for an FX pair, the move of the
    home currency if it is one side, else of the side that isn't a major (USD/INR up: INR
    weaker); else none."""
    parts = symbol.upper().split("/")
    if parts[0] in OIL:
        return {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "oil"}
    if "index" in (instrument_type or "").lower():
        return {"theme": "markets", "direction_up": "equity_up", "direction_down": "equity_down"}
    if len(parts) != 2:
        return None
    base, quote = parts
    if base in GOLD:
        return {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "gold"}
    if base in OIL:
        return {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "oil"}
    if not (re.fullmatch(r"[A-Z]{3}", base) and re.fullmatch(r"[A-Z]{3}", quote)):
        return None
    if home_currency in (quote, base):
        return fx_theme(home_currency, up_is_weaker=quote == home_currency)
    if base in MAJORS and quote not in MAJORS:
        return fx_theme(quote, up_is_weaker=True)
    if quote in MAJORS and base not in MAJORS:
        return fx_theme(base, up_is_weaker=False)
    return None
