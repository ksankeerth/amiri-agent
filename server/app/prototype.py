"""Prototype reset: the only way to start again is to import a new institution JSON file. The reset wipes the
institution and everything AMIRI Agent made for it, then loads the file you send as the new institution. That includes the
data connection (its approval and validation switch describe the old institution), its check reports, and the imported
data. Kept: market series and their prices (slow and costly to fetch again), the reference data, the Metrics Spec and
the tick log. Off with PROTOTYPE_RESET=false.

POST /prototype:reset takes {confirm: "RESET", profile: {institution, sections}}, the same shape as
POST /institutions:import and as the file Settings downloads. The profile is checked first, with the checks creating
an institution applies (schema, create rules, every section and item rule, the database's constraints, and that it is
complete enough to go live), in a transaction that is always rolled back. If anything is wrong the answer is a 422
and nothing is wiped. Only then are the tables emptied, the profile imported (source `import`, id forced to the
installation's INSTITUTION_ID) and the institution activated: no monitors, events or scenarios yet.
The old `then` choice (empty, demo-bank, demo-insurer) is gone and answers 422.

POST /prototype:demo loads a demo on an empty platform (the first screen's buttons). It works only while no
institution exists, so it never overwrites anything, and it doesn't need the reset to be switched on.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, model_validator

from app import demo, demo_lock, settings
from app.institutions.api import Actor, ImportBody, who
from app.institutions.schemas import InstitutionCreate
from app.problems import Problem
from app.tick import TICK_LOCK

router = APIRouter(prefix="/api/v1", tags=["prototype"])
log = logging.getLogger("amiri.prototype")

SCHEMAS = ("assistant", "cases", "core", "studio", "ops")  # all of it is the institution's
SIGNALS = ("signals.findings", "signals.monitor_runs", "signals.radar_runs", "signals.radar_stories")


class ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: Literal["RESET"]
    profile: ImportBody

    @model_validator(mode="before")
    @classmethod
    def _needs_a_profile(cls, data):
        if isinstance(data, dict) and ("then" in data or "profile" not in data):
            raise ValueError("Reset now needs a JSON profile to load: send {confirm: \"RESET\", profile: "
                             "{institution, sections}}, the file Settings downloads. The empty and demo choices are gone.")
        return data


class DemoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: demo.Kind


async def _load_demo(request: Request, kind: demo.Kind, actor: Actor) -> dict:
    """The demo institution imported and activated (one institution per platform: the installation's id)."""
    doc = demo.profile(kind)
    inst = request.app.state.institutions
    body = {k: v for k, v in doc["institution"].items() if k != "institution_id"}
    created = await inst.create(InstitutionCreate(**body, institution_id=settings.raw("INSTITUTION_ID")),
                                who(actor, None)[0], "import", doc["sections"])
    await inst.set_status(created["institution_id"], "activate", who(actor, None)[0])
    return {"institution_id": created["institution_id"], "name": demo.DEMOS[kind]["name"], "kind": kind}


@router.post("/prototype:reset", summary="Wipe the institution and all AMIRI Agent made for it, then load a JSON profile (prototype only)")
async def reset(request: Request, body: ResetIn, actor: Actor = None):
    demo_lock.guard()
    if not settings.flag("PROTOTYPE_RESET"):
        raise Problem(403, "reset_off", "Reset is switched off on this server (PROTOTYPE_RESET).")
    who_ = who(actor, None)[0]
    inst = request.app.state.institutions
    iid = settings.raw("INSTITUTION_ID")
    profile = body.profile.institution.model_copy(update={"institution_id": iid})
    await inst.validate_profile(profile, body.profile.sections, who_)  # a 422 here wipes nothing
    log.warning("prototype reset by %s: starting again as %s", who_, profile.name)
    pool = request.app.state.pool
    async with pool.connection() as lock:
        cur = await lock.execute("SELECT pg_try_advisory_lock(%s) AS ok", (TICK_LOCK,))
        if not (await cur.fetchone())["ok"]:
            raise Problem(409, "busy", "Background work or a simulation step is running; try again in a moment.")
        try:
            async with pool.connection() as conn, conn.transaction():
                cur = await conn.execute(
                    """SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
                       WHERE table_type = 'BASE TABLE' AND table_schema = ANY(%s)""", (list(SCHEMAS),))
                tables = [r["t"] for r in await cur.fetchall()] + list(SIGNALS)
                await conn.execute(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
                await conn.execute("UPDATE signals.series SET last_finding_id = NULL, last_finding_at = NULL")
        finally:
            await lock.execute("SELECT pg_advisory_unlock(%s)", (TICK_LOCK,))
    log.info("prototype reset: %d tables emptied", len(tables))
    created = await inst.create(profile, who_, "import", body.profile.sections)
    await inst.set_status(created["institution_id"], "activate", who_)
    return {"reset": True, "institution_id": created["institution_id"], "name": created["name"],
            "kept": ["market series and prices", "reference data"]}


@router.post("/prototype:demo", summary="Load a demo institution on an empty platform (the first screen)")
async def load_demo(request: Request, body: DemoIn, actor: Actor = None):
    demo_lock.guard()
    if await request.app.state.institutions.list_institutions(None):
        raise Problem(409, "not_empty", "An institution is already set up. To start again, use Start again from a JSON "
                                        "file (Platform Admin, Settings).")
    log.info("demo %s loaded on an empty platform by %s", body.kind, who(actor, None)[0])
    return await _load_demo(request, body.kind, actor)
