"""The sample institutions' switches and conditions (ops.mock_institutions), and the institution each
one serves today."""

import json
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import settings
from app.clock import Clock
from app.demo import DEMOS
from app.institutions.service import Institutions
from app.mockinst import conditions as cond
from app.mockinst.model import Institution, build
from app.problems import Problem

KINDS = ("bank", "insurer")
SEEDS = {k: v["file"] for k, v in DEMOS.items()}
SEED_DIR = Path(__file__).resolve().parents[1] / "seeds"


def bundled(kind: str) -> dict:
    return json.loads((SEED_DIR / SEEDS[kind]).read_text())


class MockInstitutions:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, clock: Clock):
        self.pool, self.institutions, self.clock = pool, institutions, clock
        self._built: dict[tuple, Institution] = {}
        self.calls: dict[str, int] = {}  # requests per sample, for the 429 fault

    @staticmethod
    def allowed() -> bool:
        return settings.flag("MOCK_INSTITUTIONS")

    async def state(self, kind: str) -> dict:
        if kind not in KINDS:
            raise Problem(404, "not_found", f"No sample {kind}; there is a bank and an insurer.")
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM ops.mock_institutions WHERE kind = %s", (kind,))
            r = await cur.fetchone()
        return {"kind": kind, "enabled": bool(r and r["enabled"]), "conditions": r["conditions"] if r else [],
                "updated_at": r["updated_at"] if r else None, "updated_by": r["updated_by"] if r else None}

    async def put(self, kind: str, enabled: bool, conditions: list[dict], actor: str) -> dict:
        if not self.allowed():
            raise Problem(403, "mock_off", "Sample institutions are switched off on this server (MOCK_INSTITUTIONS).")
        await self.state(kind)  # 404 for an unknown kind
        bad = cond.problems(kind, conditions)
        if bad:
            raise Problem(422, "validation_error", "Some conditions are wrong.",
                          errors=[{"field": "conditions", "message": m} for m in bad])
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO ops.mock_institutions (kind, enabled, conditions, updated_at, updated_by)
                   VALUES (%s, %s, %s, %s, %s) ON CONFLICT (kind) DO UPDATE SET enabled = excluded.enabled,
                   conditions = excluded.conditions, updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
                (kind, enabled, Jsonb(conditions), self.clock.now(), actor))
        return await self.view(kind)

    async def _profile(self, kind: str) -> tuple[dict, str, int | None]:
        """The profile a sample is shaped by: the installation's own when it is of this kind."""
        iid = settings.raw("INSTITUTION_ID")
        try:
            p = await self.institutions.profile(iid)
        except Problem:
            p = None
        if p and p["institution"]["institution_type"] == kind:
            return {"institution": p["institution"], "sections": p["sections"]}, "installation", \
                p["institution"].get("profile_version")
        return bundled(kind), "bundled", None

    async def institution(self, kind: str) -> tuple[Institution, dict, date, set[str], str]:
        """What a sample serves now: the institution, its active data conditions, today (local), the faults
        switched on, and where its profile came from."""
        st = await self.state(kind)
        profile, source, version = await self._profile(kind)
        today = self.clock.now().astimezone(ZoneInfo(profile["institution"]["time_zone"])).date()
        key = (kind, source, profile["institution"].get("institution_id"), version, today)
        inst = self._built.get(key)
        if inst is None:
            inst = build(profile, kind, today)
            self._built = {k: v for k, v in self._built.items() if k[0] != kind} | {key: inst}
        active = cond.active(kind, st["conditions"], today)
        faults = {i for i in active if cond.BY_ID[i].group == "fault"}
        data = {i: a for i, a in active.items() if cond.BY_ID[i].group == "data"}
        return inst, data, today, faults, source

    async def view(self, kind: str, base: str = "") -> dict:
        st = await self.state(kind)
        profile, source, _ = await self._profile(kind)
        return {**st, "allowed": self.allowed(), "base_path": f"/mock/{kind}/metrics/v1",
                "openapi_path": f"/mock/{kind}/openapi.json",
                "shaped_by": {"name": profile["institution"]["name"], "source": source},
                "presets": [{"id": p.id, "label": p.label, "group": p.group, "size_label": p.size_label,
                             "size": p.size, "start_days_ago": p.start_days_ago, "note": p.note}
                            for p in cond.presets(kind)]}
