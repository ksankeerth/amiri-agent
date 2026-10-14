"""The investigation agent's request (agents/investigation-agent/openapi.yaml 0.3), built by
code from the profile and the stored findings."""

from app import reference, settings
from app.investigation import coverage

LEGACY_FX = {"home_weaker": "weaker", "home_stronger": "stronger"}  # findings written before migration 0010


def institution(ctx: dict) -> dict:
    home = ctx["country"]
    abroad = list(dict.fromkeys(c for c in (reference.country_of(f["code"]) for f in ctx["footprint"]) if c and c != home))
    return {
        "name": ctx["name"], "institution_type": ctx["institution_type"], "country": home,
        "country_name": reference.place_name(home), "currency": ctx["currency"], "time_zone": ctx["time_zone"],
        "footprint": [{"country": c, "currency": reference.country_currency(c)} for c in abroad],
        "summary": ctx["summary"] or ctx["name"],
        "segments": [{"id": s["id"], "label": s["label"], "note": s.get("note")} for s in ctx["segments"]],
        "rivals": [r["name"] for r in ctx["rivals"]],
        "regulators": [r["name"] for r in ctx["regulators"]],
        "flows": [{"kind": f["kind"], "local": f["local"], "counterpart": f["counterpart"]} for f in ctx["flows"]],
        "corridors": ctx["corridors"],
    }


def products(ctx: dict) -> list[dict]:
    # Where each product is booked isn't in the profile yet: empty = home and every footprint country.
    return [{"product_id": p["id"], "name": p["name"], "category": p["category"], "product_type": p["product_type"]}
            for p in ctx["products"]]


def finding(row: dict, base_currency: str) -> dict:
    themes = []
    for t in row["themes"] or []:
        t = dict(t)
        if t.get("theme") == "fx" and t.get("direction") in LEGACY_FX:
            t["direction"], t["currency"] = LEGACY_FX[t["direction"]], t.get("currency") or base_currency
        themes.append(t)
    return {
        "finding_id": row["finding_id"], "institution_id": row["institution_id"], "source": row["source"],
        "source_ref": row["source_ref"], "kind": row["kind"], "title": row["title"], "explanation": row["explanation"],
        "score": row["score"], "themes": themes, "places": row["places"] or [], "evidence": row["evidence"],
        "effective_from": row["effective_from"].isoformat() if row["effective_from"] else None,
        "period": row["period"], "created_at": row["created_at"].isoformat(),
    }


def place_info(code: str) -> dict | None:
    """Country and ISO 3166-2 regions of a place code (a gazetteer place climbs to its region)."""
    info = reference.place_info(code)
    country = info.get("country") or reference.country_of(code)
    if not country:
        return None
    for c in (code, info.get("parent")):
        if c and "-" in c and ":" not in c and (lv := coverage.levels(c)):
            return {"country": country, **lv}
    return {"country": country}


def build(run_id: str, ctx: dict, rows: list[dict], validation: bool) -> dict:
    places = sorted({p for r in rows for p in (r["places"] or [])})
    info = {p: i for p in places if (i := place_info(p)) and (":" in p or "-" in p)}
    return {
        "run_id": run_id, "institution_id": ctx["institution_id"],
        "server_url": settings.raw("SERVER_PUBLIC_URL"),
        "institution": institution(ctx), "products": products(ctx),
        "findings": [finding(r, ctx["currency"]) for r in rows],
        "place_info": info, "validation": validation,
    }
