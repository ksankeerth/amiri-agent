"""The region pack comes from the home country alone: the US gets its pack, every other country the base."""

import pytest

from app.harness import PACK_VERSIONS, region_for


@pytest.mark.parametrize("country", ["US", "us", "Us", " US "])
def test_a_us_institution_gets_the_us_pack(country):
    assert region_for(country) == "us"


@pytest.mark.parametrize("country", ["LK", "ID", "PH", "GB", "lk", None, "", "USA", "U.S."])
def test_every_other_country_gets_the_base_alone(country):
    assert region_for(country) is None


def test_each_pack_has_a_version():
    assert PACK_VERSIONS == {"us": "us-1"}
    assert region_for("US") in PACK_VERSIONS
