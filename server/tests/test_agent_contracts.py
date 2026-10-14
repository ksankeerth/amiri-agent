"""The agent contracts in contracts/ against what the server really sends and what its test double answers."""

from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator

from tests.test_investigation_api import bank, sandbox_move

CONTRACTS = Path(__file__).resolve().parent.parent / "contracts"


def validator(file: str, schema: str) -> Draft202012Validator:
    doc = yaml.safe_load((CONTRACTS / file).read_text())
    return Draft202012Validator({"$ref": f"#/components/schemas/{schema}", "components": doc["components"]})


def problems(v: Draft202012Validator, instance: dict) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path))}: {e.message[:140]}" for e in v.iter_errors(instance)]


async def test_what_the_server_sends_the_investigation_agent_fits_its_contract(client, env, agent):
    await bank(client, env)
    await sandbox_move(client)  # a real market-series finding, with its evidence
    await client.post("/api/v1/investigations", json={"world": "sandbox"})
    await client.post("/internal/tick")
    assert agent.requests, "the server sent nothing"
    errs = problems(validator("investigation-agent-openapi.yaml", "InvestigationRequest"), agent.requests[0])
    assert errs == [], "\n".join(errs)


async def test_the_test_double_answers_in_the_contracts_shape(client, env, agent):
    await bank(client, env)
    await sandbox_move(client)
    await client.post("/api/v1/investigations", json={"world": "sandbox"})
    await client.post("/internal/tick")
    body = agent.result(agent.requests[0])
    errs = problems(validator("investigation-agent-openapi.yaml", "InvestigationResult"), body)
    assert errs == [], errs


@pytest.mark.parametrize("file", sorted(p.name for p in CONTRACTS.glob("*.yaml")))
def test_every_contract_is_openapi_3_1_with_paths(file):
    doc = yaml.safe_load((CONTRACTS / file).read_text())
    assert doc["openapi"].startswith("3.1") and doc["paths"] and doc["components"]["schemas"]
