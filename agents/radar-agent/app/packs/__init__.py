"""Radar's region packs (app/harness.py picks one from the home country): data that narrows or adds to the
base rules for one region. A country without a pack gets the base alone, exactly as before."""

import json
from functools import cache
from pathlib import Path

from app.harness import region_for

HERE = Path(__file__).parent


@cache
def _load(region: str) -> dict:
    return json.loads((HERE / f"{region}.json").read_text())


def pack_for(country: str | None) -> dict | None:
    """The region pack for an institution based in this country, or None (the base alone)."""
    region = region_for(country)
    return {**_load(region), "region": region} if region else None
