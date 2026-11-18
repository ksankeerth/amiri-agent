"""Region harnesses: a shared base plus, for some home countries, a region pack that adds to it.

The region comes from the institution's home country, which every request already carries, so
nothing new is stored or sent. A country without a pack (Sri Lanka, Indonesia, ...) gets the base
alone, exactly as before packs existed. The same few lines are in each service (server, radar,
investigation, event monitor, setup), so each builds from its own folder.
"""

PACKS = {"US": "us"}  # home country (ISO 3166-1) -> region pack
PACK_VERSIONS = {"us": "us-1"}


def region_for(country: str | None) -> str | None:
    """The region pack for a home country ("US" or "us" -> "us"), or None: the base alone."""
    return PACKS.get((country or "").strip().upper())
