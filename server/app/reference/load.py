"""Loads the reference files into the ref schema (amiri ref-load; also at start-up).

Idempotent: rows are upserted by key; a content hash in ref.meta skips the load
when nothing changed. A row that disappeared from the files is deleted unless a
profile still points at it (then it stays, and the load reports it).
"""

import hashlib
import json
from pathlib import Path

import pycountry
from psycopg import errors as pg_errors
from psycopg.types.json import Jsonb

from app import reference, spec

HERE = Path(__file__).parent
ISIC_SECTIONS = list("ABCDEFGHIJKLMNOPQRSTU")


def content_hash() -> str:
    h = hashlib.sha256()
    for f in [*sorted(HERE.glob("*.json")), spec.SNAPSHOT]:
        h.update(f.name.encode())
        h.update(f.read_bytes())
    h.update(pycountry.__version__.encode() if hasattr(pycountry, "__version__") else b"pycountry")
    return h.hexdigest()[:16]


def _rows() -> dict[str, tuple[list[str], list[str], list[tuple]]]:
    """table → (columns, key columns, rows)."""
    places = reference.all_places()
    t: dict[str, tuple[list[str], list[str], list[tuple]]] = {}
    t["ref.places"] = (["place_code", "kind", "name", "parent_code", "country_code", "lat", "lon", "iso"], ["place_code"],
                       [(p["code"], p["kind"], p["name"] or p["code"], p["parent"], p["country"], p["lat"], p["lon"],
                         reference.is_iso_place(p["code"])) for p in places])
    t["ref.currencies"] = (["currency_code", "name"], ["currency_code"],
                           [(c["code"], c["name"]) for c in reference.currencies()])
    cats = spec.categories()
    t["ref.product_categories"] = (["category_id", "institution_type", "name"], ["category_id"],
                                   [(c["id"], c["institution"], c["name"]) for c in cats])
    t["ref.product_types"] = (["product_type_id", "category_id", "typical_products", "islamic_variant", "attribute_schema"],
                              ["product_type_id"],
                              [(p["id"], c["id"], p["typical_products"], p["islamic_variant"], None)
                               for c in cats for p in c["product_types"]])
    dims = [(k, v) for k, d in spec.spec()["dimensions"].items() for v in (d["values"] or [])]
    dims += [(d, s) for d in ("sector", "employer_sector") for s in ISIC_SECTIONS]
    t["ref.spec_dimension_values"] = (["dimension", "value"], ["dimension", "value"], sorted(set(dims)))
    t["ref.segment_templates"] = (["template_id", "institution_type", "label", "kind", "note", "income_sources", "spec_values"],
                                  ["template_id"],
                                  [(x["template_id"], x["institution_type"], x["label"], x["kind"], x.get("note"),
                                    x.get("income_sources", []), Jsonb(x.get("spec_mapping", [])))
                                   for x in reference.segment_template_rows()])
    reviewed = bool(reference.regulators().get("reviewed"))
    t["ref.regulators"] = (["regulator_id", "name", "short", "country_code", "area", "for_bank", "for_insurer",
                            "islamic_only", "controls", "reviewed"], ["regulator_id"],
                           [(r["regulator_id"], r["name"], r.get("short"), r.get("country"), r["area"],
                             "bank" in r.get("for", ["bank", "insurer"]), "insurer" in r.get("for", ["bank", "insurer"]),
                             bool(r.get("islamic_only")), r.get("controls", []), reviewed)
                            for r in reference.regulator_rows()])
    t["ref.flow_figures"] = (["figure_id", "kind", "local_place", "counterpart_place", "goods", "amount_usd", "year",
                              "dataset", "sample"], ["figure_id"],
                             [(f["figure_id"], f["kind"], f["local"], f["counterpart"], f.get("goods"), f["amount"],
                               f["year"], f["dataset"], bool(f.get("sample"))) for f in reference.flow_figure_rows()])
    t["ref.routes"] = (["route_id", "name", "kind", "points"], ["route_id"],
                       [(r["route_id"], r["name"], r["kind"], Jsonb(r["points"])) for r in reference.routes()])
    t["ref.hazards"] = (["hazard_id", "kind", "name", "note", "months", "centre_lat", "centre_lon", "radius_km"], ["hazard_id"],
                        [(h["hazard_id"], h["kind"], h["name"], h.get("note"), h.get("months", []),
                          (h.get("centre") or [None, None])[0], (h.get("centre") or [None, None])[1], h.get("radius_km"))
                         for h in reference.hazards()])
    return t


def _children() -> dict[str, tuple[list[str], list[tuple]]]:
    """Tables nothing in core points at: replaced whole."""
    aliases = [(p["code"], a) for p in reference.gazetteer()["places"] for a in set(p.get("aliases", []))]
    return {
        "ref.place_aliases": (["place_code", "alias"], aliases),
        "ref.sanctions_regimes": (["currency_code", "regulator_id"], sorted(set(reference.sanctions_rows()))),
        "ref.route_places": (["route_id", "seq", "place_code"],
                             [(r["route_id"], i, p) for r in reference.routes() for i, p in enumerate(r["places"])]),
        "ref.hazard_places": (["hazard_id", "place_code"],
                              sorted({(h["hazard_id"], p) for h in reference.hazards() for p in h["places"]})),
    }


async def load(conn, force: bool = False) -> dict | None:
    """Brings the ref tables up to the files. Returns what it did, or None if nothing changed."""
    want = content_hash()
    cur = await conn.execute("SELECT value FROM ref.meta WHERE key = 'hash'")
    row = await cur.fetchone()
    if row and row["value"] == want and not force:
        return None
    report: dict = {"hash": want, "tables": {}, "kept_in_use": {}}
    async with conn.transaction():
        await conn.execute("SET CONSTRAINTS ALL DEFERRED")
        for table, (cols, keys, rows) in _rows().items():
            tmp = "tmp_" + table.split(".")[1]
            await conn.execute(f"CREATE TEMP TABLE {tmp} (LIKE {table} INCLUDING DEFAULTS) ON COMMIT DROP")
            async with conn.cursor().copy(f"COPY {tmp} ({', '.join(cols)}) FROM STDIN") as cp:
                for r in rows:
                    await cp.write_row([json.dumps(x.obj) if isinstance(x, Jsonb) else x for x in r])
            upd = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in keys)
            await conn.execute(
                f"INSERT INTO {table} ({', '.join(cols)}) SELECT {', '.join(cols)} FROM {tmp} "
                f"ON CONFLICT ({', '.join(keys)}) " + (f"DO UPDATE SET {upd}" if upd else "DO NOTHING"))
            key = ", ".join(keys)
            try:
                async with conn.transaction():
                    cur = await conn.execute(
                        f"DELETE FROM {table} t WHERE NOT EXISTS (SELECT 1 FROM {tmp} x WHERE "
                        + " AND ".join(f"x.{k} = t.{k}" for k in keys) + f") RETURNING {key}")
                    gone = len(await cur.fetchall())
            except pg_errors.ForeignKeyViolation:
                gone = 0
                report["kept_in_use"][table] = "rows no longer in the files are still used by a profile"
            report["tables"][table] = {"rows": len(rows), "removed": gone}
        for table, (cols, rows) in _children().items():
            await conn.execute(f"DELETE FROM {table}")
            async with conn.cursor().copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
                for r in rows:
                    await cp.write_row(r)
            report["tables"][table] = {"rows": len(rows)}
        await conn.execute(
            "INSERT INTO ref.meta (key, value) VALUES ('hash', %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (want,))
    return report
