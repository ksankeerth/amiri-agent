"""The monitor's US hints: US sources and regulators, and no politics, for a US institution only.
Every other country's instruction is as before (tests/unit/test_snapshot_non_us.py pins LK and ID)."""

import copy
from pathlib import Path

import pytest

from app import examples
from app.contract import CheckRequest
from tests.unit.test_snapshot_non_us import id_request, lk_request, prompt

SNAPSHOTS = Path(__file__).parents[1] / "fixtures" / "snapshots"
SOURCES = "Prefer US sources: US outlets, and the regulators and operators themselves (the Federal Reserve, FDIC and OCC for banking; ERCOT for Texas power)."
POLITICS = "Skip elections, campaigns and party politics"


def us_request(country: str = "US") -> CheckRequest:
    body = copy.deepcopy(examples.REQUEST)
    body["institution"].update(name="Austin Tech Bank", country=country, country_name="United States", currency="USD",
                               time_zone="America/Chicago", summary="Synthetic mid-size Dallas commercial bank.")
    return CheckRequest.model_validate(body)


def test_a_us_institution_gets_the_us_hints():
    text = prompt(us_request())
    assert SOURCES in text and POLITICS in text
    assert text.index("For this institution (US):") < text.index("What a finding is:")
    assert text.count("What a finding is:") == 1


@pytest.mark.parametrize("req, name", [(lk_request, "lk"), (id_request, "id")])
def test_other_prompts_are_unchanged(req, name):
    text = prompt(req())
    assert text == (SNAPSHOTS / f"monitor_prompt_{name}.txt").read_text()
    assert "Prefer US sources" not in text and "elections" not in text


def test_the_us_prompt_is_the_base_prompt_plus_the_hints():
    us, base = prompt(us_request()), prompt(us_request("GB"))  # the same request, a country without a pack
    hints = us[us.index("\nFor this institution (US):"):us.index("\nWhat a finding is:")]
    assert us.replace(hints, "") == base.replace('"country": "GB"', '"country": "US"')
