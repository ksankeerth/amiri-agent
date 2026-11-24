"""Test helpers for the institution's data: the example file (the sample bank or insurer from app/mockinst, shaped
by the installation's profile, with any planted conditions) and importing it the way the web app does."""

import json
from datetime import date

from app.mockinst import export

ME = {"X-Amiri-Actor": "admin@x"}
C = "/api/v1/data-connection"
TODAY = date(2026, 10, 7)  # the test clock, in Colombo and Jakarta
_files: dict[tuple, dict] = {}


async def example(app, conditions=(), products: list[str] | None = None) -> dict:
    """The example file for this installation (cached across tests: it is deterministic)."""
    profile, kind, source, _ = await export.profile_for(app.state.institutions)
    key = (json.dumps(profile, sort_keys=True, default=str), json.dumps(list(conditions)), tuple(products or ()))
    if key not in _files:
        _files[key] = export.build_file(profile, kind, TODAY, list(conditions), source, products)
    return json.loads(json.dumps(_files[key]))  # a copy the caller may change


async def send(client, doc, name: str = "institution-data.json", headers=ME):
    body = doc if isinstance(doc, bytes) else json.dumps(doc).encode()
    return await client.post(f"{C}:import", params={"file_name": name}, content=body,
                             headers={**headers, "Content-Type": "application/json"})


async def connect(client, app, conditions=(), products: list[str] | None = None) -> dict:
    """Imports the example file; the connection's view."""
    r = await send(client, await example(app, conditions, products))
    assert r.status_code == 200, r.text[:2000]
    return r.json()
