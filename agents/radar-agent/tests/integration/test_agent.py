"""A live run of the judge on provided news (a simulation): no BigQuery, one real model call.

Needs model credentials (see .env.example). It checks the run's shape, not the model's wording:
every shortlisted story comes back judged, a low story is never sent, and the sends stay within
SEND_MAX_PER_RUN.
"""

import os

import pytest

from app import settings
from app.memory import Memory
from app.radar_runner import Deps, run_radar
from tests.unit.conftest import UNTIL, request

pytestmark = pytest.mark.skipif(
    not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_CLOUD_PROJECT")), reason="needs model credentials")

NEWS = [
    {"id": "n1", "title": "Saudi Arabia tightens rules on foreign workers' remittance transfers", "outlet": "Arab News",
     "places": ["SA"]},
    {"id": "n2", "title": "CBSL holds policy rates steady as inflation eases", "outlet": "Daily FT", "places": ["LK"]},
    {"id": "n3", "title": "Tankers reroute as Strait of Hormuz insurance costs jump", "outlet": "Reuters"},
    {"id": "n4", "title": "Iowa county fair breaks attendance record", "outlet": "Des Moines Register"},
]


async def test_the_judge_answers_every_shortlisted_story(tmp_path):
    news = [{**n, "published_at": UNTIL.isoformat()} for n in NEWS]
    r = await run_radar(request(run_id="rad-live-1", provided_news=news),
                        Deps(bq=None, memory=Memory(tmp_path / "runs.db")))  # type: ignore[arg-type]
    assert r.stop_reason == "finished" and r.usage.model_calls >= 1
    assert r.considered == 4 and r.stories and r.bytes_processed == 0
    for s in r.stories:
        assert s.relevance in ("high", "medium", "low") and s.why
        assert not (s.send and s.relevance == "low")
    assert sum(s.send for s in r.stories) <= settings.integer("SEND_MAX_PER_RUN")
