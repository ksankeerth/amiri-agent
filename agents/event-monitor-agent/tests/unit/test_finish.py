"""finish keeps findings to what their evidence says: dates by code, places, key dates,
numbers and names, then the reviewer."""

import asyncio
import copy

import pytest
from conftest import ARAB_NEWS, GULF_NEWS, HEADLINE, OLD, UNDATED

from app import tools, verifier
from app.verifier import FindingReview, Review


@pytest.fixture
def searched(ctx):
    asyncio.run(tools.web_search("Saudi Arabia foreign workers quota", ctx))
    return ctx


def finish(
    ctx, findings, summary="Saudi Arabia cut quotas for foreign construction workers."
):
    return asyncio.run(tools.finish(summary, copy.deepcopy(findings), ctx))


def finding(**changes) -> dict:
    return {
        "title": HEADLINE,
        "explanation": f'Arab News reported "{HEADLINE}" at 08:40 UTC on 12 Oct.',
        "tell_me_if_lines": [2],
        "evidence": {"web": [{"url": ARAB_NEWS}]},
        "places": ["SA"],
        "key_date": "2026-11-01",
        **changes,
    }


def test_a_supported_finding_is_kept_with_its_sources(searched):
    out = finish(searched, [finding()])
    assert out == {"status": "ok", "findings_accepted": 1}
    result = searched.state[tools.STATE_RESULT]
    assert (
        result["findings"][0]["places"] == ["SA"]
        and result["findings"][0]["key_date"] == "2026-11-01"
    )
    src = result["sources"][0]
    assert (src["outlet"], src["published_at"]) == (
        "arabnews.com",
        "2026-10-12T08:40:00Z",
    )
    assert src["title"].startswith(HEADLINE)


def test_nothing_found_is_a_normal_result(searched):
    assert finish(searched, [], "Nothing new.")["status"] == "ok"
    assert searched.state[tools.STATE_RESULT]["findings"] == []


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        (
            {
                "evidence": {"web": [{"url": UNDATED}]},
                "title": "What Gulf job cuts mean",
                "explanation": "A blog discussed Gulf job cuts.",
            },
            "no publication date",
        ),
        (
            {
                "evidence": {"web": [{"url": OLD}]},
                "title": "UAE extends visa amnesty",
                "explanation": "The UAE extended its visa amnesty.",
            },
            "outside this check's window",
        ),
        (
            {"evidence": {"web": [{"url": "https://never.returned/x"}]}},
            "was not returned by web_search",
        ),
        ({"places": ["QA", "FR"]}, "FR are not the monitor's places"),
        ({"key_date": "2026-12-25"}, "not one of the monitor's key dates"),
        ({"tell_me_if_lines": [7]}, "line 7 does not exist"),
        ({"tell_me_if_lines": []}, "needs the tell_me_if line"),
        ({"evidence": {"web": []}}, "needs a web page or a headline"),
    ],
)
def test_code_refuses(searched, changes, message):
    out = finish(searched, [finding(**changes)])
    assert out["status"] == "error" and message in out["message"]


def test_the_title_is_a_cited_title(searched):
    # the site's " | Arab News" suffix may be left out; another wording may not
    assert finish(searched, [finding()])["status"] == "ok"
    out = finish(
        searched, [finding(title="Saudi Arabia slashes foreign worker numbers")]
    )
    assert out["status"] == "error" and "cited headline or page title" in out["message"]


def test_numbers_and_names_only_from_the_evidence(searched):
    out = finish(
        searched, [finding(explanation="Saudi Arabia cut 50,000 jobs, says the IMF.")]
    )
    assert (
        out["status"] == "error"
        and "50000" in out["message"]
        and "IMF" in out["message"]
    )


def test_a_page_in_two_findings_is_refused(searched):
    two = [finding(), finding(tell_me_if_lines=[1])]
    assert "use it in one finding only" in finish(searched, two)["message"]


class FakeReviewer:
    def __init__(self, *reviews):
        self.reviews = list(reviews)
        self.reports = []

    async def __call__(self, report):
        self.reports.append(report)
        return self.reviews.pop(0) if len(self.reviews) > 1 else self.reviews[0]


def test_the_reviewer_removes_lines_merges_and_rewrites(searched, monkeypatch):
    gulf = finding(
        title="Saudi quota cut to hit thousands of foreign workers",
        explanation="Gulf News reported the quota cut.",
        evidence={"web": [{"url": GULF_NEWS}]},
        tell_me_if_lines=[1, 2],
        places=["SA"],
        key_date=None,
    )
    review = Review(
        findings=[
            FindingReview(
                finding=1, unsupported_lines=[], same_story_as=None, problems=[]
            ),
            FindingReview(
                finding=2, unsupported_lines=[1], same_story_as=1, problems=[]
            ),
        ]
    )
    monkeypatch.setattr(verifier, "_verifier", FakeReviewer(review))
    out = finish(searched, [finding(), gulf])
    assert out["status"] == "ok" and out["findings_accepted"] == 1
    kept = searched.state[tools.STATE_RESULT]["findings"][0]
    assert [w["url"] for w in kept["evidence"]["web"]] == [
        ARAB_NEWS,
        GULF_NEWS,
    ] and kept["tell_me_if_lines"] == [2]
    report = monkeypatch_report = verifier._verifier.reports[0]
    assert (
        monkeypatch_report["findings"][0]["evidence"]["web_pages"][0]["published_at"]
        == "2026-10-12T08:40:00Z"
    )
    assert report["monitor"]["tell_me_if"][1]["line"] == 2


def test_a_claim_still_flagged_is_rewritten_from_the_evidence(searched, monkeypatch):
    flagged = Review(
        findings=[
            FindingReview(
                finding=1,
                unsupported_lines=[],
                same_story_as=None,
                problems=["'will cost thousands of jobs' is not in the evidence"],
            )
        ]
    )
    monkeypatch.setattr(verifier, "_verifier", FakeReviewer(flagged))
    first = finish(searched, [finding()])
    assert first["status"] == "error" and "reviewer" in first["message"]
    second = finish(searched, [finding()])
    assert (
        second["status"] == "ok"
        and "rewritten from its evidence" in second["adjusted"][0]
    )
    kept = searched.state[tools.STATE_RESULT]["findings"][0]
    assert (
        kept["explanation"].startswith('"Saudi Arabia cuts quotas')
        and "08:40 UTC on 12 Oct" in kept["explanation"]
    )
