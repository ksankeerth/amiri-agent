"""The investigation API (openapi.yaml): POST /investigations starts a run, GET reads it.

Both return at once. A run is worked in the background by InvestigationService
(app/runs.py); the caller polls GET until the status is completed,
stopped_early or failed. Request validation errors are FastAPI's 422.
"""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.contract import Error, InvestigationRequest, InvestigationStatus
from app.runs import InvestigationService, RunExists

logger = logging.getLogger(__name__)

router = APIRouter(tags=["investigations"])

RETRY_AFTER_SECONDS = 5
_UNFINISHED = {"queued", "running"}


def _service(request: Request) -> InvestigationService:
    return request.app.state.investigations


def _status_response(status: InvestigationStatus, code: int) -> JSONResponse:
    headers = {"Location": f"/investigations/{status.run_id}"}
    if status.status in _UNFINISHED:
        headers["Retry-After"] = str(RETRY_AFTER_SECONDS)
    return JSONResponse(
        status.model_dump(mode="json", exclude_none=True, by_alias=True),
        code,
        headers=headers,
    )


def _error(code: int, message: str, run_id: str | None = None) -> JSONResponse:
    return JSONResponse(
        Error(error=message, run_id=run_id).model_dump(exclude_none=True), code
    )


@router.post(
    "/investigations",
    status_code=202,
    response_model=InvestigationStatus,
    responses={
        200: {"model": InvestigationStatus, "description": "This run_id already exists with the same body."},
        409: {"model": Error, "description": "This run_id already exists with a different body."},
        500: {"model": Error, "description": "The run could not be accepted; retry with the same run_id."},
    },
)  # fmt: skip
async def start_investigation(
    body: InvestigationRequest, request: Request
) -> JSONResponse:
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
    "/investigations/{run_id}",
    response_model=InvestigationStatus,
    responses={404: {"model": Error, "description": "No run with this run_id, or it is older than 24 hours."}},
)  # fmt: skip
async def get_investigation(run_id: str, request: Request) -> JSONResponse:
    status = _service(request).store.get(run_id)
    if status is None:
        return _error(404, f"no run {run_id}", run_id)
    return _status_response(status, 200)
