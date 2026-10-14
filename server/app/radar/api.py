"""Radar (/api/v1/radar): its status, stories and runs, and the actions on a
story. Radar serves the institution this installation serves (INSTITUTION_ID)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from app.institutions.api import Actor, who
from app.radar.service import Radar

router = APIRouter(prefix="/api/v1", tags=["radar"])


def svc(request: Request) -> Radar:
    return request.app.state.radar


@router.get("/radar:status", summary="Connected; schedule; the last run's funnel; today's BigQuery bytes against the cap")
async def status(request: Request):
    return await svc(request).status()


@router.post("/radar:run", status_code=202, summary="Check now: a run at once (the daily byte cap applies)")
async def run_now(request: Request, actor: Actor = None):
    return await svc(request).run_now(who(actor, None)[0])


@router.get("/radar/runs", summary="Radar runs, newest first")
async def runs(request: Request, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    return {"items": await svc(request).runs(limit)}


@router.get("/radar/runs/{run_id}", summary="One run (a running one is asked for its status first)")
async def run(request: Request, run_id: str):
    return await svc(request).check(run_id)


@router.get("/radar/stories", summary="Stories, newest first, with their finding, event and a monitor hint")
async def stories(request: Request, status: Literal["sent", "below", "dismissed"] | None = None,
                  place: str | None = None, theme: str | None = None,
                  limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).stories(status, place, theme, limit)}


@router.get("/radar/stories/{story_id}", summary="One story")
async def story(request: Request, story_id: str):
    return await svc(request).story(story_id)


@router.post("/radar/stories/{story_id}:investigate", summary="Send a story the agent held back (it becomes a finding)")
async def investigate(request: Request, story_id: str, actor: Actor = None):
    return await svc(request).investigate(story_id, who(actor, None)[0])


@router.post("/radar/stories/{story_id}:dismiss", summary="Hide a story (not one already sent)")
async def dismiss(request: Request, story_id: str, actor: Actor = None):
    return await svc(request).dismiss(story_id, who(actor, None)[0])


@router.post("/radar/stories/{story_id}:restore", summary="Bring a dismissed story back")
async def restore(request: Request, story_id: str, actor: Actor = None):
    return await svc(request).dismiss(story_id, who(actor, None)[0], restore=True)
