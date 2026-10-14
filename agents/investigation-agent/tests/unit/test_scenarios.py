"""Every live scenario passes offline when the model reads its findings correctly.

The model is scripted to give each scenario's correct reading, keep every
screened candidate and pick the first option; amiri-server's coverage and calendar
come from fixtures (tests/scenarios/data.py). So a live failure means the model chose differently, not
that the scenario or the code can't reach its expectation.
"""

import asyncio

import pytest

from app.contract import InvestigationRequest
from app.investigate import Investigation
from tests.scenarios.catalog import SCENARIOS, evaluate
from tests.scenarios.data import FixtureData


class CorrectModel:
    """classify -> the scenario's readings, in finding order; screen -> keep; choose -> first."""

    def __init__(self, answers: list[dict]):
        self.answers = iter(answers)

    async def __call__(self, step, prompt, schema):
        props = schema["properties"]
        if step == "classify":
            return next(self.answers), "correct-model"
        if step == "screen":
            pids = props["product_ids"]["items"]["enum"]
            return {
                "keep": True,
                "product_ids": pids,
                "reason": "Applies.",
            }, "correct-model"
        field, spec = next(iter(props.items()))
        return {field: spec["enum"][0]}, "correct-model"


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s.name for s in SCENARIOS])
def test_scenario_is_reachable(scenario):
    req = InvestigationRequest.model_validate(scenario.request(f"test-{scenario.name}"))
    model = CorrectModel(
        [
            scenario.readings[f["finding_id"]]
            for f in scenario.findings
            if f["finding_id"] in scenario.readings
        ]
    )
    result = asyncio.run(
        Investigation(req, model, FixtureData(scenario.coverage)).run()
    )
    failed = [
        c
        for c in evaluate(scenario, result.model_dump(mode="json", by_alias=True))
        if not c["ok"]
    ]
    assert not failed, failed
    classified = sum(
        1 for f in scenario.findings if f["finding_id"] in scenario.readings
    )
    assert result.usage.model_calls >= classified
