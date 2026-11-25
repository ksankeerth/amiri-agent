"""Event titles name what moved: the item of a price or a disaster, and the sector hit. Themes without those keep
the built-in phrases (the fx, rates and commodity titles a Sri Lankan bank sees are unchanged)."""

import pytest

from app.contract import Event, ThemeTag
from app.investigate import phrase


def event(theme: dict, places: list[str] | None = None, size: float | None = None) -> Event:
    return Event.model_validate({"event_id": "evt-1", "finding_ids": ["f-1"], "themes": [ThemeTag(**theme).model_dump()],
                                 "country": "home", "anchor": "2026-11-18T00:00:00Z", "anchor_basis": "published_at",
                                 "places": places or [], **({"size": {"unit": "pct", "value": size}} if size else {})})


@pytest.mark.parametrize(("theme", "places", "size", "title"), [
    ({"theme": "prices", "direction": "up", "item": "electricity"}, [], 18.09, "Electricity prices rose (18.09%)"),
    ({"theme": "prices", "direction": "down", "item": "fuel"}, [], None, "Fuel prices fell"),
    ({"theme": "prices", "direction": "up", "item": "general"}, [], None, "Prices rose"),
    ({"theme": "disaster", "direction": "domestic", "item": "drought"}, ["US-TX"], None, "A drought hit in US-TX"),
    ({"theme": "disaster", "direction": "domestic", "item": "earthquake"}, [], None, "An earthquake hit"),
    ({"theme": "disaster", "direction": "abroad", "item": "storm"}, ["PH"], None, "A storm hit abroad in PH"),
    ({"theme": "sector", "direction": "shock", "sector": "technology"}, [], None, "The technology sector was hit"),
    ({"theme": "sector", "direction": "boost", "sector": "construction"}, [], None, "The construction sector got a boost"),
    ({"theme": "sector", "direction": "shock"}, [], None, "A sector was hit"),
    ({"theme": "fx", "direction": "weaker", "currency": "LKR"}, [], 6, "The LKR weakened (6%)"),
    ({"theme": "commodities", "direction": "up", "item": "oil"}, [], None, "Oil rose"),
])
def test_a_title_names_what_moved(theme, places, size, title):
    assert phrase(event(theme, places, size), "USD") == title
