"""Model fallback: when a Gemini model is busy or out of quota, the next one takes the call.

Every model call goes through here: the judge (FallbackGemini, an ADK model)
tries AGENT_MODELS in order (app/settings.py; set them in .env). Copied from
the monitor agent.

A model that fails with a failover error (429, 503, other 5xx, 404 model not
found, a timeout or a network error) is skipped for MODEL_COOLDOWN_SECONDS, so
the next calls go straight to one that works. A quota error that says when to
retry (a daily cap: "retry in 19h") is skipped until then. Any other error (a
bad request, bad credentials) is raised at once, since another model would fail
the same way. When every model fails, the last error is raised.

Each model gets one quick retry of its own (the SDK's retry options) before the
next model is tried, so a short blip costs about a second, not a model switch.
"""

import asyncio
import copy
import logging
import re
import time
from collections.abc import AsyncGenerator

import httpx
from google.adk.models import Gemini
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import errors, types
from pydantic import PrivateAttr

from app import settings

logger = logging.getLogger(__name__)

FAILOVER_CODES = {404, 408, 429, 500, 502, 503, 504}
RETRY = types.HttpRetryOptions(attempts=2, initial_delay=1.0, max_delay=2.0)
_RETRY_DELAY = re.compile(r"retryDelay['\"]?\s*:\s*['\"](\d+(?:\.\d+)?)s")


def model_chain(setting: str = "AGENT_MODELS") -> list[str]:
    """The models to try, in order."""
    return settings.names(setting)


def call_timeout() -> float:
    return settings.number("MODEL_CALL_TIMEOUT_SECONDS")


class Health:
    """Which models failed recently. Shared by every call in the process."""

    def __init__(self) -> None:
        self._cool_until: dict[str, float] = {}

    def order(self, models: list[str]) -> list[str]:
        """Models not cooling down first, in their given order; cooling ones last."""
        now = time.monotonic()
        return sorted(models, key=lambda m: self._cool_until.get(m, 0) > now)

    def failed(self, model: str, seconds: float | None = None) -> None:
        cool = max(seconds or 0, settings.number("MODEL_COOLDOWN_SECONDS"))
        self._cool_until[model] = time.monotonic() + cool

    def succeeded(self, model: str) -> None:
        self._cool_until.pop(model, None)

    def reset(self) -> None:
        self._cool_until.clear()


health = Health()


def retry_after(e: BaseException) -> float | None:
    """The delay a quota error asks for ("retryDelay": "68418s"), if any."""
    if isinstance(e, errors.APIError) and e.code == 429:
        match = _RETRY_DELAY.search(str(e))
        if match:
            return float(match.group(1))
    return None


def should_fail_over(e: BaseException) -> bool:
    if isinstance(e, errors.APIError):
        return e.code in FAILOVER_CODES
    return isinstance(e, TimeoutError | httpx.TransportError)


def _note_failure(model: str, e: BaseException, has_next: bool) -> None:
    wait = retry_after(e)
    health.failed(model, wait)
    what = (
        f"{e.code} {e.status}" if isinstance(e, errors.APIError) else type(e).__name__
    )
    if wait and wait > settings.number("MODEL_COOLDOWN_SECONDS"):
        what += f", skipped for {wait / 3600:.1f}h"
    logger.warning(
        "model %s failed (%s)%s", model, what, "; trying the next" if has_next else ""
    )


async def generate_content(
    client,
    models: list[str],
    *,
    contents,
    config: types.GenerateContentConfig,
    timeout: float | None = None,
) -> tuple[types.GenerateContentResponse, str]:
    """client.aio.models.generate_content with fallback. Returns the response and the model used.

    timeout: seconds each model gets (retries included) before the next is
    tried; MODEL_CALL_TIMEOUT_SECONDS by default.
    """
    order = health.order(models)
    last: BaseException | None = None
    for i, model in enumerate(order):
        try:
            async with asyncio.timeout(timeout or call_timeout()):
                response = await client.aio.models.generate_content(
                    model=model, contents=contents, config=config
                )
        except Exception as e:
            if not should_fail_over(e):
                raise
            _note_failure(model, e, i + 1 < len(order))
            last = e
            continue
        health.succeeded(model)
        return response, model
    raise last  # every model failed


class FallbackGemini(BaseLlm):
    """An ADK model that tries each of `models` in turn (see the module docstring)."""

    models: list[str]

    _llms: dict[str, Gemini] = PrivateAttr(default_factory=dict)

    def _llm(self, model: str) -> Gemini:
        if model not in self._llms:
            self._llms[model] = Gemini(model=model, retry_options=RETRY)
        return self._llms[model]

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        order = health.order(self.models)
        last: BaseException | None = None
        for i, model in enumerate(order):
            # Gemini edits the request it sends (headers, contents): give each
            # attempt its own copy so a failed one leaves nothing behind.
            attempt = llm_request.model_copy(
                update={
                    "model": model,
                    "contents": copy.deepcopy(llm_request.contents),
                    "config": llm_request.config.model_copy(deep=True)
                    if llm_request.config
                    else None,
                }
            )
            try:
                # Collect before yielding, so a failure part-way through can
                # still move to the next model (checks do not stream).
                async with asyncio.timeout(call_timeout()):
                    responses = [
                        r
                        async for r in self._llm(model).generate_content_async(
                            attempt, stream=False
                        )
                    ]
            except Exception as e:
                if not should_fail_over(e):
                    raise
                _note_failure(model, e, i + 1 < len(order))
                last = e
                continue
            health.succeeded(model)
            for r in responses:
                yield r
            return
        raise last  # every model failed


def fallback_gemini(models: list[str] | None = None) -> FallbackGemini:
    models = models or model_chain()
    return FallbackGemini(model=models[0], models=models)
