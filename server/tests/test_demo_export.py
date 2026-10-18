"""The repository's demo/ folder: in step with the demo profiles, and every file loads the way demo/README.md says."""

import json

import pytest

from app import demo, demo_export
from app.institutions import schemas as S
from app.monitors.schemas import MonitorSpec
from app.series.schemas import SeriesCreate
from app.studio.api import CustomIn

B = "/api/v1/institutions"
H = {"X-Amiri-Actor": "rm@example.com"}
DEMO = demo_export.REPO / "demo"
KINDS = list(demo.DEMOS)


def test_demo_folder_matches_the_seeds():
    want = demo_export.all_files()
    have = {str(p.relative_to(DEMO)): p.read_text() for p in DEMO.glob("*/[0-9][0-9] */*.json")}
    assert sorted(have) == sorted(want), "demo/ is out of date: run `uv run amiri demo-export`"
    stale = [k for k in want if have[k] != want[k]]
    assert not stale, f"demo/ is out of date ({stale[:3]}): run `uv run amiri demo-export`"
    for d in demo.DEMOS.values():
        assert (DEMO / d["slug"] / "world.md").exists()
    assert (DEMO / "README.md").exists()


def _step(kind: str, title: str) -> dict[str, dict]:
    """The files of one step folder, by name: the folder is found by its title, whatever its number."""
    root = DEMO / demo.DEMOS[kind]["slug"]
    [folder] = [p for p in root.iterdir() if p.is_dir() and p.name[3:] == title]
    return {p.name: json.loads(p.read_text()) for p in sorted(folder.glob("*.json"))}


@pytest.mark.parametrize("kind", KINDS)
def test_every_file_fits_its_form(kind):
    for f in _step(kind, "Add a series")["series.json"]["series"]:
        SeriesCreate(**f)
    for f in _step(kind, "Write your own scenario").values():
        assert 8 <= len(f["title"]) <= 120
        CustomIn(headlines=f["headlines"], prices=f["prices"])
    profile = _step(kind, "Tell Amiri Agent about your institution")["profile.json"]
    ids = {f"{demo_export.EXPOSURE[s]}:{it['id']}" for s, items in profile["sections"].items() for it in items
           if s in demo_export.EXPOSURE}
    for f in _step(kind, "New monitor").values():
        spec = MonitorSpec(**f["spec"])
        missing = [e.id for e in spec.private.exposure if e.id not in ids]
        assert not missing, f"{spec.about.name}: {missing} are not in the profile"
    words = json.dumps([profile, *_step(kind, "New monitor").values(), *_step(kind, "Write your own scenario").values()])
    # the bank is in Sri Lanka only (the insurer's palm-oil exports to India are a real flow, so India stays there)
    for w in ("India", "Kerala", "Tamil Nadu", "Nusantara") if kind == "bank" else ("Nusantara",):
        assert w not in words, w


@pytest.mark.parametrize("kind", KINDS)
async def test_the_whole_profile_and_file_by_file_give_the_same_profile(client, kind):
    whole = _step(kind, "Tell Amiri Agent about your institution")
    doc = whole["profile.json"]
    r = await client.post(f"{B}:import", json={"institution": {**doc["institution"], "institution_id": "demo-whole"},
                                               "sections": doc["sections"]})
    assert r.status_code == 201, r.text

    # file by file, as demo/README.md says: the form, the footprint's edit dialog, then each Import dialog in order
    r = await client.post(B, json={**whole["institution.json"]["institution"], "institution_id": "demo-files"})
    assert r.status_code == 201, r.text
    [fp] = _step(kind, "Edit place in the footprint")["footprint.json"]["items"]
    r = await client.post(f"{B}/demo-files:batch", json={"operations": [
        {"op": "update", "section": "footprint", "id": fp["id"], "data": {k: v for k, v in fp.items() if k != "id"}}]})
    assert r.status_code == 200, r.text
    for section, title in demo_export.SECTION_STEPS:
        [f] = _step(kind, title).values()
        ops = [{"op": "create", "section": section, "id": it["id"], "data": {k: v for k, v in it.items() if k != "id"}}
               for it in f["items"]]
        r = await client.post(f"{B}/demo-files:batch", json={"operations": ops})
        assert r.status_code == 200, (title, r.text)

    a = (await client.get(f"{B}/demo-whole/profile")).json()["sections"]
    b = (await client.get(f"{B}/demo-files/profile")).json()["sections"]
    assert set(a) == set(S.SECTIONS)
    for s in S.SECTIONS:
        assert [x["id"] for x in a[s]] == [x["id"] for x in b[s]] == [x["id"] for x in doc["sections"][s]], s


@pytest.mark.parametrize("kind", KINDS)
async def test_the_monitors_save_against_the_demo(client, env, kind):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    r = await client.post("/api/v1/prototype:demo", json={"kind": kind})
    assert r.status_code == 200, r.text
    for name, f in _step(kind, "New monitor").items():
        r = await client.post("/api/v1/monitors", json=f, headers=H)
        assert r.status_code == 201, (name, r.text)
