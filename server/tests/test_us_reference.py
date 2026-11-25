"""The US pack's reference data: a US region, Texas places and US regulators. Data only, added beside
the rest: every existing entry is as it was (tests/test_snapshot_non_us.py pins what agents see)."""

import json

import pytest

from app import reference, settings
from tests.test_institutions_api import BANK, B, add, new

US_BANK = {**BANK, "name": "Austin Tech Bank", "home_country": "US", "base_currency": "USD",
           "time_zone": "America/Chicago", "clearing_currencies": ["USD"]}


async def test_us_regulators_are_suggested_for_a_us_bank(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    iid = (await new(client, US_BANK))["institution_id"]
    await add(client, iid, "footprint", {"code": "US-TX", "role": "branches"})
    items = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    home = {x["item"]["short"]: x for x in items if x["item"]["relation"] == "home"}
    assert set(home) == {"Fed", "OCC", "FDIC", "CFPB", "Texas DOB"}
    assert home["FDIC"]["item"]["regulator_id"] == "us-fdic" and home["CFPB"]["item"]["area"] == "conduct"
    ofac = [x for x in items if x["item"]["regulator_id"] == "sanctions-ofac"]  # the existing entry, reused
    assert len(ofac) == 1 and ofac[0]["item"]["relation"] == "reach"
    assert not any(x["item"]["short"] == "CBSL" for x in items)


async def test_texas_dob_only_for_a_footprint_in_texas(client, env):
    """The federal regulators for every US bank; a state's regulator only when the footprint has that state."""
    env.setenv("SUPPORTED_REGION", "us")
    iid = (await new(client, US_BANK))["institution_id"]
    await add(client, iid, "footprint", {"code": "US-AZ", "role": "branches"})
    items = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    home = {x["item"]["short"] for x in items if x["item"]["relation"] == "home"}
    assert home == {"Fed", "OCC", "FDIC", "CFPB"}
    bare = (await new(client, {**US_BANK, "name": "Phoenix Example Bank"}))["institution_id"]  # the US alone
    items = (await client.get(f"{B}/{bare}/suggestions/regulators")).json()["items"]
    assert "Texas DOB" not in {x["item"]["short"] for x in items}


async def test_a_sri_lankan_bank_gets_no_us_regulator(client):
    iid = (await new(client))["institution_id"]
    items = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    assert not any((x["item"]["regulator_id"] or "").startswith("us-") for x in items)
    assert "CBSL" in {x["item"]["short"] for x in items}


async def test_the_us_region_takes_us_banks_and_japac_stays_the_default(client, env):
    r = await client.post(B, json=US_BANK)  # the default region (japac): a US home is refused, as before
    assert r.status_code == 422 and {e["code"] for e in r.json()["errors"]} == {"outside_region"}
    env.setenv("SUPPORTED_REGION", "us")
    homes = (await client.get("/api/v1/reference/countries", params={"scope": "home"})).json()
    assert homes["region"]["id"] == "us" and [c["code"] for c in homes["items"]] == ["US"]
    assert (await client.post(B, json=BANK)).status_code == 422  # Sri Lanka isn't in the US region
    assert (await client.post(B, json=US_BANK)).status_code == 201


def test_texas_places_are_in_the_gazetteer():
    for code, parent in [("city:dallas", "US-TX"), ("city:houston", "US-TX"), ("city:fort-worth", "US-TX"),
                         ("city:austin", "US-TX"), ("city:san-antonio", "US-TX"), ("city:midland", "US-TX")]:
        info = reference.place_info(code)
        assert info["country"] == "US" and info["parent"] == parent and info["lat"] and info["kind"] == "city"
    assert "Permian Basin" in next(p for p in reference.gazetteer()["places"] if p["code"] == "city:midland")["aliases"]
    sj = reference.place_info("city:san-jose")
    assert sj["parent"] == "US-CA" and sj["lat"] and reference.search_places("silicon valley")[0]["code"] == "city:san-jose"
    for code in ("US-TX", "US-CA", "US-AZ", "US-UT", "US-NV"):
        assert reference.place_info(code)["lat"] is not None
    assert {h["code"] for h in reference.search_places("permian")} == {"city:midland"}


def test_radars_gazetteer_is_an_exact_copy_of_the_servers():
    radar = settings.PROJECT.parent / "agents" / "radar-agent" / "app" / "reference" / "gazetteer.json"
    if not radar.exists():
        pytest.skip("not in the repository (a server-only checkout)")
    server = settings.PROJECT / "app" / "reference" / "gazetteer.json"
    assert radar.read_bytes() == server.read_bytes()
    json.loads(server.read_text())


# ------------------------------------------------- SUPPORTED_REGION as a list

def _snapshot() -> dict:
    from pathlib import Path

    return json.loads((Path(__file__).parent / "fixtures" / "snapshots" / "region_japac.json").read_text())


@pytest.mark.parametrize("value", [None, "", "japac", " JAPAC "])
async def test_japac_alone_is_as_it_was(client, env, value):
    """The default, an empty variable (the default too) and japac itself: the region of the commit before lists."""
    if value is None:
        env.delenv("SUPPORTED_REGION", raising=False)
    else:
        env.setenv("SUPPORTED_REGION", value)
    snap = _snapshot()
    assert reference.region() == snap["region"]
    homes = (await client.get("/api/v1/reference/countries", params={"scope": "home"})).json()
    assert [c["code"] for c in homes["items"]] == snap["countries_home"]
    assert homes["region"] == {"id": "japac", "label": "Japan and Asia-Pacific (JAPAC)"}


async def test_us_alone(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    r = reference.region()
    assert (r["id"], r["label"], r["countries"], r["currencies"]) == ("us", "United States", ["US"], ["USD"])
    assert (await client.post(B, json=BANK)).status_code == 422


async def test_japac_and_us_allow_both_home_countries_and_currencies(client, env):
    env.setenv("SUPPORTED_REGION", "japac,us")
    r = reference.region()
    assert r["id"] == "japac,us" and r["label"] == "Japan and Asia-Pacific (JAPAC) and United States"
    assert {"LK", "US"} <= set(r["countries"]) and {"LKR", "USD"} <= set(r["currencies"])
    assert r["countries"] == _snapshot()["region"]["countries"] + ["US"]
    homes = (await client.get("/api/v1/reference/countries", params={"scope": "home"})).json()
    assert {"LK", "US"} <= {c["code"] for c in homes["items"]}
    cur = (await client.get("/api/v1/reference/currencies", params={"scope": "home"})).json()
    assert {"LKR", "USD"} <= {c["code"] for c in cur["items"]}
    assert (await client.post(B, json=BANK)).status_code == 201  # Sri Lanka


async def test_a_us_home_under_japac_and_us(client, env):
    env.setenv("SUPPORTED_REGION", "us,japac")
    assert reference.region()["id"] == "us,japac"
    assert (await client.post(B, json=US_BANK)).status_code == 201


def test_an_unknown_region_is_ignored_with_a_warning(env, caplog):
    env.setenv("SUPPORTED_REGION", "japac,emea")
    with caplog.at_level("WARNING"):
        assert reference.region() == _snapshot()["region"]
    assert any("emea" in m and "ignored" in m for m in caplog.messages)
    env.setenv("SUPPORTED_REGION", "emea")  # nothing known: anywhere, as an unknown id always was
    assert reference.region() is None
