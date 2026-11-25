"""What reaches the investigation agent is what it accepts, and one bad finding never costs the batch.

Radar's themes are free text: on 21 Nov 2026 one tagged {"theme": "sector", "item": "data centers"}, the agent
refused the whole batch (HTTP 422), and three findings were set aside uninvestigated. Now the request builder
cleans every finding's themes and evidence, and a finding the agent still refuses is set aside alone, with the
reason, while the rest are sent again."""

import pytest

from app.investigation.request import MAX_THEMES, clean_evidence, clean_themes
from tests.test_investigation_api import bank, sandbox_move

I = "/api/v1/investigations"


async def copy_of(sql, f: dict, finding_id: str) -> dict:
    """A second new finding, like the first (as a second source would write it)."""
    await sql("""INSERT INTO signals.findings (finding_id, world, institution_id, source, source_ref, kind, title, explanation,
                   score, themes, effective_from, period, places, evidence, created_at)
                 SELECT %s, world, institution_id, source, source_ref, kind, title || ' (again)', explanation, score, themes,
                   effective_from, period, places, evidence, created_at + interval '1 second'
                 FROM signals.findings WHERE finding_id = %s""", (finding_id, f["finding_id"]))
    return {"finding_id": finding_id}


@pytest.mark.parametrize(("given", "sent"), [
    # Radar has no sector field: a sector theme's item is its sector (what failed on 21 Nov)
    ([{"theme": "sector", "direction": "shock", "item": "data centers"}], [{"theme": "sector", "direction": "shock", "sector": "data centers"}]),
    # an item the theme doesn't have is dropped; the theme stays
    ([{"theme": "prices", "direction": "up", "item": "rent"}], [{"theme": "prices", "direction": "up"}]),
    ([{"theme": "prices", "direction": "up", "item": "electricity"}], [{"theme": "prices", "direction": "up", "item": "electricity"}]),
    # an unknown theme or direction is dropped
    ([{"theme": "politics", "direction": "up"}, {"theme": "rates", "direction": "sideways"}], []),
    # a currency only on fx, and a malformed one becomes the base
    ([{"theme": "fx", "direction": "weaker", "currency": "usd"}], [{"theme": "fx", "direction": "weaker", "currency": "LKR"}]),
    ([{"theme": "rates", "direction": "up", "currency": "USD"}], [{"theme": "rates", "direction": "up"}]),
    ([{"theme": "fx", "direction": "home_weaker"}], [{"theme": "fx", "direction": "weaker", "currency": "LKR"}]),
    # unknown keys go, repeats go
    ([{"theme": "macro", "direction": "worse", "why": "x"}, {"theme": "macro", "direction": "worse"}], [{"theme": "macro", "direction": "worse"}]),
])
def test_themes_are_cleaned_to_the_vocabulary(given, sent):
    assert clean_themes(given, "LKR") == sent


def test_valid_themes_pass_unchanged_and_at_most_four_go():
    valid = [{"theme": "fx", "direction": "weaker", "currency": "LKR"}, {"theme": "commodities", "direction": "up", "item": "oil"},
             {"theme": "remittance", "direction": "down"}, {"theme": "disaster", "direction": "domestic", "item": "flood"},
             {"theme": "macro", "direction": "worse"}]
    assert clean_themes(valid[:4], "LKR") == valid[:4]
    assert len(clean_themes(valid, "LKR")) == MAX_THEMES


def test_a_web_page_without_an_http_address_is_dropped():
    ev = {"signals": [], "headlines": [], "web": [{"url": "https://a.example/1", "title": "a"}, {"url": "www.b.example", "title": "b"}]}
    assert clean_evidence(ev)["web"] == [{"url": "https://a.example/1", "title": "a"}]


async def test_a_refused_finding_is_set_aside_alone_and_the_rest_are_investigated(client, env, agent, sql):
    await bank(client, env)
    good = await sandbox_move(client)
    bad = await copy_of(sql, good, "f-bad-radar-tag")
    agent.refuse = {bad["finding_id"]}
    run = (await client.post(I, json={})).json()["items"][0]
    assert run["status"] == "running" and run["finding_ids"] == [good["finding_id"]]
    assert [f["finding_id"] for f in agent.requests[0]["findings"]] == [good["finding_id"]]
    got = (await client.get(f"/api/v1/findings/{bad['finding_id']}")).json()
    assert got["status"] == "set_aside" and got["outcome"]["reason"] == "investigation_failed"
    assert "refused this finding" in got["outcome"]["note"]
    assert (await client.get(f"{I}/{run['run_id']}")).json()["status"] == "completed"  # the good one went through


async def test_a_batch_whose_every_finding_is_refused_fails_as_before(client, env, agent):
    await bank(client, env)
    only = await sandbox_move(client)
    agent.refuse = {only["finding_id"]}
    r = await client.post(I, json={})
    run = r.json()["items"][0]
    assert (await client.get(f"{I}/{run['run_id']}")).json()["status"] == "failed"
