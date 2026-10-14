"""The Scenario Studio (/api/v1/studio). Scenarios are
built from templates for an institution (default INSTITUTION_ID); one simulation runs at a time,
moved by the Studio page with :step."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app import settings
from app.institutions.api import Actor, who
from app.studio.service import Studio

router = APIRouter(prefix="/api/v1/studio", tags=["scenario studio"])
Intensity = Literal["low", "medium", "high"]


def svc(request: Request) -> Studio:
    return request.app.state.studio


def iid(institution_id: str | None) -> str:
    return institution_id or settings.raw("INSTITUTION_ID")


class HeadlineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(pattern=r"^[a-z0-9-]{1,24}$")] = Field(description="A template headline's id (h1…) or the page's own (c-…).")
    title: Annotated[str, Field(min_length=8, max_length=200)]
    day: Annotated[int, Field(ge=1, le=21)] = Field(description="The scenario day it is published, 1 to 21.")
    time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] = "09:00"


class PriceMoveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Literal["none", "weaker", "stronger"] = Field(description="The home currency against the US dollar.")
    size_pct: Annotated[float, Field(ge=0, le=30)] = 0
    ramp_days: Annotated[int, Field(ge=1, le=15)] = 5


class CustomIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    headlines: Annotated[list[HeadlineIn], Field(max_length=30)] | None = Field(
        None, description="The scenario's whole headline list, in place of the template's.")
    prices: PriceMoveIn | None = Field(None, description="The price move (a blank scenario).")

    @model_validator(mode="after")
    def _unique(self):
        ids = [h.id for h in self.headlines or []]
        if len(ids) != len(set(ids)):
            raise ValueError("headline ids must be unique")
        return self


class ScenarioIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str = Field(description="A template, or 'blank' to write your own.")
    institution_id: str | None = None
    intensity: Intensity = "medium"
    title: Annotated[str, Field(max_length=120)] | None = None
    custom: CustomIn | None = None


class ScenarioPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intensity: Intensity | None = None
    switched_off: list[str] | None = Field(None, max_length=20, description="Headline ids, story keys or 'prices'.")
    title: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    custom: CustomIn | None = Field(None, description="Headlines and price move; what is given replaces what was there.")


class SimulationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_id: str
    mode: Literal["live", "record", "replay"] = "live"


class StepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_step: int | None = Field(None, description="The step the page last saw; another one gives 409 step_moved.")


@router.get("/templates", summary="Templates, and whether each can run for the institution")
async def templates(request: Request, institution_id: str | None = None):
    return {"items": await svc(request).templates(iid(institution_id))}


@router.get("/scenarios", summary="The institution's scenarios")
async def scenarios(request: Request, institution_id: str | None = None):
    return {"items": await svc(request).scenarios(iid(institution_id))}


@router.post("/scenarios", status_code=201, summary="A scenario from a template, built for the institution")
async def create(request: Request, body: ScenarioIn, actor: Actor = None):
    return await svc(request).create_scenario(iid(body.institution_id), body.template_id, body.intensity, body.title,
                                              who(actor, None)[0], _custom(body.custom))


@router.get("/scenarios/{scenario_id}", summary="A scenario: what it plays (headlines, prices, monitor, stories)")
async def scenario(request: Request, scenario_id: str):
    return await svc(request).scenario(scenario_id)


@router.patch("/scenarios/{scenario_id}",
              summary="Change the intensity, headlines, price move or title, switch parts off (a new version: record it again)")
async def update(request: Request, scenario_id: str, body: ScenarioPatch):
    return await svc(request).update_scenario(scenario_id, body.intensity, body.switched_off, body.title, _custom(body.custom))


def _custom(c: CustomIn | None) -> dict | None:
    return c.model_dump(mode="json", exclude_none=True) if c else None


@router.delete("/scenarios/{scenario_id}", status_code=204)
async def delete(request: Request, scenario_id: str):
    await svc(request).delete_scenario(scenario_id)


@router.post("/simulations", status_code=201, summary="Start a simulation (clears the Studio's world; one at a time)")
async def start(request: Request, body: SimulationIn, actor: Actor = None):
    return await svc(request).start(body.scenario_id, body.mode, who(actor, None)[0])


@router.get("/simulations/current", summary="The running simulation, if any")
async def current(request: Request):
    return {"simulation": await svc(request).current()}


@router.get("/simulations/{sim_id}", summary="A simulation: clock, timeline (after seq `since`), prices, events, summary")
async def simulation(request: Request, sim_id: str, since: Annotated[int, Query(ge=0)] = 0):
    return await svc(request).simulation(sim_id, since)


@router.post("/simulations/{sim_id}:step",
             summary="One step: collect the agents' runs, investigate, or advance the clock a day")
async def step(request: Request, sim_id: str, body: StepIn | None = None):
    return await svc(request).step(sim_id, (body or StepIn()).expected_step)


@router.post("/simulations/{sim_id}:stop", summary="Stop a simulation")
async def stop(request: Request, sim_id: str):
    return await svc(request).stop(sim_id)
