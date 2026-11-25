"""Radar's US pack: home news for a US institution is its footprint's states and cities, not the whole country.

For any other country the query and the article tagging are the base's, byte for byte
(tests/unit/test_snapshot_non_us.py pins them). Here: the US query's parameters, that the SQL rule
(replayed in Python by tests/fixtures/recall.py) and articles.py agree, and the judge's politics rule.
"""

import json
import re
from datetime import UTC, datetime, timedelta

from app.articles import from_row
from app.contract import RadarRunRequest
from app.geo import home_domain, is_home_outlet, places
from app.judge import institution_brief
from app.packs import pack_for
from app.prompt import build_instruction
from app.queries import SQL, SQL_REGION, pack_actor_names, plan
from tests.fixtures.recall import recalled, rows
from tests.unit.test_snapshot_non_us import SNAPSHOTS, lk_request, plan_snapshot

UNTIL = datetime(2026, 10, 17, 6, 0, tzinfo=UTC)
US_BANK = {
    "run_id": "rad-us-1",
    "institution": {"name": "Austin Tech Bank", "institution_type": "bank", "country": "US",
                    "country_name": "United States", "currency": "USD", "time_zone": "America/Chicago",
                    "summary": "Synthetic mid-size Austin bank.",
                    "regulators": [{"id": "fed", "name": "Board of Governors of the Federal Reserve System", "aliases": []}]},
    "scope": {"places": ["US", "US-TX", "US-CA", "city:dallas", "city:houston", "city:midland", "city:san-jose"],
              "places_why": {"US": ["footprint (home)"], "US-TX": ["footprint (branches)"],
                             "US-CA": ["footprint (branches, part)"]},
              "themes": ["rates", "sector", "commodities", "regulation"], "actors": ["ERCOT", "Fed", "FDIC"]},
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


def row(title: str, outlet: str, locations: str, url: str, themes: str = "") -> dict:
    return {"DATE": 20261017030000, "outlet": outlet, "url": url, "title": title, "locations": locations,
            "themes": themes, "orgs": "", "home_n": 0, "foot_n": 0, "all_n": 0}


US1 = "1#United States#US#US"
US3 = ";".join([US1] * 3)
TX3 = ";".join(["2#Texas, United States#US#USTX"] * 3)
CA3 = ";".join(["2#California, United States#US#USCA"] * 3)
FIXTURE = {  # name: (row, home?)
    "dallas-title": (row("Dallas data-center builders pause new projects", "example.com", US1, "u/1"), True),
    "us-only": (row("Washington weighs new rules for chip exports to Asia", "example.com", US3, "u/2"), False),
    "dallasnews": (row("Grid operator warns of tight supply this winter", "dallasnews.com", "", "u/3"), True),
    "texas-locations": (row("Grid operator warns of tight supply this winter", "example.com", TX3, "u/4"), True),
    "texas-twice": (row("Grid operator warns of tight supply this winter", "example.com", TX3.rsplit(";", 1)[0], "u/5"), False),
    "us-title": (row("U.S. stocks fall as United States yields climb", "example.com", US3, "u/6"), False),
    "www-outlet": (row("Refinery outage lifts gasoline prices", "www.houstonchronicle.com", "", "u/7"), True),
    # a. a name or state match needs a relevance theme or word
    "celebrity": (row("Bryce Dallas Howard hails 'sweetheart' Robert Pattinson", "femalefirst.co.uk", US1, "u/8",
                      "TAX_FNCACT_ACTOR"), False),
    "texas-theme": (row("Texas families feel the squeeze", "example.com", TX3, "u/9", "ECON_INTEREST_RATES"), True),
    "texas-nothing": (row("Texas high school football scores", "example.com", TX3, "u/10"), False),
    # politics: an election story's themes alone don't count; a relevance word in its title does
    "politics-themes": (row("Here's how Texas governor candidates want to reshape education", "example.com", TX3, "u/11",
                            "ELECTION;ECON_INFLATION"), False),
    "politics-words": (row("Democrats eye Texas-style utility rate freezes amid energy price push", "example.com", TX3,
                           "u/12", "ELECTION;TAX_POLITICAL_PARTY_DEMOCRATS"), True),
    # b. an outlet's name (with a hyphen) is cut before names are matched; a station counts only when relevant
    "station-politics": (row("Mary Peltola defeats Dan Sullivan in Alaska's Senate race | FOX 4 Dallas-Fort Worth",
                             "fox4news.com", US1, "u/13", "ELECTION"), False),
    "station-relevant": (row("Data center plans in Red Oak draw protest at joint city meeting &#x2013; NBC 5 Dallas-Fort Worth",
                             "nbcdfw.com", US1, "u/14"), True),
    # c. California is covered in part: only through the pack's Silicon Valley names
    "california-mentions": (row("Home sales fall to a three-year low", "example.com", CA3, "u/15", "ECON_HOUSING_PRICES"), False),
    "california-name": (row("California home sales fall to near three-year low", "example.com", CA3, "u/16",
                            "ECON_HOUSING_PRICES"), False),
    "silicon-valley": (row("Silicon Valley startups cut jobs as funding dries up", "example.com", US1, "u/17"), True),
}


def test_without_a_pack_the_sql_and_parameters_are_the_pinned_ones():
    assert plan_snapshot(lk_request()) == json.loads((SNAPSHOTS / "radar_plan_lk.json").read_text())
    q, p = plan(lk_request())
    assert q.sql is SQL and p.region is None and "home_adm1" not in q.params and "home_themes" not in q.params


def test_the_us_query_narrows_home_to_the_footprint():
    q, p = plan(us_request())
    assert q.sql is SQL_REGION and p.region == "us"
    params = {k: v for k, (_, v) in q.params.items()}
    assert params["home_adm1"] == ["USTX"]  # California is covered in part: not by its mentions
    assert {"dallasnews.com", "houstonchronicle.com", "bizjournals.com", "reuters.com"} <= set(params["home_outlets"])
    assert {"nbcdfw.com", "fox4news.com"} <= set(params["relevant_outlets"])
    assert "home_domain" not in params and "@home_domain" not in q.sql  # not ".us": US outlets are .com
    for word in ("texas", "dallas", "houston", "fort worth", "permian", "ercot", "silicon valley", "san jose"):
        assert word in params["home_names"]
    assert "united states" not in params["home_names"] and "u\\.s\\." not in params["home_names"]
    assert "california" not in params["home_names"]
    assert params["home_themes"] and params["home_words"] and params["politics_themes"]
    assert params["home_fips"] == ["US"]  # still the country, for the actor rule (an actor with the US in it)


def test_every_parameter_the_us_sql_names_is_sent():
    import re

    q, _ = plan(us_request())
    assert set(re.findall(r"@(\w+)", q.sql)) == set(q.params)
    q, _ = plan(lk_request())
    assert set(re.findall(r"@(\w+)", q.sql)) == set(q.params)


def test_the_us_query_reads_no_new_column():
    """BigQuery bills the columns a query reads. Only the first step (a) reads the table; it is the base query's,
    word for word, and every later step works on its output."""
    first = SQL[SQL.index("WITH a AS"):SQL.index("b AS")]
    assert SQL_REGION.startswith(SQL[:SQL.index("WITH a AS")] + first)
    assert SQL_REGION.count("FROM `") == SQL.count("FROM `") == 1


def test_sql_and_articles_agree_on_what_is_home():
    req, p = us_request(), us_places()
    sql_home = {r["url"]: r["r_home"] for r in recalled([r for r, _ in FIXTURE.values()], req)}
    for key, (r, home) in FIXTURE.items():
        a = from_row(r, p)
        assert ("US" in a.about) is home, key
        assert sql_home.get(r["url"], False) is home, key


def test_a_place_named_in_the_title_needs_relevance_too():
    req = us_request()
    got = {r["url"]: r for r in recalled([FIXTURE["celebrity"][0], FIXTURE["dallas-title"][0]], req)}
    assert "u/8" not in got  # "Bryce Dallas Howard": no place match, no home
    assert got["u/1"]["r_place"] and got["u/1"]["r_home"]


def test_us_actors_are_whole_names():
    q, _ = plan(us_request())
    pattern = q.params["actor_names"][1]
    for title in ("fed's williams backs further rate hikes", "fomc holds rates steady", "federal reserve minutes",
                  "dallas fed survey shows weaker loans", "ercot asks for conservation"):
        assert re.search(pattern, title), title
    for title in ("fed up fox news host takes down jd vance", "fans fed up with the referee"):
        assert not re.search(pattern, title), title
    assert "fed" not in [x.lower() for x in pack_actor_names(us_request(), pack_for("US"))]


def test_sql_and_articles_agree_on_a_real_day():
    """Every real row of 16-17 Oct 2026 (Serendib's day, with many US articles), judged for a US bank, from the
    raw titles: the SQL cleans them itself (queries._CLEAN, replayed by recall.sql_clean) the way articles.py does."""
    req, p = us_request(), us_places()
    day = rows("serendib-2026-10-16.jsonl.gz")
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
    assert checked > 1000 and 0 < homes < us_by_country / 10  # far narrower than "the US, 3 times"


def test_the_sql_cleaning_matches_articles_on_every_real_title():
    """Every real title whose entities the SQL decodes (separators, quotes and apostrophes) cleans the same in SQL
    and Python. Python's html.unescape decodes every entity; a title with another one is left out."""
    from app.articles import clean_title as clean
    from tests.fixtures.recall import sql_clean

    entity = re.compile(r"&(#x?[0-9a-fA-F]+|[a-zA-Z]+);")
    titles = [r["title"] for r in rows("serendib-2026-10-16.jsonl.gz") if r.get("title")]
    checked = [t for t in titles if not entity.search(sql_clean(t))]
    assert len(checked) > 0.9 * len(titles)
    differ = [t for t in checked if sql_clean(t) != clean(t, outlet_hyphens=True).lower()]
    assert not differ, differ[:5]  # the day has no encoded apostrophes; the next test covers them


def test_encoded_apostrophes_and_quotes_decode_in_sql_as_in_python():
    from app.articles import clean_title as clean
    from tests.fixtures.recall import sql_clean

    for raw in ("Fed&#39;s Williams backs further rate hikes", "Fed&#x27;s Barr: higher rates needed",
                "Fed&#x2019;s Waller sees a December hike", "Fed&amp;#39;s minutes point to a hike",
                "&quot;Texas&quot; grid faces a tight winter | Dallas News", "&#x201c;ERCOT&#x201d; asks for conservation"):
        assert sql_clean(raw) == clean(raw, outlet_hyphens=True).lower(), raw
    req = us_request()
    pattern = plan(req)[0].params["actor_names"][1]
    for raw in ("Fed&#39;s Williams backs further rate hikes", "Fed&#x2019;s Waller sees a December hike"):
        assert re.search(pattern, sql_clean(raw)), raw  # the actor matches in BigQuery as in Python
    got = recalled([row("Fed&#39;s Williams backs further rate hikes", "example.com", US1, "u/fed")], req)
    assert got and got[0]["r_actor"]


def test_a_footprint_name_in_an_irrelevant_title_adds_no_place():
    """An actor brings these in (the Fed is named), but the titles aren't relevant: Texas and California don't
    become places the story is about. California, covered in part, never counts by its own name."""
    p = us_places()
    senate = from_row({**row("Texas Senate race tightens as the Fed watches", "example.com", US1, "u/a",
                             "ELECTION;TAX_POLITICAL_PARTY_REPUBLICANS"), "r_actor": True}, p)
    assert "US-TX" not in senate.about | senate.places and "US" not in senate.about and not senate.in_title
    cal = from_row({**row("California lawmakers argue over a ballot measure", "example.com", US1, "u/b",
                          "ELECTION"), "r_actor": True}, p)
    assert "US-CA" not in cal.about | cal.places
    cal_relevant = from_row(row("California home sales fall as mortgage rates rise", "example.com", US1, "u/c",
                                "ECON_HOUSING_PRICES"), p)
    assert "US-CA" not in cal_relevant.about  # by name: a part-covered state needs the pack's names
    valley = from_row(row("Silicon Valley startups cut jobs", "example.com", US1, "u/d"), p)
    assert "US-CA" in valley.about and "US" in valley.about
    assert p.subdivisions["US-CA"][0] == "silicon valley" and "california" not in p.subdivisions["US-CA"]
    texas = from_row(row("Texas grid operator warns of tight winter supply", "example.com", US1, "u/e"), p)
    assert {"US-TX", "US"} <= texas.about


def test_home_outlets_come_from_the_pack_for_the_us():
    p = us_places()
    assert is_home_outlet("dallasnews.com", p) and is_home_outlet("www.wsj.com", p)
    assert not is_home_outlet("news.us", p) and not is_home_outlet("notdallasnews.com", p)
    lk = places("LK", ["LK"])
    assert is_home_outlet("ft.lk", lk) and not is_home_outlet("dallasnews.com", lk)
    assert home_domain("LK") == ".lk"  # unchanged


def test_outlets_follow_the_footprints_states():
    """National outlets serve any US footprint; a state's papers and stations only a bank covering that state in
    full. A bank in Arizona alone gets no Texas outlets as home."""
    az = places("US", ["US", "US-AZ"], {"US-AZ": ["footprint (branches)"]})
    assert is_home_outlet("reuters.com", az) and not is_home_outlet("dallasnews.com", az)
    assert az.relevant_outlets == [] and az.home_adm1 == ["USAZ"]
    tx = us_places()
    assert {"dallasnews.com", "reuters.com"} <= set(tx.home_outlets) and "nbcdfw.com" in tx.relevant_outlets
    part_tx = places("US", ["US", "US-TX"], {"US-TX": ["footprint (branches, part)"]})
    assert not is_home_outlet("dallasnews.com", part_tx) and part_tx.relevant_outlets == []
    q, _ = plan(us_request())
    assert q.params["home_outlets"][1] == tx.home_outlets and q.params["relevant_outlets"][1] == tx.relevant_outlets


def judge_state(req: RadarRunRequest) -> dict:
    return {"institution": institution_brief(req), "batch": [], "vocabulary": {"rates": {"up": "rates rise"}}}


def test_the_us_judge_skips_politics_and_the_lk_judge_is_unchanged():
    rule = "Skip elections, campaigns and party politics; keep interest rates, regulation, credit, energy, power and data centers."
    us = build_instruction(judge_state(us_request()))
    assert rule in us and us.index(rule) < us.index("Theme vocabulary")
    lk = build_instruction(judge_state(lk_request()))
    assert rule not in lk and "elections" not in lk
    assert us.replace(rule + "\n\n", "").count("Theme vocabulary") == 1
