"""Prototype reset: wipe the institution and everything Amiri Agent made for it, so the platform
can be shown again from the start, as for a new institution. That includes the data connection (its approval
and validation switch describe the old institution), its check reports, and the sample institutions' switches
and conditions. Kept: market series and their prices (slow and costly to fetch again), the reference data, the
Metrics Spec and the tick log. Off with PROTOTYPE_RESET=false.

Two ways back: `empty` (the Overview's first run: set up an institution from scratch) or `demo` (the demo bank,
Serendib Commercial Bank, imported and activated, nothing else: no monitors, events or scenarios yet).
"""

import json
import logging
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app import settings
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
    then: Literal["empty", "demo"] = "empty"


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
    if body.then == "demo":
        doc = json.loads((settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())
        inst = request.app.state.institutions
        created = await inst.create(InstitutionCreate(**{**doc["institution"], "institution_id": settings.raw("INSTITUTION_ID")}),
                                    who(actor, None)[0], "import", doc["sections"])
        await inst.set_status(created["institution_id"], "activate", who(actor, None)[0])
        out["institution_id"] = created["institution_id"]
    return out
