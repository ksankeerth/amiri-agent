"""Market series API (/api/v1). No role checks here: roles are applied in the web app."""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Query, Request, Response

from app.series.schemas import (
    BarsPage,
    FindingList,
    LookupResult,
    ProviderCallList,
    RefreshResult,
    SeriesCreate,
    SeriesList,
    SeriesPatch,
    SeriesStatus,
    SeriesView,
    SimulateIn,
    SimulateResult,
)
from app.series.service import MarketSeries

router = APIRouter(prefix="/api/v1", tags=["market series"])


def svc(request: Request) -> MarketSeries:
    return request.app.state.series


@router.get("/series", response_model=SeriesList, summary="Every watched series, with its latest state")
async def list_series(request: Request):
    return {"items": await svc(request).list_all()}


@router.get("/series:status", response_model=SeriesStatus,
            summary="Prototype limits, the fetch schedule and Twelve Data credits")
async def series_status(request: Request):
    return await svc(request).status()


@router.get("/series:lookup", response_model=LookupResult,
            summary="Search Twelve Data symbols (for the add form; 1 credit, cached 24 h)")
async def lookup(request: Request, q: Annotated[str, Query(min_length=1, max_length=40)]):
    return await svc(request).lookup(q)


@router.post("/series", response_model=SeriesView, status_code=201,
             summary="Watch a new symbol: checks it with Twelve Data and reads its history")
async def create_series(request: Request, body: SeriesCreate, response: Response):
    out = await svc(request).create(body.model_dump(exclude_unset=True))
    response.headers["Location"] = f"/api/v1/series/{out['series_id']}"
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.get("/series/{series_id}", response_model=SeriesView)
async def get_series(request: Request, series_id: str, response: Response):
    out = await svc(request).get(series_id)
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.patch("/series/{series_id}", response_model=SeriesView,
              summary="Change name, theme, places, detector settings; pause or resume")
async def patch_series(request: Request, series_id: str, body: SeriesPatch, response: Response,
                       if_match: Annotated[str | None, Header()] = None):
    out = await svc(request).update(series_id, body.model_dump(), body.model_fields_set, if_match)
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.delete("/series/{series_id}", status_code=204,
               summary="Stop watching: removes the series and its bars; its findings stay")
async def delete_series(request: Request, series_id: str):
    await svc(request).delete(series_id)
    return Response(status_code=204)


@router.post("/series/{series_id}:refresh", response_model=RefreshResult,
             summary="Fetch the latest bars now (the Refresh button)")
async def refresh_series(request: Request, series_id: str):
    return await svc(request).refresh(series_id)


@router.post("/series/{series_id}:simulate", response_model=SimulateResult,
             summary="Test move: a made-up bar after the latest one; a sandbox finding if it fires (live data unchanged)")
async def simulate_move(request: Request, series_id: str, body: SimulateIn):
    return await svc(request).simulate(series_id, body.change_pct)


@router.get("/series/{series_id}/bars", response_model=BarsPage, response_model_by_alias=True,
            summary="Closed bars for the chart: hourly, or daily built from the hourly bars")
async def series_bars(
    request: Request,
    series_id: str,
    from_: Annotated[datetime, Query(alias="from")],
    until: Annotated[datetime, Query()],
    interval: Annotated[Literal["1h", "1d"], Query()] = "1h",
):
    return await svc(request).bars(series_id, from_, until, interval)


@router.get("/series/{series_id}/fetches", response_model=ProviderCallList,
            summary="The fetch log: every call to Twelve Data for this series, errors as raised")
async def series_fetches(request: Request, series_id: str,
                         limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).fetches(series_id, limit)}


@router.get("/series/{series_id}/findings", response_model=FindingList,
            summary="Moves this series fired")
async def series_findings(request: Request, series_id: str,
                          limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return {"items": await svc(request).findings(series_id, limit)}
