"""Monitors (/api/v1/monitors): write, approve, run and read them.
Monitors belong to the institution this installation serves (INSTITUTION_ID). No role
checks here: roles are applied in the web app (any Risk Manager approves)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from app import settings
from app.institutions.api import Actor, who
from app.monitors.schemas import ChangesRequested, Draft, MonitorCreate, MonitorPatch
from app.monitors.service import Monitors
from app.problems import Problem

router = APIRouter(prefix="/api/v1", tags=["monitors"])
Status = Literal["draft", "submitted", "live", "paused", "retired"]


def svc(request: Request) -> Monitors:
    return request.app.state.monitors


def institution(institution_id: str | None = None) -> str:
    return institution_id or settings.raw("INSTITUTION_ID")


Inst = Annotated[str | None, Query(description="Default: INSTITUTION_ID (the setup agent passes its thread's institution).")]


@router.get("/monitors:status", summary="Is the monitor agent connected; live monitors and the limit")
async def status(request: Request):
    return await svc(request).status()


@router.get("/monitors", summary="The institution's monitors (retired last)")
async def list_monitors(request: Request, status: Status | None = None, institution_id: Inst = None):
    return {"items": await svc(request).all(institution(institution_id), status)}


@router.post("/monitors", status_code=201, summary="Write a monitor: a draft, version 1")
async def create(request: Request, body: MonitorCreate, actor: Actor = None):
    a, _ = who(actor, None)
    return await svc(request).create(institution(), body.spec, a, note=body.note)


@router.get("/monitors:draftable",
            summary="Profile items a monitor can be drafted from, by code (monitor_id: one already watches it)")
async def draftable(request: Request, institution_id: Inst = None):
    return {"items": await svc(request).draftable(institution(institution_id))}


@router.get("/monitors:template", summary="Code's draft for a profile item, saving nothing (the setup agent's tool)")
async def template(request: Request, section: str, item_id: str, institution_id: Inst = None):
    return await svc(request).template(institution(institution_id), section, item_id)


@router.post("/monitors:draft", status_code=201,
             summary="Draft a monitor from a profile item (code fills the sentence, lines and chips; you check them)")
async def draft(request: Request, body: Draft, actor: Actor = None):
    a, _ = who(actor, None)
    if body.template_id:
        raise Problem(404, "not_found", f"No template {body.template_id}; draft from a profile item.")
    return await svc(request).draft(institution(body.institution_id), body.section, body.item_id, a)


@router.get("/monitor-checks/{run_id}",
            summary="One check: its request, result and findings count (a running one is asked for its status)")
async def check(request: Request, run_id: str):
    return await svc(request).check(run_id)


@router.get("/monitors/{monitor_id}", summary="One monitor: its spec, pending version and history")
async def get(request: Request, monitor_id: str):
    return await svc(request).get(monitor_id)


@router.patch("/monitors/{monitor_id}",
              summary="Change the spec: edits a draft; on a submitted, live or paused monitor makes the next version")
async def update(request: Request, monitor_id: str, body: MonitorPatch, actor: Actor = None):
    a, _ = who(actor, None)
    return await svc(request).update(monitor_id, body.spec, a, body.note)


@router.post("/monitors/{monitor_id}:submit", summary="Send the latest version for approval")
async def submit(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).transition(monitor_id, "submit", who(actor, None)[0])


@router.post("/monitors/{monitor_id}:approve",
             summary="Approve the submitted version: it goes live (or replaces the live one)")
async def approve(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).transition(monitor_id, "approve", who(actor, None)[0])


@router.post("/monitors/{monitor_id}:request-changes", summary="Send the submitted version back, with a note")
async def request_changes(request: Request, monitor_id: str, body: ChangesRequested, actor: Actor = None):
    return await svc(request).transition(monitor_id, "request_changes", who(actor, None)[0], body.note)


@router.post("/monitors/{monitor_id}:pause", summary="Stop checking a live monitor")
async def pause(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).transition(monitor_id, "pause", who(actor, None)[0])


@router.post("/monitors/{monitor_id}:resume", summary="Check a paused monitor again")
async def resume(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).transition(monitor_id, "resume", who(actor, None)[0])


@router.post("/monitors/{monitor_id}:retire", summary="Retire a monitor for good")
async def retire(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).transition(monitor_id, "retire", who(actor, None)[0])


@router.post("/monitors/{monitor_id}:run", status_code=202,
             summary="Check now: a live monitor's live version, or a test of a draft whose findings go to the sandbox")
async def run_now(request: Request, monitor_id: str, actor: Actor = None):
    return await svc(request).run_now(monitor_id, who(actor, None)[0])


@router.get("/monitors/{monitor_id}/runs", summary="The monitor's checks, newest first")
async def runs(request: Request, monitor_id: str, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    return {"items": await svc(request).runs(monitor_id, limit)}


@router.get("/monitors/{monitor_id}/findings", summary="The monitor's findings (live and sandbox), newest first")
async def findings(request: Request, monitor_id: str, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    return {"items": await svc(request).findings(monitor_id, limit)}
