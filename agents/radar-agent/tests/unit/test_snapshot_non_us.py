"""Today's Radar for institutions without a region pack (Sri Lanka, Indonesia), pinned.

The query's SQL and parameters, and how articles.py tags a fixed set of real GDELT rows, must stay
exactly as they were at ce1d73e for every country without a pack. The expected values live in
tests/fixtures/snapshots/ and are never regenerated: a difference here is a change in behaviour.
"""

import asyncio
import json
import re
from datetime import UTC, datetime

from app.articles import dedupe, from_row
from app.contract import RadarRunRequest
from app.geo import places
from app.judge import judge
from app.prompt import build_instruction
from app.queries import plan
from app.stories import group, shortlist
from tests.fixtures.recall import HERE, recalled, rows, window
from tests.unit.conftest import scripted

SNAPSHOTS = HERE / "snapshots"
SINCE, UNTIL = datetime(2026, 10, 16, 6, 0, tzinfo=UTC), datetime(2026, 10, 17, 6, 0, tzinfo=UTC)

ID_INSURER = {
    "run_id": "rad-snapshot-id",
    "institution": {"name": "Samudra Raya General Insurance", "institution_type": "insurer", "country": "ID",
                    "country_name": "Indonesia", "currency": "IDR", "time_zone": "Asia/Jakarta",
                    "summary": "A general insurer: motor, property, marine cargo.",
                    "regulators": [{"id": "ojk", "name": "Otoritas Jasa Keuangan", "aliases": ["OJK"]}],
                    "rivals": [{"id": "rival", "name": "Nusantara Insurance", "aliases": []}]},
    "scope": {"places": ["ID", "ID-JK", "ID-JB", "SG", "chk:malacca"],
              "places_why": {"ID": ["footprint (home)"], "SG": ["flow: reinsurance with ID"],
                             "chk:malacca": ["place to watch: marine cargo"]},
              "themes": ["fx", "disaster", "regulation"], "actors": ["OJK"]},
    "window": {"since": SINCE.isoformat(), "until": UNTIL.isoformat()},
    "seen": [],
    "limits": {"max_stories": 10, "max_model_calls": 40, "timeout_seconds": 300, "max_queries": 1,
               "max_bytes_per_query": 1_500_000_000},
}


def lk_request() -> RadarRunRequest:
    return window(json.loads((HERE / "serendib-request.json").read_text()), SINCE, UNTIL)


PATTERN = re.compile(r"^\(\^\|\[\^a-z0-9\]\)\((.*)\)\(\[\^a-z0-9\]\|\$\)$")


def canon(value):
    """geo.title_pattern orders names of equal length as a set iterates (it changes with the hash seed):
    the names are compared longest first, then alphabetically."""
    m = PATTERN.match(value) if isinstance(value, str) else None
    if not m:
        return value
    names = sorted(re.split(r"(?<!\\)\|", m.group(1)), key=lambda n: (-len(n), n))
    return "(^|[^a-z0-9])(" + "|".join(names) + ")([^a-z0-9]|$)"


def plan_snapshot(req: RadarRunRequest) -> dict:
    q, _ = plan(req)
    return {"name": q.name, "purpose": q.purpose, "sql": q.sql, "days": [d.isoformat() for d in q.days],
            "clamped": q.clamped,
            "params": {k: [t, list(v) if isinstance(v, (list, tuple)) else canon(v)] for k, (t, v) in q.params.items()}}


def articles_snapshot(req: RadarRunRequest) -> list[dict]:
    """Every 20th row of the real day, tagged as articles.py tags it (None: dropped)."""
    p = places(req.institution.country, list(req.scope.places), dict(req.scope.places_why))
    out = []
    for r in rows("serendib-2026-10-16.jsonl.gz")[::20]:
        a = from_row(r, p)
        out.append({"url": r["url"], "article": None if a is None else {
            "about": sorted(a.about), "places": sorted(a.places), "in_title": a.in_title, "rules": sorted(a.rules)}})
    return out


def judge_prompt_snapshot(req: RadarRunRequest) -> str:
    """The judge's instruction for the first batch of the real day's shortlist."""
    p = places(req.institution.country, list(req.scope.places), dict(req.scope.places_why))
    cands = group(dedupe([a for a in (from_row(r, p) for r in recalled(rows("serendib-2026-10-16.jsonl.gz"), req)) if a]))
    ask = scripted()
    asyncio.run(judge(shortlist(cands, req, []), req, 1, ask))
    return build_instruction(ask.calls[0])


def expected(name: str):
    return json.loads((SNAPSHOTS / name).read_text())


def test_lk_query_sql_and_parameters_are_unchanged():
    assert plan_snapshot(lk_request()) == expected("radar_plan_lk.json")


def test_id_query_sql_and_parameters_are_unchanged():
    assert plan_snapshot(RadarRunRequest.model_validate(ID_INSURER)) == expected("radar_plan_id.json")


def test_lk_home_and_footprint_tagging_of_real_rows_is_unchanged():
    got = articles_snapshot(lk_request())
    assert len(got) == len(expected("radar_articles_lk.json"))
    assert got == expected("radar_articles_lk.json")


def test_lk_judge_prompt_is_unchanged():
    assert judge_prompt_snapshot(lk_request()) == (SNAPSHOTS / "radar_judge_prompt_lk.txt").read_text()
