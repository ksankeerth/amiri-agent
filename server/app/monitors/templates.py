"""Drafting a monitor by code. "Draft a monitor" on a profile item fills the name,
watch chips (names and aliases from the profile), places, exposure and first "tell me if"
lines from a template for the item's kind; the user edits before submitting."""

from app import reference
from app.institutions.rules import State
from app.problems import Problem

DRAFTED = ["public.in_one_sentence", "public.tell_me_if", "public.watch"]
SECTIONS = ("risk-exposures", "regulators", "rivals", "flows", "counterparties")
MIGRANT = {"name": "migrant workers", "type": "topic", "other_forms": ["foreign workers", "expatriate workers"],
           "not_confused_with": []}


def _place(code: str) -> dict:
    name = reference.place_name(code) or code
    return {"name": name, "type": "place" if reference.is_country(code) else "region", "other_forms": [],
            "not_confused_with": []}


def _list(codes: list[str]) -> str:
    names = [reference.place_name(c) or c for c in codes]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " or " + names[-1] if names else "our markets"


def draftable(state: State) -> list[dict]:
    """Profile items a monitor can be drafted from, with a label."""
    out = []
    for k, it in state.section("risk-exposures").items():
        if it.data["status"] == "active":
            out.append({"section": "risk-exposures", "item_id": k, "label": it.data["title"], "kind": it.data["kind"]})
    for k, it in state.section("regulators").items():
        out.append({"section": "regulators", "item_id": k, "label": it.data["name"], "kind": it.data["area"]})
    for k, it in state.section("rivals").items():
        out.append({"section": "rivals", "item_id": k, "label": it.data["name"], "kind": it.data["type"]})
    for k, it in state.section("flows").items():
        d = it.data
        if d["kind"] in ("remittances_in", "exports", "imports"):
            local = "" if d["local"] == state.inst["fields"]["home_country"] else \
                f" → {reference.place_name(d['local']) or d['local']}"  # a branch's own corridor
            out.append({"section": "flows", "item_id": k, "kind": d["kind"],
                        "label": f"{d['kind'].replace('_', ' ')}: {reference.place_name(d['counterpart']) or d['counterpart']}{local}"})
    for k, it in state.section("counterparties").items():
        out.append({"section": "counterparties", "item_id": k, "label": it.data["name"], "kind": it.data["kind"]})
    return out


def draft(state: State, section: str, item_id: str) -> tuple[dict, dict]:
    """(spec, origin_ref) for a monitor drafted from a profile item."""
    it = state.section(section).get(item_id)
    if it is None:
        raise Problem(404, "not_found", f"No {section} item {item_id}.")
    d, f = it.data, state.inst["fields"]
    home = f["home_country"]
    kind_word = "banks" if f["institution_type"] == "bank" else "insurers"
    exposure = [{"id": f"{_EXPOSURE[section]}:{item_id}", "how_it_reaches_us": ""}]
    if section == "risk-exposures":
        places = d["places"] or [home]
        p = _list(places)
        lines = {
            "conflict": [f"Conflict or attacks affect {p}", f"Shipping, flights or trade through {p} are disrupted"],
            "climate": [f"A flood, storm, earthquake or drought hits {p}", f"Authorities declare an emergency in {p}"],
            "health": [f"An outbreak spreads in {p}", f"Authorities restrict movement or trade in {p}"],
            "economic": [f"Sanctions, controls or a crisis affect payments or trade with {p}"],
            "market": [f"A market shock in {p} affects prices our customers pay"],
            "regulatory": [f"New rules in {p} affect our customers"],
        }.get(d["kind"], [f"A disruption in {p} affects our customers"])
        touched = [*(d.get("touches") or {}).get("products", []), *(d.get("touches") or {}).get("segments", [])]
        exposure += [{"id": f"product:{x}", "how_it_reaches_us": ""} for x in (d.get("touches") or {}).get("products", [])
                     if x in state.section("products")]
        exposure += [{"id": f"segment:{x}", "how_it_reaches_us": ""} for x in (d.get("touches") or {}).get("segments", [])
                     if x in state.section("segments")]
        chips = [_place(c) for c in places[:6]]
        if d.get("hazard_id") and (h := reference.hazard(d["hazard_id"])):
            chips.append({"name": h["name"], "type": "topic", "other_forms": [], "not_confused_with": []})
        name, sentence = d["title"], f"{d['title']}: events in {p} that could reach " + (
            "the products and customers it touches." if touched else "our customers.")
        months = d.get("months") or []
        ignore = [] if not months else ["Seasonal reports with no new damage or disruption"]
    elif section == "regulators":
        x = d.get("short") or d["name"]
        places = [d["country"]] if d.get("country") else []
        chips = [{"name": d["name"], "type": "organisation", "other_forms": [s for s in [d.get("short")] if s],
                  "not_confused_with": []}]
        lines = {
            "insurance": [f"{x} announces a new rule, direction or penalty for insurers",
                          f"{x} changes capital, solvency or pricing rules"],
            "aml": [f"{x} announces new reporting, sanctions or anti-money-laundering rules"],
            "sanctions": [f"{x} adds sanctions that affect payments or customers"],
        }.get(d["area"], [f"{x} announces a new rule, direction or penalty for {kind_word}",
                          f"{x} changes its policy rate, reserve requirements or relief measures"])
        name, sentence, ignore = f"{x}: rules and actions", f"New rules, directions or penalties from {d['name']}.", \
            ["Speeches or reports with no new rule"]
    elif section == "rivals":
        x = d["name"]
        places = d.get("places") or [home]
        chips = [{"name": x, "type": "organisation", "other_forms": list(d.get("aliases") or []), "not_confused_with": []}]
        lines = [f"{x} cuts its prices, rates or fees", f"{x} launches a new product or enters a new market",
                 f"{x} faces fraud, failure or action by a regulator"]
        name, sentence, ignore = f"{x}: prices and products", f"Moves by {x} that could take our customers.", \
            ["Advertising with no change in prices or products"]
    elif section == "flows":
        c = d["counterpart"]
        places = [c, d["local"]]
        cname = reference.place_name(c) or c
        if d["kind"].startswith("remittances"):
            chips = [_place(c), MIGRANT]
            lines = [f"{cname} announces job cuts, visa limits or wage controls for foreign workers",
                     f"Conflict or disruption in {cname} affects foreign workers or money transfers"]
            name, sentence = f"Jobs and pay in {cname}", f"Events in {cname} that could cut migrant workers' jobs, pay or transfers home."
        else:
            goods = d.get("goods") or "goods"
            chips = [_place(c), {"name": goods, "type": "sector", "other_forms": [], "not_confused_with": []}]
            lines = [f"{cname} changes tariffs, import rules or sanctions that affect {goods}",
                     f"A disruption in {cname} cuts demand or payments for {goods}"]
            name, sentence = f"Trade with {cname}: {goods}", f"Events in {cname} that could cut trade or payments for {goods}."
        exposure += [{"id": f"segment:{x}", "how_it_reaches_us": ""} for x in d.get("segments") or []
                     if x in state.section("segments")]
        ignore = ["Routine statistics with no change"]
    else:  # counterparties
        x = d["name"]
        places = d.get("places") or []
        chips = [{"name": x, "type": "organisation", "other_forms": list(d.get("aliases") or []), "not_confused_with": []}]
        lines = [f"{x} faces failure, fraud, sanctions or a downgrade", f"{x} has an outage that stops payments or claims"]
        name, sentence, ignore = f"{x}: failures and sanctions", f"Trouble at {x}, which we depend on.", []
    spec = {
        "about": {"name": name[:80], "owner": "Risk management", "check_frequency": 60, "kind": "events"},
        "public": {"watch": chips[:12], "in_one_sentence": sentence[:300], "tell_me_if": lines[:8], "ignore": ignore,
                   "places": list(dict.fromkeys(p for p in places if reference.is_place(p)))[:20], "languages": ["en"]},
        "private": {"exposure": list({e["id"]: e for e in exposure}.values())},
        "alert_level": 6,
    }
    return spec, {"section": section, "item_id": item_id}


_EXPOSURE = {"risk-exposures": "risk", "regulators": "regulator", "rivals": "rival", "flows": "flow",
             "counterparties": "counterparty"}
