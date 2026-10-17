"""Rival suggestions: banks or insurers from the reference list (reference/institutions.json) that compete with
the institution, ranked by code, never by a model.

A candidate must be the same kind (a bank for a bank, an insurer for an insurer) and work in at least one of the
institution's countries. Size, when the institution has a size band: a small or mid-size institution competes with
its own size and the next size up (the bigger ones fight for its customers); a large or systemic one with its own
size and the next size down (much smaller ones aren't its competition). Without a size band every size is offered.
Same size, a shared home market and the same customers come first."""

BANDS = ["small", "mid", "large", "systemic"]
BAND_WORDS = {"small": "Small", "mid": "Mid-size", "large": "Large", "systemic": "Systemic"}
KIND_FOCUS = {"individual": "retail", "business": "business", "public_sector": "corporate", "financial": "corporate"}


def size_fits(own: str | None, theirs: str) -> bool:
    if own not in BANDS:
        return True
    gap = BANDS.index(theirs) - BANDS.index(own)
    return gap == 0 or (gap == 1 if BANDS.index(own) < 2 else gap == -1)


def suggest(rows: list[dict], kind: str, size_band: str | None, home: str, countries: set[str],
            segment_kinds: set[str], have: set[str], place_name) -> list[dict]:
    """rows: the reference list. countries: where the institution works (home included). segment_kinds: its customer
    groups' kinds. have: names (and aliases) already in its rivals, casefolded. Returns suggestions in create shape."""
    focus = {KIND_FOCUS[k] for k in segment_kinds if k in KIND_FOCUS}
    out = []
    for r in rows:
        shared = [c for c in r["countries"] if c in countries]
        if r["type"] != kind or not shared or not size_fits(size_band, r["size_band"]):
            continue
        same_size = size_band == r["size_band"]
        same_customers = not focus or bool(focus & set(r["focus"]))
        overlap = "high" if same_size and home in shared and same_customers else "medium" if same_customers else "low"
        where = ", ".join(place_name(c) for c in shared)
        why = f"{BAND_WORDS[r['size_band']]} {r['type']} in {where}; {', '.join(r['focus'])} customers"
        names = {r["name"].casefold(), *(a.casefold() for a in r["aliases"])}
        out.append({"added": bool(names & have), "why": why, "size_band": r["size_band"], "reference_id": r["id"],
                    "_rank": (overlap != "high", home not in shared, not same_size, not same_customers, r["name"]),
                    "item": {"name": r["name"], "type": r["type"], "places": shared, "overlap": overlap,
                             "aliases": r["aliases"], "note": f"From the reference list ({why}); to be confirmed."}})
    out.sort(key=lambda s: s.pop("_rank"))
    return out
