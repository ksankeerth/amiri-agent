"""The setup guide for a region pack (app/harness.py), sent in the context pack as `region_guide` for an
institution whose home country has one (the US); none for every other country, so their pack is as before.

The text is region_guides/<region>.txt; the setup agent keeps the same file
(agents/setup-agent/app/region_guides/) for a session that began before the home country was set.
"""

from functools import cache
from pathlib import Path

from app.harness import PACK_VERSIONS, region_for

HERE = Path(__file__).parent / "region_guides"


@cache
def _text(region: str) -> str:
    return (HERE / f"{region}.txt").read_text().strip()


def region_guide(country: str | None) -> dict | None:
    """{region, version, text} for a home country with a pack, else None."""
    region = region_for(country)
    return {"region": region, "version": PACK_VERSIONS[region], "text": _text(region)} if region else None
