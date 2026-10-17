"""The run API (the server's contract 2.0): POST /radar-runs starts a run, GET /radar-runs/{run_id} reads it.

Both answer at once; a run is worked in the background (app/runs.py) and the caller polls GET until
the status is completed, stopped_early or failed. Request validation errors are FastAPI's 422.
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.contract import RadarRunRequest, RadarRunStatus
from app.runs import RadarService, RunExists

logger = logging.getLogger(__name__)
router = APIRouter(tags=["radar"])
RETRY_AFTER_SECONDS = 5


def _service(request: Request) -> RadarService:
    return request.app.state.radar


def _status(status: RadarRunStatus, code: int) -> JSONResponse:
    headers = {"Location": f"/radar-runs/{status.run_id}"}
    if status.status in ("queued", "running"):
        headers["Retry-After"] = str(RETRY_AFTER_SECONDS)
    return JSONResponse(status.model_dump(mode="json", exclude_none=True), code, headers=headers)


def _error(code: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, code)


@router.post("/radar-runs", status_code=202, response_model=RadarRunStatus, summary="Start a run")
async def start_run(body: RadarRunRequest, request: Request) -> JSONResponse:
    service = _service(request)
    try:
        service.store.purge()  # runs are kept for 24 hours
        status, created = service.store.create(body)
    except RunExists:
        return _error(409, f"run_id {body.run_id} already exists with a different request")
    except Exception:
        logger.exception("could not accept run %s", body.run_id)
        return _error(500, "The run could not be accepted; retry with the same run_id.")
    if not created:
        return _status(status, 200)
    service.start(body)
    return _status(status, 202)


@router.get("/radar-runs/{run_id}", response_model=RadarRunStatus, summary="A run's status; its result when finished")
async def get_run(run_id: str, request: Request) -> JSONResponse:
    status = _service(request).store.get(run_id)
    return _error(404, f"no run {run_id}") if status is None else _status(status, 200)


@router.get("/health", summary="Up")
async def health() -> dict:
    return {"status": "ok"}
