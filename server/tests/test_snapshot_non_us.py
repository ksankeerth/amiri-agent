"""Today's setup-assistant context pack for an institution without a region pack (Sri Lanka), pinned.

The pack the server sends the setup agent for the Serendib demo bank, and for a chat before any
institution exists, must stay exactly as it was at ce1d73e. The expected values are in
tests/fixtures/snapshots/ and are never regenerated: a difference here is a change in behaviour.
Only what changes from run to run (the thread id) is left out.
"""

import json

from app import settings
from tests.test_assistant_api import ME

SNAPSHOTS = settings.PROJECT / "tests" / "fixtures" / "snapshots"
SEED = json.loads((settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())


async def pack(client, institution_id: str | None) -> dict:
    r = await client.post("/api/v1/assistant/sessions", json={"institution_id": institution_id}, headers=ME)
    assert r.status_code == 201, r.text
    ctx = (await client.get(f"/api/v1/assistant/sessions/{r.json()['session_id']}/context")).json()
    assert ctx.pop("thread_id").startswith("thr")
    return ctx


async def test_the_lk_context_pack_is_unchanged(client, env):
    env.setenv("INSTITUTION_ID", "serendib-bank")
    r = await client.post("/api/v1/institutions:import", json={"institution": SEED["institution"],
                                                               "sections": SEED["sections"]})
    assert r.status_code == 201, r.text
    got = await pack(client, "serendib-bank")
    assert got == json.loads((SNAPSHOTS / "assistant_pack_lk.json").read_text())


async def test_the_pack_before_an_institution_exists_is_unchanged(client):
    got = await pack(client, None)
    assert got == json.loads((SNAPSHOTS / "assistant_pack_new.json").read_text())


# The database schema and every API contract are fixed: a region pack never changes them.
GUARDED = ["server/app/migrations", "server/openapi.yaml", "server/contracts", "server/app/spec/reference-openapi-1.0.0.yaml",
           "agents/event-monitor-agent/openapi.yaml", "agents/investigation-agent/openapi.yaml"]


def guarded_hashes() -> dict[str, str]:
    import hashlib

    root = settings.PROJECT.parent
    files = []
    for g in GUARDED:
        p = root / g
        files += sorted(x for x in p.rglob("*") if x.is_file() and "__pycache__" not in x.parts) if p.is_dir() else [p]
    return {str(f.relative_to(root)): hashlib.sha256(f.read_bytes()).hexdigest() for f in files}


def test_no_migration_or_contract_changed():
    import pytest

    if not (settings.PROJECT.parent / "agents").is_dir():
        pytest.skip("not in the repository (a server-only checkout)")
    assert guarded_hashes() == json.loads((SNAPSHOTS / "guarded_files.json").read_text())
