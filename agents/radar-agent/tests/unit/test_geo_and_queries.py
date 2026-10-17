"""Places as GDELT codes them, and the query: parameters only, two days at most, the type's themes."""

from datetime import timedelta

from app.geo import fips, fips_to_iso, places, title_pattern
from app.queries import SQL, TABLE, plan
from tests.unit.conftest import UNTIL, request


def test_fips_codes_differ_from_iso_where_gdelt_says_so():
    assert fips("LK") == ("CE",) and fips("KW") == ("KU",) and fips("OM") == ("MU",) and fips("BH") == ("BA",)
    assert fips("IN") == ("IN",) and fips("SA") == ("SA",)
    m = fips_to_iso()
    assert m["CE"] == "LK" and m["KU"] == "KW" and m["MU"] == "OM" and m["BA"] == "BH" and m["SA"] == "SA"


def test_the_scope_becomes_codes_and_names():
    p = places("LK", ["LK", "IN", "SA", "IN-TN", "LK-1", "chk:hormuz"])
    assert p.home_fips == ("CE",) and set(p.footprint_fips) == {"IN", "SA"}
    assert {"sri lanka", "colombo", "cbsl"} <= set(p.home_names)
    assert "tamil nadu" in p.footprint_names and "western province" not in p.home_names  # too generic alone
    assert p.named["chk:hormuz"] == ["strait of hormuz", "hormuz"]
    assert p.codes_in_title("Two ships sink near Strait of Hormuz") == {"chk:hormuz"}
    assert p.codes_in_title("Rupee slides as CBSL holds rates in Colombo") == {"LK"}


def test_title_pattern_is_whole_words_and_escaped():
    import re
    pat = title_pattern(["u.s.", "oman"])
    assert re.search(pat, "talks with oman resume") and not re.search(pat, "woman of the year")
    assert title_pattern([]) == ""


def test_one_capped_parameterised_query():
    q, _ = plan(request())
    assert q.sql == SQL and f"`{TABLE}`" in q.sql and q.sql.count("`") == 2  # one table, the partitioned GKG
    assert "Seylan" not in q.sql and "Sri Lanka" not in q.sql  # names only as parameters
    assert q.params["day_from"][1] == "2026-10-16" and q.params["day_to"][1] == "2026-10-17"  # the window spans midnight
    assert q.params["home_fips"] == ("ARRAY<STRING>", ["CE"])
    assert "seylan bank" in q.params["actor_names"][1] and "cbsl" in q.params["actor_names"][1]
    assert "ECON_CENTRALBANK" in q.params["themes"][1] and "NATURAL_DISASTER_FLOOD" in q.params["themes"][1]


def test_an_insurer_gets_insurance_themes():
    q, _ = plan(request(institution_type="insurer"))
    assert "WB_337_INSURANCE" in q.params["themes"][1] and "ECON_CENTRALBANK" not in q.params["themes"][1]


def test_a_long_window_reads_two_days_at_most():
    req = request(window={"since": (UNTIL - timedelta(days=5)).isoformat(), "until": UNTIL.isoformat()})
    q, _ = plan(req)
    assert q.clamped and q.days == [UNTIL.date() - timedelta(days=1), UNTIL.date()]
    assert q.params["day_from"][1] == "2026-10-16"
