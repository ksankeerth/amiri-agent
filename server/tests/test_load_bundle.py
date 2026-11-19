"""demo/load_bundle.py against the test app: the Austin Tech Bank bundle on an empty platform.

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
BUNDLE = json.loads((ROOT / "demo" / "austin-tech-bank" / "bundle.json").read_text())


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


async def load(client, approver=None):
    lb = script()
    lines: list[str] = []
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), BUNDLE, "John", approver, say=lines.append)
    summary = await asyncio.to_thread(loader.run, False)
    return lb, loader, summary, lines


async def test_the_austin_bundle_loads_on_an_empty_platform(client, us):
    _, _, summary, lines = await load(client, approver="Maya")
    assert summary == {"institution_id": "austin-tech-bank", "series_added": 4, "series_skipped": 0, "monitors": 7,
                       "monitors_live": 7, "sample_data": True}
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
    sample = {s["kind"]: s for s in (await client.get("/api/v1/mock-institutions")).json()["items"]}
    assert sample["bank"]["enabled"] is True and sample["bank"]["shaped_by"]["name"] == "Austin Tech Bank"


async def test_a_second_run_refuses_and_writes_nothing(client, us):
    await load(client)
    lb = script()
    loader = lb.Loader(InProcess(client, asyncio.get_running_loop()), BUNDLE, "John", say=lambda _: None)
    with pytest.raises(lb.NotEmpty, match="Reset the prototype"):
        await asyncio.to_thread(loader.run, False)
    assert loader.done == []
    assert len((await client.get("/api/v1/institutions")).json()) == 1


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


@pytest.mark.parametrize("sample, says", [({"enabled": True}, "switch on"), ({"enabled": False}, "switch off"),
                                          (None, "unchanged")])
def test_the_plan_says_what_happens_to_the_sample_data(sample, says):
    lb = script()
    bundle = {k: v for k, v in BUNDLE.items() if k != "sample_data"}
    if sample is not None:
        bundle["sample_data"] = sample
    step6 = next(x for x in lb.plan(bundle, "John", "John", True) if x.startswith("6. "))
    assert step6 == f"6. sample bank: {says}"
