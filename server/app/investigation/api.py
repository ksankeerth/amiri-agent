"""Findings, investigations and events (/api/v1), and what the investigation agent reads
(/api/v1/internal). No role checks here: roles are applied in the web app."""

import asyncio
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from app import settings
from app.investigation import calendar as cal
from app.investigation import coverage as cov
from app.investigation.service import Investigations
from app.problems import Problem


async def agent_only(authorization: Annotated[str | None, Header()] = None) -> None:
    """INTERNAL_AUTH=id_token: a Google ID token for this server from a listed service account."""
    if settings.raw("INTERNAL_AUTH") != "id_token":
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise Problem(401, "unauthenticated", "A Google ID token is required (Authorization: Bearer).")
    import google.auth.transport.requests
    import google.oauth2.id_token

    try:
        claims = await asyncio.to_thread(google.oauth2.id_token.verify_oauth2_token, authorization[7:],
                                         google.auth.transport.requests.Request(), settings.raw("SERVER_PUBLIC_URL"))
    except ValueError as e:
        raise Problem(401, "unauthenticated", f"The ID token isn't valid: {e}") from e
    if claims.get("email") not in settings.names("INTERNAL_CALLERS"):
        raise Problem(403, "forbidden", f"{claims.get('email')} may not call the internal API.")


router = APIRouter(prefix="/api/v1", tags=["findings and investigations"])
internal = APIRouter(prefix="/api/v1/internal", tags=["for the agents"], dependencies=[Depends(agent_only)])
World = Literal["live", "sandbox", "studio"]


def svc(request: Request) -> Investigations:
    return request.app.state.investigations


class InvestigateNow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    finding_ids: list[str] | None = Field(None, max_length=20, description="Default: every new finding.")
    world: Literal["live", "sandbox"] | None = Field(None, description="Default: both live and sandbox findings "
                                                     "(the Studio's are investigated by its own steps).")


@router.get("/investigation:status", summary="Is the agent connected, is validation on, what is waiting")
async def status(request: Request):
    return await svc(request).status()


@router.get("/findings", summary="Findings from every source, newest first")
async def findings(request: Request, status: Literal["new", "grouped", "linked", "set_aside"] | None = None,
                   world: World | None = None, source: Literal["timeseries", "radar", "monitor"] | None = None,
                   limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).findings(status, world, source, limit)}


@router.get("/findings/{finding_id}", summary="One finding, with what became of it")
async def finding(request: Request, finding_id: str):
    return await svc(request).finding(finding_id)


@router.post("/investigations", status_code=202,
             summary="Investigate new findings now (skips the wait); ones continuing an open event join it instead")
async def investigate_now(request: Request, body: InvestigateNow | None = None):
    body = body or InvestigateNow()
    return await svc(request).start_now(body.finding_ids, body.world)


@router.get("/investigations", summary="Investigation runs, newest first")
async def runs(request: Request, limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).runs(limit)}


@router.get("/investigations/{run_id}", summary="One run: request, result and the readable report")
async def run(request: Request, run_id: str):
    return await svc(request).run(run_id)


@router.post("/investigations/{run_id}:collect", summary="Ask the agent for a running run's result now")
async def collect(request: Request, run_id: str):
    await svc(request).collect(run_id)
    return await svc(request).run(run_id)


@router.get("/events", summary="Events the investigations found, most recent first")
async def events(request: Request, world: World | None = None, status: Literal["open", "closed"] | None = None,
                 limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).events(world, limit, status)}


@router.delete("/sandbox", summary="Clear simulated findings and what their investigations found (live data stays)")
async def clear_sandbox(request: Request):
    return await svc(request).clear_sandbox()


@router.get("/events/{event_id}", summary="One event: findings, what could be affected, tasks, the report")
async def event(request: Request, event_id: str):
    return await svc(request).event(event_id)


# ---------------------------------------------------------------- for the agents


@internal.get("/coverage", summary="What each product can be measured with (assumed from the Metrics Spec)")
async def coverage(request: Request, institution_id: str):
    state = await request.app.state.institutions.state(institution_id)
    return cov.coverage(state)


@internal.get("/calendar", summary="Business days of the institution's home country")
async def calendar(request: Request, institution_id: str, start: date, until: date):
    state = await request.app.state.institutions.state(institution_id)
    f = state.inst["fields"]
    if not f.get("home_country"):
        raise Problem(422, "invalid", "The institution has no home country.")
    return cal.calendar(f["home_country"], f["time_zone"], start, until)
