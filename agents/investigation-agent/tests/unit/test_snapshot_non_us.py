"""Today's investigation for institutions without a region pack (Sri Lanka, Indonesia, the Philippines), pinned.

The built-in catalog (every mechanism id, in order) and what each offline scenario of ce1d73e produces
with the correct reading (its tracks version, the mechanisms code listed and the hypotheses kept) must
stay exactly as they were. The expected values are in tests/fixtures/snapshots/ and are never
regenerated: a difference here is a change in behaviour.
"""

import asyncio
import json
from pathlib import Path

import pytest

from app import tracks
from app.contract import InvestigationRequest
from app.investigate import Investigation
from tests.scenarios.catalog import SCENARIOS
from tests.scenarios.data import FixtureData
from tests.unit.test_scenarios import CorrectModel

SNAPSHOTS = Path(__file__).parents[1] / "fixtures" / "snapshots"
EXPECTED_RUNS = json.loads((SNAPSHOTS / "investigation_runs.json").read_text())


def catalog_snapshot() -> dict:
    return {"tracks_version": tracks.TRACKS_VERSION, "mechanism_ids": [m.mechanism_id for m in tracks.MECHANISMS]}


def run_snapshot(scenario) -> dict:
    req = InvestigationRequest.model_validate(scenario.request(f"snap-{scenario.name}"))
    model = CorrectModel([scenario.readings[f["finding_id"]] for f in scenario.findings
                          if f["finding_id"] in scenario.readings])
    r = asyncio.run(Investigation(req, model, FixtureData(scenario.coverage)).run())
    return {"country": req.institution.country, "tracks_version": r.tracks_version,
            "listed": sorted({m for s in r.screening for m in s.mechanism_ids}),
            "hypotheses": sorted(h.mechanism_id for h in r.hypotheses)}


def test_the_built_in_catalog_is_unchanged():
    assert catalog_snapshot() == json.loads((SNAPSHOTS / "investigation_catalog.json").read_text())


def test_every_pinned_scenario_is_still_there():
    assert set(EXPECTED_RUNS) <= {s.name for s in SCENARIOS}
    assert {v["country"] for v in EXPECTED_RUNS.values()} >= {"LK", "ID"}


@pytest.mark.parametrize("name", sorted(EXPECTED_RUNS))
def test_a_non_us_run_is_unchanged(name):
    scenario = next(s for s in SCENARIOS if s.name == name)
    got = run_snapshot(scenario)
    assert got == EXPECTED_RUNS[name]
    assert got["tracks_version"] == "builtin-v2.4"
