"""Institution profile API (/api/v1). The web app's forms and the assistant both
use it; no role checks here (roles are applied in the web app).

Who made a change: X-Amiri-Actor (an email; IAP later) and X-Amiri-Source
(form | assistant | setup | import | system), recorded in the history.
"""

import json
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, create_model

from app import reference, settings, spec
from app.institutions.schemas import (
    SECTION_LIMITS,
    SECTIONS,
    SUBTYPES,
    Batch,
    InstitutionCreate,
    InstitutionFields,
    InstitutionPatch,
    Operation,
)
from app.institutions.service import SOURCES, Institutions
from app.problems import Problem

router = APIRouter(prefix="/api/v1", tags=["institution profile"])
ref_router = APIRouter(prefix="/api/v1/reference", tags=["reference data"])

Actor = Annotated[str | None, Header(alias="X-Amiri-Actor", description="Who is making the change (email).")]
Source = Annotated[str | None, Header(alias="X-Amiri-Source", description="form | assistant | setup | import | system")]
IfMatch = Annotated[str | None, Header(alias="If-Match", description="The version you last read; a newer one gives 409.")]


def svc(request: Request) -> Institutions:
    return request.app.state.institutions


def who(actor: str | None, source: str | None) -> tuple[str, str]:
    s = (source or "form").lower()
    if s not in SOURCES:
        raise Problem(400, "bad_request", f"X-Amiri-Source is one of {', '.join(SOURCES)}.")
    return (actor or "anonymous")[:120], s


def version_of(if_match: str | None) -> int | None:
    if if_match is None:
        return None
    try:
        return int(if_match.strip().strip('"').removeprefix("W/").strip('"'))
    except ValueError as e:
        raise Problem(400, "bad_request", "If-Match is the version number, e.g. \"3\".") from e


# ---------------------------------------------------------------- response models


class InstitutionView(InstitutionFields):
    model_config = ConfigDict(extra="allow")
    institution_id: str
    status: Literal["setup", "active", "archived"]
    version: int
    profile_version: int
    created_at: datetime
    updated_at: datetime
    activated_at: datetime | None
    archived_at: datetime | None
    counts: dict[str, int]


class InstitutionSummary(BaseModel):
    institution_id: str
    name: str
    institution_type: str
    status: str
    home_country: str
    profile_version: int
    items: int
    updated_at: datetime


class Change(BaseModel):
    section: str
    id: str | None
    op: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class Note(BaseModel):
    model_config = ConfigDict(extra="allow")
    section: str | None = None
    id: str | None = None
    code: str
    message: str


class OpResult(BaseModel):
    index: int
    op: str
    section: str
    id: str | None
    version: int | None
    item: dict[str, Any] | None


class BatchResult(BaseModel):
    institution_id: str
    dry_run: bool
    profile_version: int
    results: list[OpResult]
    changes: list[Change]
    warnings: list[Note]


class Check(BaseModel):
    id: str
    level: Literal["required", "recommended", "info"]
    ok: bool
    message: str
    section: str
    fix: str


class Readiness(BaseModel):
    institution_id: str
    status: str
    ready: bool
    missing_required: int
    open_recommendations: int
    checks: list[Check]
    warnings: list[Note]


class Profile(BaseModel):
    institution: InstitutionView
    sections: dict[str, list[dict[str, Any]]]
    place_names: dict[str, str | None]
    places: dict[str, dict[str, Any]]
    origins: dict[str, dict[str, dict[str, Any]]] = Field(
        description="How each item got there: section → item id → {source (form, assistant, setup, import), by, at, proposal_id, last_*}.")
    readiness: dict[str, Any]


class ImportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    institution: InstitutionCreate
    sections: dict[str, list[dict[str, Any]]] = Field(
        default_factory=dict, description="Items per section, as GET /profile returns them (ids kept; versions ignored).")


class HistoryRow(BaseModel):
    change_id: int
    profile_version: int
    at: datetime
    actor: str
    source: str
    batch_id: str
    section: str
    item_id: str | None
    op: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    proposal_id: str | None = None


class History(BaseModel):
    items: list[HistoryRow]
    next_before: int | None


class Suggestion(BaseModel):
    model_config = ConfigDict(extra="allow")
    added: bool
    item: dict[str, Any]


class Suggestions(BaseModel):
    section: str
    note: str
    items: list[Suggestion]


# ---------------------------------------------------------------- institutions


@router.get("/institutions", response_model=list[InstitutionSummary], summary="Institutions in this installation")
async def list_institutions(request: Request, status: Literal["setup", "active", "archived"] | None = None):
    return await svc(request).list_institutions(status)


@router.post("/institutions", response_model=InstitutionView, status_code=201,
             summary="Create an institution (status setup); its home country joins the footprint")
async def create_institution(request: Request, body: InstitutionCreate, response: Response,
                             actor: Actor = None, source: Source = None):
    a, s = who(actor, source)
    out = await svc(request).create(body, a, s)
    if actor:  # the person's setup chat, begun before the institution existed, becomes its chat
        await request.app.state.assistant.attach_user_thread(a, out["institution_id"])
    response.headers["Location"] = f"/api/v1/institutions/{out['institution_id']}"
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.post("/institutions:import", response_model=InstitutionView, status_code=201,
             summary="Create an institution with its whole profile in one step (seeds, sandboxes, copies)")
async def import_institution(request: Request, body: ImportBody, actor: Actor = None):
    a, _ = who(actor, "import")
    out = await svc(request).create(body.institution, a, "import", body.sections)
    if actor:
        await request.app.state.assistant.attach_user_thread(a, out["institution_id"])
    return out


@router.get("/institutions/{institution_id}", response_model=InstitutionView)
async def get_institution(request: Request, institution_id: str, response: Response):
    out = await svc(request).get(institution_id)
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.patch("/institutions/{institution_id}", response_model=InstitutionView,
              summary="Change the institution's own fields (If-Match: its version)")
async def patch_institution(request: Request, institution_id: str, body: InstitutionPatch, response: Response,
                            if_match: IfMatch = None, actor: Actor = None, source: Source = None):
    a, s = who(actor, source)
    data = body.model_dump(mode="json", include=body.model_fields_set)
    await svc(request).batch(institution_id, [Operation(op="update", section="institution", data=data,
                                                        if_version=version_of(if_match))], a, s)
    out = await svc(request).get(institution_id)
    response.headers["ETag"] = f'"{out["version"]}"'
    return out


@router.delete("/institutions/{institution_id}", status_code=204,
               summary="Delete an institution still in setup (archive an active one instead)")
async def delete_institution(request: Request, institution_id: str):
    await svc(request).delete(institution_id)
    return Response(status_code=204)


@router.post("/institutions/{institution_id}:activate", response_model=InstitutionView,
             summary="Go live: needs every required readiness check to pass")
async def activate(request: Request, institution_id: str, actor: Actor = None):
    return await svc(request).set_status(institution_id, "activate", who(actor, None)[0])


@router.post("/institutions/{institution_id}:archive", response_model=InstitutionView)
async def archive(request: Request, institution_id: str, actor: Actor = None):
    return await svc(request).set_status(institution_id, "archive", who(actor, None)[0])


@router.post("/institutions/{institution_id}:restore", response_model=InstitutionView)
async def restore(request: Request, institution_id: str, actor: Actor = None):
    return await svc(request).set_status(institution_id, "restore", who(actor, None)[0])


@router.post("/institutions/{institution_id}:batch", response_model=BatchResult,
             summary="Apply many changes at once, all or nothing; dry_run shows the result without saving")
async def batch(request: Request, institution_id: str, body: Batch, response: Response,
                if_match: IfMatch = None, actor: Actor = None, source: Source = None):
    a, s = who(actor, source)
    out = await svc(request).batch(institution_id, body.operations, a, s, body.dry_run,
                                   body.if_profile_version if body.if_profile_version is not None else version_of(if_match))
    response.headers["ETag"] = f'"{out["profile_version"]}"'
    return out


@router.get("/institutions/{institution_id}/profile", response_model=Profile,
            summary="Everything in one call (the Institution page); ETag: the profile version")
async def profile(request: Request, institution_id: str, response: Response):
    out = await svc(request).profile(institution_id)
    response.headers["ETag"] = f'"{out["institution"]["profile_version"]}"'
    return out


@router.get("/institutions/{institution_id}/context",
            summary="The compact profile agents read, with the derived Radar scope")
async def context(request: Request, institution_id: str):
    return await svc(request).context(institution_id)


@router.get("/institutions/{institution_id}/readiness", response_model=Readiness,
            summary="What's done and what's missing (a checklist; no score)")
async def readiness(request: Request, institution_id: str):
    return await svc(request).readiness_for(institution_id)


@router.get("/institutions/{institution_id}/history", response_model=History,
            summary="Every change, newest first (page with before=next_before)")
async def history(request: Request, institution_id: str, section: str | None = None, item_id: str | None = None,
                  limit: Annotated[int, Query(ge=1, le=200)] = 50, before: int | None = None,
                  since_version: Annotated[int | None, Query(description="Only changes after this profile version.")] = None,
                  source: Annotated[str | None, Query(description="form, assistant, setup, import or system")] = None):
    return await svc(request).history(institution_id, section, item_id, limit, before, since_version, source)


@router.get("/institutions/{institution_id}/history/batches/{batch_id}/undo",
            summary="The operations that would undo one change (a form save, an import, an applied proposal); not applied")
async def undo(request: Request, institution_id: str, batch_id: str):
    return await svc(request).undo(institution_id, batch_id)


@router.get("/institutions/{institution_id}/suggestions/{section}", response_model=Suggestions,
            summary="Code-made suggestions (products, segments, regulators, flows, rivals; the risk finder), in create shape")
async def suggestions(request: Request, institution_id: str,
                      section: Literal["products", "segments", "regulators", "flows", "risk-exposures", "rivals"]):
    return await svc(request).suggestions(institution_id, section)


# ---------------------------------------------------------------- one set of routes per section


class ItemMeta(BaseModel):
    id: str
    version: int
    created_at: datetime | None
    updated_at: datetime | None
    updated_by: str | None


class UsedBy(BaseModel):
    section: str
    id: str
    field: str


def _section_routes(section: str, model: type[BaseModel]) -> None:
    name = model.__name__
    View = type(f"{name}View", (model, ItemMeta), {"model_config": ConfigDict(extra="allow"), "__module__": __name__})
    Detail = create_model(f"{name}Detail", __base__=View, used_by=(list[UsedBy], []), warnings=(list[Note], []))
    ListOut = create_model(f"{name}List", items=(list[View], ...))
    Created = create_model(f"{name}Saved", item=(View, ...), warnings=(list[Note], []), profile_version=(int, ...))
    Patch = create_model(f"{name}Patch", __config__=ConfigDict(extra="forbid"),
                         **{k: (f.annotation | None, None) for k, f in model.model_fields.items()})
    path = f"/institutions/{{institution_id}}/{section}"
    tag = [f"profile: {section}"]

    async def list_items(request: Request, institution_id: str):
        return {"items": await svc(request).section(institution_id, section)}

    async def create_item(request: Request, institution_id: str, body: model, response: Response,  # type: ignore[valid-type]
                          id: Annotated[str | None, Query(description="Your own id; default from the name.")] = None,
                          actor: Actor = None, source: Source = None):
        a, s = who(actor, source)
        out = await svc(request).batch(institution_id, [Operation(op="create", section=section, id=id,
                                                                  data=body.model_dump(mode="json"))], a, s)
        r = out["results"][0]
        response.headers["Location"] = f"/api/v1/institutions/{institution_id}/{section}/{r['id']}"
        response.headers["ETag"] = f'"{r["version"]}"'
        return {"item": r["item"], "warnings": out["warnings"], "profile_version": out["profile_version"]}

    async def get_item(request: Request, institution_id: str, item_id: str, response: Response):
        out = await svc(request).item(institution_id, section, item_id)
        response.headers["ETag"] = f'"{out["version"]}"'
        return out

    async def patch_item(request: Request, institution_id: str, item_id: str, body: Patch, response: Response,  # type: ignore[valid-type]
                         if_match: IfMatch = None, actor: Actor = None, source: Source = None):
        a, s = who(actor, source)
        data = body.model_dump(mode="json", include=body.model_fields_set)
        out = await svc(request).batch(institution_id, [Operation(op="update", section=section, id=item_id, data=data,
                                                                  if_version=version_of(if_match))], a, s)
        r = out["results"][0]
        response.headers["ETag"] = f'"{r["version"]}"'
        return {"item": r["item"], "warnings": out["warnings"], "profile_version": out["profile_version"]}

    async def delete_item(request: Request, institution_id: str, item_id: str, if_match: IfMatch = None,
                          force: Annotated[bool, Query(description="Also remove references to it from other items.")] = False,
                          actor: Actor = None, source: Source = None):
        a, s = who(actor, source)
        await svc(request).batch(institution_id, [Operation(op="delete", section=section, id=item_id, force=force,
                                                            if_version=version_of(if_match))], a, s)
        return Response(status_code=204)

    router.add_api_route(path, list_items, methods=["GET"], response_model=ListOut, tags=tag,
                         name=f"list_{section}", summary=f"List {section}")
    router.add_api_route(path, create_item, methods=["POST"], response_model=Created, status_code=201, tags=tag,
                         name=f"create_{section}", summary=f"Add to {section}")
    router.add_api_route(f"{path}/{{item_id}}", get_item, methods=["GET"], response_model=Detail, tags=tag,
                         name=f"get_{section}", summary="One item, with what uses it and its warnings")
    router.add_api_route(f"{path}/{{item_id}}", patch_item, methods=["PATCH"], response_model=Created, tags=tag,
                         name=f"patch_{section}", summary="Change some fields (If-Match: the item's version)")
    router.add_api_route(f"{path}/{{item_id}}", delete_item, methods=["DELETE"], status_code=204, tags=tag,
                         name=f"delete_{section}", summary="Delete (409 in_use unless force)")


for _section, _model in SECTIONS.items():
    _section_routes(_section, _model)


# ---------------------------------------------------------------- reference data


@ref_router.get("/countries", summary="ISO 3166-1 countries (scope=home: those a home country may be, SUPPORTED_REGION)")
async def countries(q: str | None = None, scope: Literal["all", "home"] = "all"):
    items = reference.countries()
    region = reference.region() if scope == "home" else None
    if region:
        items = [c for c in items if c["code"] in region["countries"]]
    if q:
        k = q.casefold()
        items = [c for c in items if k in c["name"].casefold() or k == c["code"].casefold()]
    return {"items": items, "region": {"id": region["id"], "label": region["label"]} if region else None}


@ref_router.get("/countries/{code}/regions", summary="ISO 3166-2 regions of a country (provinces, states, districts)")
async def regions(code: str):
    code = code.upper()
    if not reference.is_country(code):
        raise Problem(404, "not_found", f"No country {code}.")
    return {"country": code, "items": reference.regions(code)}


@ref_router.get("/places", summary="Search places: ISO countries and regions, and gazetteer places (chokepoints, seas, ports, cities)")
async def places(q: str = "", kind: str | None = None, country: str | None = None,
                 limit: Annotated[int, Query(ge=1, le=400)] = 50):
    return {"items": reference.search_places(q, kind, country.upper() if country else None, limit)}


@ref_router.get("/places/{code}", summary="One place, with coordinates when the gazetteer has them")
async def place(code: str):
    c = code.lower() if ":" in code else code.upper()
    if not reference.is_place(c):
        raise Problem(404, "not_found", f"No place {code}.")
    return reference.place_info(c)


@ref_router.get("/routes", summary="Sea routes with their points and the places they pass")
async def routes():
    return {"items": [{**r, "places": [reference.place_info(p) for p in r["places"]]} for r in reference.routes()]}


@ref_router.get("/hazards", summary="The hazard library the risk finder uses")
async def hazards():
    return {"items": reference.hazards()}


@ref_router.get("/regulators/{regulator_id}", summary="One entry of the rule table, in the shape of a regulator item")
async def rule_table_entry(regulator_id: str):
    r = reference.regulator(regulator_id)
    if r is None:
        raise Problem(404, "not_found", f"No regulator {regulator_id} in the rule table.")
    return {"regulator_id": r["regulator_id"], "name": r["name"], "short": r.get("short"), "country": r.get("country"),
            "area": r["area"], "basis": "rule", "rule_ref": r["regulator_id"], "controls": r.get("controls", []),
            "relation": r.get("relation") or ("standard" if r.get("country") is None else "home")}


@ref_router.get("/demo-profile", summary="The demo bank's whole profile (sample data), in the import format")
async def demo_profile():
    from fastapi.responses import JSONResponse

    from app import settings as _settings

    doc = json.loads((_settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())
    return JSONResponse(doc, headers={"Content-Disposition": 'attachment; filename="amiri-demo-profile.json"'})


@ref_router.get("/currencies", summary="ISO 4217 currencies (scope=home: those a base currency may be, SUPPORTED_REGION)")
async def currencies(scope: Literal["all", "home"] = "all"):
    items = reference.currencies()
    region = reference.region() if scope == "home" else None
    if region:
        items = [c for c in items if c["code"] in region["currencies"]]
    return {"items": items, "region": {"id": region["id"], "label": region["label"]} if region else None}


@router.get("/installation", summary="The institution this installation serves (INSTITUTION_ID), for the web app's frame")
async def installation(request: Request):
    return {**await _installation(request), "prototype_reset": bool(settings.flag("PROTOTYPE_RESET"))}


async def _installation(request: Request) -> dict:
    iid = settings.raw("INSTITUTION_ID")
    try:
        i = await svc(request).get(iid)
    except Problem:
        if settings.flag("SINGLE_INSTITUTION") and not await svc(request).list_institutions(None):
            return {"institution_id": iid, "profile": False, "name": None, "time_zone": "UTC", "notes": []}  # first run
        return {"institution_id": iid, "profile": False, "name": None, "time_zone": "UTC",
                "notes": [f"INSTITUTION_ID is {iid}, which has no profile: findings are written for it and "
                          "can't be investigated. Set INSTITUTION_ID to the profile's id."]}
    return {"institution_id": iid, "profile": True, "name": i["name"], "short_name": i.get("short_name"),
            "institution_type": i["institution_type"], "home_country": i["home_country"],
            "country_name": reference.place_name(i["home_country"]), "base_currency": i["base_currency"],
            "time_zone": i["time_zone"], "status": i["status"], "notes": []}


@ref_router.get("/time-zones", summary="IANA time zones")
async def time_zones():
    return {"items": reference.time_zones()}


@ref_router.get("/institution-types", summary="Institution types and their subtypes")
async def institution_types():
    return {"items": [{"institution_type": t, "subtypes": s} for t, s in SUBTYPES.items()]}


@ref_router.get("/product-taxonomy", summary="Metrics Spec product categories and types, for a bank or an insurer")
async def product_taxonomy(institution_type: Literal["bank", "insurer"] | None = None):
    return {"spec_version": spec.spec()["spec_version"], "items": spec.categories(institution_type)}


@ref_router.get("/segment-dimensions", summary="Metrics Spec dimensions a customer group can map to")
async def segment_dimensions():
    return {"items": [{"dimension": k, **v} for k, v in spec.spec()["dimensions"].items() if k in spec.SEGMENT_DIMENSIONS]}


@ref_router.get("/themes", summary="Themes (Metrics Spec ids) with their directions and items")
async def themes():
    t = reference.themes()
    return {"items": [{"theme": k, "meaning": v, "directions": [{"direction": d, "meaning": m}
                                                                for d, m in t.get(k, {}).get("directions", {}).items()],
                       "items": t.get(k, {}).get("items", []), "sector": bool(t.get(k, {}).get("sector")),
                       "currency": bool(t.get(k, {}).get("currency"))}
                      for k, v in spec.spec()["themes"].items()]}


@ref_router.get("/profile-schema", summary="JSON Schema of the institution and every section, with limits (for forms)")
async def profile_schema():
    return {"institution": InstitutionCreate.model_json_schema(),
            "sections": {k: m.model_json_schema() for k, m in SECTIONS.items()},
            "limits": SECTION_LIMITS}
