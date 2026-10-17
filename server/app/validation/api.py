"""Validation's results: verdicts per event or task, and running due tasks now."""

from datetime import date

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app.validation.service import Validation

router = APIRouter(prefix="/api/v1/validation", tags=["validation"])


def svc(request: Request) -> Validation:
    return request.app.state.validation


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_ids: list[str] | None = Field(None, max_length=50, description="These tasks, due or not; default: every due task.")
    as_of: date | None = Field(None, description="Judge as of this local date (default today); for replays and tests.")


@router.get("/verdicts", summary="Validation tasks with their latest verdict and its history")
async def verdicts(request: Request, event_id: str | None = None, task_id: str | None = None):
    return {"items": await svc(request).verdicts(event_id, task_id)}


@router.post(":run", summary="Judge due tasks now (the tick does this on its own)")
async def run(request: Request, body: RunIn | None = None):
    body = body or RunIn()
    return await svc(request).run_due(body.task_ids, body.as_of)
