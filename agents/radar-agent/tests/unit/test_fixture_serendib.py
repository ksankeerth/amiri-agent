"""Real GDELT rows for one bank's day (Serendib Commercial Bank, 16-17 Oct 2026), replayed offline.

tests/fixtures/serendib-2026-10-16.jsonl.gz was captured once with scripts/capture_fixture.py and the
request the server sent (tests/fixtures/serendib-request.json); tests/fixtures/recall.py applies the
query's current rules to it. These pin what tuning found, so later changes can't quietly undo it.
"""

import json
from datetime import UTC, datetime
from functools import cache

from app.articles import dedupe, from_row
from app.geo import places
from app.stories import group, shortlist
from tests.fixtures.recall import HERE, recalled, rows, window

UNTIL = datetime(2026, 10, 17, 6, 0, tzinfo=UTC)


@cache
def run():
    req = window(json.loads((HERE / "serendib-request.json").read_text()), datetime(2026, 10, 16, 6, 0, tzinfo=UTC), UNTIL)
    got = recalled(rows("serendib-2026-10-16.jsonl.gz"), req)
    p = places(req.institution.country, list(req.scope.places), dict(req.scope.places_why))
    cands = group(dedupe([a for a in (from_row(r, p) for r in got) if a]))
    return req, got, cands, shortlist(cands, req, [])


def titles(cands) -> list[str]:
    return [h.title for c in cands for h in c.headlines()]


def test_a_trade_partner_must_be_named_not_just_mentioned():
    # the US is in scope for garment exports only: its domestic news (3,500 rows a day by share) stays out
    _, got, _, _ = run()
    assert len(got) < 1200
    assert not any("Lake Mead" in (r["title"] or "") for r in got)  # a US story by share only


def test_home_outlets_count_as_home_news():
    # "Govt. eyes Azerbaijan oil and gas supply" (ft.lk) neither names Sri Lanka nor is geocoded there
    _, got, cands, _ = run()
    assert any("Azerbaijan oil and gas" in (r["title"] or "") and r["r_home"] for r in got)
    c = next(c for c in cands if any("Azerbaijan oil and gas" in a.title for a in c.articles))
    assert "LK" in c.about


def test_one_strait_one_story():
    _, _, cands, short = run()
    hormuz = [c for c in cands if c.anchor == "chk:hormuz"]
    assert len(hormuz) == 1 and hormuz[0].sources >= 20
    assert "Hormuz" in hormuz[0].headlines()[0].title
    assert hormuz[0] in short


def test_vague_aliases_and_outlet_names_dont_make_stories():
    _, _, cands, _ = run()
    assert not any("sea:persian-gulf" in c.places for c in cands if any("Gulf Coast" in a.title for a in c.articles))
    assert not any(t.startswith("Arab News |") for t in titles(cands))


def test_the_shortlist_has_home_economy_watched_places_and_corridors():
    req, _, _, short = run()
    got = titles(short)
    assert len(short) == 3 * req.limits.max_stories
    for want in ("assures IMF it will present 2027 austerity budget", "FATF Grey-Listing", "Strait of Hormuz", "Saudi"):
        assert any(want in t for t in got), want
    assert sum("LK" in c.about for c in short) <= len(short) // 3 + 1  # home news doesn't crowd out the rest
    for noise in ("Iowa", "Ontario gas prices", "Boys and Girls Club", "Coast Guard rescues", "Lake Mead"):
        assert not any(noise in t for t in got), noise
