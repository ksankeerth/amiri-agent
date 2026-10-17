"""What the investigation agent may measure, per profile product: GET /api/v1/internal/coverage.

Without an approved data connection, coverage is **assumed from the Metrics Spec**: each
product serves its category's metrics that apply to its product type, with the spec's
breakdowns and validation rules. Whole-category metrics (spec scope: category, such as
large depositors' net flow, digital transactions, the insurer's solvency) come as groups:
the categories the institution sells in, plus payments for a bank and the company for an
insurer. Breakdown values come from the spec (fixed lists), the
home country's ISO 3166-2 regions, the profile's corridors and currencies, and ISIC
sections. With validation on an approved connection (Metrics Spec reference API), `narrowed`
keeps only what its catalog serves, with the catalog's own breakdowns, grain and lag, so the
agent never asks for a metric or a breakdown value the institution doesn't serve; the shape
stays the same.
"""

from functools import cache

import pycountry

from app import spec
from app.connect.coverage import catalog_version
from app.institutions.rules import State

ISIC_SECTIONS = list("ABCDEFGHIJKLMNOPQRSTU")
ASSUMED_SOURCE = "metrics-spec"
# Categories whose whole-category metrics apply to the institution whatever it sells:
# every bank has payment channels; every insurer is a company with capital and reinsurance.
INSTITUTION_WIDE = {"bank": ["payments"], "insurer": ["insurer_company"]}


NOT_ADMINISTRATIVE = {"geographical unit"}  # Indonesia's island groups sit above its provinces


def _admin_parent(sub) -> str | None:
    """The administrative parent of a subdivision (skipping geographical groupings)."""
    if not sub.parent_code:
        return None
    parent = pycountry.subdivisions.get(code=sub.parent_code)
    return None if parent is None or (parent.type or "").lower() in NOT_ADMINISTRATIVE else sub.parent_code


@cache
def regions(country: str) -> tuple[list[str], list[str]]:
    """The country's ISO 3166-2 first- and second-level administrative codes."""
    subs = [s for s in (pycountry.subdivisions.get(country_code=country) or [])
            if (s.type or "").lower() not in NOT_ADMINISTRATIVE]
    return (sorted(s.code for s in subs if not _admin_parent(s)), sorted(s.code for s in subs if _admin_parent(s)))


def levels(code: str) -> dict | None:
    """region_l1 (and region_l2) of an ISO 3166-2 code, by administrative level; None for other codes."""
    sub = pycountry.subdivisions.get(code=code)
    if sub is None or (sub.type or "").lower() in NOT_ADMINISTRATIVE:
        return None
    parent = _admin_parent(sub)
    return {"region_l1": parent, "region_l2": sub.code} if parent else {"region_l1": sub.code}


def _dimension_values(dim: str, state: State, currencies: list[str]) -> list[str]:
    f = state.inst["fields"]
    if dim == "region_l1":
        return regions(f["home_country"])[0] + ["unknown"]
    if dim == "region_l2":
        return regions(f["home_country"])[1] + ["unknown"]
    if dim == "corridor":
        flows = [i.data["counterpart"] for i in state.section("flows").values()]
        return [*list(dict.fromkeys(flows)), "unknown"]
    if dim == "currency":
        return currencies
    if dim in ("sector", "employer_sector", "merchant_sector"):
        return [*ISIC_SECTIONS, "unknown"]
    d = spec.any_dimension(dim)
    return list(d["values"] or []) if d else []


def _metric(m: dict, state: State, currency: str, currencies: list[str]) -> dict:
    v = m.get("validation") or {}
    adverse = m.get("adverse") or []
    return {
        "metric": m["key"], "name": m["name"], "question": m.get("question"), "kind": m["kind"],
        "unit": currency if m["unit"] == "currency" else m["unit"],
        "currency": currency if m["unit"] == "currency" else None,
        "grain": m["grain"], "lag_days": m.get("max_lag_days") or 0,
        "adverse": adverse[0] if adverse else None, "adverse_allowed": v.get("adverse_allowed") or adverse,
        "method": v.get("method"), "min_volume": v.get("min_volume"),
        "dimensions": {b: _dimension_values(b, state, currencies) for b in m.get("breakdowns") or []},
        "thresholds": v.get("thresholds") or {}, "history_from": None,
        "stable_age_days": v.get("stable_age_days"), "min_denominator": v.get("min_denominator"),
        "counts": v.get("counts"), "min_base": v.get("min_base"), "mask_family": v.get("mask_family"),
        "masked_by": v.get("masked_by"),
    }


def applies(m: dict, product_type: str) -> bool:
    """A metric's applies_to: "all", or a list of product types."""
    a = m.get("applies_to")
    return not a or a == "all" or product_type in a


def coverage(state: State) -> dict:
    f = state.inst["fields"]
    base = f["base_currency"]
    products = []
    for pid, it in state.section("products").items():
        p = it.data
        if p["status"] == "closed":
            continue
        currencies = list(dict.fromkeys([*p.get("currencies", []), base]))
        currency = p["currencies"][0] if p.get("currencies") else base
        metrics = [m for m in spec.metrics(p["category"]) if m.get("scope", "product") == "product" and applies(m, p["product_type"])]
        book = p.get("book_size")
        products.append({
            "product_id": pid, "name": p["name"], "category": p["category"], "product_type": p["product_type"],
            "source_product_id": (p.get("data") or {}).get("catalog_product_id"),
            "book_size": {"value": book["amount"], "unit": book["currency"]} if book else None,
            "metrics": [_metric(m, state, currency if m.get("currency_rule") == "product" else base, currencies)
                        for m in metrics],
        })
    cats = list(dict.fromkeys([p["category"] for p in products] + INSTITUTION_WIDE.get(f["institution_type"], [])))
    groups = []
    for cat in cats:
        metrics = [m for m in spec.metrics(cat) if m.get("scope") == "category"]
        if metrics:
            c = spec.category(cat)
            groups.append({
                "group_id": f"group-{cat.replace('_', '-')}", "category": cat,
                "name": f"All {c['name'][0].lower() + c['name'][1:] if c else cat}",
                "institution_wide": cat in INSTITUTION_WIDE.get(f["institution_type"], []),
                "metrics": [_metric(m, state, base, [base]) for m in metrics],
            })
    return {
        "data_source": {"data_source_id": ASSUMED_SOURCE, "name": f"Assumed from Metrics Spec {spec.spec()['spec_version']}",
                        "catalog_version": spec.spec()["spec_version"], "spec_version": spec.spec()["spec_version"],
                        "assumed": True},
        "products": products,
        "groups": groups,  # whole-category metrics (Metrics Spec scope: category)
        "unmatched": {"profile": [p["product_id"] for p in products if not p["metrics"]], "source": []},
    }


def _served(m: dict, cm: dict) -> dict:
    """An assumed metric as the catalog serves it: its breakdowns and values, grain, lag and history."""
    dims = {d: list(v) for d, v in (cm.get("breakdowns") or {}).items() if isinstance(v, list)}
    return {**m, "grain": cm.get("grain") or m["grain"], "lag_days": max(int(cm.get("max_lag_days") or 0), m["lag_days"]),
            "history_from": cm.get("history_from"), "dimensions": dims}


def narrowed(assumed: dict, raw: dict, source_id: str, name: str) -> dict:
    """The assumed coverage, narrowed to the connected catalog: a product keeps the metrics its catalog product
    serves (by key, or by an alias the catalog declares); a whole-category group keeps what a category-scope
    catalog entry serves. Products and groups the catalog lacks keep no metrics."""
    catalog = {p.get("product_id"): p for p in raw.get("products") or [] if isinstance(p, dict)}
    renamed = {a["old"]["key"]: a["new"]["key"] for a in raw.get("aliases") or []
               if isinstance(a, dict) and isinstance(a.get("old"), dict) and isinstance(a.get("new"), dict)}
    used: set[str] = set()

    def keep(metrics: list[dict], cp: dict | None) -> list[dict]:
        served = {m.get("key"): m for m in (cp or {}).get("metrics") or [] if isinstance(m, dict)}
        out = []
        for m in metrics:
            cm = served.get(m["metric"]) or served.get(renamed.get(m["metric"]))
            if cm is not None:
                out.append(_served(m, cm))
        return out

    products = []
    for p in assumed["products"]:
        link = p.get("source_product_id") or p["product_id"]
        cp = catalog.get(link)
        if cp is not None:
            used.add(link)
        products.append({**p, "source_product_id": cp["product_id"] if cp else p.get("source_product_id"),
                         "metrics": keep(p["metrics"], cp)})
    groups = []
    for g in assumed["groups"]:
        cp = next((c for pid, c in catalog.items() if c.get("scope") == "category" and c.get("category") == g["category"]),
                  None)
        if cp is not None:
            used.add(cp["product_id"])
        if metrics := keep(g["metrics"], cp):
            groups.append({**g, "metrics": metrics})
    return {
        "data_source": {"data_source_id": source_id, "name": name, "catalog_version": catalog_version(raw),
                        "spec_version": raw.get("spec_version"), "assumed": False},
        "products": products,
        "groups": groups,
        "unmatched": {"profile": [p["product_id"] for p in products if not p["metrics"]],
                      "source": sorted(pid for pid in catalog if pid not in used)},
    }
