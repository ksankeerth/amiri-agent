"""The whole check through the ADK runner, with a scripted model in place of Gemini.
Everything else is real: the tools, finish's checks and the result builder."""

import asyncio
from collections.abc import AsyncGenerator

from conftest import ARAB_NEWS, HEADLINE
from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from app.agent import instruction
from app.check_runner import run_check
from app.contract import CheckRequest
from app.tools import TOOLS


class ScriptedLlm(BaseLlm):
    """Returns the next scripted step on each call: a list of (tool, args)."""

    model: str = "scripted"
    script: list = Field(default_factory=list)
    requests: list = Field(default_factory=list)

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request)
        step = self.script[min(len(self.requests), len(self.script)) - 1]
        parts = [
            types.Part(function_call=types.FunctionCall(name=n, args=a))
            for n, a in step
        ]
        yield LlmResponse(content=types.Content(role="model", parts=parts))


def check(body: dict, script: list):
    llm = ScriptedLlm(script=script, requests=[])
    agent = Agent(
        name="event_monitor_agent", model=llm, instruction=instruction, tools=TOOLS
    )
    result = asyncio.run(
        run_check(CheckRequest.model_validate(body), App(name="app", root_agent=agent))
    )
    return result, llm


FINDING = {
    "title": HEADLINE,
    "explanation": f'Arab News reported "{HEADLINE}".',
    "tell_me_if_lines": [2],
    "evidence": {"web": [{"url": ARAB_NEWS}]},
    "places": ["SA"],
    "key_date": None,
}


def test_a_web_check_reports_a_dated_finding(request_example, fake_web):
    result, llm = check(
        request_example,
        [
            [("web_search", {"query": "Saudi Arabia foreign workers quota"})],
            [
                (
                    "finish",
                    {
                        "summary": "Saudi Arabia cut quotas for foreign construction workers.",
                        "findings": [FINDING],
                    },
                )
            ],
        ],
    )
    assert result.stop_reason == "finished" and len(result.findings) == 1
    assert result.sources[0].published_at.isoformat() == "2026-10-12T08:40:00+00:00"
    c = result.coverage
    assert (
        c.web_queries,
        c.pages_seen,
        c.pages_dated,
        c.pages_in_window,
        c.already_reported,
    ) == (1, 4, 3, 2, 1)
    assert [t.tool for t in result.tool_trace] == [
        "web_search"
    ]  # an accepted finish is left out
    prompt = llm.requests[0].config.system_instruction
    assert (
        "Gulf jobs and security" in prompt and "how_it_reaches_us" in prompt
    )  # private parts: in <monitor_private>
    assert fake_web.search.queries == ["Saudi Arabia foreign workers quota"]


def test_a_simulation_reads_the_given_headlines(request_example):
    news = [
        {
            "id": "sim-1",
            "title": HEADLINE,
            "published_at": "2026-10-12T09:30:00Z",
            "outlet": "Arab News",
        }
    ]
    body = {**request_example, "web_search": None, "provided_news": news}
    sim = {**FINDING, "evidence": {"news": [{"item_id": "sim-1"}]}}
    result, _ = check(
        body,
        [
            [("list_provided_news", {"cursor": ""})],
            [
                (
                    "finish",
                    {
                        "summary": "Saudi Arabia cut quotas for foreign construction workers.",
                        "findings": [sim],
                    },
                )
            ],
        ],
    )
    assert result.findings[0].evidence.news[0].item_id == "sim-1"
    assert result.sources[0].ref == "sim-1" and result.coverage.provided_news == 1


def test_a_refused_finish_is_fixed_and_the_trace_shows_why(request_example):
    bad = {**FINDING, "places": ["FR"]}
    result, _ = check(
        request_example,
        [
            [("web_search", {"query": "Saudi quota"})],
            [("finish", {"summary": "Quota cut.", "findings": [bad]})],
            [
                (
                    "finish",
                    {
                        "summary": "Saudi Arabia cut quotas for foreign construction workers.",
                        "findings": [FINDING],
                    },
                )
            ],
        ],
    )
    assert len(result.findings) == 1
    refused = [t for t in result.tool_trace if t.tool == "finish"]
    assert refused and refused[0].status == "error" and "FR" in refused[0].message


def test_a_check_that_never_finishes_says_so(request_example):
    result, _ = check(
        {**request_example, "limits": {"max_steps": 2}},
        [[("web_search", {"query": "Saudi quota"})]],
    )
    assert (
        result.findings == []
        and result.stop_reason == "step_limit"
        and "Stopped" in result.summary
    )


def test_a_check_whose_every_search_failed_fails(request_example, fake_web, monkeypatch):
    from app import web_search
    from app.runs import error_message

    async def over_quota(query, since, until):
        raise RuntimeError("429 RESOURCE_EXHAUSTED. You exceeded your current quota")

    monkeypatch.setattr(web_search, "_searcher", over_quota)
    script = [[("web_search", {"query": "Saudi quota"})], [("finish", {"summary": "Nothing new.", "findings": []})]]
    try:
        check(request_example, script)
    except web_search.SearchUnavailable as e:
        assert error_message(e).startswith("Web search failed for every query (quota exceeded)")
    else:
        raise AssertionError("a check that read nothing must fail, not report nothing new")


def test_a_failed_search_among_good_ones_is_counted(request_example, fake_web, monkeypatch):
    from app import web_search

    calls = []

    async def flaky(query, since, until):
        calls.append(query)
        if len(calls) == 1:
            raise RuntimeError("503 UNAVAILABLE")
        return await fake_web.search(query, since, until)

    monkeypatch.setattr(web_search, "_searcher", flaky)
    result, _ = check(request_example, [
        [("web_search", {"query": "Saudi quota"})], [("web_search", {"query": "Saudi foreign workers"})],
        [("finish", {"summary": "Nothing new.", "findings": []})]])
    assert result.coverage.web_queries == 2 and result.coverage.web_failed == 1


def test_a_call_adk_refused_is_an_error_in_the_trace(request_example, fake_web):
    result, _ = check(request_example, [
        [("web_search", {"queries": ["Saudi quota"]})], [("web_search", {"query": "Saudi quota"})],
        [("finish", {"summary": "Nothing new.", "findings": []})]])
    first = result.tool_trace[0]
    assert first.status == "error" and "query" in (first.message or "")
