"""Institution profile service. Code only; no model.

Every write is a batch (a single-item edit is a batch of one): the profile is
loaded under a row lock on the institution, every operation is applied and
checked against the profile as it will be, and only then is anything written,
in one transaction, with a change-log row per changed item. A dry run returns
the same results and changes without writing; the assistant's proposals use it
to show a diff, and confirm with the same operations.
"""

import copy
import uuid
from datetime import datetime

from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import ValidationError

from app import reference, settings, spec
from app.clock import Clock
from app.institutions import privacy, rivals, rules, store
from app.institutions.rules import Item, State
from app.institutions.schemas import (
    NAME_FIELD,
    SECTION_LIMITS,
    SECTIONS,
    SUBTYPES,
    InstitutionCreate,
    InstitutionPatch,
    Operation,
    slugify,
)
from app.problems import Problem
from app.text import plural

META = ("id", "version", "created_at", "updated_at", "created_by", "updated_by", "position")
SOURCES = ("form", "assistant", "setup", "import", "system")

# Product categories → themes that news about them is likely to carry (Radar scope).
CATEGORY_THEMES = {
    "savings": ["rates", "remittance"], "wealth": ["markets", "rates"], "gold_loan": ["commodities"],
    "retail_loan": ["rates", "macro"], "vehicle_finance": ["rates", "prices"], "cards": ["macro", "fx"],
    "business_loan": ["rates", "sector", "macro"], "agri_loan": ["commodities", "disaster"],
    "trade_finance": ["fx", "sector"], "payments": ["regulation"], "remittances": ["remittance", "fx"],
    "fx": ["fx"], "distribution": ["regulation"], "life": ["rates", "markets"], "health": ["prices"],
    "motor": ["prices", "disaster"], "travel": ["remittance"], "property": ["disaster"], "marine": ["sector"],
    "liability": ["regulation"], "agriculture": ["commodities", "disaster"], "micro_insurance": ["disaster"],
    "insurer_company": ["markets", "trust"],
}
ALWAYS_THEMES = ["regulation", "macro", "disaster", "trust"]
FLOW_WORDS = {"remittances_in": "remittances", "remittances_out": "outward remittances", "tourism": "tourism",
              "services": "services income", "exports": "exports", "imports": "imports"}


def _err(errors: list[dict], detail: str = "The change breaks the profile's rules.") -> Problem:
    return Problem(422, "validation_error", detail, errors=errors)


def _pyd_errors(e: ValidationError, **ctx) -> list[dict]:
    return [{**ctx, "field": ".".join(str(x) for x in er["loc"]), "code": "invalid", "message": er["msg"]}
            for er in e.errors()]


def item_view(section: str, item_id: str, it: Item) -> dict:
    return {"id": item_id, "version": it.version, **it.data, "created_at": it.created_at,
            "updated_at": it.updated_at, "updated_by": it.updated_by}



def region_errors(fields: dict) -> list[dict]:
    """The prototype is tested in one region (SUPPORTED_REGION): the home country and base currency must be in it."""
    r = reference.region()
    if not r:
        return []
    out = []
    if fields.get("home_country") and fields["home_country"] not in r["countries"]:
        out.append({"section": "institution", "field": "home_country", "code": "outside_region",
                    "message": f"the prototype covers {r['label']} only: choose a home country there"})
    if fields.get("base_currency") and fields["base_currency"] not in r["currencies"]:
        out.append({"section": "institution", "field": "base_currency", "code": "outside_region",
                    "message": f"the prototype covers {r['label']} only: choose a currency of a country there"})
    return out

class Institutions:
    def __init__(self, pool: AsyncConnectionPool, clock: Clock):
        self.pool, self.clock = pool, clock

    # ------------------------------------------------ loading

    async def _load(self, conn, institution_id: str, *, lock: bool) -> State:
        state = await store.load_state(conn, institution_id, lock)
        if state is None:
            raise Problem(404, "not_found", f"No institution {institution_id}.")
        return state

    async def state(self, institution_id: str) -> State:
        async with self.pool.connection() as conn:
            return await self._load(conn, institution_id, lock=False)

    # ------------------------------------------------ institutions

    def inst_view(self, state: State) -> dict:
        r = state.inst
        return {"institution_id": r["institution_id"], "status": r["status"], "version": r["version"],
                "profile_version": r["profile_version"], **r["fields"],
                "created_at": r["created_at"], "updated_at": r["updated_at"],
                "activated_at": r["activated_at"], "archived_at": r["archived_at"],
                "counts": {s: len(state.section(s)) for s in SECTIONS}}

    async def list_institutions(self, status: str | None) -> list[dict]:
        async with self.pool.connection() as conn:
            counts = " + ".join(f"(SELECT count(*) FROM {sp.table} x WHERE x.institution_id = i.institution_id)"
                                for sp in store.SPECS.values())
            cur = await conn.execute(
                f"""SELECT i.*, ({counts}) AS items
                   FROM core.institutions i WHERE %s::text IS NULL OR i.status = %s ORDER BY i.created_at""",
                (status, status),
            )
            return [{"institution_id": r["institution_id"], "name": r["name"],
                     "institution_type": r["institution_type"], "status": r["status"],
                     "home_country": r["home_country"], "profile_version": r["profile_version"],
                     "items": r["items"], "updated_at": r["updated_at"]} for r in await cur.fetchall()]

    async def get(self, institution_id: str) -> dict:
        return self.inst_view(await self.state(institution_id))

    async def create(self, body: InstitutionCreate, actor: str, source: str,
                     sections: dict[str, list[dict]] | None = None, proposal_id: str | None = None) -> dict:
        """Creates an institution with its home footprint entry, then (import) its sections."""
        fields = body.model_dump(mode="json", exclude={"institution_id"})
        if fields.get("subtype") and fields["subtype"] not in SUBTYPES[fields["institution_type"]]:
            raise _err([{"section": "institution", "field": "subtype", "code": "invalid",
                         "message": f"a {fields['institution_type']} is one of {', '.join(SUBTYPES[fields['institution_type']])}"}])
        pd = privacy.errors(fields, "institution") + region_errors(fields)
        if pd:
            raise _err(pd)
        defaults = {"islamic": False, "clearing_currencies": [], "fiscal_year_start_month": 1}
        fields = {**defaults, **{k: v for k, v in fields.items() if v is not None}}
        iid = body.institution_id or (settings.raw("INSTITUTION_ID") if settings.flag("SINGLE_INSTITUTION") else "") \
            or slugify(body.name)
        now = self.clock.now()
        ops = [Operation(op="create", section="footprint",
                         data={"code": fields["home_country"], "role": "home", "scope": "all"})]
        ops_import = []
        for sec, items in (sections or {}).items():
            if sec not in SECTIONS:
                raise _err([{"section": sec, "code": "unknown_section", "message": f"no section {sec}"}])
            for it in items:
                data = {k: v for k, v in it.items() if k not in META}
                if sec == "footprint" and data.get("code", "").upper() == fields["home_country"] and data.get("role") == "home":
                    ops[0] = Operation(op="create", section="footprint", data=data)
                    continue
                ops_import.append(Operation(op="create", section=sec, id=it.get("id"), data=data))
        async with self.pool.connection() as conn, conn.transaction():
            if settings.flag("SINGLE_INSTITUTION"):
                cur = await conn.execute("SELECT name FROM core.institutions WHERE status <> 'archived' LIMIT 1")
                if other := await cur.fetchone():
                    raise Problem(409, "one_institution", f"This platform holds one institution ({other['name']}). "
                                  "Reset the prototype to start again with another.")
            cur = await conn.execute("SELECT 1 FROM core.institutions WHERE institution_id = %s", (iid,))
            if await cur.fetchone():
                raise Problem(409, "institution_exists", f"An institution with id {iid} exists; give another institution_id.")
            st = State(inst={"institution_id": iid, "fields": fields})
            try:
                await store.write_institution(conn, st, now, False, 1, insert=True)
            except pg_errors.UniqueViolation as e:
                raise Problem(409, "institution_exists", f"An institution with id {iid} exists.") from e
            await self._apply(conn, iid, [*ops, *ops_import], actor, source, dry_run=False,
                              if_profile_version=None, initial=True, proposal_id=proposal_id)
        return await self.get(iid)

    async def set_status(self, institution_id: str, action: str, actor: str) -> dict:
        now = self.clock.now()
        async with self.pool.connection() as conn, conn.transaction():
            state = await self._load(conn, institution_id, lock=True)
            cur_status = state.inst["status"]
            if action == "activate":
                if cur_status == "archived":
                    raise Problem(409, "institution_archived", "Restore the institution first.")
                rd = self.readiness(state)
                if not rd["ready"]:
                    raise Problem(409, "not_ready", "Required parts of the profile are missing.",
                                  missing=[c for c in rd["checks"] if c["level"] == "required" and not c["ok"]])
                new, col = "active", "activated_at"
            elif action == "archive":
                new, col = "archived", "archived_at"
            else:  # restore
                if cur_status != "archived":
                    raise Problem(409, "conflict", "Only an archived institution can be restored.")
                new, col = ("active" if state.inst["activated_at"] else "setup"), "archived_at"
            if new == cur_status:
                return self.inst_view(state)
            pv = state.inst["profile_version"] + 1
            await conn.execute(
                f"UPDATE core.institutions SET status = %s, {col} = %s, updated_at = %s, profile_version = %s WHERE institution_id = %s",
                (new, None if action == "restore" else now, now, pv, institution_id),
            )
            await conn.execute(
                """INSERT INTO core.profile_changes (institution_id, profile_version, at, actor, source, batch_id,
                     section, item_id, op, before, after) VALUES (%s, %s, %s, %s, 'system', %s, 'institution', NULL, 'status', %s, %s)""",
                (institution_id, pv, now, actor, uuid.uuid4().hex[:12], Jsonb({"status": cur_status}), Jsonb({"status": new})),
            )
        return await self.get(institution_id)

    async def delete(self, institution_id: str) -> None:
        async with self.pool.connection() as conn, conn.transaction():
            state = await self._load(conn, institution_id, lock=True)
            if state.inst["status"] != "setup":
                raise Problem(409, "cannot_delete", "Only an institution still in setup can be deleted; archive it instead.")
            await conn.execute("DELETE FROM core.institutions WHERE institution_id = %s", (institution_id,))

    # ------------------------------------------------ the batch

    async def batch(self, institution_id: str, ops: list[Operation], actor: str, source: str,
                    dry_run: bool = False, if_profile_version: int | None = None,
                    proposal_id: str | None = None) -> dict:
        try:
            async with self.pool.connection() as conn, conn.transaction():
                return await self._apply(conn, institution_id, ops, actor, source, dry_run, if_profile_version,
                                         proposal_id=proposal_id)
        except (pg_errors.ForeignKeyViolation, pg_errors.UniqueViolation, pg_errors.CheckViolation) as e:
            # the database's own rules, checked at commit (deferred links): only reached if the service's checks missed something
            raise Problem(409 if isinstance(e, pg_errors.UniqueViolation) else 422, "database_rule",
                          f"The database refused the change: {e.diag.message_primary}",
                          constraint=e.diag.constraint_name) from e

    async def _apply(self, conn, institution_id: str, ops: list[Operation], actor: str, source: str,
                     dry_run: bool, if_profile_version: int | None, initial: bool = False,
                     proposal_id: str | None = None) -> dict:
        state = await self._load(conn, institution_id, lock=True)
        if state.inst["status"] == "archived" and not dry_run:
            raise Problem(409, "institution_archived", "The institution is archived; restore it to change it.")
        if if_profile_version is not None and if_profile_version != state.inst["profile_version"]:
            raise Problem(409, "conflict", f"The profile changed (now version {state.inst['profile_version']}); reload and retry.",
                          current_profile_version=state.inst["profile_version"])
        now = self.clock.now()
        before = copy.deepcopy(state)
        results: list[dict] = []
        changes: list[dict] = []
        errors: list[dict] = []
        touched: set[tuple[str, str]] = set()
        inst_changed = False

        for idx, op in enumerate(ops):
            try:
                if op.section == "institution":
                    if op.op != "update":
                        raise _err([{"code": "invalid", "message": "the institution itself only takes update"}])
                    changes += self._update_institution(state, op, idx)
                    inst_changed = True
                    results.append({"index": idx, "op": op.op, "section": "institution", "id": institution_id,
                                    "version": state.inst["version"] + 1})
                    continue
                sec = op.section
                if op.op == "create":
                    iid, ch = self._create_item(state, op, idx, actor, now)
                elif op.op == "update":
                    iid, ch = self._update_item(state, op, idx, actor, now)
                else:
                    iid, ch = self._delete_item(state, op, idx, actor, now, touched)
                changes += ch
                touched.add((sec, iid))
                it = state.section(sec).get(iid)
                results.append({"index": idx, "op": op.op, "section": sec, "id": iid,
                                "version": it.version if it else None})
            except Problem as p:
                for e in p.extra.get("errors", []) or [{"code": p.code, "message": p.detail}]:
                    errors.append({"operation": idx, **e})
                if p.status != 422:  # conflicts and missing items stop the batch at once
                    p.extra["operation"] = idx
                    raise
        # hard rules on everything touched, against the final profile
        for sec, iid in touched:
            for e in rules.errors_for(state, sec, iid):
                idx = next((r["index"] for r in results if r["section"] == sec and r["id"] == iid), None)
                errors.append({"operation": idx, **e})
        if inst_changed:
            for iid in state.section("products"):
                for e in rules.errors_for(state, "products", iid):
                    errors.append({"operation": None, **e})
            for iid in state.section("footprint"):
                for e in rules.errors_for(state, "footprint", iid):
                    errors.append({"operation": None, **e})
        errors += [{"operation": None, **e} for e in rules.check_home(state)]
        if errors:
            raise _err(errors)
        warnings = [w for sec, iid in sorted(touched) for w in rules.warnings_for(state, sec, iid)]
        new_pv = state.inst["profile_version"] + (0 if initial else 1)
        out = {"institution_id": institution_id, "dry_run": dry_run,
               "profile_version": state.inst["profile_version"] if dry_run else new_pv,
               "results": results, "changes": changes, "warnings": warnings}
        for r in results:
            it = state.section(r["section"]).get(r["id"]) if r["section"] != "institution" else None
            r["item"] = item_view(r["section"], r["id"], it) if it else None
        if dry_run or not changes:
            if not dry_run:
                out["profile_version"] = state.inst["profile_version"]
            return out
        try:
            await self._persist(conn, before, state, changes, inst_changed, actor, source, now, new_pv, proposal_id)
        except (pg_errors.ForeignKeyViolation, pg_errors.UniqueViolation, pg_errors.CheckViolation) as e:
            # the database's own rules: only reached if the service's checks missed something
            raise Problem(409 if isinstance(e, pg_errors.UniqueViolation) else 422, "database_rule",
                          f"The database refused the change: {e.diag.message_primary}",
                          constraint=e.diag.constraint_name) from e
        return out

    def _update_institution(self, state: State, op: Operation, idx: int) -> list[dict]:
        data = op.data or {}
        try:
            patch = InstitutionPatch(**data)
        except ValidationError as e:
            raise _err(_pyd_errors(e, section="institution")) from e
        if op.if_version is not None and op.if_version != state.inst["version"]:
            raise Problem(409, "conflict", f"The institution changed (version {state.inst['version']}).",
                          current_version=state.inst["version"])
        old = copy.deepcopy(state.inst["fields"])
        new = dict(old)
        required = {"name", "institution_type", "home_country", "base_currency", "time_zone"}
        for k in patch.model_fields_set:
            v = getattr(patch, k)
            if v is None and k in required:
                raise _err([{"section": "institution", "field": k, "code": "required", "message": f"{k} can't be empty"}])
            new[k] = patch.model_dump(mode="json")[k]
        if new.get("subtype") and new["subtype"] not in SUBTYPES[new["institution_type"]]:
            raise _err([{"section": "institution", "field": "subtype", "code": "invalid",
                         "message": f"a {new['institution_type']} is one of {', '.join(SUBTYPES[new['institution_type']])}"}])
        if new["home_country"] != old["home_country"]:
            fp = state.section("footprint")
            homes = [k for k, it in fp.items() if it.data["role"] == "home"]
            if not any(reference.country_of(fp[k].data["code"]) == new["home_country"] for k in homes):
                raise _err([{"section": "institution", "field": "home_country", "code": "home_footprint_first",
                             "message": f"add {new['home_country']} to the footprint with role home (and change the old home's role) in the same batch, before this change"}])
        pd = privacy.errors({k: new.get(k) for k in patch.model_fields_set}, "institution") + \
            region_errors({k: new.get(k) for k in patch.model_fields_set})
        if pd:
            raise _err(pd)
        state.inst["fields"] = new
        state.inst["name"] = new["name"]
        state.inst["institution_type"] = new["institution_type"]
        diff_b = {k: old.get(k) for k in patch.model_fields_set if old.get(k) != new.get(k)}
        diff_a = {k: new.get(k) for k in diff_b}
        return [{"section": "institution", "id": state.inst["institution_id"], "op": "update",
                 "before": diff_b, "after": diff_a}] if diff_b else []

    def _validate(self, section: str, data: dict, idx: int, item_id: str | None) -> dict:
        try:
            out = SECTIONS[section](**data).model_dump(mode="json")
        except ValidationError as e:
            raise _err(_pyd_errors(e, section=section, id=item_id)) from e
        except TypeError as e:
            raise _err([{"section": section, "id": item_id, "code": "invalid", "message": str(e)}]) from e
        pd = privacy.errors(out, section, item_id)
        if pd:
            raise _err(pd)
        return out

    def _check_unique(self, state: State, section: str, data: dict, item_id: str) -> None:
        if section == "risk-exposures" and data.get("hazard_id"):
            for oid, it in state.section(section).items():
                if oid != item_id and it.data.get("hazard_id") == data["hazard_id"]:
                    raise Problem(409, "duplicate", f"{data['hazard_id']} is already an exposure (id {oid}); "
                                  "edit that one.", existing_id=oid)
        nf = NAME_FIELD[section]
        if nf is None:
            return
        key = str(data[nf]).casefold()
        for oid, it in state.section(section).items():
            if oid != item_id and str(it.data[nf]).casefold() == key:
                raise Problem(409, "duplicate", f"{section} already has “{data[nf]}” (id {oid}).", existing_id=oid)

    def _create_item(self, state: State, op: Operation, idx: int, actor: str, now: datetime) -> tuple[str, list[dict]]:
        sec = op.section
        if not op.data:
            raise _err([{"section": sec, "code": "required", "message": "create needs data"}])
        data = self._validate(sec, op.data, idx, op.id)
        items = state.section(sec)
        if len(items) >= SECTION_LIMITS[sec]:
            raise Problem(409, "section_limit", f"{sec} holds at most {SECTION_LIMITS[sec]} items.")
        if sec == "footprint":
            iid = data["code"].lower()
            if op.id and op.id != iid:
                raise _err([{"section": sec, "field": "id", "code": "invalid", "message": f"a footprint entry's id is its code in lower case ({iid})"}])
            if iid in items:
                raise Problem(409, "duplicate", f"{data['code']} is already in the footprint.", existing_id=iid)
        else:
            self._check_unique(state, sec, data, "")
            if op.id:
                iid = op.id
                if iid in items:
                    raise Problem(409, "item_exists", f"{sec} already has an item with id {iid}.", existing_id=iid)
            else:
                base = slugify(data[NAME_FIELD[sec]]) if NAME_FIELD[sec] else slugify(
                    f"{data['kind']}-{data['local']}-{data['counterpart']}{'-' + data['goods'] if data.get('goods') else ''}")
                iid, n = base, 2
                while iid in items:
                    iid, n = f"{base}-{n}", n + 1
        if sec == "flows" and data["source"]["kind"] == "user" and not data["source"].get("edited_by"):
            data["source"]["edited_by"] = actor
            data["source"]["edited_at"] = now.isoformat()
        pos = max((i.position for i in items.values()), default=-1) + 1
        items[iid] = Item(data, 1, pos, now, now, actor, actor, new=True)
        return iid, [{"section": sec, "id": iid, "op": "create", "before": None, "after": data}]

    def _update_item(self, state: State, op: Operation, idx: int, actor: str, now: datetime) -> tuple[str, list[dict]]:
        sec, iid = op.section, op.id
        if not iid:
            raise _err([{"section": sec, "code": "required", "message": "update needs an id"}])
        it = state.section(sec).get(iid)
        if it is None:
            raise Problem(404, "not_found", f"No {sec} item {iid}.")
        if op.if_version is not None and op.if_version != it.version:
            raise Problem(409, "conflict", f"{sec}/{iid} changed (version {it.version}); reload and retry.",
                          current_version=it.version)
        patch = {k: v for k, v in (op.data or {}).items() if k not in META}
        if sec == "footprint" and "code" in patch and str(patch["code"]).upper() != it.data["code"]:
            raise _err([{"section": sec, "id": iid, "field": "code", "code": "immutable",
                         "message": "a footprint entry's place can't change; delete it and add the new one"}])
        merged = {**it.data, **patch}
        if sec == "flows":
            merged = self._flow_edit(it.data, patch, merged, actor, now)
        data = self._validate(sec, merged, idx, iid)
        self._check_unique(state, sec, data, iid)
        if data == it.data:
            return iid, []
        old = it.data
        it.data, it.version, it.updated_at, it.updated_by = data, it.version + 1, now, actor
        return iid, [{"section": sec, "id": iid, "op": "update",
                      "before": {k: old.get(k) for k in data if old.get(k) != data.get(k)},
                      "after": {k: data.get(k) for k in data if old.get(k) != data.get(k)}}]

    @staticmethod
    def _flow_edit(old: dict, patch: dict, merged: dict, actor: str, now: datetime) -> dict:
        """Keeps a figure's source honest: editing a dataset figure makes it the user's,
        with the dataset's figure kept; putting the dataset figure back restores the source."""
        if "source" in patch or "value" not in patch or not patch["value"]:
            return merged
        src = dict(old.get("source") or {})
        new_amt = patch["value"].get("amount")
        old_amt = (old.get("value") or {}).get("amount")
        if src.get("kind") == "dataset" and new_amt != old_amt:
            src.update(kind="user", original_amount=old_amt, edited_by=actor, edited_at=now.isoformat())
            merged["status"] = "confirmed"
        elif src.get("kind") == "user" and src.get("original_amount") is not None and new_amt == src["original_amount"]:
            src.update(kind="dataset", original_amount=None, edited_by=None, edited_at=None)
        elif src.get("kind") == "user":
            src.update(edited_by=actor, edited_at=now.isoformat())
        merged["source"] = src
        return merged

    def _delete_item(self, state: State, op: Operation, idx: int, actor: str, now: datetime,
                     touched: set) -> tuple[str, list[dict]]:
        sec, iid = op.section, op.id
        if not iid:
            raise _err([{"section": sec, "code": "required", "message": "delete needs an id"}])
        it = state.section(sec).get(iid)
        if it is None:
            raise Problem(404, "not_found", f"No {sec} item {iid}.")
        if op.if_version is not None and op.if_version != it.version:
            raise Problem(409, "conflict", f"{sec}/{iid} changed (version {it.version}); reload and retry.",
                          current_version=it.version)
        refs = rules.referrers(state, sec, iid)
        if refs and not op.force:
            raise Problem(409, "in_use", f"{sec}/{iid} is used by {plural(len(refs), 'other item')}; remove those references, "
                          "or delete with force to remove them too.", referrers=refs)
        changes = []
        for r in refs:
            ref_it = state.section(r["section"])[r["id"]]
            path = tuple(r["field"].split("."))
            old = ref_it.data
            ref_it.data = rules.drop_reference(old, path, iid)
            ref_it.version += 1
            ref_it.updated_at, ref_it.updated_by = now, actor
            changes.append({"section": r["section"], "id": r["id"], "op": "update",
                            "before": {path[0]: old.get(path[0])}, "after": {path[0]: ref_it.data.get(path[0])}})
            touched.add((r["section"], r["id"]))
        del state.section(sec)[iid]
        return iid, [{"section": sec, "id": iid, "op": "delete", "before": it.data, "after": None}, *changes]

    async def _persist(self, conn, before: State, state: State, changes: list[dict], inst_changed: bool,
                       actor: str, source: str, now: datetime, pv: int, proposal_id: str | None = None) -> None:
        iid = state.inst["institution_id"]
        await store.write_institution(conn, state, now, inst_changed, pv)
        for sec in store.ORDER:  # targets before the items that point at them
            old, new = before.section(sec), state.section(sec)
            for k, it in new.items():
                if k in old and old[k].version == it.version:
                    continue
                await store.write_item(conn, state, sec, k, it, now)
        for sec in reversed(store.ORDER):  # deletes after every reference to them is gone
            old, new = before.section(sec), state.section(sec)
            for k in old:
                if k not in new:
                    await store.delete_item(conn, iid, sec, k)
        batch_id = proposal_id or uuid.uuid4().hex[:12]
        async with conn.cursor() as c:
            await c.executemany(
                """INSERT INTO core.profile_changes (institution_id, profile_version, at, actor, source, batch_id,
                     section, item_id, op, before, after, proposal_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                [(iid, pv, now, actor, source, batch_id, ch["section"],
                  ch["id"] if ch["section"] != "institution" else None, ch["op"],
                  Jsonb(ch["before"]) if ch["before"] is not None else None,
                  Jsonb(ch["after"]) if ch["after"] is not None else None, proposal_id) for ch in changes],
            )

    # ------------------------------------------------ reads

    async def section(self, institution_id: str, section: str) -> list[dict]:
        state = await self.state(institution_id)
        return [item_view(section, k, it) for k, it in state.section(section).items()]

    async def item(self, institution_id: str, section: str, item_id: str) -> dict:
        state = await self.state(institution_id)
        it = state.section(section).get(item_id)
        if it is None:
            raise Problem(404, "not_found", f"No {section} item {item_id}.")
        view = item_view(section, item_id, it)
        view["used_by"] = rules.referrers(state, section, item_id)
        view["warnings"] = rules.warnings_for(state, section, item_id)
        return view

    async def profile(self, institution_id: str) -> dict:
        state = await self.state(institution_id)
        sections = {s: [item_view(s, k, it) for k, it in state.section(s).items()] for s in SECTIONS}
        codes = set(state.footprint_codes()) | {state.inst["fields"]["home_country"]}
        for s in ("segments", "rivals", "counterparties", "risk-exposures"):
            for it in state.section(s).values():
                codes |= set(it.data.get("places") or [])
        for it in state.section("flows").values():
            codes |= {it.data["local"], it.data["counterpart"]}
        for it in state.section("watch-places").values():
            if it.data.get("code"):
                codes.add(it.data["code"])
        for it in state.section("regulators").values():
            if it.data.get("country"):
                codes.add(it.data["country"])
        for it in state.section("risk-exposures").values():
            for r in it.data["touches"]["routes"]:
                codes |= set((reference.route(r) or {}).get("places", []))
        rd = self.readiness(state)
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT DISTINCT ON (section, item_id) section, item_id, source, actor, at, proposal_id, op
                   FROM core.profile_changes WHERE institution_id = %s AND item_id IS NOT NULL
                   ORDER BY section, item_id, change_id""", (institution_id,))
            first = await cur.fetchall()
            cur = await conn.execute(
                """SELECT DISTINCT ON (section, item_id) section, item_id, source, actor, at, proposal_id
                   FROM core.profile_changes WHERE institution_id = %s AND item_id IS NOT NULL
                   ORDER BY section, item_id, change_id DESC""", (institution_id,))
            last = {(r["section"], r["item_id"]): r for r in await cur.fetchall()}
        origins: dict[str, dict[str, dict]] = {}
        for r in first:
            if r["item_id"] not in state.section(r["section"]):
                continue
            lr = last[(r["section"], r["item_id"])]
            origins.setdefault(r["section"], {})[r["item_id"]] = {
                "source": r["source"], "by": r["actor"], "at": r["at"], "proposal_id": r["proposal_id"],
                "last_source": lr["source"], "last_by": lr["actor"], "last_at": lr["at"], "last_proposal_id": lr["proposal_id"]}
        return {"institution": self.inst_view(state), "sections": sections, "origins": origins,
                "place_names": {c: reference.place_name(c) for c in sorted(codes)},
                "places": {c: reference.place_info(c) for c in sorted(codes)},
                "readiness": {"ready": rd["ready"], "missing_required": rd["missing_required"],
                              "open_recommendations": rd["open_recommendations"]}}

    def readiness(self, state: State) -> dict:
        f = state.inst["fields"]
        segs, prods = state.section("segments"), state.section("products")
        checks = []

        def check(cid: str, level: str, ok: bool, message: str, section: str, fix: str = ""):
            checks.append({"id": cid, "level": level, "ok": ok, "message": message, "section": section, "fix": fix})

        check("identity", "required", all(f.get(k) for k in ("name", "institution_type", "home_country", "base_currency", "time_zone")),
              "Name, type, home country, base currency and time zone", "institution")
        homes = [i for i in state.section("footprint").values() if i.data["role"] == "home"]
        check("footprint_home", "required", bool(homes), "Where it operates, with its home country", "footprint",
              "Add the home country to the footprint with role home.")
        check("segments", "required", bool(segs), f"{plural(len(segs), 'customer group')}", "segments",
              "Add at least one customer group (categories, never names).")
        check("products", "required", bool(prods), f"{plural(len(prods), 'product')}", "products",
              "Add at least one product from the Metrics Spec taxonomy.")
        no_seg = [k for k, it in prods.items() if not it.data["segments"]]
        check("product_segments", "recommended", not no_seg and bool(prods),
              "Every product names the customer groups it serves" + (f" ({len(no_seg)} don't)" if no_seg else ""),
              "products", "Link each product to its customer groups.")
        no_map = [k for k, it in segs.items() if not it.data["spec_mapping"]]
        check("segment_mapping", "recommended", not no_map and bool(segs),
              "Every customer group maps to a Metrics Spec value" + (f" ({len(no_map)} don't)" if no_map else ""),
              "segments", "Map each group to a spec dimension value, so checks can be scoped to it.")
        sug = [s for s in self._regulator_suggestions(state) if not s["added"]]
        check("regulators", "recommended", bool(state.section("regulators")) and not sug,
              f"{plural(len(state.section('regulators')), 'regulator')}" + (f"; {len(sug)} more suggested by the rule table" if sug else ""),
              "regulators", "Review the suggested regulators.")
        check("rivals", "recommended", bool(state.section("rivals")), f"{plural(len(state.section('rivals')), 'rival')}", "rivals",
              "Add the competitors that matter.")
        check("flows", "recommended", bool(state.section("flows")), f"{plural(len(state.section('flows')), 'flow')} of money and goods",
              "flows", "Review the suggested flows.")
        active = [it for it in state.section("risk-exposures").values() if it.data["status"] == "active"]
        open_finds = [x for x in self._exposure_suggestions(state) if not x["added"]]
        check("risk_exposures", "recommended", bool(active) and not open_finds,
              f"{plural(len(active), 'risk exposure')}" + (f"; the risk finder has {len(open_finds)} more to review" if open_finds else ""),
              "risk-exposures", "Review what the risk finder found.")
        check("governance_body", "recommended", bool(f.get("governance_body")), "Who owns risk decisions", "institution",
              "Name the risk governance body.")
        unlinked = [k for k, it in prods.items() if not (it.data.get("data") or {}).get("source_id")]
        check("product_data", "info", not unlinked, f"{len(prods) - len(unlinked)} of {plural(len(prods), 'product')} linked to a data connection",
              "products", "Checks need each product's numbers from a data connection.")
        req = [c for c in checks if c["level"] == "required" and not c["ok"]]
        rec = [c for c in checks if c["level"] == "recommended" and not c["ok"]]
        warnings = [w for s in SECTIONS for k in state.section(s) for w in rules.warnings_for(state, s, k)]
        return {"institution_id": state.inst["institution_id"], "status": state.inst["status"],
                "ready": not req, "missing_required": len(req), "open_recommendations": len(rec),
                "checks": checks, "warnings": warnings}

    async def readiness_for(self, institution_id: str) -> dict:
        return self.readiness(await self.state(institution_id))

    async def context(self, institution_id: str) -> dict:
        """The compact profile the agents read (investigation, monitors, Radar, assistant)."""
        state = await self.state(institution_id)
        f = state.inst["fields"]
        S = state.section
        flows = sorted((it.data for it in S("flows").values()), key=lambda d: -((d.get("value") or {}).get("amount") or 0))
        cats = sorted({it.data["category"] for it in S("products").values()})
        themes = list(dict.fromkeys([t for c in cats for t in CATEGORY_THEMES.get(c, [])] + ALWAYS_THEMES +
                                    (["competitor"] if S("rivals") else []) +
                                    (["remittance"] if any(d["kind"].startswith("remittances") for d in flows) else [])))
        themes = [t for t in themes if t in spec.spec()["themes"]]
        places = list(dict.fromkeys(
            state.footprint_codes() + [it.data["code"] for it in S("watch-places").values() if it.data.get("code")]
            + [d["counterpart"] for d in flows]
            + [p for it in S("risk-exposures").values() if it.data["status"] == "active" for p in it.data["places"]]))
        named = [it.data["name"] for it in S("watch-places").values() if not it.data.get("code")]

        def money(d):
            v = d.get("value")
            return None if not v else {"amount": v["amount"], "currency": v["currency"], "year": v["year"],
                                       "source": d["source"].get("dataset") or d["source"]["kind"], "sample": d["source"].get("sample", False)}

        return {
            "institution_id": state.inst["institution_id"], "profile_version": state.inst["profile_version"],
            "status": state.inst["status"], "name": f["name"], "institution_type": f["institution_type"],
            "subtype": f.get("subtype"), "islamic": f.get("islamic", False), "country": f["home_country"],
            "currency": f["base_currency"], "time_zone": f["time_zone"], "summary": f.get("summary") or "",
            "governance_body": f.get("governance_body"), "clearing_currencies": f.get("clearing_currencies", []),
            "footprint": [{"code": it.data["code"], "name": reference.place_name(it.data["code"]), "role": it.data["role"]}
                          for it in S("footprint").values()],
            "segments": [{"id": k, "label": it.data["label"], "kind": it.data["kind"], "note": it.data.get("note"),
                          "places": it.data["places"], "income_sources": it.data["income_sources"],
                          "spec_mapping": it.data["spec_mapping"]} for k, it in S("segments").items()],
            "products": [{"id": k, "name": it.data["name"], "category": it.data["category"],
                          "product_type": it.data["product_type"], "islamic": it.data["islamic"],
                          "segments": it.data["segments"], "status": it.data["status"], "owner": it.data.get("owner")}
                         for k, it in S("products").items() if it.data["status"] != "closed"],
            "flows": [{"kind": d["kind"], "local": d["local"], "counterpart": d["counterpart"], "goods": d.get("goods"),
                       "value": money(d)} for d in flows],
            "corridors": list(dict.fromkeys(d["counterpart"] for d in flows if d["kind"] == "remittances_in")),
            "regulators": [{"name": it.data["name"], "short": it.data.get("short"), "area": it.data["area"],
                            "relation": it.data["relation"]} for it in S("regulators").values()],
            "rivals": [{"name": it.data["name"], "type": it.data["type"], "aliases": it.data["aliases"],
                        "overlap": it.data["overlap"]} for it in S("rivals").values()],
            "counterparties": [{"name": it.data["name"], "kind": it.data["kind"], "aliases": it.data["aliases"]}
                               for it in S("counterparties").values()],
            "risk_exposures": [{"title": it.data["title"], "kind": it.data["kind"], "places": it.data["places"],
                                "months": it.data["months"], "hazard_id": it.data["hazard_id"],
                                "touches": it.data["touches"]}
                               for it in S("risk-exposures").values() if it.data["status"] == "active"],
            "radar_scope": {
                "places": places, "named_places": named, "themes": themes, "why": self._scope_reasons(state, flows),
                "actors": list(dict.fromkeys(
                    [it.data.get("short") or it.data["name"] for it in S("regulators").values()]
                    + [it.data["name"] for it in S("rivals").values()]
                    + [it.data["name"] for it in S("counterparties").values()])),
            },
        }

    @staticmethod
    def _scope_reasons(state: State, flows: list[dict]) -> dict[str, list[str]]:
        """Why each place is in the Radar scope (scenario S22)."""
        why: dict[str, list[str]] = {}

        def add(code: str | None, reason: str) -> None:
            if code:
                why.setdefault(code, [])
                if reason not in why[code]:
                    why[code].append(reason)

        S = state.section
        for it in S("footprint").values():
            add(it.data["code"], f"footprint ({it.data['role'].replace('_', ' ')})")
        for it in S("watch-places").values():
            add(it.data.get("code"), f"place to watch: {it.data.get('reason') or it.data['name']}")
        for d in flows:
            add(d["counterpart"], f"flow: {d['kind'].replace('_', ' ')}{' (' + d['goods'] + ')' if d.get('goods') else ''} with {d['local']}")
        for it in S("risk-exposures").values():
            if it.data["status"] == "active":
                for p in it.data["places"]:
                    add(p, f"risk: {it.data['title']}")
        return why

    async def undo(self, institution_id: str, batch_id: str) -> dict:
        """The operations that undo one batch, from the history's before and after values. Not applied:
        the forms apply them with :batch, the setup agent proposes them (scenario S21)."""
        async with self.pool.connection() as conn:
            await self._load(conn, institution_id, lock=False)
            cur = await conn.execute(
                """SELECT * FROM core.profile_changes WHERE institution_id = %s AND batch_id = %s ORDER BY change_id""",
                (institution_id, batch_id))
            rows = await cur.fetchall()
        if not rows:
            raise Problem(404, "not_found", f"No change {batch_id}.")
        creates, updates, deletes = [], [], []
        for r in rows:
            if r["op"] == "status":
                continue
            if r["section"] == "institution":
                if r["op"] == "update" and r["before"]:
                    updates.append(Operation(op="update", section="institution", data=r["before"]))
                continue
            if r["op"] == "create":
                deletes.append(Operation(op="delete", section=r["section"], id=r["item_id"]))
            elif r["op"] == "update":
                updates.append(Operation(op="update", section=r["section"], id=r["item_id"], data=r["before"]))
            elif r["op"] == "delete":
                creates.append(Operation(op="create", section=r["section"], id=r["item_id"], data=r["before"]))
        ops = [*creates, *updates, *deletes[::-1]]
        out = {"batch_id": batch_id, "source": rows[0]["source"], "actor": rows[0]["actor"], "at": rows[0]["at"],
               "proposal_id": rows[0]["proposal_id"], "operations": [o.model_dump(mode="json", exclude_none=True) for o in ops]}
        if not ops:
            return {**out, "valid": False, "errors": [{"code": "nothing_to_undo", "message": "This change can't be undone."}], "changes": []}
        try:
            dry = await self.batch(institution_id, ops, "undo", "form", dry_run=True)
            return {**out, "valid": True, "errors": [], "changes": dry["changes"]}
        except Problem as e:
            return {**out, "valid": False, "errors": e.extra.get("errors") or [{"code": e.code, "message": e.detail}], "changes": []}

    async def history(self, institution_id: str, section: str | None, item_id: str | None,
                      limit: int, before: int | None, since_version: int | None = None,
                      source: str | None = None) -> dict:
        async with self.pool.connection() as conn:
            await self._load(conn, institution_id, lock=False)
            cur = await conn.execute(
                """SELECT change_id, profile_version, at, actor, source, batch_id, section, item_id, op, before, after,
                          proposal_id
                   FROM core.profile_changes WHERE institution_id = %(i)s
                     AND (%(s)s::text IS NULL OR section = %(s)s) AND (%(it)s::text IS NULL OR item_id = %(it)s)
                     AND (%(b)s::bigint IS NULL OR change_id < %(b)s)
                     AND (%(v)s::int IS NULL OR profile_version > %(v)s)
                     AND (%(src)s::text IS NULL OR source = %(src)s)
                   ORDER BY change_id DESC LIMIT %(n)s""",
                {"i": institution_id, "s": section, "it": item_id, "b": before, "v": since_version,
                 "src": source, "n": limit + 1},
            )
            rows = await cur.fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        return {"items": rows, "next_before": rows[-1]["change_id"] if more else None}

    # ------------------------------------------------ suggestions (code, from reference data and the spec)

    async def suggestions(self, institution_id: str, section: str) -> dict:
        state = await self.state(institution_id)
        fn = {"products": self._product_suggestions, "segments": self._segment_suggestions,
              "regulators": self._regulator_suggestions, "flows": self._flow_suggestions,
              "risk-exposures": self._exposure_suggestions, "rivals": self._rival_suggestions}.get(section)
        if fn is None:
            raise Problem(404, "not_found", f"No suggestions for {section} (products, segments, regulators, flows, risk-exposures, rivals).")
        items = fn(state)
        return {"section": section, "items": items,
                "note": {"regulators": "From the rule table (to be reviewed by compliance).",
                         "flows": "Figures from reference data; in the prototype they are sample figures.",
                         "products": "Metrics Spec product types for this institution type.",
                         "segments": "Common customer groups, each mapped to a Metrics Spec value.",
                         "risk-exposures": "The risk finder: hazards from the hazard library whose places overlap "
                                           "your footprint, customer groups, flows or sea routes.",
                         "rivals": "Licensed banks and insurers in your markets, of a similar size, from a sample reference "
                                   "list (AU, NZ, LK so far; to be reviewed). None for other markets: name your own."}[section]}

    def _rival_suggestions(self, state: State) -> list[dict]:
        f = state.inst["fields"]
        have = {n.casefold() for it in state.section("rivals").values() for n in [it.data["name"], *it.data.get("aliases", [])]}
        kinds = {it.data.get("kind") for it in state.section("segments").values()}
        return rivals.suggest(reference.institution_rows(), state.type, f.get("size_band"), f["home_country"],
                              state.footprint_countries() | {f["home_country"]}, kinds, have, reference.place_name)

    def _product_suggestions(self, state: State) -> list[dict]:
        have = {(it.data["category"], it.data["product_type"]) for it in state.section("products").values()}
        islamic = state.inst["fields"].get("islamic", False)
        out = []
        for c in spec.categories(state.type):
            for p in c["product_types"]:
                out.append({"added": (c["id"], p["id"]) in have, "category_name": c["name"],
                            "typical_products": p["typical_products"], "islamic_variant": p["islamic_variant"],
                            "item": {"name": p["id"].replace("_", " ").capitalize(), "category": c["id"],
                                     "product_type": p["id"], "islamic": islamic and bool(p["islamic_variant"])}})
        return out

    def _segment_suggestions(self, state: State) -> list[dict]:
        have = {it.data["label"].casefold() for it in state.section("segments").values()}
        maps = {tuple((m["dimension"], m["value"]) for m in it.data["spec_mapping"]) for it in state.section("segments").values()}
        out = []
        for t in reference.segment_template_rows():
            if t["institution_type"] != state.type:
                continue
            key = tuple((m["dimension"], m["value"]) for m in t["spec_mapping"])
            out.append({"added": t["label"].casefold() in have or (bool(key) and key in maps),
                        "item": {"template_id": t["template_id"],
                                 **{k: t[k] for k in ("label", "kind", "note", "income_sources", "spec_mapping")}}})
        return out

    def _regulator_suggestions(self, state: State) -> list[dict]:
        f = state.inst["fields"]
        table = reference.regulators()
        have = {it.data["name"].casefold() for it in state.section("regulators").values()}
        out: list[dict] = []

        have_ids = {it.data.get("regulator_id") for it in state.section("regulators").values()}

        def add(r: dict, relation: str, why: str):
            if state.type not in r.get("for", ["bank", "insurer"]):
                return
            if r.get("islamic_only") and not f.get("islamic"):
                return
            if any(o["item"]["regulator_id"] == r["regulator_id"] for o in out):
                return
            out.append({"added": r["regulator_id"] in have_ids or r["name"].casefold() in have,
                        "reviewed": table["reviewed"], "why": why,
                        "item": {"regulator_id": r["regulator_id"], "name": r["name"], "short": r.get("short"),
                                 "country": r.get("country"), "area": r["area"], "relation": relation, "basis": "rule",
                                 "rule_ref": r["regulator_id"], "controls": r.get("controls", [])}})

        rows = reference.regulator_rows()
        home = f["home_country"]
        for r in rows:
            if r.get("country") == home:
                add(r, "home", f"home country {reference.place_name(home)}")
        for c in sorted(state.footprint_countries() - {home}):
            for r in rows:
                if r.get("country") == c:
                    add(r, "host", f"you operate in {reference.place_name(c)}")
        for cur, rid in reference.sanctions_rows():
            if cur in f.get("clearing_currencies", []):
                add(reference.regulator(rid), "reach", f"you clear payments in {cur}")
        for r in rows:
            if r["regulator_id"].startswith("global-"):
                add(r, "standard", "a global standard for your type of institution")
        return out

    def _flow_suggestions(self, state: State) -> list[dict]:
        fp = set(state.footprint_codes())
        fpc = state.footprint_countries()
        have = {(it.data["kind"], it.data["local"], it.data["counterpart"], it.data.get("goods"))
                for it in state.section("flows").values()}
        out = []
        for r in reference.flow_figure_rows():
            local, counterpart = r["local"], r["counterpart"]
            if not rules.in_footprint(local, fp, fpc):
                continue
            item = {"kind": r["kind"], "local": local, "counterpart": counterpart, "goods": r.get("goods"),
                    "figure_id": r["figure_id"],
                    "value": {"amount": r["amount"], "currency": "USD", "year": r["year"]},
                    "source": {"kind": "dataset", "dataset": r["dataset"], "dataset_year": r["year"],
                               "sample": r.get("sample", False)},
                    "status": "suggested"}
            out.append({"added": (r["kind"], local, counterpart, r.get("goods")) in have, "item": item})
        return out

    def _exposure_suggestions(self, state: State) -> list[dict]:
        """The risk finder: a hazard meets something the institution depends on when one of its
        places overlaps a footprint place, a customer group's place, a flow's end, or a place on
        a sea route one of its flows takes. Code only."""
        S = state.section
        by_hazard = {it.data.get("hazard_id"): (k, it) for k, it in S("risk-exposures").items() if it.data.get("hazard_id")}
        fp = state.footprint_codes()
        out = []
        for h in reference.hazards():
            hp = h["places"]

            def hit(code: str, hp: list[str] = hp) -> bool:  # overlaps: either inside the other
                return any(reference.overlaps(code, x) for x in hp)

            def within(code: str, hp: list[str] = hp) -> bool:  # the place lies inside the hazard
                return any(code == x or x in reference.ancestors(code) for x in hp)

            segs = [k for k, it in S("segments").items() if any(hit(p) for p in it.data["places"])]
            # a route is hit where it passes a strait or sea in the hazard (its ports are covered by the footprint)
            routes = [r["route_id"] for r in reference.routes()
                      if any(within(p) for p in r["places"] if p.startswith(("chk:", "sea:")))]
            # a flow is hit when one of its ends is inside the hazard, or its sea route crosses it
            # (a flow to "all of Sri Lanka" isn't hit by floods in one province)
            flows = [k for k, it in S("flows").items()
                     if within(it.data["local"]) or within(it.data["counterpart"]) or (it.data.get("route_id") in routes)]
            fp_hit = [c for c in fp if hit(c)]
            if not (segs or flows or fp_hit):
                continue
            flow_segs = {s for k in flows for s in S("flows")[k].data["segments"]}
            all_segs = list(dict.fromkeys(segs + sorted(flow_segs)))
            prods = [k for k, it in S("products").items() if set(it.data["segments"]) & set(all_segs)]
            if flows:
                kinds = [S("flows")[k].data["kind"] for k in flows]
                what = FLOW_WORDS[max(set(kinds), key=kinds.count)]
            elif segs:
                what = S("segments")[segs[0]].data["label"].lower()
            else:
                what = "your footprint"
            existing = by_hazard.get(h["hazard_id"])
            out.append({
                "added": existing is not None,
                "status": existing[1].data["status"] if existing else None,
                "existing_id": existing[0] if existing else None,
                "hazard": {"hazard_id": h["hazard_id"], "name": h["name"], "kind": h["kind"], "note": h.get("note"),
                           "months": h["months"], "centre": h.get("centre"), "radius_km": h.get("radius_km")},
                "matched": {"footprint": fp_hit, "segments": segs, "flows": flows,
                            "routes": [r for r in routes if any(S("flows")[k].data.get("route_id") == r for k in flows)]},
                "item": {"hazard_id": h["hazard_id"], "title": f"{h['name']} meets {what}", "kind": h["kind"],
                         "months": h["months"], "places": hp, "source": "finder",
                         "touches": {"segments": all_segs, "products": prods, "flows": flows,
                                     "routes": [r for r in routes if any(S("flows")[k].data.get("route_id") == r for k in flows)],
                                     "watch_places": []}},
            })
        return out
