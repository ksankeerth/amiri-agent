"""Today's monitor prompt for institutions without a region pack (Sri Lanka, Indonesia), pinned.

The instruction the agent builds for a check must stay exactly as it was at ce1d73e for every country
without a pack. The expected text is in tests/fixtures/snapshots/ and is never regenerated: a difference
here is a change in behaviour.
"""

import copy
from pathlib import Path

from app import examples
from app.contract import CheckRequest
from app.prompt import build_instruction
from app.tools import build_check_state

SNAPSHOTS = Path(__file__).parents[1] / "fixtures" / "snapshots"


def lk_request() -> CheckRequest:
    return CheckRequest.model_validate(copy.deepcopy(examples.REQUEST))


def id_request() -> CheckRequest:
    body = copy.deepcopy(examples.REQUEST)
    body["institution"] = {
        "name": "Samudra Raya General Insurance", "institution_type": "insurer", "country": "ID",
        "country_name": "Indonesia", "currency": "IDR", "time_zone": "Asia/Jakarta",
        "summary": "A general insurer: motor, property and marine cargo.",
        "regulators": [{"id": "ojk", "name": "Otoritas Jasa Keuangan", "aliases": ["OJK"]}],
        "notes": "Private note for the snapshot.",
    }
    body["monitor"]["spec"]["private"]["exposure"] = []
    return CheckRequest.model_validate(body)


def prompt(req: CheckRequest) -> str:
    return build_instruction(build_check_state(req))


def test_lk_prompt_is_unchanged():
    assert prompt(lk_request()) == (SNAPSHOTS / "monitor_prompt_lk.txt").read_text()


def test_id_prompt_is_unchanged():
    assert prompt(id_request()) == (SNAPSHOTS / "monitor_prompt_id.txt").read_text()
