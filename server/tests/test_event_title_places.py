"""A stored event's title shows place names where the agent wrote codes; currencies are never touched."""

from app.investigation.service import _place_names


def test_codes_become_names_and_currencies_stay():
    assert _place_names("A drought hit in US-TX", ["US-TX"]) == "A drought hit in Texas"
    assert _place_names("The LKR weakened (6%)", ["LK"]) == "The LKR weakened (6%)"
    assert _place_names("A flood hit in LK-1 and LK-2", ["LK-1", "LK-2", "LK"]) == (
        "A flood hit in Western Province and Central Province")
    assert _place_names("Oil rose", []) == "Oil rose"
