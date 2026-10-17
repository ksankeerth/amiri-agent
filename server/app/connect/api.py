"""The Platform Admin's data connection: the address (or a sample institution), Check, the reports,
Approve, and the validation switch."""

from typing import Annotated, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from app import settings
from app.connect.service import DataConnection
from app.institutions.api import Actor, who

router = APIRouter(prefix="/api/v1", tags=["data connection"])


def svc(request: Request) -> DataConnection:
    return request.app.state.data_connection


def public(request: Request) -> str:
    return settings.raw("SERVER_PUBLIC_URL") or str(request.base_url)


class ConnectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["sample", "url"]
    sample: Literal["bank", "insurer"] | None = None
    base_url: Annotated[str, Field(max_length=500)] | None = None
    openapi_url: Annotated[str, Field(max_length=500)] | None = None
    auth_header: Annotated[str, Field(max_length=80, pattern=r"^[A-Za-z0-9-]+$")] | None = None
    auth_value: Annotated[str, Field(max_length=4000)] | None = Field(None, description="Write only; never returned.")


class ValidationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.get("/data-connection", summary="The institution's data connection, its approval and the latest check")
async def get_connection(request: Request):
    return await svc(request).view(public(request))


@router.put("/data-connection", summary="Set the connection (it needs checking and approving again)")
async def put_connection(request: Request, body: ConnectionIn, actor: Actor = None):
    return await svc(request).put(body.model_dump(), who(actor, None)[0], public(request))


@router.post("/data-connection:check", status_code=201, summary="Check the connection now; the report")
async def check(request: Request, actor: Actor = None):
    return await svc(request).check(who(actor, None)[0])


@router.get("/data-connection/checks", summary="The latest checks, newest first")
async def checks(request: Request):
    return {"items": await svc(request).checks()}


@router.get("/data-connection/checks/{check_id}", summary="One check's full report")
async def report(request: Request, check_id: str):
    return await svc(request).report(check_id)


@router.post("/data-connection:approve", summary="Approve the connection the latest check describes")
async def approve(request: Request, actor: Actor = None):
    return await svc(request).approve(who(actor, None)[0], public(request))


@router.put("/validation", summary="Switch validation against the institution's data on or off")
async def put_validation(request: Request, body: ValidationIn, actor: Actor = None):
    return await svc(request).set_validation(body.enabled, who(actor, None)[0], public(request))
