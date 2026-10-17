"""Cleaning, grouping, scoring and the checks on the judge's picks."""

from app.articles import clean_title, dedupe, from_row, is_english
from app.geo import places
from app.stories import Judgement, finish, group, shortlist, to_story
from tests.unit.conftest import ROWS, request

P = places("LK", ["LK", "IN", "SA", "AE", "chk:hormuz"])


def articles():
    return [a for a in (from_row(r, P) for r in ROWS) if a is not None]


def test_titles_are_decoded_trimmed_and_english_only():
    assert clean_title("Shiranthi gets bail | Daily FT") == "Shiranthi gets bail"
    assert clean_title("Trump intensifies messaging &#x2013; Whittier Daily News") == "Trump intensifies messaging"
    assert not is_english(clean_title("&#x90AE;&#x62A5;&#xFF1A;&#x57C3;&#x5C14;&#x987F;"))
    assert len(articles()) == len(ROWS) - 1  # the Chinese title is dropped


def test_places_come_from_codes_and_titles_in_the_scopes_terms():
    by = {a.url: a for a in articles()}
    assert by["https://ft.lk/1"].places == {"LK"}
    assert by["https://aninews.in/3"].places == {"chk:hormuz", "IN"} and by["https://aninews.in/3"].in_title  # "Indian seafarers"
    assert by["https://arabnews.com/7"].places == {"SA"}


def test_syndicated_copies_and_similar_titles_group_but_count_as_one_source():
    cands = group(dedupe(articles()))
    hormuz = next(c for c in cands if "chk:hormuz" in c.places and any("seafarers" in a.title for a in c.articles))
    # the syndicated copies count once; "two ships sink" names the same strait, so it's the same story
    assert len(hormuz.articles) == 3 and hormuz.sources == 2 and len(hormuz.outlets) == 3
    seylan = next(c for c in cands if any("Seylan" in a.title for a in c.articles))
    assert len(seylan.articles) == 2 and seylan.sources == 2
    assert len({c.key for c in cands}) == len(cands) >= 3


def test_home_and_named_stories_score_above_a_far_footprint_one():
    req = request()
    short = shortlist(group(articles()), req, [])
    scores = {next(iter(c.places)): c.pre_score for c in short if len(c.places) == 1}
    assert scores["LK"] > scores["SA"]


def test_the_judges_picks_are_checked():
    req = request(seen=["rdr-000000000001"])
    c = shortlist(group(articles()), req, [])[0]
    j = Judgement(relevance="low", send=True, why="Routine.", title="T", summary="S",
                  themes=[{"theme": "fx", "direction": "weaker"}, {"theme": "fx", "direction": "sideways"},
                          {"theme": "weather", "direction": "up"}],
                  same_as="rdr-not-remembered", continues="rdr-not-in-seen")
    s = to_story(c, j, req)
    assert s.send is False  # never a low one
    assert [t.theme + ":" + t.direction for t in s.themes] == ["fx:weaker"]  # vocabulary and directions only
    assert s.development_of is None and s.fingerprint.startswith("rdr-") and s.fingerprint != "rdr-not-remembered"
    j2 = Judgement(relevance="high", send=True, why="Link.", title="T", summary="S", continues="rdr-000000000001")
    assert to_story(c, j2, req).development_of == "rdr-000000000001"


def test_at_most_three_sent_and_one_story_per_fingerprint(monkeypatch):
    req = request()
    short = shortlist(group(articles()), req, [])
    stories = [to_story(c, Judgement(relevance="high", send=True, why="Link.", title=f"T{i}", summary="S"), req)
               for i, c in enumerate(short)]
    stories.append(stories[0].model_copy(update={"score": 1}))  # a duplicate fingerprint, weaker
    out = finish(stories, 10)
    assert sum(s.send for s in out) == 3 and len({s.fingerprint for s in out}) == len(out)
