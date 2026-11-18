"""The event monitor's region packs (app/harness.py picks one from the institution's home country): hints added to
a check's instruction. A country without a pack gets the instruction exactly as before."""

import json
from functools import cache
from pathlib import Path

from app.harness import region_for

HERE = Path(__file__).parent


@cache
def _load(region: str) -> dict:
    return json.loads((HERE / f"{region}.json").read_text())


def pack_for(country: str | None) -> dict | None:
    region = region_for(country)
    return {**_load(region), "region": region} if region else None
