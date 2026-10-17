"""The Metrics Spec for people: its pages' data, and the files to download, each named with the version; the PDF,
the YAML and the server's snapshot never say different versions."""

import re

import yaml

from app import spec
from app.spec import api as spec_api


async def test_the_pages_get_the_whole_spec(client):
    s = (await client.get("/api/v1/spec")).json()
    assert s["spec_version"] == spec.spec()["spec_version"] == "1.0.0" and s["validation_params_version"] == "1.0.0"
    assert len(s["categories"]) == 23 and sum(len(c.get("metrics") or []) for c in s["categories"]) == 128
    assert [c["id"] for c in s["conformance_checks"]] == [f"C{i:02d}" for i in range(1, 23)]
    assert s["vocabularies"]["error_codes"]["rate_limited"] == 429 and "size_band" in s["dimensions"]
    assert set(s["guide"]) == {"intro", "1", "2", "3", "6", "8", "10", "11", "12", "13"}  # the rest is drawn from the YAML
    assert s["guide"]["intro"]["md"].startswith("This spec tells") and "**Files:**" not in s["guide"]["intro"]["md"]
    assert s["guide"]["1"]["title"] == "Purpose, audience and versioning" and "MAJOR" in s["guide"]["1"]["md"]
    assert s["changelog"][0]["version"] == "1.0.0"
    assert [f["name"] for f in s["files"]] == ["metrics-spec-1.0.0.pdf", "metrics-spec-1.0.0.yaml",
                                               "metrics-spec-1.0.0-openapi.yaml"]


async def test_the_files_download_with_their_versions(client):
    for name, kind, starts in (("metrics-spec-1.0.0.yaml", "application/yaml", b"spec_version"),
                               ("metrics-spec-1.0.0-openapi.yaml", "application/yaml", b"openapi"),
                               ("metrics-spec-1.0.0.pdf", "application/pdf", b"%PDF")):
        r = await client.get(f"/api/v1/spec/files/{name}")
        assert r.status_code == 200 and r.headers["content-type"].startswith(kind), (name, r.status_code)
        assert name in r.headers["content-disposition"] and starts in r.content[:400], name
    assert (await client.get("/api/v1/spec/files/metrics-spec-0.9.0.pdf")).status_code == 404
    assert (await client.get("/api/v1/spec/files/..%2Fsettings.py")).status_code == 404


def test_the_pdf_yaml_and_snapshot_say_the_same_version():
    v = yaml.safe_load(spec_api.yaml_path().read_text())["spec_version"]
    assert v == spec.spec()["spec_version"] == spec.reference_openapi()["info"]["version"]
    pdf = spec_api.pdf_path().read_bytes()
    title = re.search(rb"/Title \(([^)]*)\)", pdf)
    assert title and title.group(1).decode() == f"Metrics Spec {v}", "remake it: uv run amiri spec-pdf"
    assert sorted(p.name for p in spec_api.HERE.glob("metrics-spec-*.pdf")) == [f"metrics-spec-{v}.pdf"]  # no stale PDF
