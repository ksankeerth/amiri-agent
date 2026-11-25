"""The investigation agent's request (agents/investigation-agent/openapi.yaml 0.5), built by
code from the profile and the stored findings."""

import re

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


MAX_THEMES = 4  # the investigation agent's limit per finding
THEME_KEYS = ("theme", "direction", "item", "sector", "currency", "implied")


def clean_themes(themes: list[dict] | None, base_currency: str) -> list[dict]:
    """A finding's themes as the investigation agent accepts them, whatever wrote them (Radar's are free text).

    A theme or direction outside the vocabulary is dropped; Radar has no sector field, so a sector theme's item is
    its sector; an item the theme doesn't have is dropped; a currency is kept for fx only (the base when missing or
    malformed); at most MAX_THEMES, without repeats. Themes already in the vocabulary come out as they went in."""
    vocab = reference.themes()
    out: list[dict] = []
    for t in themes or []:
        if not isinstance(t, dict):
            continue
        t = dict(t)
        if t.get("theme") == "fx" and t.get("direction") in LEGACY_FX:
            t["direction"], t["currency"] = LEGACY_FX[t["direction"]], t.get("currency") or base_currency
        spec = vocab.get(t.get("theme"))
        if not spec or t.get("direction") not in spec["directions"]:
            continue
        clean = {k: t[k] for k in THEME_KEYS if k in t and t[k] is not None}
        if t["theme"] == "sector":
            sector = clean.get("sector") or clean.pop("item", None)
            clean.pop("item", None)
            if isinstance(sector, str) and sector.strip():
                clean["sector"] = sector.strip()[:80]
        else:
            clean.pop("sector", None)
            if clean.get("item") not in spec.get("items", []):
                clean.pop("item", None)
        if spec.get("currency"):
            cur = clean.get("currency")
            clean["currency"] = cur if isinstance(cur, str) and re.fullmatch(r"[A-Z]{3}", cur) else base_currency
        else:
            clean.pop("currency", None)
        if not isinstance(clean.get("implied", False), bool):
            clean.pop("implied")
        if clean not in out:
            out.append(clean)
    return out[:MAX_THEMES]


def clean_evidence(evidence: dict | None) -> dict:
    """Evidence as the agent accepts it: a web page needs an http(s) address."""
    ev = dict(evidence or {})
    if ev.get("web"):
        ev["web"] = [w for w in ev["web"] if isinstance(w, dict) and re.match(r"^https?://", str(w.get("url") or ""))]
    return ev


def finding(row: dict, base_currency: str, exposure: dict | None = None) -> dict:
    themes = clean_themes(row["themes"], base_currency)
    return {
        "finding_id": row["finding_id"], "institution_id": row["institution_id"], "source": row["source"],
        "source_ref": row["source_ref"], "kind": row["kind"], "title": row["title"], "explanation": row["explanation"],
        "score": row["score"], "themes": themes, "places": row["places"] or [], "evidence": clean_evidence(row["evidence"]),
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
