"""The US pack's reference data: a US region, Texas places and US regulators. Data only, added beside
the rest: every existing entry is as it was (tests/test_snapshot_non_us.py pins what agents see)."""

import json

import pytest

from app import reference, settings
from tests.test_institutions_api import BANK, B, new

US_BANK = {**BANK, "name": "Austin Tech Bank", "home_country": "US", "base_currency": "USD",
           "time_zone": "America/Chicago", "clearing_currencies": ["USD"]}


async def test_us_regulators_are_suggested_for_a_us_bank(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    iid = (await new(client, US_BANK))["institution_id"]
    items = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    home = {x["item"]["short"]: x for x in items if x["item"]["relation"] == "home"}
    assert set(home) == {"Fed", "OCC", "FDIC", "CFPB", "Texas DOB"}
    assert home["FDIC"]["item"]["regulator_id"] == "us-fdic" and home["CFPB"]["item"]["area"] == "conduct"
    ofac = [x for x in items if x["item"]["regulator_id"] == "sanctions-ofac"]  # the existing entry, reused
    assert len(ofac) == 1 and ofac[0]["item"]["relation"] == "reach"
    assert not any(x["item"]["short"] == "CBSL" for x in items)


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
