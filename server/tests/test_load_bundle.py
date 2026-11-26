"""demo/load_bundle.py against the test app: the Austin Tech Bank bundle on an empty platform, on one that already
holds it (run twice, nothing doubles), on one that holds a different institution (a clear refusal, or --reset --yes).

The script is standard library only and talks HTTP; here its steps run in a worker thread, and each request
goes to the app in-process (the test's own event loop) through the same `request(method, path, body, actor)`
interface. The after-load step (Radar run, monitor checks) is skipped: it calls models in a real deployment.
"""

import asyncio
import importlib.util
import json

import pytest

from app import settings
from tests.conftest import START, hourly_walk

ROOT = settings.PROJECT.parent
BUNDLE_FILE = ROOT / "demo" / "austin-tech-bank" / "bundle.json"
BUNDLE = json.loads(BUNDLE_FILE.read_text())


def script():
    spec = importlib.util.spec_from_file_location("load_bundle", ROOT / "demo" / "load_bundle.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class InProcess:
    """The script's Api, answered by the app through the test client on the test's loop."""

    def __init__(self, client, loop):
        self.client, self.loop = client, loop

    def request(self, method, path, body=None, actor=None):
        async def go():
            r = await self.client.request(method, path, json=body, headers={"X-Amiri-Actor": actor or "John"})
            try:
                return r.status_code, r.json()
            except ValueError:
                return r.status_code, r.text
        return asyncio.run_coroutine_threadsafe(go(), self.loop).result()


@pytest.fixture
def us(env, fake):
    env.setenv("SUPPORTED_REGION", "us")
    env.setenv("INSTITUTION_ID", "austin-tech-bank")
    env.setenv("SINGLE_INSTITUTION", "true")
    for i, s in enumerate(BUNDLE["series"]):  # the ETFs the bundle adds, at the fake Twelve Data
        fake.add(s["symbol"], hourly_walk(START, 120, 50.0, 0.01, seed=40 + i, around_the_clock=False), type_="ETF")


async def load(client, approver=None, reset=False):
    lb = script()
    lines: list[str] = []
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), BUNDLE, "John", approver, say=lines.append,
                       reset=reset)
    summary = await asyncio.to_thread(loader.run, False)
    return lb, loader, summary, lines


async def test_the_austin_bundle_loads_on_an_empty_platform(client, us):
    _, _, summary, lines = await load(client, approver="Maya")
    assert summary == {"institution_id": "austin-tech-bank", "series_added": 4, "series_skipped": 0, "monitors": 7,
                       "monitors_live": 7, "sample_data": True, "monitors_skipped": 0, "institution": "created"}
    assert lines[-1] == "[7] after-load actions skipped (--skip-after-load)"

    inst = (await client.get("/api/v1/installation")).json()
    assert inst["profile"] is True and inst["status"] == "active" and inst["name"] == "Austin Tech Bank"
    series = {s["symbol"] for s in (await client.get("/api/v1/series")).json()["items"]}
    assert {"QQQ", "UNG", "USO", "IEF"} <= series
    live = (await client.get("/api/v1/monitors", params={"status": "live"})).json()["items"]
    assert len(live) == 7
    for m in live:
        v = next(x for x in (await client.get(f"/api/v1/monitors/{m['monitor_id']}")).json()["versions"]
                 if x["status"] == "approved")
        assert (v["created_by"], v["submitted_by"], v["approved_by"]) == ("John", "John", "Maya")
        assert v["approved_at"] and v["note"] == "Loaded from bundle"
    data = (await client.get("/api/v1/data-connection")).json()
    assert data["configured"] is True and data["imported"]["summary"]["institution"] == "Austin Tech Bank"
    assert data["imported"]["file_name"] == "example-data.json" and data["approved"] is None


async def counts(client):
    return {
        "monitors": len((await client.get("/api/v1/monitors")).json()["items"]),
        "series": len((await client.get("/api/v1/series")).json()["items"]),
        "institutions": len((await client.get("/api/v1/institutions")).json()),
    }


async def test_a_second_run_loads_onto_the_same_institution_and_adds_nothing(client, us):
    await load(client)
    before = await counts(client)
    assert before == {"monitors": 7, "series": 4, "institutions": 1}
    _, loader, summary, lines = await load(client)
    assert summary == {"institution_id": "austin-tech-bank", "series_added": 0, "series_skipped": 4, "monitors": 0,
                       "monitors_live": 0, "sample_data": True, "monitors_skipped": 7, "institution": "kept"}
    assert loader.done == []
    assert await counts(client) == before
    assert any("already set up" in x for x in lines) and any("already imported" in x for x in lines)
    assert sum("already there, skipped" in x for x in lines) == 7


async def test_a_run_after_a_failure_keeps_what_is_there_and_adds_the_rest(client, us):
    lb = script()
    partial = json.loads(json.dumps(BUNDLE))
    partial["monitors"], partial["series"] = BUNDLE["monitors"][:3], BUNDLE["series"][:1]
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), partial, "John", say=lambda _: None)
    await asyncio.to_thread(loader.run, False)
    assert await counts(client) == {"monitors": 3, "series": 1, "institutions": 1}
    _, _, summary, _ = await load(client)
    assert summary["monitors"] == 4 and summary["monitors_skipped"] == 3 and summary["series_added"] == 3
    assert (await counts(client))["monitors"] == 7


async def test_an_archived_institution_is_not_brought_back_by_a_second_run(client, us):
    await load(client)
    assert (await client.post("/api/v1/institutions/austin-tech-bank:archive", headers={"X-Amiri-Actor": "John"})).status_code == 200
    # an archived institution is not ours to bring back: the script stops with the server's own answer
    lb = script()
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), BUNDLE, "John", say=lambda _: None)
    with pytest.raises(lb.StepFailed, match="activate"):
        await asyncio.to_thread(loader.run, False)


async def a_different_bank(client):
    other = json.loads(json.dumps(BUNDLE["institution"]))
    other["name"] = "Some Other Bank"
    assert (await client.post("/api/v1/institutions:import", json={"institution": other, "sections": BUNDLE["sections"]},
                              headers={"X-Amiri-Actor": "John"})).status_code in (200, 201)


async def test_a_different_institution_stops_with_a_clear_message_and_writes_nothing(client, us):
    await a_different_bank(client)
    lb = script()
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), BUNDLE, "John", say=lambda _: None,
                       profile_path="demo/austin-tech-bank/profile.json")
    with pytest.raises(lb.NotEmpty) as e:
        await asyncio.to_thread(loader.run, False)
    msg = str(e.value)
    assert msg.startswith("A different institution is set up") and "Some Other Bank" in msg
    assert "Start again from a JSON file (Settings) with this bundle's profile: demo/austin-tech-bank/profile.json" in msg
    assert "then run this again" in msg and "--reset --yes" in msg and "Reset the prototype" not in msg
    assert loader.done == []
    assert (await counts(client)) == {"monitors": 0, "series": 0, "institutions": 1}


async def test_reset_starts_again_from_the_bundle_profile_then_loads(client, us):
    await a_different_bank(client)
    _, loader, summary, lines = await load(client, reset=True)
    assert summary["institution"] == "reset" and summary["monitors"] == 7 and summary["monitors_live"] == 7
    assert loader.done[0].startswith("reset: wiped") and not any(d.startswith("imported") for d in loader.done)
    inst = (await client.get("/api/v1/installation")).json()
    assert inst["name"] == "Austin Tech Bank" and inst["status"] == "active"
    assert (await client.get("/api/v1/institutions")).json()[0]["institution_id"] == "austin-tech-bank"
    assert (await counts(client))["monitors"] == 7
    assert any("activated by the reset" in x for x in lines)


async def test_main_reset_with_yes_resets_then_loads(client, us, capsys):
    await a_different_bank(client)
    lb = script()
    code = await asyncio.to_thread(lb.main, ["--file", str(BUNDLE_FILE), "--reset", "--yes", "--skip-after-load"],
                                   InProcess(client, asyncio.get_running_loop()))
    out = capsys.readouterr().out
    assert code == 0 and "wipes the institution and everything made for it" in out and "Some Other Bank" in out
    assert "institution reset" in out and (await counts(client))["monitors"] == 7


async def test_main_reset_without_yes_refuses_and_changes_nothing(client, us, capsys):
    await a_different_bank(client)
    lb = script()
    code = await asyncio.to_thread(lb.main, ["--file", str(BUNDLE_FILE), "--reset", "--skip-after-load"],
                                   InProcess(client, asyncio.get_running_loop()))
    cap = capsys.readouterr()
    assert code == 2 and "needs --yes" in cap.err
    assert (await client.get("/api/v1/installation")).json()["name"] == "Some Other Bank"
    assert (await counts(client))["monitors"] == 0


def test_the_reset_prompt_wants_RESET_typed_at_a_terminal():
    lb = script()

    class Tty:
        def isatty(self):
            return True
    assert lb.confirm_reset("x", False, Tty(), lambda _: "RESET") is True
    assert lb.confirm_reset("x", False, Tty(), lambda _: "yes") is False
    assert lb.confirm_reset("x", True) is True


def test_profile_json_is_the_bundle_profile_in_the_import_shape():
    lb = script()
    profile = json.loads((BUNDLE_FILE.parent / "profile.json").read_text())
    assert profile == lb.profile_of(BUNDLE) and set(profile) == {"institution", "sections"}
    from app.institutions.api import ImportBody  # the shape /prototype:reset and Settings take
    ImportBody.model_validate(profile)


async def test_an_existing_series_is_skipped_not_an_error(client, us):
    assert (await client.post("/api/v1/series", json=BUNDLE["series"][0], headers={"X-Amiri-Actor": "John"})).status_code == 201
    _, _, summary, lines = await load(client)
    assert summary["series_added"] == 3 and summary["series_skipped"] == 1
    assert any("already watched, skipped" in x for x in lines)


async def test_a_failure_stops_and_says_what_was_done(client, us):
    lb = script()
    bad = json.loads(json.dumps(BUNDLE))
    bad["monitors"][1]["spec"]["private"]["exposure"] = [{"id": "product:nope"}]
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), bad, "John", say=lambda _: None)
    with pytest.raises(lb.StepFailed) as e:
        await asyncio.to_thread(loader.run, False)
    assert "write monitor" in str(e.value)
    assert loader.done[0].startswith("imported Austin Tech Bank") and "activated" in loader.done
    assert sum(d.startswith("monitor ") for d in loader.done) == 1


def test_the_plan_writes_nothing_and_names_the_costs(capsys):
    lb = script()
    assert lb.main(["--file", str(ROOT / "demo" / "austin-tech-bank" / "bundle.json"), "--plan"]) == 0
    out = capsys.readouterr().out
    assert "import Austin Tech Bank (US, bank)" in out and "4 market series: QQQ, UNG, USO, IEF" in out
    assert "7 monitors; 7 live: submitted by John, approved by John" in out and "cost money" in out
    lb.main(["--file", str(ROOT / "demo" / "austin-tech-bank" / "bundle.json"), "--plan", "--skip-after-load"])
    assert "no after-load actions" in capsys.readouterr().out
    lb.main(["--file", str(ROOT / "demo" / "austin-tech-bank" / "bundle.json"), "--plan", "--reset"])
    out = capsys.readouterr().out
    assert "1. start again: wipe the institution and everything made for it" in out and "load Austin Tech Bank (US, bank)" in out


@pytest.mark.parametrize("sample, says", [
    ({"enabled": True}, "import the example file (nothing planted)"),
    ({"enabled": True, "conditions": [{"id": "floods"}]}, "import the example file (floods planted)"),
    ({"enabled": False}, "unchanged"), (None, "unchanged")])
def test_the_plan_says_what_happens_to_the_sample_data(sample, says):
    lb = script()
    bundle = {k: v for k, v in BUNDLE.items() if k != "sample_data"}
    if sample is not None:
        bundle["sample_data"] = sample
    step6 = next(x for x in lb.plan(bundle, "John", "John", True) if x.startswith("6. "))
    assert step6 == f"6. the institution's data (sample bank): {says}"
