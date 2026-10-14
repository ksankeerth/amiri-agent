"""Rules that need the whole profile: references between items, bank or insurer
fit, the home footprint, and soft warnings. Code only."""

from dataclasses import dataclass, field
from typing import Any

from app import reference, spec

# Which fields of which sections point at items of other sections.
REFERENCES: list[tuple[str, tuple[str, ...], str]] = [
    ("products", ("segments",), "segments"),
    ("flows", ("segments",), "segments"),
    ("risk-exposures", ("touches", "segments"), "segments"),
    ("risk-exposures", ("touches", "products"), "products"),
    ("risk-exposures", ("touches", "flows"), "flows"),
    ("risk-exposures", ("touches", "watch_places"), "watch-places"),
]


@dataclass
class Item:
    data: dict[str, Any]
    version: int = 1
    position: int = 0
    created_at: Any = None
    updated_at: Any = None
    created_by: str | None = None
    updated_by: str | None = None
    new: bool = False


@dataclass
class State:
    inst: dict[str, Any]  # the institutions row, fields expanded
    items: dict[str, dict[str, Item]] = field(default_factory=dict)

    @property
    def type(self) -> str:
        return self.inst["fields"]["institution_type"]

    def section(self, name: str) -> dict[str, Item]:
        return self.items.setdefault(name, {})

    def footprint_codes(self) -> list[str]:
        return [i.data["code"] for i in self.section("footprint").values()]

    def footprint_countries(self) -> set[str]:
        return {c for c in (reference.country_of(x) for x in self.footprint_codes()) if c}


def _get(d: dict, path: tuple[str, ...]) -> list:
    for k in path:
        d = (d or {}).get(k) or {}
    return d if isinstance(d, list) else []


def referrers(state: State, section: str, item_id: str) -> list[dict]:
    """Items that point at section/item_id."""
    out = []
    for src, path, target in REFERENCES:
        if target != section:
            continue
        for sid, it in state.section(src).items():
            if item_id in _get(it.data, path):
                out.append({"section": src, "id": sid, "field": ".".join(path)})
    return out


def drop_reference(data: dict, path: tuple[str, ...], item_id: str) -> dict:
    import copy

    d = copy.deepcopy(data)
    node = d
    for k in path[:-1]:
        node = node.setdefault(k, {})
    node[path[-1]] = [x for x in node.get(path[-1]) or [] if x != item_id]
    return d


def errors_for(state: State, section: str, item_id: str) -> list[dict]:
    """Hard rules for one item against the rest of the profile."""
    it = state.section(section).get(item_id)
    if it is None:
        return []
    d = it.data
    errs: list[dict] = []

    def err(field_: str, code: str, msg: str):
        errs.append({"section": section, "id": item_id, "field": field_, "code": code, "message": msg})

    for src, path, target in REFERENCES:
        if src != section:
            continue
        missing = [x for x in _get(d, path) if x not in state.section(target)]
        if missing:
            err(".".join(path), "unknown_reference", f"no {target} with id {', '.join(missing)}")
    if section == "products":
        c = spec.category(d["category"])
        if c and c["institution"] != state.type:
            err("category", "category_not_for_type",
                f"{d['category']} is a {c['institution']} category; this institution is a {state.type}")
    if section == "footprint" and d["role"] == "home":
        home = state.inst["fields"]["home_country"]
        if reference.country_of(d["code"]) != home:
            err("role", "home_outside_home_country", f"home is {home}; {d['code']} is elsewhere (use branches, subsidiary, …)")
    if section == "flows" and d["local"] and reference.country_of(d["local"]) == d["counterpart"] and d["kind"] != "services":
        err("counterpart", "same_country", "the counterpart is the same country as the local end")
    return errs


def warnings_for(state: State, section: str, item_id: str) -> list[dict]:
    """Soft rules: allowed, but worth showing."""
    it = state.section(section).get(item_id)
    if it is None:
        return []
    d = it.data
    out: list[dict] = []
    fp = set(state.footprint_codes())
    fpc = state.footprint_countries()

    def warn(code: str, msg: str):
        out.append({"section": section, "id": item_id, "code": code, "message": msg})

    def inside(code: str) -> bool:
        return in_footprint(code, fp, fpc)

    if section == "segments":
        outside = [p for p in d["places"] if not inside(p)]
        if outside:
            warn("place_outside_footprint", f"places outside the footprint: {', '.join(outside)}")
        if not d["spec_mapping"]:
            warn("no_spec_mapping", "no Metrics Spec value: checks can't be scoped to this group")
    if section == "products":
        if not d["segments"]:
            warn("no_segments", "no customer group: the investigation can't tell who it reaches")
        if d["islamic"] and not state.inst["fields"].get("islamic"):
            warn("islamic_product", "an Islamic product, but the institution isn't marked islamic")
    if section == "flows" and not inside(d["local"]):
        warn("local_outside_footprint", f"{d['local']} isn't in the footprint")
    if section == "regulators" and d["relation"] == "home" and d.get("country") not in (None, state.inst["fields"]["home_country"]):
        warn("home_regulator_abroad", f"a home regulator in {d['country']}")
    return out


def in_footprint(code: str, fp: set[str], fp_countries: set[str]) -> bool:
    """A place is inside when it is a footprint entry, lies inside one (a district in a
    footprint province, a city in a footprint country), or is a country partly in the footprint."""
    if code in fp:
        return True
    if any(a in fp for a in reference.ancestors(code)):
        return True
    return reference.is_country(code) and code in fp_countries


def check_home(state: State) -> list[dict]:
    fp = state.section("footprint")
    if not any(i.data["role"] == "home" for i in fp.values()):
        return [{"section": "footprint", "id": None, "field": "role", "code": "home_required",
                 "message": f"the footprint needs a home entry for {state.inst['fields']['home_country']}"}]
    return []
