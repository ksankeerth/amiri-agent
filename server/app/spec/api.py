"""The Metrics Spec for people: the pages at /spec (both roles) read it from here, and the files an institution's
team downloads (the YAML, the reference API and the PDF, each named with its version). Behind the bot check, like
the rest of the API."""

import re
from functools import cache
from pathlib import Path

import yaml
from fastapi import APIRouter
from fastapi.responses import FileResponse

from app import spec
from app.problems import Problem

router = APIRouter(prefix="/api/v1/spec", tags=["spec"])

HERE = Path(__file__).parent
DRAWN = ("4", "5", "7", "9")  # guide sections the pages draw from the YAML instead (taxonomy, metrics, dimensions, checks)
# Each change to the spec, newest first; the words match the versioning rules in the guide (§1.4). The editorial
# revision of 17 Oct 2026 changed no number, key, unit, threshold or rule, and kept 1.0.0.
CHANGELOG = [
    {"version": "1.0.0", "date": "2026-10-17", "kind": "Editorial",
     "text": "Editorial revision: wording, file references and the PDF layout. No number, key, unit, threshold or "
             "rule changed."},
    {"version": "1.0.0", "date": "2026-10-11", "kind": "MAJOR",
     "text": "First release, for implementation feedback: 23 product categories, the reference API, the conformance "
             "checks C01 to C22 and the validation parameters 1.0.0."},
]


def version() -> str:
    return spec.spec()["spec_version"]


def yaml_path() -> Path:
    return HERE / f"metrics-spec-{version()}.yaml"


def guide_path() -> Path:
    return HERE / f"metrics-spec-{version()}.md"


def pdf_path() -> Path:
    return HERE / f"metrics-spec-{version()}.pdf"


@cache
def source() -> dict:
    return yaml.safe_load(yaml_path().read_text())


def _intro(md: str) -> str:
    """The guide's opening without its title, version line, file list and contents: the pages show those themselves."""
    keep, dropping = [], False
    for line in md.split("\n"):
        if line.startswith(("**Files:**", "**Contents.**")):
            dropping = True
            continue
        if dropping and (re.match(r"^(- |\d+\. )", line) or not line.strip()):
            continue
        dropping = False
        if not line.startswith(("# ", "**Version**")):
            keep.append(line)
    return "\n".join(keep).strip()


@cache
def guide() -> dict[str, dict]:
    """The guide's numbered sections: {"1": {"title", "md"}, ...}; the text before them is "intro"."""
    out: dict[str, dict] = {}
    key, title, lines = "intro", "", []
    for line in guide_path().read_text().splitlines():
        m = re.match(r"^## (\d+)\. (.+)$", line)
        if m:
            out[key] = {"title": title, "md": "\n".join(lines).strip().removesuffix("---").strip()}
            key, title, lines = m.group(1), m.group(2), []
        else:
            lines.append(line)
    out[key] = {"title": title, "md": "\n".join(lines).strip().removesuffix("---").strip()}
    out["intro"]["md"] = _intro(out["intro"]["md"])
    return out


def files() -> list[dict]:
    v = version()
    return [{"name": n, "label": label, "available": p.exists(), "bytes": p.stat().st_size if p.exists() else None,
             "href": f"/api/v1/spec/files/{n}"}
            for n, label, p in ((f"metrics-spec-{v}.pdf", "The guide (PDF)", pdf_path()),
                                (f"metrics-spec-{v}.yaml", "The spec, machine-readable (YAML)", yaml_path()),
                                (f"metrics-spec-{v}-openapi.yaml", "The reference API (OpenAPI)", spec.REFERENCE_OPENAPI))]


@router.get("", summary="The Metrics Spec, for its pages: guide sections, categories and metrics, dimensions, checks")
async def spec_pages():
    d = source()
    v = d["vocabularies"]
    return {
        "spec_version": d["spec_version"], "validation_params_version": d["validation_params_version"],
        "title": d["title"], "status": d["status"], "published": d["published"],
        "guide": {k: g for k, g in guide().items() if k not in DRAWN}, "capability_levels": d["capability_levels"],
        "drawn": {k: guide()[k] for k in DRAWN},  # the guide's text of the sections the pages draw; the print layout uses it
        "vocabularies": {k: v[k] for k in ("kinds", "units", "currency_rules", "grains", "methods", "tiers", "error_codes")
                         if k in v},
        "dimensions": d["dimensions"], "categories": d["categories"], "conformance_checks": d["conformance_checks"],
        "aliases": d.get("aliases") or [], "deprecations": d.get("deprecations") or [], "break_kinds": d.get("break_kinds"),
        "changelog": CHANGELOG, "files": files(),
    }


@router.get("/files/{name}", summary="A spec file to download, named with its version")
async def spec_file(name: str):
    f = next((x for x in files() if x["name"] == name), None)
    if not f or not f["available"]:
        raise Problem(404, "not_found", f"No spec file {name}." + (" The PDF is made with `uv run amiri spec-pdf`."
                                                                    if name.endswith(".pdf") else ""))
    path = {".pdf": pdf_path()}.get(Path(name).suffix) or (spec.REFERENCE_OPENAPI if "openapi" in name else yaml_path())
    media = "application/pdf" if name.endswith(".pdf") else "application/yaml"
    return FileResponse(path, media_type=media, filename=name)
