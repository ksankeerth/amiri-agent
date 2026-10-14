"""Alerts (/api/v1/alerts): what Amiri Agent found for each team's products, and
who has looked at it. Any Risk Manager acknowledges or resolves; every step is recorded."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app.alerts.service import Alerts
from app.institutions.api import Actor, who

router = APIRouter(prefix="/api/v1", tags=["alerts"])


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid")
    note: Annotated[str, Field(max_length=500)] | None = None


def svc(request: Request) -> Alerts:
    return request.app.state.alerts


@router.get("/alerts:summary", summary="Counts to review by level and team (the menu badge, the page's strip)")
async def summary(request: Request):
    return await svc(request).summary()


@router.get("/alerts", summary="Alerts, newest change first")
async def alerts(request: Request, status: Literal["new", "acknowledged", "resolved"] | None = None,
                 owner: str | None = None, level: Literal["warning", "developing", "adverse"] | None = None,
                 event_id: str | None = None,
                 limit: Annotated[int, Query(ge=1, le=200)] = 100):
    return {"items": await svc(request).all(status, owner, level, limit, None, event_id)}


@router.get("/alerts/{alert_id}", summary="One alert, with its effects, evidence and history")
async def alert(request: Request, alert_id: str):
    return await svc(request).get(alert_id)


@router.post("/alerts/{alert_id}:ack", summary="Acknowledge: someone has looked at it (with an optional note)")
async def ack(request: Request, alert_id: str, body: Note | None = None, actor: Actor = None):
    return await svc(request).act(alert_id, "ack", who(actor, None)[0], (body or Note()).note)


@router.post("/alerts/{alert_id}:resolve", summary="Resolve: nothing more to do")
async def resolve(request: Request, alert_id: str, body: Note | None = None, actor: Actor = None):
    return await svc(request).act(alert_id, "resolve", who(actor, None)[0], (body or Note()).note)


@router.post("/alerts/{alert_id}:reopen", summary="Back to review")
async def reopen(request: Request, alert_id: str, actor: Actor = None):
    return await svc(request).act(alert_id, "reopen", who(actor, None)[0], None)
