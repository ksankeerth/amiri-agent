"""Reads and writes the institution profile's tables (migration 0003).

The service works on items in the API's JSON shape; this module maps them to the
main table of each section and its link tables, and back. Writing an item upserts
its row and replaces its link rows; deleting removes the row (its own links go with
it; links from other items are RESTRICT, so they must be removed first, which the
service does).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from psycopg.types.json import Jsonb

from app.institutions.rules import Item, State
from app.institutions.schemas import SECTIONS

INST_COLS = ["name", "legal_name", "short_name", "institution_type", "subtype", "islamic", "lei", "home_country",
             "base_currency", "time_zone", "summary", "governance_body", "size_band", "fiscal_year_start_month", "website"]


@dataclass
class Link:
    table: str
    cols: tuple[str, ...]          # value columns
    path: tuple[str, ...]          # where in the item: ("places",) or ("touches", "segments")


@dataclass
class Spec:
    table: str
    id_col: str
    to_row: Callable[[dict, State], dict]
    from_row: Callable[[dict], dict]
    links: list[Link] = field(default_factory=list)


def _num(x):
    if isinstance(x, Decimal):
        return float(x)
    return x


def _d(x):
    return x.isoformat() if isinstance(x, (date, datetime)) else x


SPECS: dict[str, Spec] = {
    "footprint": Spec(
        "core.footprint", "footprint_id",
        lambda d, s: {"place_code": d["code"], "role": d["role"], "scope": d["scope"],
                      "branch_count": d.get("branch_count"), "note": d.get("note")},
        lambda r: {"code": r["place_code"], "role": r["role"], "scope": r["scope"],
                   "branch_count": r["branch_count"], "note": r["note"]}),
    "watch-places": Spec(
        "core.watch_places", "watch_place_id",
        lambda d, s: {"name": d["name"], "place_code": d.get("code"), "kind": d["kind"], "reason": d.get("reason"),
                      "lat": d.get("lat"), "lon": d.get("lon")},
        lambda r: {"name": r["name"], "code": r["place_code"], "kind": r["kind"], "reason": r["reason"],
                   "lat": r["lat"], "lon": r["lon"]}),
    "segments": Spec(
        "core.segments", "segment_id",
        lambda d, s: {"label": d["label"], "kind": d["kind"], "note": d.get("note"),
                      "income_sources": d.get("income_sources") or [],
                      "share_of_customers_pct": d.get("share_of_customers_pct"), "template_id": d.get("template_id")},
        lambda r: {"label": r["label"], "kind": r["kind"], "note": r["note"], "income_sources": list(r["income_sources"]),
                   "share_of_customers_pct": _num(r["share_of_customers_pct"]), "template_id": r["template_id"]},
        [Link("core.segment_places", ("place_code",), ("places",)),
         Link("core.segment_spec_values", ("dimension", "value"), ("spec_mapping",))]),
    "products": Spec(
        "core.products", "product_id",
        lambda d, s: {"institution_type": s.type, "name": d["name"], "category_id": d["category"],
                      "product_type_id": d["product_type"], "islamic": d["islamic"], "owner": d.get("owner"),
                      "status": d["status"], "launched_on": d.get("launched_on"),
                      "book_amount": (d.get("book_size") or {}).get("amount"),
                      "book_currency": (d.get("book_size") or {}).get("currency"),
                      "book_as_of": (d.get("book_size") or {}).get("as_of"),
                      "data_source_id": (d.get("data") or {}).get("source_id"),
                      "catalog_product_id": (d.get("data") or {}).get("catalog_product_id"),
                      "attributes": Jsonb(d.get("attributes") or {}), "note": d.get("note")},
        lambda r: {"name": r["name"], "category": r["category_id"], "product_type": r["product_type_id"],
                   "islamic": r["islamic"], "owner": r["owner"], "status": r["status"], "launched_on": _d(r["launched_on"]),
                   "book_size": None if r["book_amount"] is None else
                   {"amount": _num(r["book_amount"]), "currency": r["book_currency"], "as_of": _d(r["book_as_of"])},
                   "data": None if r["data_source_id"] is None and r["catalog_product_id"] is None else
                   {"source_id": r["data_source_id"], "catalog_product_id": r["catalog_product_id"]},
                   "attributes": r["attributes"] or {}, "note": r["note"]},
        [Link("core.product_currencies", ("currency_code",), ("currencies",)),
         Link("core.product_segments", ("segment_id",), ("segments",))]),
    "flows": Spec(
        "core.flows", "flow_id",
        lambda d, s: {"kind": d["kind"], "local_place": d["local"], "counterpart_place": d["counterpart"],
                      "route_id": d.get("route_id"), "figure_id": d.get("figure_id"), "label": d.get("label"),
                      "goods": d.get("goods"),
                      "amount": (d.get("value") or {}).get("amount"), "currency": (d.get("value") or {}).get("currency"),
                      "year": (d.get("value") or {}).get("year"),
                      "source_kind": d["source"]["kind"], "dataset": d["source"].get("dataset"),
                      "dataset_year": d["source"].get("dataset_year"), "source_url": d["source"].get("url"),
                      "sample": d["source"].get("sample", False),
                      "original_amount": d["source"].get("original_amount"), "edited_by": d["source"].get("edited_by"),
                      "edited_at": d["source"].get("edited_at"), "status": d["status"], "note": d.get("note")},
        lambda r: {"kind": r["kind"], "local": r["local_place"], "counterpart": r["counterpart_place"],
                   "route_id": r["route_id"], "figure_id": r["figure_id"], "label": r["label"], "goods": r["goods"],
                   "value": None if r["amount"] is None else
                   {"amount": _num(r["amount"]), "currency": r["currency"], "year": r["year"]},
                   "source": {"kind": r["source_kind"], "dataset": r["dataset"], "dataset_year": r["dataset_year"],
                              "url": r["source_url"], "sample": r["sample"], "original_amount": _num(r["original_amount"]),
                              "edited_by": r["edited_by"], "edited_at": r["edited_at"]},
                   "status": r["status"], "note": r["note"]},
        [Link("core.flow_segments", ("segment_id",), ("segments",))]),
    "regulators": Spec(
        "core.regulators", "item_id",
        lambda d, s: {"regulator_id": d.get("regulator_id"), "name": d["name"], "short": d.get("short"),
                      "country_code": d.get("country"), "area": d["area"], "relation": d["relation"],
                      "basis": d["basis"], "rule_ref": d.get("rule_ref"), "controls": d.get("controls") or [],
                      "note": d.get("note")},
        lambda r: {"regulator_id": r["regulator_id"], "name": r["name"], "short": r["short"], "country": r["country_code"],
                   "area": r["area"], "relation": r["relation"], "basis": r["basis"], "rule_ref": r["rule_ref"],
                   "controls": list(r["controls"]), "note": r["note"]}),
    "rivals": Spec(
        "core.rivals", "rival_id",
        lambda d, s: {"name": d["name"], "type": d["type"], "overlap": d["overlap"], "aliases": d.get("aliases") or [],
                      "website": d.get("website"), "note": d.get("note")},
        lambda r: {"name": r["name"], "type": r["type"], "overlap": r["overlap"], "aliases": list(r["aliases"]),
                   "website": r["website"], "note": r["note"]},
        [Link("core.rival_places", ("place_code",), ("places",)),
         Link("core.rival_categories", ("category_id",), ("categories",))]),
    "counterparties": Spec(
        "core.counterparties", "counterparty_id",
        lambda d, s: {"name": d["name"], "kind": d["kind"], "importance": d["importance"],
                      "aliases": d.get("aliases") or [], "note": d.get("note")},
        lambda r: {"name": r["name"], "kind": r["kind"], "importance": r["importance"], "aliases": list(r["aliases"]),
                   "note": r["note"]},
        [Link("core.counterparty_places", ("place_code",), ("places",))]),
    "risk-exposures": Spec(
        "core.risk_exposures", "exposure_id",
        lambda d, s: {"title": d["title"], "hazard_id": d.get("hazard_id"), "kind": d["kind"],
                      "months": d.get("months") or [], "source": d["source"], "status": d["status"], "note": d.get("note")},
        lambda r: {"title": r["title"], "hazard_id": r["hazard_id"], "kind": r["kind"], "months": list(r["months"]),
                   "source": r["source"], "status": r["status"], "note": r["note"]},
        [Link("core.exposure_places", ("place_code",), ("places",)),
         Link("core.exposure_segments", ("segment_id",), ("touches", "segments")),
         Link("core.exposure_products", ("product_id",), ("touches", "products")),
         Link("core.exposure_flows", ("flow_id",), ("touches", "flows")),
         Link("core.exposure_routes", ("route_id",), ("touches", "routes")),
         Link("core.exposure_watch_places", ("watch_place_id",), ("touches", "watch_places"))]),
}
# Write order: an item's targets first. Deletes run in reverse.
ORDER = ["segments", "watch-places", "footprint", "products", "flows", "regulators", "rivals", "counterparties",
         "risk-exposures"]
assert set(ORDER) == set(SECTIONS) == set(SPECS)


def _get(d: dict, path: tuple[str, ...]) -> list:
    for k in path:
        d = (d or {}).get(k) or {}
    return d if isinstance(d, list) else []


def _put(d: dict, path: tuple[str, ...], value: list) -> None:
    for k in path[:-1]:
        d = d.setdefault(k, {})
    d[path[-1]] = value


# ---------------------------------------------------------------- read


async def load_institution(conn, institution_id: str, lock: bool) -> dict | None:
    cur = await conn.execute(
        f"SELECT * FROM core.institutions WHERE institution_id = %s{' FOR UPDATE' if lock else ''}", (institution_id,))
    r = await cur.fetchone()
    if not r:
        return None
    cur = await conn.execute(
        "SELECT currency_code FROM core.institution_currencies WHERE institution_id = %s AND role = 'clearing' "
        "ORDER BY position", (institution_id,))
    clearing = [x["currency_code"] for x in await cur.fetchall()]
    fields = {c: r[c] for c in INST_COLS}
    fields["clearing_currencies"] = clearing
    return {"institution_id": r["institution_id"], "name": r["name"], "institution_type": r["institution_type"],
            "fields": fields, "status": r["status"], "version": r["version"], "profile_version": r["profile_version"],
            "created_at": r["created_at"], "updated_at": r["updated_at"], "activated_at": r["activated_at"],
            "archived_at": r["archived_at"]}


async def load_state(conn, institution_id: str, lock: bool) -> State | None:
    inst = await load_institution(conn, institution_id, lock)
    if inst is None:
        return None
    state = State(inst=inst)
    for sec, sp in SPECS.items():
        cur = await conn.execute(f"SELECT * FROM {sp.table} WHERE institution_id = %s ORDER BY position, {sp.id_col}",
                                 (institution_id,))
        rows = await cur.fetchall()
        data = {r[sp.id_col]: sp.from_row(r) for r in rows}
        for ln in sp.links:
            cur = await conn.execute(
                f"SELECT {sp.id_col}, {', '.join(ln.cols)} FROM {ln.table} WHERE institution_id = %s "
                f"ORDER BY {sp.id_col}, position", (institution_id,))
            grouped: dict[str, list] = {}
            for lr in await cur.fetchall():
                v = lr[ln.cols[0]] if len(ln.cols) == 1 else {c: lr[c] for c in ln.cols}
                grouped.setdefault(lr[sp.id_col], []).append(v)
            for iid, d in data.items():
                _put(d, ln.path, grouped.get(iid, []))
        model = SECTIONS[sec]
        for r in rows:
            iid = r[sp.id_col]
            # through the model, so stored items compare equal to freshly validated ones
            norm = model(**data[iid]).model_dump(mode="json")
            state.section(sec)[iid] = Item(norm, r["version"], r["position"], r["created_at"], r["updated_at"],
                                           r["created_by"], r["updated_by"])
    return state


# ---------------------------------------------------------------- write


async def write_institution(conn, state: State, now: datetime, bump_version: bool, profile_version: int,
                            insert: bool = False) -> None:
    f = state.inst["fields"]
    vals = [f.get(c) for c in INST_COLS]
    iid = state.inst["institution_id"]
    if insert:
        await conn.execute(
            f"INSERT INTO core.institutions (institution_id, {', '.join(INST_COLS)}, created_at, updated_at) "
            f"VALUES (%s, {', '.join(['%s'] * len(INST_COLS))}, %s, %s)", [iid, *vals, now, now])
    else:
        sets = ", ".join(f"{c} = %s" for c in INST_COLS)
        await conn.execute(
            f"UPDATE core.institutions SET {sets}, version = version + %s, profile_version = %s, updated_at = %s "
            "WHERE institution_id = %s", [*vals, 1 if bump_version else 0, profile_version, now, iid])
    await conn.execute("DELETE FROM core.institution_currencies WHERE institution_id = %s AND role = 'clearing'", (iid,))
    for i, c in enumerate(f.get("clearing_currencies") or []):
        await conn.execute(
            "INSERT INTO core.institution_currencies (institution_id, currency_code, role, position) VALUES (%s, %s, 'clearing', %s)",
            (iid, c, i))


async def write_item(conn, state: State, section: str, item_id: str, it: Item, now: datetime) -> None:
    sp = SPECS[section]
    iid = state.inst["institution_id"]
    row = sp.to_row(it.data, state)
    meta = {"position": it.position, "version": it.version, "created_at": it.created_at or now,
            "updated_at": it.updated_at or now, "created_by": it.created_by, "updated_by": it.updated_by}
    cols = ["institution_id", sp.id_col, *row, *meta]
    upd = ", ".join(f"{c} = EXCLUDED.{c}" for c in [*row, "position", "version", "updated_at", "updated_by"])
    await conn.execute(
        f"INSERT INTO {sp.table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
        f"ON CONFLICT (institution_id, {sp.id_col}) DO UPDATE SET {upd}",
        [iid, item_id, *row.values(), *meta.values()])
    for ln in sp.links:
        await conn.execute(f"DELETE FROM {ln.table} WHERE institution_id = %s AND {sp.id_col} = %s", (iid, item_id))
        values = _get(it.data, ln.path)
        if not values:
            continue
        rows = [[iid, item_id, *([v] if len(ln.cols) == 1 else [v[c] for c in ln.cols]), i] for i, v in enumerate(values)]
        async with conn.cursor() as c:
            await c.executemany(
                f"INSERT INTO {ln.table} (institution_id, {sp.id_col}, {', '.join(ln.cols)}, position) "
                f"VALUES ({', '.join(['%s'] * (len(ln.cols) + 3))})", rows)


async def delete_item(conn, institution_id: str, section: str, item_id: str) -> None:
    sp = SPECS[section]
    await conn.execute(f"DELETE FROM {sp.table} WHERE institution_id = %s AND {sp.id_col} = %s", (institution_id, item_id))
