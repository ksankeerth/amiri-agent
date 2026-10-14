"""The check API (openapi.yaml): POST /checks starts a run, GET /checks/{run_id} reads it.

Both return at once. A run is worked in the background by CheckService
(app/runs.py); the caller polls GET until the status is completed,
stopped_early or failed. Request validation errors are FastAPI's 422.
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.contract import CheckRequest, CheckStatus, Error
from app.runs import CheckService, RunExists

logger = logging.getLogger(__name__)

router = APIRouter(tags=["checks"])

RETRY_AFTER_SECONDS = 5
_UNFINISHED = {"queued", "running"}


def _service(request: Request) -> CheckService:
    return request.app.state.checks


def _status_response(status: CheckStatus, code: int) -> JSONResponse:
    headers = {"Location": f"/checks/{status.run_id}"}
    if status.status in _UNFINISHED:
        headers["Retry-After"] = str(RETRY_AFTER_SECONDS)
    return JSONResponse(
        status.model_dump(mode="json", exclude_none=True), code, headers=headers
    )


def _error(code: int, message: str, run_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        Error(error=message, run_id=run_id).model_dump(exclude_none=True), code
    )


@router.post(
    "/checks",
    status_code=202,
    response_model=CheckStatus,
    responses={
        200: {"model": CheckStatus, "description": "This run_id already exists with the same body."},
        409: {"model": Error, "description": "This run_id already exists with a different body."},
        500: {"model": Error, "description": "The run could not be accepted; retry with the same run_id."},
    },
)  # fmt: skip
async def start_check(body: CheckRequest, request: Request) -> JSONResponse:
    service = _service(request)
    try:
        service.store.purge()  # runs are kept for 24 hours
        status, created = service.store.create(body)
    except RunExists:
        return _error(
            409,
            f"run_id {body.run_id} already exists with a different request",
            body.run_id,
        )
    except Exception:
        logger.exception("could not accept run %s", body.run_id)
        return _error(500, "The run could not be accepted; retry with the same run_id.")
    if not created:
        return _status_response(status, 200)
    service.start(body)
    return _status_response(status, 202)


@router.get(
    "/checks/{run_id}",
    response_model=CheckStatus,
    responses={404: {"model": Error, "description": "No run with this run_id, or it is older than 24 hours."}},
)  # fmt: skip
async def get_check(run_id: str, request: Request) -> JSONResponse:
    status = _service(request).store.get(run_id)
    if status is None:
        return _error(404, f"no run {run_id}", run_id)
    return _status_response(status, 200)
