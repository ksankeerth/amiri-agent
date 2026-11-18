"""The tracks a run uses: the built-in catalog, plus a region pack's rules when the institution's home
country has one (app/harness.py). Without a pack the run uses app/tracks.py's catalog as it is, and
reports its version unchanged."""

from dataclasses import dataclass, field
from functools import cache

from app import tracks
from app.harness import PACK_VERSIONS, region_for
from app.tracks import Mechanism


@dataclass(frozen=True)
class Catalog:
    mechanisms: list[Mechanism]
    version: str
    region: str | None = None
    by_id: dict[str, Mechanism] = field(default_factory=dict)


def _pack(region: str) -> list[Mechanism]:
    if region == "us":
        from app.packs.us_tracks import MECHANISMS

        return MECHANISMS
    return []


@cache
def _catalog(region: str | None) -> Catalog:
    if region is None:
        return Catalog(tracks.MECHANISMS, tracks.TRACKS_VERSION, None, tracks.BY_ID)
    ms = [*tracks.MECHANISMS, *_pack(region)]
    return Catalog(ms, f"{tracks.TRACKS_VERSION}+{PACK_VERSIONS[region]}", region, {m.mechanism_id: m for m in ms})


def catalog_for(country: str | None) -> Catalog:
    """The catalog for an institution based in this country (ISO 3166-1)."""
    return _catalog(region_for(country))
