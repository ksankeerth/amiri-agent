"""Every scenario passes offline when the model answers correctly: a scripted model searches
once and reports the scenario's expected findings. So a live failure means the model chose
differently, not that the scenario or the code can't reach its expectation."""

import asyncio

import pytest
from google.adk.agents import Agent
from google.adk.apps import App
from test_agent_loop import ScriptedLlm

from app import pages, web_search
from app.agent import instruction
from app.check_runner import run_check
from app.contract import CheckRequest
from app.tools import TOOLS
from tests.scenarios.catalog import SCENARIOS, evaluate


def correct_findings(s) -> list[dict]:
    out = []
    for e in s.findings:
        src = next(x for x in s.sources if x.url in e.urls)
        out.append(
            {
                "title": src.title.split(" | ")[0],
                "explanation": f'"{src.title}" was published.',
                "tell_me_if_lines": sorted(e.lines),
                "evidence": {"web": [{"url": src.url}]},
                "places": [],
                "key_date": None,
            }
        )
    return out


@pytest.mark.parametrize("s", SCENARIOS, ids=[s.name for s in SCENARIOS])
def test_scenario_is_reachable(s, monkeypatch):
    async def search(query, since, until):
        return {
            "answer": s.answer,
            "sources": [{"url": x.url, "title": "link"} for x in s.sources],
        }

    page_map = s.pages()

    async def read(url):
        return page_map[url]

    monkeypatch.setattr(web_search, "_searcher", search)
    monkeypatch.setattr(pages, "_reader", read)
    llm = ScriptedLlm(
        script=[
            [("web_search", {"query": "news"})],
            [("finish", {"summary": "Checked.", "findings": correct_findings(s)})],
        ],
        requests=[],
    )
    agent = Agent(
        name="event_monitor_agent", model=llm, instruction=instruction, tools=TOOLS
    )
    result = asyncio.run(
        run_check(
            CheckRequest.model_validate({**s.request, "run_id": f"t-{s.name}"}),
            App(name="app", root_agent=agent),
        )
    )
    failed = [c for c in evaluate(s, result.model_dump(mode="json")) if not c["ok"]]
    assert not failed, (
        failed,
        [t.message for t in result.tool_trace if t.status != "ok"],
    )
