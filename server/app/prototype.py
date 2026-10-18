"""Prototype reset: wipe the institution and everything Amiri Agent made for it, so the platform
can be shown again from the start, as for a new institution. That includes the data connection (its approval
and validation switch describe the old institution), its check reports, and the sample institutions' switches
and conditions. Kept: market series and their prices (slow and costly to fetch again), the reference data, the
Metrics Spec and the tick log. Off with PROTOTYPE_RESET=false.

Three ways back: `empty` (the Overview's first run: set up an institution from scratch), `demo-bank` (the demo bank,
Serendib Commercial Bank, Sri Lanka) or `demo-insurer` (the demo insurer, Samudra Raya General Insurance, Indonesia),
imported and activated, nothing else: no monitors, events or scenarios yet. `demo` is the bank (older callers).

POST /prototype:demo loads a demo on an empty platform (the first screen's buttons). It works only while no
institution exists, so it never overwrites anything, and it doesn't need the reset to be switched on.
"""

import logging
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app import demo, settings
from app.institutions.api import Actor, who
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
    then: Literal["empty", "demo", "demo-bank", "demo-insurer"] = "empty"


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


@router.post("/prototype:reset", summary="Wipe the institution and all Amiri Agent made for it (prototype only)")
async def reset(request: Request, body: ResetIn, actor: Actor = None):
    if not settings.flag("PROTOTYPE_RESET"):
        raise Problem(403, "reset_off", "Reset is switched off on this server (PROTOTYPE_RESET).")
    log.warning("prototype reset (then %s) by %s from %s", body.then, who(actor, None)[0],
                request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?"))
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
    out = {"reset": True, "then": body.then, "kept": ["market series and prices", "reference data"]}
    log.info("prototype reset: %d tables emptied", len(tables))
    if body.then != "empty":
        out |= await _load_demo(request, "insurer" if body.then == "demo-insurer" else "bank", actor)
    return out


@router.post("/prototype:demo", summary="Load a demo institution on an empty platform (the first screen)")
async def load_demo(request: Request, body: DemoIn, actor: Actor = None):
    if await request.app.state.institutions.list_institutions(None):
        raise Problem(409, "not_empty", "An institution is already set up. To switch to a demo, reset the prototype "
                                        "(Platform Admin, Settings).")
    log.info("demo %s loaded on an empty platform by %s", body.kind, who(actor, None)[0])
    return await _load_demo(request, body.kind, actor)
