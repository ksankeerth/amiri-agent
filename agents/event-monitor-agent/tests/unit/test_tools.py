"""The tools: web search (budget, guards, page dates by code) and a simulation's headlines."""

import asyncio

from conftest import ARAB_NEWS, GULF_NEWS, OLD, REPORTED, UNDATED, ctx_for

from app import tools


def search(ctx, query="Saudi Arabia foreign workers quota"):
    return asyncio.run(tools.web_search(query, ctx))


def test_sources_carry_the_pages_own_date_and_title(ctx, fake_web):
    out = search(ctx)
    assert out["status"] == "ok" and out["queries_left"] == 2
    by_url = {s["url"]: s for s in out["sources"]}
    assert (
        REPORTED not in by_url and out["already_reported"] == 1
    )  # this monitor reported it before
    a = by_url[ARAB_NEWS]
    assert (a["title"], a["outlet"], a["published_at"], a["in_window"]) == (
        "Saudi Arabia cuts quotas for foreign construction workers | Arab News",
        "arabnews.com",
        "2026-10-12T08:40:00Z",
        True,
    )  # 20 min before the window: inside the grace
    assert by_url[GULF_NEWS]["in_window"] is True
    assert by_url[OLD]["in_window"] is False and "outside" in by_url[OLD]["note"]
    assert (
        by_url[UNDATED]["published_at"] is None
        and "no publication date" in by_url[UNDATED]["note"]
    )
    assert REPORTED not in fake_web.pages.read  # not even read


def test_the_budget_and_guards(ctx, request_example):
    for _ in range(3):
        assert search(ctx)["status"] == "ok"
    assert search(ctx)["status"] == "blocked"
    c = ctx_for(request_example)
    assert search(c, "see https://x.com")["status"] == "blocked"
    assert search(c, "Saudi " + "x" * 220)["status"] == "blocked"
    assert search(c, "   ")["status"] == "error"
    assert c.state[tools.STATE_WEB_USED] == 0  # refused queries cost nothing


def test_private_words_never_reach_a_query(ctx):
    out = search(
        ctx, "remittances fund savings Saudi"
    )  # "remittances" only in the private exposure note
    assert out["status"] == "blocked" and "remittances" in out["message"]


def test_a_simulation_reads_its_headlines_and_cannot_search(request_example):
    news = [
        {
            "id": f"n{i}",
            "title": f"Headline {i}",
            "published_at": f"2026-10-12T09:{i:02d}:00Z",
        }
        for i in range(30)
    ]
    news.append(
        {"id": "late", "title": "Tomorrow", "published_at": "2026-10-13T09:00:00Z"}
    )
    c = ctx_for(request_example, web_search=None, provided_news=news)
    assert asyncio.run(tools.web_search("Saudi", c))["status"] == "blocked"
    first = tools.list_provided_news("", c)
    assert len(first["items"]) == 25 and first["next_cursor"] == "25"
    second = tools.list_provided_news(first["next_cursor"], c)
    assert [i["id"] for i in second["items"]] == [
        "n25",
        "n26",
        "n27",
        "n28",
        "n29",
    ] and second["next_cursor"] == ""


def test_a_web_check_has_no_provided_news(ctx):
    assert tools.list_provided_news("", ctx)["status"] == "blocked"
