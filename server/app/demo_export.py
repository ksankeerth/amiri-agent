"""The repository's demo/ folder, written from the demo profiles (app/seeds/) by `uv run amiri demo-export`.

One folder per demo institution. Inside it, one numbered folder per step, named after the dialog or page title it is
loaded through in the web app, in the order to load them. tests/test_demo_export.py fails when demo/ and this drift
apart. demo/README.md and each institution's world.md are written by hand and left alone here.
"""

import json
import re
from pathlib import Path

from app import demo, settings
from app.institutions import schemas as S

REPO = settings.PROJECT.parent

# the step folders for the profile's sections: the web app's Import dialog is "Import <the section's name, lower case>"
SECTION_STEPS = [
    ("watch-places", "Import places to watch"),
    ("segments", "Import customer groups"),
    ("products", "Import products"),
    ("flows", "Import money and goods flows"),
    ("regulators", "Import regulators and rules"),
    ("rivals", "Import rivals"),
    ("counterparties", "Import firms you depend on"),
    ("risk-exposures", "Import risk exposures"),
]
CONDITION = {"bank": "remittances_fall", "insurer": "floods"}  # what the sample API's data shows, for Verification
# a monitor's exposure names profile items as "<kind>:<id>" (app/monitors/schemas.py Exposure)
EXPOSURE = {"products": "product", "segments": "segment", "flows": "flow", "rivals": "rival", "regulators": "regulator",
            "counterparties": "counterparty", "risk-exposures": "risk"}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def item_id(section: str, item: dict) -> str:
    """The id the server gives an item imported without one (InstitutionService: the name field, slugified)."""
    if item.get("id"):
        return item["id"]
    d = S.SECTIONS[section](**{k: v for k, v in item.items() if k != "id"}).model_dump()
    name = S.NAME_FIELD[section]
    return S.slugify(d[name] if name else f"{d['kind']}-{d['local']}-{d['counterpart']}{'-' + d['goods'] if d.get('goods') else ''}")


def extras(kind: demo.Kind) -> dict:
    """The demo's monitors and Studio scenarios: {"monitors": [spec, …], "scenarios": [{title, headlines, prices}, …]}."""
    return json.loads((settings.PROJECT / "app" / "seeds" / "demo_extras.json").read_text())[kind]


def _with_ids(doc: dict) -> dict:
    return {**doc, "sections": {s: [{"id": item_id(s, it), **{k: v for k, v in it.items() if k != "id"}} for it in items]
                                for s, items in doc["sections"].items()}}


def _json(x) -> str:
    return json.dumps(x, indent=2, ensure_ascii=False) + "\n"


def files(kind: demo.Kind) -> dict[str, str]:
    """Every generated file of one demo: {path inside demo/<slug>/: text}."""
    d = demo.DEMOS[kind]
    doc = _with_ids(demo.profile(kind))
    out: dict[str, str] = {}
    n = 1

    def step(title: str) -> str:
        nonlocal n
        folder = f"{n:02d} {title}"
        n += 1
        return folder

    f = step("Tell Amiri Agent about your institution")
    out[f"{f}/profile.json"] = _json(doc)
    out[f"{f}/institution.json"] = _json({"institution": doc["institution"]})
    f = step("Edit place in the footprint")
    out[f"{f}/footprint.json"] = _json({"items": doc["sections"]["footprint"]})
    for section, title in SECTION_STEPS:
        f = step(title)
        out[f"{f}/{section}.json"] = _json({"items": doc["sections"][section]})
    f = step("Add a series")
    out[f"{f}/series.json"] = _json({"series": demo.SERIES[kind]})
    x = extras(kind)
    f = step("New monitor")
    for i, spec in enumerate(x["monitors"], 1):
        out[f"{f}/{i:02d}-{_slug(spec['about']['name'])}.json"] = _json({"spec": spec})
    f = step("Write your own scenario")
    for i, sc in enumerate(x["scenarios"], 1):
        out[f"{f}/{i:02d}-{_slug(sc['title'])}.json"] = _json(sc)
    f = step(f"The sample {kind}")
    out[f"{f}/conditions.json"] = _json({"conditions": [{"id": CONDITION[kind]}]})
    return {f"{d['slug']}/{k}": v for k, v in out.items()}


def all_files() -> dict[str, str]:
    return {k: v for kind in demo.DEMOS for k, v in files(kind).items()}  # type: ignore[arg-type]


def write(dest: Path) -> str:
    """Writes demo/ (generated files only; stale generated files in the step folders are removed)."""
    want = all_files()
    for slug in (d["slug"] for d in demo.DEMOS.values()):
        root = dest / slug
        if root.exists():
            for p in root.glob("[0-9][0-9] */*.json"):
                if str(p.relative_to(dest)) not in want:
                    p.unlink()
            for p in root.glob("[0-9][0-9] *"):
                if p.is_dir() and not any(p.iterdir()):
                    p.rmdir()
    for rel, text in want.items():
        p = dest / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return f"wrote {len(want)} files under {dest}"
