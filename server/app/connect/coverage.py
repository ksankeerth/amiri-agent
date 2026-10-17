"""Coverage for this institution: per product in the profile, its product in the institution's catalog,
the metrics the spec requires for its category, which are served and at what grain, and so which
checks are off. A coarser grain is accepted at reduced capability (spec §1.3)."""

from app import spec

GRAIN_ORDER = {"daily": 0, "weekly": 1, "monthly": 2, "quarterly": 3}


def _required(category: str, product_type: str | None) -> list[dict]:
    out = []
    for m in spec.metrics(category):
        if m["scope"] != "product" or m["tier"] != "required":
            continue
        applies = m.get("applies_to")
        if isinstance(applies, list) and product_type not in applies:
            continue
        out.append(m)
    return out


def coverage(profile: dict | None, cat: dict) -> dict:
    catalog = {p.get("product_id"): p for p in cat.get("products") or [] if isinstance(p, dict)}
    used: set[str] = set()
    products, sentences = [], []
    for item in (profile or {}).get("sections", {}).get("products", []):
        if item.get("status") in ("closing", "closed"):
            continue
        link = (item.get("data") or {}).get("catalog_product_id") or item.get("id")
        cp = catalog.get(link)
        required = _required(item["category"], item.get("product_type"))
        entry = {"profile_product_id": item.get("id"), "name": item["name"], "category": item["category"],
                 "catalog_product_id": cp.get("product_id") if cp else None, "required": [m["key"] for m in required],
                 "served": [], "missing": [], "reduced": [], "extra": []}
        if cp is None:
            entry["status"] = "none"
            entry["missing"] = entry["required"]
            sentences.append(f"{item['name']}: no product in the catalog with id {link}. Link it on the product "
                             "(data → catalog product id), or add it to the catalog.")
            products.append(entry)
            continue
        used.add(link)
        served = {m.get("key"): m for m in cp.get("metrics") or [] if isinstance(m, dict)}
        entry["served"] = sorted(served)
        for m in required:
            got = served.get(m["key"])
            if got is None:
                entry["missing"].append(m["key"])
                continue
            g_spec, g_got = GRAIN_ORDER.get(m["grain"], 0), GRAIN_ORDER.get(got.get("grain"), 0)
            if g_got > g_spec:
                method = (m.get("validation") or {}).get("method")
                off = ["recent_vs_prior"] if method == "recent_vs_prior" else []
                entry["reduced"].append({"key": m["key"], "grain_spec": m["grain"], "grain_served": got.get("grain"),
                                         "off": off})
        entry["extra"] = sorted(set(served) - set(entry["required"]))
        entry["status"] = "full" if not entry["missing"] and not entry["reduced"] else "partial"
        n_req = len(required)
        if entry["missing"]:
            sentences.append(f"{item['name']}: {n_req - len(entry['missing'])} of {n_req} required metrics; missing "
                             f"{', '.join(entry['missing'])}.")
        for red in entry["reduced"]:
            off = f", so {', '.join(red['off'])} is off" if red["off"] else ""
            sentences.append(f"{item['name']}: {red['key']} is served {red['grain_served']} "
                             f"(the spec asks {red['grain_spec']}){off}.")
        products.append(entry)
    unmapped = [{"product_id": pid, "name": p.get("name"), "category": p.get("category")}
                for pid, p in catalog.items() if pid not in used]
    return {"products": products, "unmapped_catalog_products": unmapped, "sentences": sentences}
