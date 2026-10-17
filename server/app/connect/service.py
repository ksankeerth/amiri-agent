"""The installation's data connection (ops.data_connection), the connector's reports (ops.data_checks),
approval, and the validation switch.

A connection is either a sample institution served by this server (read in-process) or an address
someone typed (checked by client.check_url before each check). The key or token for an address is
stored encrypted with DATA_SECRET_KEY and never returned."""

import base64
import hashlib
import uuid

import httpx
from cryptography.fernet import Fernet, InvalidToken
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import auth, settings
from app.clock import Clock
from app.connect import checker
from app.connect.client import InstitutionData, UnsafeURL, check_url
from app.institutions.service import Institutions
from app.problems import Problem

INTERNAL = "http://amiri.internal"  # the base an in-process call to a sample institution uses


def _fernet() -> Fernet:
    key = settings.raw("DATA_SECRET_KEY")
    if len(key) < 32:
        raise Problem(422, "secret_key_missing", "DATA_SECRET_KEY isn't set (32+ characters), so a key can't be stored. "
                      "Set it, or connect without a key.")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()))


class DataConnection:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, clock: Clock):
        self.pool, self.institutions, self.clock = pool, institutions, clock
        self.app = None  # set by the app: sample institutions are called in-process

    async def _row(self) -> dict | None:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM ops.data_connection WHERE id = 1")
            return await cur.fetchone()

    @staticmethod
    def _shown_url(row: dict, public: str) -> str | None:
        if row["source"] == "sample":
            return f"{public.rstrip('/')}/mock/{row['sample']}/metrics/v1"
        return row["base_url"]

    async def view(self, public: str = "") -> dict:
        row = await self._row()
        latest = await self._latest()
        if latest is not None:  # does it describe the connection as it is now?
            latest = {**latest, "current": bool(row) and latest["connection_version"] == row["version"]}
        if row is None:
            return {"configured": False, "validation_enabled": False, "validation_allowed": self._validation_allowed(),
                    "approved": None, "latest_check": latest}
        return {"configured": True, "source": row["source"], "sample": row["sample"],
                "base_url": self._shown_url(row, public), "openapi_url": row["openapi_url"],
                "auth_header": row["auth_header"], "auth_set": row["auth_value"] is not None,
                "approved": {"check_id": row["approved_check_id"], "at": row["approved_at"], "by": row["approved_by"]}
                if row["approved_check_id"] else None,
                "validation_enabled": row["validation_enabled"], "validation_allowed": self._validation_allowed(),
                "latest_check": latest, "updated_at": row["updated_at"], "updated_by": row["updated_by"]}

    @staticmethod
    def _validation_allowed() -> bool:
        return settings.raw("METRICS_VALIDATION") == "on"

    async def put(self, body: dict, actor: str, public: str = "") -> dict:
        """A new or changed connection. It needs checking and approving again."""
        source = body["source"]
        enc = None
        if source == "sample":
            if body.get("sample") not in ("bank", "insurer"):
                raise Problem(422, "validation_error", "Choose the sample bank or the sample insurer.")
            base = openapi = header = None
        else:
            base = (body.get("base_url") or "").strip().rstrip("/")
            openapi = (body.get("openapi_url") or "").strip() or None
            if not base.endswith("/metrics/v1"):
                raise Problem(422, "validation_error", "The address must end with /metrics/v1 (the reference API's base), "
                              "e.g. https://data.bank.example/metrics/v1.")
            for u in filter(None, (base, openapi)):
                try:
                    check_url(u)
                except UnsafeURL as e:
                    raise Problem(422, "unsafe_url", str(e)) from e
            header = (body.get("auth_header") or "").strip() or None
            if body.get("auth_value"):
                if not header:
                    raise Problem(422, "validation_error", "Name the header the key goes in (e.g. Authorization).")
                enc = _fernet().encrypt(body["auth_value"].encode())
            elif header:
                old = await self._row()
                enc = old["auth_value"] if old and old["auth_header"] == header and old["source"] == "url" else None
                if enc is None:
                    raise Problem(422, "validation_error", "Give the key or token for that header.")
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO ops.data_connection (id, source, sample, base_url, openapi_url, auth_header, auth_value,
                     approved_check_id, approved_at, approved_by, validation_enabled, updated_at, updated_by)
                   VALUES (1, %s, %s, %s, %s, %s, %s, NULL, NULL, NULL, false, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET version = ops.data_connection.version + 1,
                     source = excluded.source, sample = excluded.sample,
                     base_url = excluded.base_url, openapi_url = excluded.openapi_url, auth_header = excluded.auth_header,
                     auth_value = excluded.auth_value, approved_check_id = NULL, approved_at = NULL, approved_by = NULL,
                     validation_enabled = false, updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
                (source, body.get("sample") if source == "sample" else None, base, openapi, header, enc,
                 self.clock.now(), actor))
        return await self.view(public)

    async def client(self) -> tuple[InstitutionData, str, str | None]:
        """The client for the connection as it is now, its target (as shown) and its OpenAPI address."""
        row = await self._row()
        if row is None:
            raise Problem(409, "not_configured", "No data connection yet: enter the address, or use a sample institution.")
        if row["source"] == "sample":
            headers = {}
            if auth.gate_on():  # the bot check covers /mock/: an in-process call carries a fresh session
                headers["Cookie"] = f"{auth.COOKIE}={auth.issue('internal')[0]}"
            base = f"{INTERNAL}/mock/{row['sample']}/metrics/v1"
            data = InstitutionData(base, headers=headers, transport=httpx.ASGITransport(app=self.app))
            return data, f"the sample {row['sample']}", f"{INTERNAL}/mock/{row['sample']}/openapi.json"
        for u in filter(None, (row["base_url"], row["openapi_url"])):
            try:
                check_url(u)
            except UnsafeURL as e:
                raise Problem(422, "unsafe_url", str(e)) from e
        headers = {}
        if row["auth_header"] and row["auth_value"]:
            try:
                headers[row["auth_header"]] = _fernet().decrypt(bytes(row["auth_value"])).decode()
            except InvalidToken as e:
                raise Problem(409, "secret_unreadable", "The stored key can't be read (DATA_SECRET_KEY changed): "
                              "enter it again.") from e
        return InstitutionData(row["base_url"], headers=headers), row["base_url"], row["openapi_url"]

    async def check(self, actor: str) -> dict:
        row = await self._row()
        data, target, openapi_url = await self.client()
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
                # an approved connection that now fails: validation stops until it is fixed and approved again
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

    async def approve(self, actor: str, public: str = "") -> dict:
        row = await self._row()
        latest = await self._latest()
        if row is None or latest is None:
            raise Problem(409, "not_checked", "Check the connection first.")
        if latest["connection_version"] != row["version"]:
            raise Problem(409, "not_checked", "The connection changed since the last check; check it again.")
        if latest["status"] == "not_ready":
            raise Problem(409, "not_ready", "The last check found blocking problems; fix them and check again.")
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE ops.data_connection SET approved_check_id = %s, approved_at = %s, approved_by = %s "
                               "WHERE id = 1", (latest["check_id"], self.clock.now(), actor))
        return await self.view(public)

    async def set_validation(self, enabled: bool, actor: str, public: str = "") -> dict:
        row = await self._row()
        if enabled:
            if not self._validation_allowed():
                raise Problem(409, "validation_off", "Validation is switched off on this server (METRICS_VALIDATION).")
            if row is None or not row["approved_check_id"]:
                raise Problem(409, "not_approved", "Approve a checked connection first.")
        if row is not None:
            async with self.pool.connection() as conn:
                await conn.execute("UPDATE ops.data_connection SET validation_enabled = %s, updated_by = %s WHERE id = 1",
                                   (enabled, actor))
        return await self.view(public)

    async def validation_on(self) -> bool:
        """Validation runs: allowed by the server, switched on, on an approved connection."""
        if not self._validation_allowed():
            return False
        row = await self._row()
        return bool(row and row["validation_enabled"] and row["approved_check_id"])
