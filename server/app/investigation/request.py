"""The investigation agent's request (agents/investigation-agent/openapi.yaml 0.5), built by
code from the profile and the stored findings."""

from app import reference, settings
from app.investigation import coverage

LEGACY_FX = {"home_weaker": "weaker", "home_stronger": "stronger"}  # findings written before migration 0010
NOT_BOOKING = ("representative_office",)


def footprint(ctx: dict) -> list[dict]:
    """The countries other than home where it operates: the role that books business there, if any, and
    the regions when it covers only some (India: three states; empty is the whole country)."""
    home, out = ctx["country"], {}
    for f in ctx["footprint"]:
        c = reference.country_of(f["code"])
        if not c or c == home:
            continue
        e = out.setdefault(c, {"country": c, "currency": reference.country_currency(c), "role": f["role"],
                               "regions": [], "whole": False})
        if e["role"] in NOT_BOOKING and f["role"] not in NOT_BOOKING:
            e["role"] = f["role"]
        if f["code"] == c:
            e["whole"] = True
        elif "-" in f["code"] and ":" not in f["code"]:
            e["regions"].append(f["code"])
    return [{k: v for k, v in e.items() if k != "whole"} | ({"regions": []} if e["whole"] else {})
            for e in out.values()]


def institution(ctx: dict) -> dict:
    home = ctx["country"]
    return {
        "name": ctx["name"], "institution_type": ctx["institution_type"], "country": home,
        "country_name": reference.place_name(home), "currency": ctx["currency"], "time_zone": ctx["time_zone"],
        "footprint": footprint(ctx),
        "summary": ctx["summary"] or ctx["name"],
        "segments": [{"id": s["id"], "label": s["label"], "note": s.get("note")} for s in ctx["segments"]],
        "rivals": [r["name"] for r in ctx["rivals"]],
        "regulators": [r["name"] for r in ctx["regulators"]],
        "flows": [{"kind": f["kind"], "local": f["local"], "counterpart": f["counterpart"]} for f in ctx["flows"]],
        "corridors": ctx["corridors"],
    }


def products(ctx: dict, currencies: dict[str, list[str]] | None = None) -> list[dict]:
    # Where each product is booked isn't in the profile yet; its currencies are, and they tell a
    # footprint country's book (INR) from home's.
    cur = currencies or {}
    return [{"product_id": p["id"], "name": p["name"], "category": p["category"], "product_type": p["product_type"],
             "currencies": cur.get(p["id"]) or []} for p in ctx["products"]]


def finding(row: dict, base_currency: str, exposure: dict | None = None) -> dict:
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
        **({"exposure": exposure} if exposure else {}),
    }


def lanes(code: str) -> dict:
    """For a chokepoint, sea or port: the sea lanes through it and the countries at their ports."""
    through = [r for r in reference.routes() if code in r["places"]]
    countries = sorted({c for r in through for p in r["places"] if (c := reference.country_of(p)) and len(c) == 2})
    return {"lane_countries": countries, "lanes": [r["name"] for r in through]} if through else {}


def place_info(code: str) -> dict | None:
    """Country and ISO 3166-2 regions of a place code (a gazetteer place climbs to its region), and the sea
    lanes through it (a chokepoint has no country, but the trade on its lanes does)."""
    info = reference.place_info(code)
    country = info.get("country") or reference.country_of(code)
    lane = lanes(code) if ":" in code else {}
    if not country:
        return {"country": None, **lane} if lane else None
    for c in (code, info.get("parent")):
        if c and "-" in c and ":" not in c and (lv := coverage.levels(c)):
            return {"country": country, **lv, **lane}
    return {"country": country, **lane}


def exposure(spec: dict, state) -> dict | None:
    """A monitor's exposures (`private.exposure`, its owner's words) that name items the profile has."""
    out: dict = {"products": [], "segments": [], "flows": [], "risks": [], "notes": []}
    S = state.section
    for e in ((spec or {}).get("private") or {}).get("exposure") or []:
        kind, _, key = str(e.get("id") or "").partition(":")
        if kind == "product" and key in S("products"):
            out["products"].append(key)
        elif kind == "segment" and key in S("segments"):
            out["segments"].append(key)
        elif kind == "flow" and key in S("flows"):
            d = S("flows")[key].data
            out["flows"].append({"kind": d["kind"], "counterpart": d["counterpart"]})
        elif kind == "risk" and key in S("risk-exposures") and S("risk-exposures")[key].data.get("status") == "active":
            out["risks"].append(key)
        else:
            continue
        if e.get("how_it_reaches_us") and len(out["notes"]) < 12:
            out["notes"].append(str(e["how_it_reaches_us"])[:300])
    return out if any(out[k] for k in ("products", "segments", "flows", "risks")) else None


def build(run_id: str, ctx: dict, rows: list[dict], validation: bool, currencies: dict | None = None,
          exposures: dict | None = None) -> dict:
    places = sorted({p for r in rows for p in (r["places"] or [])})
    info = {p: i for p in places if (i := place_info(p)) and (":" in p or "-" in p)}
    exp = exposures or {}
    return {
        "run_id": run_id, "institution_id": ctx["institution_id"],
        "server_url": settings.raw("SERVER_PUBLIC_URL"),
        "institution": institution(ctx), "products": products(ctx, currencies),
        "findings": [finding(r, ctx["currency"], exp.get(r["finding_id"])) for r in rows],
        "place_info": info, "validation": validation,
    }
