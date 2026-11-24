"""The Platform Admin's data connection: import the institution's data (a JSON file), download an example file,
Check, the reports, Approve, and the validation switch."""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from app import demo_lock
from app.connect.service import DataConnection, max_bytes, too_large
from app.institutions.api import Actor, who
from app.mockinst import export

router = APIRouter(prefix="/api/v1", tags=["data connection"])


def svc(request: Request) -> DataConnection:
    return request.app.state.data_connection


class ValidationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.get("/data-connection", summary="The institution's imported data, its approval and the latest check")
async def get_connection(request: Request):
    return await svc(request).view()


@router.post("/data-connection:import", summary="Import the institution's data (amiri-institution-data/1 JSON as the "
             "body); it replaces the data before and needs checking and approving again",
             openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": {
                 "type": "object", "description": "The import format: server/app/connect/IMPORT_FORMAT.md"}}}}})
async def import_data(request: Request, file_name: Annotated[str | None, Query(max_length=200)] = None,
                      actor: Actor = None):
    demo_lock.guard()
    cap = max_bytes()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > cap:
        raise too_large(int(declared))
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > cap:
            raise too_large(size)
        chunks.append(chunk)
    return await svc(request).import_(b"".join(chunks), file_name, who(actor, None)[0])


@router.get("/data-connection:example", summary="An example file in the import format: the sample bank (or insurer, "
            "for an insurer) shaped by this installation's profile, with a planted scenario",
            response_class=Response,
            responses={200: {"content": {"application/json": {}}, "description": "amiri-institution-data/1"}})
async def example(request: Request, scenario: Annotated[str | None, Query(
        max_length=200, description="Comma-separated data conditions to plant (e.g. remittances_fall), or none; "
        "default: the demo's own (the bank: remittances_fall; the insurer: floods)")] = None):
    body, name = await export.example(request.app.state.institutions, svc(request).clock, scenario)
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/data-connection:check", status_code=201, summary="Check the imported data now; the report")
async def check(request: Request, actor: Actor = None):
    return await svc(request).check(who(actor, None)[0])


@router.get("/data-connection/checks", summary="The latest checks, newest first")
async def checks(request: Request):
    return {"items": await svc(request).checks()}


@router.get("/data-connection/checks/{check_id}", summary="One check's full report")
async def report(request: Request, check_id: str):
    return await svc(request).report(check_id)


@router.post("/data-connection:approve", summary="Approve the data the latest check describes")
async def approve(request: Request, actor: Actor = None):
    demo_lock.guard()
    return await svc(request).approve(who(actor, None)[0])


@router.put("/validation", summary="Switch validation against the institution's data on or off")
async def put_validation(request: Request, body: ValidationIn, actor: Actor = None):
    demo_lock.guard()
    return await svc(request).set_validation(body.enabled, who(actor, None)[0])
