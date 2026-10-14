"""POST /checks and GET /checks/{run_id}, with a fake runner in place of the agent."""

import asyncio
import copy
import threading
import time
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai import errors

from app import check_api
from app.contract import CheckResult, Coverage, Usage
from app.runs import INTERRUPTED, CheckService, RunStore


def result(stop_reason: str = "finished") -> CheckResult:
    return CheckResult(
        stop_reason=stop_reason,
        summary="Nothing new.",
        findings=[],
        coverage=Coverage(
            web_queries=0,
            pages_seen=0,
            pages_dated=0,
            pages_in_window=0,
            already_reported=0,
            provided_news=0,
        ),
        tool_trace=[],
        usage=Usage(model="m", model_calls=1, tool_calls=0, duration_ms=5),
    )


class FakeRunner:
    """Holds each run until release() (or returns at once if not gated)."""

    def __init__(self, outcome=None, gated: bool = False):
        self.outcome = outcome or result()
        self.gate = threading.Event()
        if not gated:
            self.gate.set()
        self.started: list[str] = []

    def release(self) -> None:
        self.gate.set()

    async def __call__(self, req):
        self.started.append(req.run_id)
        while not self.gate.is_set():
            await asyncio.sleep(0.01)
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        return self.outcome


@pytest.fixture
def store(tmp_path) -> RunStore:
    return RunStore(tmp_path / "runs.db")


def client_for(store: RunStore, runner: FakeRunner, max_concurrent: int = 4):
    app = FastAPI()
    app.include_router(check_api.router)
    app.state.checks = CheckService(store, runner, max_concurrent=max_concurrent)
    return TestClient(app)


def wait_until_finished(client: TestClient, run_id: str) -> dict:
    for _ in range(500):
        body = client.get(f"/checks/{run_id}").json()
        if body["status"] not in ("queued", "running"):
            return body
        time.sleep(0.01)
    raise AssertionError(f"run {run_id} did not finish: {body}")


def test_start_then_poll_until_completed(store, request_example):
    runner = FakeRunner(gated=True)
    with client_for(store, runner) as client:
        r = client.post("/checks", json=request_example)
        assert r.status_code == 202
        assert r.headers["Location"] == f"/checks/{request_example['run_id']}"
        assert r.headers["Retry-After"] == "5"
        assert r.json()["status"] == "queued"
        assert "result" not in r.json()

        polled = client.get(r.headers["Location"])
        assert polled.status_code == 200
        assert polled.json()["status"] in ("queued", "running")
        assert polled.headers["Retry-After"] == "5"

        runner.release()
        done = wait_until_finished(client, request_example["run_id"])
    assert done["status"] == "completed"
    assert done["result"]["summary"] == "Nothing new."
    assert done["started_at"] and done["finished_at"]
    assert runner.started == [request_example["run_id"]]


def test_same_run_id_and_body_returns_the_run_without_starting_another(
    store, request_example
):
    runner = FakeRunner()
    with client_for(store, runner) as client:
        assert client.post("/checks", json=request_example).status_code == 202
        wait_until_finished(client, request_example["run_id"])
        again = client.post("/checks", json=request_example)
    assert again.status_code == 200
    assert again.json()["status"] == "completed"
    assert "Retry-After" not in again.headers
    assert runner.started == [request_example["run_id"]]


def test_same_run_id_with_a_different_body_is_a_conflict(store, request_example):
    with client_for(store, FakeRunner()) as client:
        client.post("/checks", json=request_example)
        changed = copy.deepcopy(request_example)
        changed["web_search"] = {"max_queries": 5}
        r = client.post("/checks", json=changed)
    assert r.status_code == 409
    assert r.json() == {
        "error": f"run_id {request_example['run_id']} already exists with a different request",
        "run_id": request_example["run_id"],
    }


def test_invalid_request_is_422_and_creates_no_run(store, request_example):
    with client_for(store, FakeRunner()) as client:
        r = client.post(
            "/checks", json={**request_example, "feeds": [], "web_search": None}
        )
        assert r.status_code == 422
        assert r.json()["detail"]
        assert client.get(f"/checks/{request_example['run_id']}").status_code == 404


def test_unknown_run_is_404(store):
    with client_for(store, FakeRunner()) as client:
        r = client.get("/checks/nope")
    assert r.status_code == 404
    assert r.json() == {"error": "no run nope", "run_id": "nope"}


def test_a_limit_stop_is_stopped_early(store, request_example):
    with client_for(store, FakeRunner(result("step_limit"))) as client:
        client.post("/checks", json=request_example)
        done = wait_until_finished(client, request_example["run_id"])
    assert done["status"] == "stopped_early"
    assert done["result"]["stop_reason"] == "step_limit"


def test_every_model_unavailable_fails_the_run(store, request_example):
    outage = errors.APIError(503, {"error": {"code": 503, "status": "UNAVAILABLE"}})
    with client_for(store, FakeRunner(outage)) as client:
        client.post("/checks", json=request_example)
        done = wait_until_finished(client, request_example["run_id"])
    assert done["status"] == "failed"
    assert done["error"] == (
        "Every model was unavailable (busy). Coverage was not advanced; start a new run."
    )
    assert "result" not in done


def test_runs_wait_for_a_free_slot(store, request_example):
    runner = FakeRunner(gated=True)
    second = {**request_example, "run_id": "run-second"}
    with client_for(store, runner, max_concurrent=1) as client:
        client.post("/checks", json=request_example)
        client.post("/checks", json=second)
        time.sleep(0.1)
        assert client.get("/checks/run-second").json()["status"] == "queued"
        runner.release()
        assert wait_until_finished(client, "run-second")["status"] == "completed"


def test_runs_left_unfinished_by_a_restart_are_failed(store, request_example):
    from app.contract import CheckRequest

    status, _ = store.create(CheckRequest.model_validate(request_example))
    store.mark_running(status.run_id)
    assert store.fail_interrupted() == 1
    failed = store.get(status.run_id)
    assert failed.status == "failed" and failed.error == INTERRUPTED


def test_runs_older_than_a_day_are_purged(store, request_example):
    from app.contract import CheckRequest

    store.create(CheckRequest.model_validate(request_example))
    assert store.purge(older_than=timedelta(hours=24)) == 0
    assert store.purge(older_than=timedelta(seconds=-1)) == 1
    assert store.get(request_example["run_id"]) is None
