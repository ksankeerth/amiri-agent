"""The investigation through the ADK runner, and the POST/GET /investigations API."""

import asyncio
import copy
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.adk.apps import App
from test_investigate import EXAMPLE, FakeData, ScriptedLlm

from app import investigation_api
from app.agent import InvestigationAgent
from app.contract import InvestigationRequest
from app.investigation_runner import run_investigation
from app.runs import InvestigationService, RunStore


def agent_app(llm=None, data=None) -> App:
    agent = InvestigationAgent(
        name="investigation_agent", llm=llm or ScriptedLlm(), data=data or FakeData()
    )
    return App(name="app", root_agent=agent)


def test_runs_through_the_adk_runner():
    req = InvestigationRequest.model_validate(EXAMPLE)
    result = asyncio.run(run_investigation(req, agent_app()))
    assert result.stop_reason == "finished"
    assert any(t.metric == "lc_openings" for t in result.tasks)


@pytest.fixture
def client(tmp_path):
    async def runner(req):
        return await run_investigation(req, agent_app())

    app = FastAPI()
    app.include_router(investigation_api.router)
    app.state.investigations = InvestigationService(
        RunStore(tmp_path / "runs.db"), runner, max_concurrent=2
    )
    with TestClient(app) as c:
        yield c


def wait(client, run_id) -> dict:
    for _ in range(300):
        body = client.get(f"/investigations/{run_id}").json()
        if body["status"] not in ("queued", "running"):
            return body
        time.sleep(0.02)
    raise AssertionError(body)


def test_start_then_poll(client):
    r = client.post("/investigations", json=EXAMPLE)
    assert r.status_code == 202
    assert r.headers["Location"] == f"/investigations/{EXAMPLE['run_id']}"
    done = wait(client, EXAMPLE["run_id"])
    assert done["status"] == "completed"
    task = next(t for t in done["result"]["tasks"] if t["metric"] == "lc_openings")
    assert set(task["watch"]) == {
        "from",
        "until",
    }  # business dates under their JSON names


def test_repeat_and_conflict(client):
    client.post("/investigations", json=EXAMPLE)
    wait(client, EXAMPLE["run_id"])
    assert client.post("/investigations", json=EXAMPLE).status_code == 200
    changed = copy.deepcopy(EXAMPLE)
    changed["tracks_version"] = "custom-1"
    assert client.post("/investigations", json=changed).status_code == 409


def test_invalid_and_unknown(client):
    bad = {**EXAMPLE, "findings": []}
    assert client.post("/investigations", json=bad).status_code == 422
    assert client.get("/investigations/nope").status_code == 404
