"""A platform serves one institution: a second can't be created until the prototype is reset."""

from tests.test_investigation_api import SEED, bank


async def test_a_second_institution_is_refused(client, env):
    env.setenv("SINGLE_INSTITUTION", "true")
    await bank(client, env)
    other = {**SEED["institution"], "institution_id": "other-bank", "name": "Other Bank"}
    r = await client.post("/api/v1/institutions:import", json={"institution": other, "sections": {}})
    assert r.status_code == 409 and r.json()["code"] == "one_institution"
