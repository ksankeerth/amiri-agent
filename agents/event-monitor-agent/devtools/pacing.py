"""Development-only pacing for live runs on a rate-limited Gemini key.

Off unless MODEL_MIN_INTERVAL_SECONDS is set (or an interval is passed): then
every HTTP request this process sends to Gemini (agent steps, web searches,
reviewer calls and the SDK's own retries) is spaced at least that many seconds
apart, and a request refused with 503 (model busy), or with 429 and a
suggested retryDelay, waits and is sent again. A 429 without a retryDelay is a
cap waiting will not clear, so it fails at once.

This package is not in the Docker image (the Dockerfile copies app/ only), so
production can never sleep here. Used by scripts/run_check.py, the scenario
runner, and the local API server when the variable is set.

    from devtools import pacing
    pacing.install()             # paces only if MODEL_MIN_INTERVAL_SECONDS is set
    pacing.install(interval=13)  # 5 requests per minute, whatever the env says

Installed but off, it still counts requests and quota refusals (the scenario
runner reports them) without ever sleeping.
"""

import asyncio
import os
import re
import sys
import time

from google.genai import errors
from google.genai._api_client import BaseApiClient

ENV_VAR = "MODEL_MIN_INTERVAL_SECONDS"
RETRY_CODES = {429, 503}


class MinInterval:
    """Spaces awaits at least `interval` seconds apart, across event loops."""

    def __init__(self, interval: float = 0.0) -> None:
        self.interval = interval
        self._last = float("-inf")
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock: asyncio.Lock | None = None

    def _get_lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._loop is not loop:  # each asyncio.run() has its own loop
            self._loop, self._lock = loop, asyncio.Lock()
        return self._lock

    async def wait(self) -> None:
        if self.interval <= 0:
            return
        async with self._get_lock():
            delay = self._last + self.interval - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            self._last = time.monotonic()


spacer = MinInterval()
_original = BaseApiClient._async_request_once
_retries = 4
# Requests sent (retries included). Unlike usage.model_calls, this counts web
# searches and reviewer calls too.
requests = 0
# Requests refused for quota (429) and not retried: the key's quota for that
# model or feature is used up.
quota_failures = 0


def active() -> bool:
    return spacer.interval > 0


def _retry_delay(error: errors.APIError, attempt: int) -> float | None:
    """Seconds to wait before retrying, or None when retrying cannot help.

    The server's suggested delay ("retryDelay": "34s") if given; else 15s, 30s,
    60s... for a 503, and None for a 429 (a cap, not a per-minute limit).
    """
    match = re.search(r"retryDelay['\"]?\s*:\s*['\"](\d+(?:\.\d+)?)s", str(error))
    if match:
        return float(match.group(1)) + 1
    return None if error.code == 429 else 15.0 * 2**attempt


async def _paced_request(self, http_request, stream=False):
    global requests, quota_failures
    for attempt in range(_retries + 1):
        await spacer.wait()
        requests += 1
        try:
            return await _original(self, http_request, stream)
        except errors.APIError as e:
            delay = (
                _retry_delay(e, attempt) if active() and e.code in RETRY_CODES else None
            )
            if delay is None or attempt == _retries:
                if e.code == 429:
                    quota_failures += 1
                raise
            print(
                f"  [pacing] {e.code} {e.status}: waiting {delay:.0f}s, then retrying "
                f"({attempt + 1}/{_retries})",
                file=sys.stderr,
            )
            await asyncio.sleep(delay)
    raise AssertionError("unreachable")


def interval_from_env() -> float:
    return float(os.getenv(ENV_VAR) or 0)


def install(interval: float | None = None, retries: int = 4) -> float:
    """Hooks every Gemini request in this process. Returns the interval (0 = off)."""
    global _retries
    spacer.interval = interval_from_env() if interval is None else interval
    _retries = retries
    BaseApiClient._async_request_once = _paced_request
    return spacer.interval


def uninstall() -> None:
    BaseApiClient._async_request_once = _original
