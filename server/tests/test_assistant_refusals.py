"""What the setup chat learns when the region rule or an Apply says no: the agent hears it, the chat records it."""

from tests.test_assistant_api import ME, A, propose, session
from tests.test_institutions_api import BANK, new

UK = {"name": "Thamesgate General", "institution_type": "insurer", "subtype": "general", "home_country": "GB",
      "base_currency": "GBP", "time_zone": "Europe/London"}


async def thread(client) -> str:
    await session(client)
    return (await client.get(f"{A}/thread", headers=ME)).json()["thread_id"]


async def test_a_home_outside_the_region_is_refused_when_proposed(client):
    tid = await thread(client)
    r = await propose(client, thread_id=tid, track="institution", kind="create_institution",
                      summary="Create Thamesgate General", institution=UK)
    assert r.status_code == 422 and r.json()["code"] == "outside_region"
    assert {e["field"] for e in r.json()["errors"]} == {"home_country", "base_currency"}
    assert "Japan and Asia-Pacific" in r.json()["errors"][0]["message"]
    # nothing was offered to the person
    assert not (await client.get("/api/v1/proposals", params={"thread_id": tid})).json()
    # a home in the region still works
    r = await propose(client, thread_id=tid, track="institution", kind="create_institution",
                      summary="Create Serendib", institution=BANK)
    assert r.status_code == 201, r.text


async def test_a_subtype_outside_its_type_is_refused_when_proposed(client):
    tid = await thread(client)
    r = await propose(client, thread_id=tid, track="institution", kind="create_institution",
                      summary="Create Hangang General", institution={**UK, "subtype": "non-life", "home_country": "KR",
                                                                    "base_currency": "KRW", "time_zone": "Asia/Seoul"})
    assert r.status_code == 422 and r.json()["code"] == "validation_error"
    assert r.json()["errors"][0]["field"] == "subtype" and "general" in r.json()["errors"][0]["message"]
    assert not (await client.get("/api/v1/proposals", params={"thread_id": tid})).json()


async def test_a_failed_apply_is_recorded_in_the_chat(client):
    tid = await thread(client)
    p = (await propose(client, thread_id=tid, track="institution", kind="create_institution",
                       summary="Create Serendib", institution=BANK)).json()
    await new(client)  # meanwhile the institution was made with the forms: one per platform, so this can't apply
    r = await client.post(f"/api/v1/proposals/{p['proposal_id']}:confirm", headers=ME)
    assert r.status_code >= 400
    assert (await client.get(f"/api/v1/proposals/{p['proposal_id']}")).json()["status"] == "failed"
    msgs = (await client.get(f"{A}/thread", headers=ME)).json()["messages"]
    last = msgs[-1]
    assert last["kind"] == "applied" and last["content"]["status"] == "failed"
    assert last["content"]["proposal_id"] == p["proposal_id"] and last["content"]["detail"]
    # and the institution track is not marked concluded
    th = (await client.get(f"{A}/thread", headers=ME)).json()
    assert next(t for t in th["tracks"] if t["track"] == "institution")["status"] != "concluded"
