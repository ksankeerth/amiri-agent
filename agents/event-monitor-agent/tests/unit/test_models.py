"""Model fallback: a busy or out-of-quota model hands the call to the next one."""

import asyncio
import types as pytypes

import pytest
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import errors, types

from app import models
from app.agent import root_agent


@pytest.fixture(autouse=True)
def fresh_health():
    models.health.reset()
    yield
    models.health.reset()


def api_error(code: int) -> errors.APIError:
    return errors.APIError(code, {"error": {"code": code, "status": "X"}})


class FakeClient:
    """client.aio.models.generate_content that fails for the models in `failing`."""

    def __init__(self, failing: dict[str, BaseException]):
        self.failing = failing
        self.asked: list[str] = []
        self.aio = pytypes.SimpleNamespace(
            models=pytypes.SimpleNamespace(generate_content=self._generate)
        )

    async def _generate(self, *, model, contents, config):
        self.asked.append(model)
        if model in self.failing:
            raise self.failing[model]
        return f"answer from {model}"


def generate(client, chain):
    return asyncio.run(
        models.generate_content(
            client, chain, contents="q", config=types.GenerateContentConfig()
        )
    )


@pytest.mark.parametrize(
    "failure", [api_error(429), api_error(503), api_error(500), TimeoutError()]
)
def test_busy_or_exhausted_model_falls_back_to_the_next(failure):
    client = FakeClient({"a": failure})
    assert generate(client, ["a", "b"]) == ("answer from b", "b")
    assert client.asked == ["a", "b"]


def test_a_failed_model_is_skipped_while_it_cools_down():
    client = FakeClient({"a": api_error(503)})
    generate(client, ["a", "b"])
    client.failing = {}
    assert generate(client, ["a", "b"]) == ("answer from b", "b")  # b first now
    assert client.asked == ["a", "b", "b"]


def test_errors_another_model_would_repeat_are_raised_at_once():
    client = FakeClient({"a": api_error(400)})
    with pytest.raises(errors.APIError):
        generate(client, ["a", "b"])
    assert client.asked == ["a"]


def test_when_every_model_fails_the_last_error_is_raised():
    client = FakeClient({"a": api_error(503), "b": api_error(429)})
    with pytest.raises(errors.APIError) as e:
        generate(client, ["a", "b"])
    assert e.value.code == 429


def test_each_role_has_its_own_model_list(monkeypatch):
    for name in ("AGENT_MODELS", "REVIEWER_MODELS", "SEARCH_MODELS"):
        monkeypatch.delenv(name, raising=False)
    assert models.model_chain() == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    assert models.reviewer_chain() == [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
    ]
    assert models.search_chain() == ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
    monkeypatch.setenv("AGENT_MODELS", " x-model , y-model,x-model ")
    assert models.model_chain() == ["x-model", "y-model"]


def test_a_daily_cap_is_skipped_until_it_resets(monkeypatch):
    """The 9 Oct 429 for gemini-3.8-flash said "retryDelay": "68418s" (about 19h)."""
    monkeypatch.delenv("MODEL_COOLDOWN_SECONDS", raising=False)
    capped = errors.APIError(
        429,
        {
            "error": {
                "code": 429,
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.RetryInfo",
                        "retryDelay": "68418s",
                    }
                ],
            }
        },
    )
    assert models.retry_after(capped) == 68418.0
    assert models.retry_after(api_error(503)) is None
    client = FakeClient({"a": capped})
    generate(client, ["a", "b"])
    cool_until = models.health._cool_until["a"]
    import time

    assert cool_until - time.monotonic() > 68000  # not the usual 60s


# --------------------------------------------------------- the agent's model


class FakeGemini:
    def __init__(self, model, failure=None):
        self.model, self.failure, self.requests = model, failure, []

    async def generate_content_async(self, llm_request, stream=False):
        self.requests.append(llm_request)
        llm_request.contents.append(
            types.Content(role="user", parts=[])
        )  # as Gemini does
        if self.failure:
            raise self.failure
        yield LlmResponse(
            content=types.Content(role="model", parts=[types.Part(text=self.model)])
        )


def run_agent_model(llm: models.FallbackGemini, request: LlmRequest) -> list[str]:
    async def go():
        return [
            r.content.parts[0].text async for r in llm.generate_content_async(request)
        ]

    return asyncio.run(go())


def test_agent_model_falls_back_and_leaves_the_request_untouched():
    llm = models.fallback_gemini(["a", "b"])
    fakes = {"a": FakeGemini("a", api_error(429)), "b": FakeGemini("b")}
    llm._llms.update(fakes)
    request = LlmRequest(
        model="a", contents=[types.Content(role="user", parts=[types.Part(text="hi")])]
    )
    assert run_agent_model(llm, request) == ["b"]
    assert [r.model for r in fakes["a"].requests + fakes["b"].requests] == ["a", "b"]
    assert len(request.contents) == 1  # each attempt edited its own copy


def test_agent_model_times_out_to_the_next(monkeypatch):
    class Hanging(FakeGemini):
        async def generate_content_async(self, llm_request, stream=False):
            await asyncio.sleep(3600)
            yield None

    monkeypatch.setenv("MODEL_CALL_TIMEOUT_SECONDS", "0.05")
    llm = models.fallback_gemini(["a", "b"])
    llm._llms.update({"a": Hanging("a"), "b": FakeGemini("b")})
    assert run_agent_model(llm, LlmRequest(model="a", contents=[])) == ["b"]


def test_the_agent_uses_the_fallback_model():
    assert isinstance(root_agent.model, models.FallbackGemini)
    assert root_agent.model.models == models.model_chain()


def test_a_slow_model_hands_over_after_its_time_limit():
    """gemini-3.8-flash took 19-52s for a one-word answer under load (9 Oct 2026)."""

    class SlowA(FakeClient):
        async def _generate(self, *, model, contents, config):
            if model == "a":
                self.asked.append(model)
                await asyncio.sleep(3600)
            return await super()._generate(
                model=model, contents=contents, config=config
            )

    client = SlowA({})
    answer = asyncio.run(
        models.generate_content(
            client,
            ["a", "b"],
            contents="q",
            config=types.GenerateContentConfig(),
            timeout=0.05,
        )
    )
    assert answer == ("answer from b", "b")
    assert models.health.order(["a", "b"]) == ["b", "a"]  # a cools down


def test_reviewer_and_search_get_their_own_time_limits(monkeypatch):
    from app import agent

    for name in (
        "REVIEWER_TIMEOUT_SECONDS",
        "SEARCH_TIMEOUT_SECONDS",
        "MODEL_CALL_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    assert agent.REVIEWER_MODELS == models.reviewer_chain()
    assert agent.SEARCH_MODELS == models.search_chain()
    assert models.call_timeout() == 90.0

    used = []

    async def fake_generate(client, chain, *, contents, config, timeout=None):
        used.append((chain, timeout))
        raise RuntimeError("stop")

    monkeypatch.setattr(models, "generate_content", fake_generate)
    from app.verifier import GeminiVerifier
    from app.web_search import GoogleSearcher

    reviewer = GeminiVerifier(models=["r"])
    reviewer._client = object()
    searcher = GoogleSearcher(models=["s"])
    searcher._client = object()
    with pytest.raises(RuntimeError):
        asyncio.run(reviewer({"monitor": {}, "findings": []}))
    with pytest.raises(RuntimeError):
        asyncio.run(searcher("q", "a", "b"))
    assert used == [(["r"], 45.0), (["s"], 30.0)]
