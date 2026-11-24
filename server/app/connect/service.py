"""The installation's data connection (ops.data_connection), the connector's reports (ops.data_checks),
approval, and the validation switch.

The institution's data comes from one imported JSON file (importfmt.py), stored in ops.imported_data and
ops.imported_series and served in-process as the Metrics Spec reference API (imported.py). A new import replaces
the old data and needs checking and approving again, like any changed connection."""

import hashlib
import json
import uuid
from zoneinfo import ZoneInfo

import httpx
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import auth, settings
from app.clock import Clock
from app.connect import checker, importfmt
from app.connect.client import InstitutionData
from app.connect.imported import (
    IN_PROCESS_HEADER,
    IN_PROCESS_TOKEN,
    PREFIX,
    ImportedStore,
)
from app.institutions.service import Institutions
from app.problems import Problem

INTERNAL = "http://amiri.internal"  # the base an in-process call uses


def max_bytes() -> int:
    return int(settings.number("DATA_IMPORT_MAX_MB") * 1024 * 1024)


class DataConnection:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, clock: Clock):
        self.pool, self.institutions, self.clock = pool, institutions, clock
        self.imported = ImportedStore(pool)
        self.app = None  # set by the app: the imported data is read in-process

    async def _row(self) -> dict | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM ops.data_connection WHERE id = 1 AND source = 'imported'")
            return await cur.fetchone()

    async def view(self) -> dict:
        row = await self._row()
        meta = await self.imported.meta() if row else None
        latest = await self._latest()
        if latest is not None:  # does it describe the data as it is now?
            latest = {**latest, "current": bool(row) and latest["connection_version"] == row["version"]}
        base = {"validation_allowed": self._validation_allowed(), "latest_check": latest,
                "max_import_mb": settings.number("DATA_IMPORT_MAX_MB")}
        if row is None or meta is None:
            return {"configured": False, "validation_enabled": False, "approved": None, **base}
        return {"configured": True, "source": "imported",
                "imported": {"file_name": meta["file_name"], "bytes": meta["bytes"], "as_of": meta["as_of"],
                             "about": meta["about"], "summary": meta["summary"], "at": meta["imported_at"],
                             "by": meta["imported_by"]},
                "approved": {"check_id": row["approved_check_id"], "at": row["approved_at"], "by": row["approved_by"]}
                if row["approved_check_id"] else None,
                "validation_enabled": row["validation_enabled"], "updated_at": row["updated_at"],
                "updated_by": row["updated_by"], **base}

    @staticmethod
    def _validation_allowed() -> bool:
        return settings.raw("METRICS_VALIDATION") == "on"

    def _today(self, doc: object):
        """Today where the institution is (the catalog's time zone, else UTC), for as_of."""
        tz = "UTC"
        if isinstance(doc, dict) and isinstance(doc.get("catalog"), dict):
            tz = str((doc["catalog"].get("profile") or {}).get("time_zone") or "UTC")
        try:
            zone = ZoneInfo(tz)
        except (ValueError, KeyError):
            zone = ZoneInfo("UTC")
        return self.clock.now().astimezone(zone).date()

    async def import_(self, raw: bytes, file_name: str | None, actor: str) -> dict:
        """Replaces the institution's data with a file. It needs checking and approving again."""
        if len(raw) > max_bytes():
            raise too_large(len(raw))
        try:
            doc = json.loads(raw)
        except UnicodeDecodeError as e:
            raise Problem(422, "invalid_json", "The file isn't UTF-8 text.") from e
        except json.JSONDecodeError as e:
            raise Problem(422, "invalid_json", f"The file isn't valid JSON: {e.msg} at line {e.lineno}, "
                          f"column {e.colno}.") from e
        try:
            data = importfmt.read(doc, self._today(doc))
        except importfmt.Invalid as e:
            first = e.errors[0]
            raise Problem(422, "invalid_import", f"The file can't be imported: {first['field']}: {first['message']}"
                          + (f" (and {len(e.errors) - 1} more)" if len(e.errors) > 1 else ""),
                          errors=e.errors) from e
        name = (file_name or "").strip()[:200] or None
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            await self.imported.write(conn, data, name, len(raw), hashlib.sha256(raw).hexdigest(), now, actor)
            await conn.execute(
                """INSERT INTO ops.data_connection (id, source, approved_check_id, approved_at, approved_by,
                     validation_enabled, updated_at, updated_by)
                   VALUES (1, 'imported', NULL, NULL, NULL, false, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET version = ops.data_connection.version + 1, source = 'imported',
                     approved_check_id = NULL, approved_at = NULL, approved_by = NULL, validation_enabled = false,
                     updated_at = excluded.updated_at, updated_by = excluded.updated_by""", (now, actor))
        return await self.view()

    async def client(self) -> tuple[InstitutionData, str, str | None]:
        """The client for the imported data (served in-process), its target as shown, and its OpenAPI address."""
        row = await self._row()
        meta = await self.imported.meta() if row else None
        if row is None or meta is None:
            raise Problem(409, "not_configured", "No data yet: import your institution's data as a JSON file.")
        headers = {IN_PROCESS_HEADER: IN_PROCESS_TOKEN}
        if auth.gate_on():  # the bot check covers /imported/: an in-process call carries a fresh session
            headers["Cookie"] = f"{auth.COOKIE}={auth.issue('internal')[0]}"
        data = InstitutionData(f"{INTERNAL}{PREFIX}/metrics/v1", headers=headers,
                               transport=httpx.ASGITransport(app=self.app))
        target = f"the imported file{' ' + meta['file_name'] if meta['file_name'] else ''} (as of {meta['as_of']})"
        return data, target, f"{INTERNAL}{PREFIX}/openapi.json"

    async def check(self, actor: str) -> dict:
        data, target, openapi_url = await self.client()
        row = await self._row()
        iid = settings.raw("INSTITUTION_ID")
        try:
            p = await self.institutions.profile(iid)
            profile = {"institution": p["institution"], "sections": p["sections"]}
        except Problem:
            profile = None
        try:
            report = await checker.run(data, profile, self.clock.now(), target, openapi_url)
        finally:
            await data.aclose()
        check_id = "chk-" + uuid.uuid4().hex[:12]
        report = {"check_id": check_id, "run_by": actor, **report}
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO ops.data_checks (check_id, connection_version, started_at, finished_at, status, target,
                     server_version, report, run_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (check_id, row["version"], report["started_at"], report["finished_at"], report["status"], target,
                 report["server_version"], Jsonb(report), actor))
            if report["status"] == "not_ready" and row["approved_check_id"]:
                # approved data that now fails: validation stops until it is fixed and approved again
                await conn.execute("UPDATE ops.data_connection SET approved_check_id = NULL, approved_at = NULL, "
                                   "approved_by = NULL, validation_enabled = false WHERE id = 1")
                report["withdrawn"] = "The approval was withdrawn and validation switched off: fix the problems, check, approve."
                await conn.execute("UPDATE ops.data_checks SET report = %s WHERE check_id = %s", (Jsonb(report), check_id))
            await conn.execute("DELETE FROM ops.data_checks WHERE check_id NOT IN "
                               "(SELECT check_id FROM ops.data_checks ORDER BY seq DESC LIMIT 50)")
        return report

    async def _latest(self) -> dict | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("""SELECT check_id, connection_version, started_at, status, target, server_version,
                                          report -> 'headline' AS headline FROM ops.data_checks
                                        ORDER BY seq DESC LIMIT 1""")
            return await cur.fetchone()

    async def checks(self, limit: int = 20) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute("""SELECT check_id, started_at, finished_at, status, target, server_version, run_by,
                                          report -> 'headline' AS headline, report -> 'summary' AS summary
                                        FROM ops.data_checks ORDER BY seq DESC LIMIT %s""", (limit,))
            return await cur.fetchall()

    async def report(self, check_id: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT report FROM ops.data_checks WHERE check_id = %s", (check_id,))
            r = await cur.fetchone()
        if not r:
            raise Problem(404, "not_found", f"No check {check_id}.")
        return r["report"]

    async def approve(self, actor: str) -> dict:
        row = await self._row()
        latest = await self._latest()
        if row is None or latest is None:
            raise Problem(409, "not_checked", "Check the data first.")
        if latest["connection_version"] != row["version"]:
            raise Problem(409, "not_checked", "The data changed since the last check; check it again.")
        if latest["status"] == "not_ready":
            raise Problem(409, "not_ready", "The last check found blocking problems; fix them and check again.")
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE ops.data_connection SET approved_check_id = %s, approved_at = %s, approved_by = %s "
                               "WHERE id = 1", (latest["check_id"], self.clock.now(), actor))
        return await self.view()

    async def set_validation(self, enabled: bool, actor: str) -> dict:
        row = await self._row()
        if enabled:
            if not self._validation_allowed():
                raise Problem(409, "validation_off", "Validation is switched off on this server (METRICS_VALIDATION).")
            if row is None or not row["approved_check_id"]:
                raise Problem(409, "not_approved", "Approve checked data first.")
        if row is not None:
            async with self.pool.connection() as conn:
                await conn.execute("UPDATE ops.data_connection SET validation_enabled = %s, updated_by = %s WHERE id = 1",
                                   (enabled, actor))
        return await self.view()

    async def validation_on(self) -> bool:
        """Validation runs: allowed by the server, switched on, on approved data."""
        if not self._validation_allowed():
            return False
        row = await self._row()
        return bool(row and row["validation_enabled"] and row["approved_check_id"])


def too_large(size: int) -> Problem:
    cap = settings.number("DATA_IMPORT_MAX_MB")
    return Problem(413, "too_large", f"The file is {size / 1024 / 1024:.1f} MB; the most this server takes is "
                   f"{cap:g} MB (DATA_IMPORT_MAX_MB).")
