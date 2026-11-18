"""Radar's US pack: home news for a US institution is its footprint's states and cities, not the whole country.

For any other country the query and the article tagging are the base's, byte for byte
(tests/unit/test_snapshot_non_us.py pins them). Here: the US query's parameters, that the SQL rule
(replayed in Python by tests/fixtures/recall.py) and articles.py agree, and the judge's politics rule.
"""

import json
from datetime import UTC, datetime, timedelta

from app.articles import clean_title, from_row
from app.contract import RadarRunRequest
from app.geo import home_domain, is_home_outlet, places
from app.judge import institution_brief
from app.prompt import build_instruction
from app.queries import SQL, SQL_REGION, plan
from tests.fixtures.recall import recalled, rows
from tests.unit.test_snapshot_non_us import SNAPSHOTS, lk_request, plan_snapshot

UNTIL = datetime(2026, 10, 17, 6, 0, tzinfo=UTC)
US_BANK = {
    "run_id": "rad-us-1",
    "institution": {"name": "Austin Tech Bank", "institution_type": "bank", "country": "US",
                    "country_name": "United States", "currency": "USD", "time_zone": "America/Chicago",
                    "summary": "Synthetic mid-size Dallas commercial bank.",
                    "regulators": [{"id": "fed", "name": "Federal Reserve", "aliases": []}]},
    "scope": {"places": ["US", "US-TX", "city:dallas", "city:houston", "city:midland"],
              "places_why": {"US": ["footprint (home)"], "US-TX": ["footprint (home)"]},
              "themes": ["rates", "sector", "commodities", "regulation"], "actors": ["ERCOT", "Federal Reserve"]},
    "window": {"since": (UNTIL - timedelta(hours=24)).isoformat(), "until": UNTIL.isoformat()},
    "seen": [],
    "limits": {"max_stories": 10, "max_model_calls": 40, "timeout_seconds": 300, "max_queries": 1,
               "max_bytes_per_query": 1_500_000_000},
}


def us_request() -> RadarRunRequest:
    return RadarRunRequest.model_validate(US_BANK)


def us_places():
    r = us_request()
    return places(r.institution.country, list(r.scope.places), dict(r.scope.places_why))


def row(title: str, outlet: str, locations: str, url: str) -> dict:
    return {"DATE": 20261017030000, "outlet": outlet, "url": url, "title": title, "locations": locations,
            "themes": "", "orgs": "", "home_n": 0, "foot_n": 0, "all_n": 0}


US3 = ";".join(["1#United States#US#US"] * 3)
FIXTURE = {
    "dallas-title": row("Dallas data-center builders pause new projects", "example.com",
                        "1#United States#US#US", "https://example.com/1"),
    "us-only": row("Washington weighs new rules for chip exports to Asia", "example.com", US3, "https://example.com/2"),
    "dallasnews": row("Grid operator warns of tight supply this winter", "dallasnews.com", "", "https://dallasnews.com/3"),
    "texas-locations": row("Grid operator warns of tight supply this winter", "example.com",
                           ";".join(["2#Texas, United States#US#USTX"] * 3), "https://example.com/4"),
    "texas-twice": row("Grid operator warns of tight supply this winter", "example.com",
                       ";".join(["2#Texas, United States#US#USTX"] * 2), "https://example.com/5"),
    "us-title": row("U.S. stocks fall as United States yields climb", "example.com", US3, "https://example.com/6"),
    "www-outlet": row("Refinery outage lifts gasoline prices", "www.houstonchronicle.com", "", "https://hc.com/7"),
}
HOME = {"dallas-title": True, "us-only": False, "dallasnews": True, "texas-locations": True, "texas-twice": False,
        "us-title": False, "www-outlet": True}


def test_without_a_pack_the_sql_and_parameters_are_the_pinned_ones():
    assert plan_snapshot(lk_request()) == json.loads((SNAPSHOTS / "radar_plan_lk.json").read_text())
    q, p = plan(lk_request())
    assert q.sql is SQL and p.region is None and "home_adm1" not in q.params


def test_the_us_query_narrows_home_to_the_footprint():
    q, p = plan(us_request())
    assert q.sql is SQL_REGION and p.region == "us"
    params = {k: v for k, (_, v) in q.params.items()}
    assert params["home_adm1"] == ["USTX"]
    assert {"dallasnews.com", "houstonchronicle.com", "bizjournals.com", "reuters.com"} <= set(params["home_outlets"])
    assert "home_domain" not in params and "@home_domain" not in q.sql  # not ".us": US outlets are .com
    for word in ("texas", "dallas", "houston", "fort worth", "permian", "ercot"):
        assert word in params["home_names"]
    assert "united states" not in params["home_names"] and "u\\.s\\." not in params["home_names"]
    assert params["home_fips"] == ["US"]  # still the country, for the actor rule (an actor with the US in it)


def test_every_parameter_the_us_sql_names_is_sent():
    import re

    q, _ = plan(us_request())
    assert set(re.findall(r"@(\w+)", q.sql)) == set(q.params)
    q, _ = plan(lk_request())
    assert set(re.findall(r"@(\w+)", q.sql)) == set(q.params)


def test_sql_and_articles_agree_on_what_is_home():
    req, p = us_request(), us_places()
    sql_home = {r["url"]: r["r_home"] for r in recalled(list(FIXTURE.values()), req)}
    for key, r in FIXTURE.items():
        a = from_row(r, p)
        assert ("US" in a.about) is HOME[key], key
        assert sql_home.get(r["url"], False) is HOME[key], key


def test_sql_and_articles_agree_on_a_real_day():
    """Every real row of 16-17 Oct 2026 (Serendib's day, with many US articles), judged for a US bank. The SQL
    reads the raw title and articles.py the cleaned one (no "| Outlet" suffix, as for every country), so both
    are given the cleaned title here: this compares the rules, not the cleaning."""
    req, p = us_request(), us_places()
    day = [{**r, "title": clean_title(r["title"])} for r in rows("serendib-2026-10-16.jsonl.gz")]
    sql_home = {r["url"]: r["r_home"] for r in recalled(day, req)}
    q, _ = plan(req)
    since, until = q.params["since"][1], q.params["until"][1]
    checked = homes = 0
    for r in day:
        a = from_row(r, p)
        if a is None or not since <= int(r["DATE"]) < until:  # the query's window
            continue
        checked += 1
        homes += "US" in a.about
        assert ("US" in a.about) == sql_home.get(r["url"], False), r["title"]
    us_by_country = sum(1 for r in day if r["locations"].count("#US#") >= 3)
    assert checked > 1000 and 0 < homes < us_by_country / 3  # far narrower than "the US, 3 times"


def test_home_outlets_come_from_the_pack_for_the_us():
    p = us_places()
    assert is_home_outlet("dallasnews.com", p) and is_home_outlet("www.wsj.com", p)
    assert not is_home_outlet("news.us", p) and not is_home_outlet("notdallasnews.com", p)
    lk = places("LK", ["LK"])
    assert is_home_outlet("ft.lk", lk) and not is_home_outlet("dallasnews.com", lk)
    assert home_domain("LK") == ".lk"  # unchanged


def judge_state(req: RadarRunRequest) -> dict:
    return {"institution": institution_brief(req), "batch": [], "vocabulary": {"rates": {"up": "rates rise"}}}


def test_the_us_judge_skips_politics_and_the_lk_judge_is_unchanged():
    rule = "Skip elections, campaigns and party politics; keep interest rates, regulation, credit, energy, power and data centers."
    us = build_instruction(judge_state(us_request()))
    assert rule in us and us.index(rule) < us.index("Theme vocabulary")
    lk = build_instruction(judge_state(lk_request()))
    assert rule not in lk and "elections" not in lk
    assert us.replace(rule + "\n\n", "").count("Theme vocabulary") == 1
