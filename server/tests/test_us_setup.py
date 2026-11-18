"""The setup assistant's context pack carries the US guide for a US institution, and nothing new for anyone else
(tests/test_snapshot_non_us.py pins the Sri Lankan pack and the pack before an institution exists)."""

import pytest

from app import settings
from app.assistant.region import HERE, region_guide
from tests.test_snapshot_non_us import pack
from tests.test_us_reference import US_BANK

GUIDE = (HERE / "us.txt").read_text().strip()


async def test_a_us_institutions_pack_has_the_us_guide(client, env):
    env.setenv("SUPPORTED_REGION", "us")
    r = await client.post("/api/v1/institutions", json={**US_BANK, "institution_id": "us-bank"})
    assert r.status_code == 201, r.text
    got = await pack(client, "us-bank")
    assert got["region_guide"] == {"region": "us", "version": "us-1", "text": GUIDE}
    assert got["institution"]["country"] == "US"
    assert "Federal Reserve" in GUIDE and "domestic_business" in GUIDE and "elections" in GUIDE


async def test_other_packs_have_no_region_guide(client):
    r = await client.post("/api/v1/institutions", json={**US_BANK, "home_country": "LK", "base_currency": "LKR",
                                                        "time_zone": "Asia/Colombo", "institution_id": "lk-bank"})
    assert r.status_code == 201, r.text
    assert "region_guide" not in await pack(client, "lk-bank")
    assert "region_guide" not in await pack(client, None)
    assert region_guide("LK") is None and region_guide(None) is None and region_guide("ID") is None


def test_the_setup_agent_keeps_the_same_guide():
    agent = settings.PROJECT.parent / "agents" / "setup-agent" / "app" / "region_guides" / "us.txt"
    if not agent.exists():
        pytest.skip("not in the repository (a server-only checkout)")
    assert agent.read_bytes() == (HERE / "us.txt").read_bytes()
