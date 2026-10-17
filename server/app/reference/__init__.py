"""Reference data, all code and packaged files (no model):

- countries, first- and second-level regions (ISO 3166-1/-2) and currencies
  (ISO 4217) from pycountry; IANA time zones from tzdata;
- the regulator and sanctions rule table (regulators.json, to be reviewed);
- customer-group templates (segments.json);
- flow figures by country pair (flows.json; sample figures in the prototype);
- the JAPAC gazetteer (gazetteer.json): coordinates for ISO places, and places ISO
  doesn't have (chokepoints chk:, seas sea:, ports port:, cities city:);
- sea routes (routes.json) and the hazard library (hazards.json) for the risk finder;
- theme directions (themes.json) for the Metrics Spec's themes.

The same files are loaded into the ref schema (load.py), so the database's
foreign keys and these in-memory checks agree.
"""

import json
import zoneinfo
from functools import cache
from pathlib import Path

import pycountry

HERE = Path(__file__).parent

# Countries ISO 3166-1 lists that pycountry has under another code, kept simple.
EXTRA_COUNTRY_NAMES = {"XK": "Kosovo"}


@cache
def _file(name: str) -> dict:
    return json.loads((HERE / name).read_text())


def regulators() -> dict:
    return _file("regulators.json")


def segment_templates() -> dict:
    return _file("segments.json")


def flow_rows() -> dict:
    return _file("flows.json")


def institution_rows() -> list[dict]:
    """Licensed banks and insurers by market, for rival suggestions (a sample, to be reviewed)."""
    return _file("institutions.json")["institutions"]


def gazetteer() -> dict:
    return _file("gazetteer.json")


def routes() -> list[dict]:
    return _file("routes.json")["routes"]


def hazards() -> list[dict]:
    return _file("hazards.json")["hazards"]


def country_currency(country: str) -> str | None:
    """The currency of a country (ISO 4217), where the table has it."""
    return _file("country_currencies.json")["currencies"].get(country)


def region() -> dict | None:
    """The region the prototype supports (SUPPORTED_REGION; empty: everywhere): {id, label, countries, currencies}."""
    from app import settings

    rid = settings.raw("SUPPORTED_REGION").strip().lower()
    r = _file("regions.json")["regions"].get(rid) if rid else None
    if not r:
        return None
    table = _file("country_currencies.json")["currencies"]
    return {"id": rid, "label": r["label"], "countries": r["countries"],
            "currencies": sorted({table[c] for c in r["countries"] if c in table})}


def countries_using(currency: str) -> list[str]:
    """The countries in the table whose currency it is."""
    return sorted(c for c, cur in _file("country_currencies.json")["currencies"].items() if cur == currency)


def themes() -> dict[str, dict]:
    """Directions (and items) per theme; the ids are the Metrics Spec's themes."""
    return _file("themes.json")["themes"]


def theme_problem(theme: str, direction: str, item: str | None = None, currency: str | None = None) -> str | None:
    """Why (theme, direction, item, currency) isn't in the vocabulary, or None when it is."""
    t = themes().get(theme)
    if t is None:
        return f"unknown theme {theme!r}; one of {', '.join(themes())}"
    if direction not in t["directions"]:
        return f"{theme} directions are {', '.join(t['directions'])}, not {direction!r}"
    if item is not None and item not in t.get("items", []):
        return f"{theme} has no item {item!r}" + (f"; one of {', '.join(t['items'])}" if t.get("items") else "")
    if t.get("currency") and not currency:
        return f"{theme} needs the currency that moved"
    if currency is not None and not t.get("currency"):
        return f"{theme} has no currency"
    return None


def _slug(text: str) -> str:
    import re

    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ---------------------------------------------------------------- stable ids for reference rows


@cache
def regulator_rows() -> list[dict]:
    """The rule table as rows with ids: country entries, sanctions regimes, global standards."""
    t = regulators()
    rows: list[dict] = []
    for country, entries in t["countries"].items():
        for e in entries:
            rows.append({**e, "regulator_id": f"{country.lower()}-{_slug(e.get('short') or e['name'])}",
                         "country": country})
    for _cur, entries in t["sanctions"].items():
        for e in entries:
            rid = f"sanctions-{_slug(e['short'])}"
            if not any(r["regulator_id"] == rid for r in rows):
                rows.append({**e, "regulator_id": rid, "country": None, "area": "sanctions",
                             "for": ["bank", "insurer"], "relation": "reach"})
    for e in t["always"]:
        rows.append({**e, "regulator_id": f"global-{_slug(e['short'])}", "country": None})
    return rows


def regulator(regulator_id: str) -> dict | None:
    return next((r for r in regulator_rows() if r["regulator_id"] == regulator_id), None)


@cache
def sanctions_rows() -> list[tuple[str, str]]:
    return [(cur, f"sanctions-{_slug(e['short'])}") for cur, es in regulators()["sanctions"].items() for e in es]


@cache
def segment_template_rows() -> list[dict]:
    return [{**t, "template_id": f"{itype}-{_slug(t['label'])}", "institution_type": itype}
            for itype, ts in segment_templates().items() if not itype.startswith("_") for t in ts]


def segment_template(template_id: str) -> dict | None:
    return next((t for t in segment_template_rows() if t["template_id"] == template_id), None)


@cache
def flow_figure_rows() -> list[dict]:
    out = []
    for r in flow_rows()["rows"]:
        local, counterpart = (r["from"], r["to"]) if r["kind"] in ("exports", "remittances_out") else (r["to"], r["from"])
        fid = _slug(f"{r['kind']}-{local}-{counterpart}-{r.get('goods') or ''}-{r['year']}")
        out.append({**r, "figure_id": fid, "local": local, "counterpart": counterpart})
    return out


def flow_figure(figure_id: str) -> dict | None:
    return next((f for f in flow_figure_rows() if f["figure_id"] == figure_id), None)


def route(route_id: str) -> dict | None:
    return next((r for r in routes() if r["route_id"] == route_id), None)


def hazard(hazard_id: str) -> dict | None:
    return next((h for h in hazards() if h["hazard_id"] == hazard_id), None)


@cache
def countries() -> list[dict]:
    out = [{"code": c.alpha_2, "name": getattr(c, "common_name", None) or c.name,
            "official_name": getattr(c, "official_name", None), "numeric": c.numeric} for c in pycountry.countries]
    out += [{"code": k, "name": v, "official_name": None, "numeric": None} for k, v in EXTRA_COUNTRY_NAMES.items()]
    return sorted(out, key=lambda c: c["name"])


@cache
def _country_codes() -> frozenset[str]:
    return frozenset(c["code"] for c in countries())


def is_country(code: str) -> bool:
    return code in _country_codes()


@cache
def regions(country: str) -> list[dict]:
    subs = pycountry.subdivisions.get(country_code=country) or []
    return sorted(({"code": s.code, "name": s.name, "type": s.type, "parent": s.parent_code or country}
                   for s in subs), key=lambda s: s["code"])


def is_region(code: str) -> bool:
    return "-" in code and pycountry.subdivisions.get(code=code) is not None


@cache
def _extra_places() -> dict[str, dict]:
    return {p["code"]: p for p in gazetteer()["places"]}


def is_extra_place(code: str) -> bool:
    return code in _extra_places()


def is_iso_place(code: str) -> bool:
    return is_country(code) or is_region(code)


def is_place(code: str) -> bool:
    return is_iso_place(code) or is_extra_place(code)


def place_name(code: str) -> str | None:
    if is_country(code):
        return next(c["name"] for c in countries() if c["code"] == code)
    if code in _extra_places():
        return _extra_places()[code]["name"]
    s = pycountry.subdivisions.get(code=code) if "-" in code else None
    return s.name if s else None


def place_info(code: str) -> dict:
    """Name, kind, parent, country and coordinates (when the gazetteer has them)."""
    x = _extra_places().get(code)
    if x:
        return {"code": code, "name": x["name"], "kind": x["kind"], "parent": x.get("parent"),
                "country": x.get("country"), "lat": x.get("lat"), "lon": x.get("lon"), "numeric": None}
    ll = gazetteer()["coordinates"].get(code)
    if is_country(code):
        kind, parent = "country", None
    else:
        s = pycountry.subdivisions.get(code=code) if "-" in code else None
        kind, parent = ((s.type or "region").lower() if s else "unknown"), (s.parent_code if s and s.parent_code else country_of(code))
    numeric = next((c["numeric"] for c in countries() if c["code"] == code), None) if kind == "country" else None
    return {"code": code, "name": place_name(code), "kind": kind, "parent": parent,
            "country": country_of(code) if is_iso_place(code) else None,
            "lat": ll[0] if ll else None, "lon": ll[1] if ll else None, "numeric": numeric}


@cache
def all_places() -> list[dict]:
    """Every place: ISO countries and regions, and the gazetteer's own places."""
    out = [place_info(c["code"]) for c in countries()]
    for c in countries():
        out += [place_info(r["code"]) for r in regions(c["code"])]
    out += [place_info(code) for code in _extra_places()]
    return out


def search_places(q: str, kind: str | None = None, country: str | None = None, limit: int = 50) -> list[dict]:
    k = q.casefold().strip()
    aliases = {p["code"]: [a.casefold() for a in p.get("aliases", [])] for p in gazetteer()["places"]}
    hits = []
    for p in all_places():
        if kind and p["kind"] != kind:
            continue
        if country and p["country"] != country and p["code"] != country:
            continue
        name = (p["name"] or "").casefold()
        if k and not (k in name or k == p["code"].casefold() or any(k in a for a in aliases.get(p["code"], []))):
            continue
        rank = (0 if name.startswith(k) or p["code"].casefold() == k else 1, 0 if p["kind"] == "country" else 1, name)
        hits.append((rank, p))
    return [p for _, p in sorted(hits, key=lambda x: x[0])][:limit]


def parent_region(code: str) -> str | None:
    """The next place up, below the country (district → province; city → its region)."""
    x = _extra_places().get(code)
    if x:
        return x.get("parent")
    s = pycountry.subdivisions.get(code=code) if "-" in code else None
    return s.parent_code if s and s.parent_code else None


def country_of(code: str) -> str | None:
    x = _extra_places().get(code)
    if x:
        return x.get("country")
    return code.split("-")[0]


def ancestors(code: str) -> list[str]:
    """Every place above, ending with the country."""
    out, p = [], parent_region(code)
    while p:
        out.append(p)
        p = parent_region(p)
    c = country_of(code)
    if c and c != code and c not in out:
        out.append(c)
    return out


def overlaps(a: str, b: str) -> bool:
    """Two places overlap when one is the other or lies inside it."""
    return a == b or b in ancestors(a) or a in ancestors(b)


@cache
def currencies() -> list[dict]:
    return sorted(({"code": c.alpha_3, "name": c.name} for c in pycountry.currencies), key=lambda c: c["code"])


@cache
def _currency_codes() -> frozenset[str]:
    return frozenset(c["code"] for c in currencies())


def is_currency(code: str) -> bool:
    return code in _currency_codes()


@cache
def time_zones() -> list[str]:
    return sorted(z for z in zoneinfo.available_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV/")))


def is_time_zone(name: str) -> bool:
    try:
        zoneinfo.ZoneInfo(name)
        return True
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return False
