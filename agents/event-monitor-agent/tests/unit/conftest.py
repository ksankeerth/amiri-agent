import copy
import types as pytypes
from datetime import UTC, datetime

import pytest

import app.agent  # noqa: F401  (sets the real searcher and verifier on import)
from app import examples, pages, tools, verifier, web_search
from app.contract import CheckRequest
from app.pages import Page

ARAB_NEWS = "https://www.arabnews.com/node/2591234"
GULF_NEWS = "https://gulfnews.com/world/gulf/saudi/quota-cut-1.500"
OLD = "https://www.khaleejtimes.com/uae/2025/old-story"
UNDATED = "https://example-blog.net/post/gulf-jobs"
REPORTED = "https://www.arabnews.com/node/2590001"  # in the example's recent_urls
HEADLINE = "Saudi Arabia cuts quotas for foreign construction workers"


def t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


PAGES = {
    ARAB_NEWS: Page(ARAB_NEWS, f"{HEADLINE} | Arab News", t("2026-10-12T08:40:00Z")),
    GULF_NEWS: Page(
        GULF_NEWS,
        "Saudi quota cut to hit thousands of foreign workers",
        t("2026-10-12T09:15:00Z"),
    ),
    OLD: Page(OLD, "UAE extends visa amnesty", t("2025-12-01T10:00:00Z")),
    UNDATED: Page(UNDATED, "What Gulf job cuts mean", None),
    REPORTED: Page(REPORTED, "Earlier Gulf story", t("2026-10-12T07:00:00Z")),
}
ANSWER = (
    f'Arab News reported on 12 October 2026 that "{HEADLINE}". Gulf News said the quota cut will '
    "hit thousands of foreign workers."
)


class FakeSearch:
    """Every query returns the same sources (all of PAGES), and is recorded."""

    def __init__(self, urls=None, answer=ANSWER):
        self.urls = urls if urls is not None else list(PAGES)
        self.answer = answer
        self.queries: list[str] = []

    async def __call__(self, query, since, until):
        self.queries.append(query)
        return {
            "answer": self.answer,
            "sources": [{"url": u, "title": "vertexaisearch link"} for u in self.urls],
        }


class FakePages:
    def __init__(self, pages=None):
        self.pages = pages if pages is not None else PAGES
        self.read: list[str] = []

    async def __call__(self, url):
        self.read.append(url)
        return self.pages.get(url) or Page(url, None, None, error="HTTP 404")


class Ctx:
    """Stands in for ADK's ToolContext: the tools only use .state and .actions."""

    def __init__(self, state: dict):
        self.state = state
        self.actions = pytypes.SimpleNamespace(skip_summarization=None)


@pytest.fixture(autouse=True)
def no_model_verifier(monkeypatch):
    """Unit tests never call Gemini; tests about the reviewer set a fake one."""
    monkeypatch.setattr(verifier, "_verifier", None)


@pytest.fixture(autouse=True)
def fake_web(monkeypatch):
    search, reader = FakeSearch(), FakePages()
    monkeypatch.setattr(web_search, "_searcher", search)
    monkeypatch.setattr(pages, "_reader", reader)
    return pytypes.SimpleNamespace(search=search, pages=reader)


@pytest.fixture
def request_example() -> dict:
    return copy.deepcopy(examples.REQUEST)


def ctx_for(body: dict, **changes) -> Ctx:
    return Ctx(
        tools.build_check_state(CheckRequest.model_validate({**body, **changes}))
    )


@pytest.fixture
def ctx(request_example) -> Ctx:
    return ctx_for(request_example)
