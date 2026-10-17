"""A whole run with a fake BigQuery and a scripted judge; the API; the contract kept equal to the server's."""

import asyncio
from pathlib import Path

import pytest

from app.bq import BigQuery
from app.contract import RadarRunStatus
from app.radar_runner import Deps, RunFailed, run_radar
from tests.unit.conftest import ROWS, UNTIL, FakeClient, request, row, scripted


def deps(client=None, ask=None):
    return Deps(bq=BigQuery(client or FakeClient(rows=ROWS)), ask=ask or scripted())


async def test_a_run_reads_groups_judges_and_reports():
    ask = scripted(default={"relevance": "high", "send": True, "why": "Remittances fund deposits.", "title": "A story",
                            "summary": "From the headlines."})
    r = await run_radar(request(), deps(ask=ask))
    assert r.stop_reason == "finished" and r.queries[0].bytes_processed == 600_000_000 == r.bytes_processed
    assert r.considered == len(ROWS) - 1 and r.shortlisted >= 3 and 1 <= len(r.stories) <= 10
    assert sum(s.send for s in r.stories) == 3 and all(s.publishers >= 1 and s.headlines for s in r.stories)
    assert r.usage.model == "gemini-test" and r.usage.model_calls == len(ask.calls) and r.usage.input_tokens > 0


async def test_a_story_keeps_its_fingerprint_when_the_server_sends_it_back():
    first = await run_radar(request(), deps())
    seylan = next(s for s in first.stories if any("Seylan" in h.title for h in s.headlines))
    # the next day: yesterday's articles are out of the window, a new one carries the story on
    later = [row("Seylan Bank partners Colombo Motor Show 2026 again", "https://ft.lk/9", "ft.lk", 0.5, home=True, actor=True)]
    alone = await run_radar(request(run_id="rad-test-2"), deps(client=FakeClient(rows=later)))
    assert alone.stories[0].fingerprint != seylan.fingerprint  # no seen_stories: nothing to recognise it by
    seen = [{"fingerprint": s.fingerprint, "title": s.title, "places": s.places,
             "headlines": [h.title for h in s.headlines][:3], "last_seen_at": UNTIL.isoformat()} for s in first.stories]
    again = await run_radar(request(run_id="rad-test-3", seen_stories=seen), deps(client=FakeClient(rows=later)))
    assert again.stories[0].fingerprint == seylan.fingerprint


async def test_a_simulation_reads_only_the_provided_news():
    req = request(provided_news=[{"id": "h1", "title": "CBSL holds rates as rupee slides", "published_at": UNTIL.isoformat(),
                                  "outlet": "dailyft.lk"}])
    client = FakeClient(rows=ROWS)
    r = await run_radar(req, deps(client=client))
    assert client.queries == [] and r.queries == [] and r.bytes_processed == 0
    assert len(r.stories) == 1 and r.stories[0].places == ["LK"]


async def test_the_call_limit_stops_early_with_what_was_judged(monkeypatch):
    monkeypatch.setenv("JUDGE_BATCH_SIZE", "2")
    r = await run_radar(request(max_model_calls=1), deps())
    assert r.stop_reason == "call_limit" and r.usage.model_calls == 1 and len(r.stories) == 2  # the one batch judged


async def test_the_daily_model_allowance_holds_stories_back():
    ask = scripted()
    r = await run_radar(request(model_calls_left_today=0), deps(ask=ask))
    assert ask.calls == [] and r.usage.model_calls == 0 and r.stories
    assert all(not s.send and s.relevance == "low" and "allowance" in s.why for s in r.stories)


async def test_a_budget_refusal_fails_the_run_with_a_plain_reason(monkeypatch):
    monkeypatch.setenv("BQ_DAILY_BYTES", "100")
    with pytest.raises(RunFailed, match="didn't read the news: Radar's daily BigQuery budget is spent"):
        await run_radar(request(), deps())


def test_the_api_is_idempotent_and_answers_the_contract():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app import radar_api
    from app.runs import RadarService, RunStore

    app = FastAPI()
    app.include_router(radar_api.router)
    service = RadarService(RunStore(":memory:"), deps())
    app.state.radar = service
    body = request().model_dump(mode="json")
    with TestClient(app) as http:
        r = http.post("/radar-runs", json=body)
        assert r.status_code == 202, r.text
        assert http.post("/radar-runs", json=body).status_code == 200
        assert http.post("/radar-runs", json={**body, "seen": ["rdr-000000000009"]}).status_code == 409
        assert http.get("/radar-runs/nope").status_code == 404
        assert http.post("/radar-runs", json={"run_id": "x"}).status_code == 422
        assert http.get("/health").json() == {"status": "ok"}
        for _ in range(50):
            got = http.get(f"/radar-runs/{body['run_id']}").json()
            if got["status"] not in ("queued", "running"):
                break
            asyncio.run(asyncio.sleep(0)) if False else http.get("/health")
        st = RadarRunStatus.model_validate(got)
        assert st.status == "completed" and st.result is not None and st.result.stories


def test_the_contract_is_the_servers():
    server = Path(__file__).resolve().parents[4] / "server" / "app" / "radar" / "contract.py"
    if not server.exists():
        pytest.skip("the server isn't in this checkout")
    mine = (Path(__file__).resolve().parents[2] / "app" / "contract.py").read_text()
    body = lambda s: s[s.index('"""', 3) + 3:]  # noqa: E731 - after the module docstring
    assert body(mine) == body(server.read_text())
