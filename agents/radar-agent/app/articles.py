"""Articles: GDELT rows (or a simulation's provided news) made clean and comparable.

GDELT titles arrive HTML-encoded ("&#x2013;"), sometimes with the outlet appended ("… | Daily FT");
some English-flagged articles still carry non-Latin titles. An article is tagged with the scope's
own codes (never GDELT's): countries from its locations' FIPS codes, and places, subdivisions and
countries named in its title. `places` is every scope place it mentions; `about` only those it is
about (named in the title, the home country mentioned HOME_MENTIONS times or the outlet on its
domain, or a country making up FOOTPRINT_SHARE of its place mentions), which is what scoring uses.
"""

import html
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import settings
from app.geo import Places, fips_to_iso, home_domain

STOP = set("a an the of in on at to for and or but with by from as is are was were be been it its this that these "
           "those after before over under amid says said new more than into about up down out off vs via".split())


@dataclass
class Article:
    url: str
    outlet: str
    title: str
    published_at: datetime
    places: set[str] = field(default_factory=set)       # scope codes it mentions
    about: set[str] = field(default_factory=set)        # scope codes it is about
    themes: set[str] = field(default_factory=set)       # GKG theme codes
    orgs: set[str] = field(default_factory=set)
    rules: set[str] = field(default_factory=set)        # home, footprint, place, actor; provided
    in_title: bool = False                              # a scope place named in the title

    @property
    def tokens(self) -> set[str]:
        return tokens(self.title)

    @property
    def family(self) -> str:
        """Copies of one article on several outlets (syndication) share this."""
        return " ".join(sorted(self.tokens))


def tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in STOP and len(w) > 1}


def clean_title(raw: str | None) -> str:
    t = html.unescape(html.unescape(raw or "")).strip()
    t = re.sub(r"\s+", " ", t)
    # an outlet's name on either side: "... | Daily FT", "... - Reuters", "Arab News | ..."; only the shorter
    # side goes, so "Exclusive | Rupee falls as oil jumps" keeps its headline
    m = re.match(r"^(.*\S)\s+[|\u2013\u2014-]\s+([^|\u2013\u2014-]{2,40})$", t)
    if m and len(m.group(2)) < len(m.group(1)):
        t = m.group(1)
    m = re.match(r"^([^|]{2,30})\s\|\s+(.+)$", t)
    if m and len(m.group(1)) < len(m.group(2)):
        t = m.group(2)
    return t.strip()


def is_english(title: str) -> bool:
    letters = [c for c in title if c.isalpha()]
    if len(letters) < 8:
        return False
    latin = sum(1 for c in letters if "LATIN" in unicodedata.name(c, ""))
    return latin / len(letters) >= 0.9


def gdelt_time(value) -> datetime:
    s = str(value)
    return datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=UTC)


def from_row(row: dict, p: Places) -> Article | None:
    title = clean_title(row.get("title"))
    if not title or not is_english(title):
        return None
    a = Article(url=row.get("url") or "", outlet=(row.get("outlet") or "").lower(), title=title,
                published_at=gdelt_time(row["DATE"]))
    codes = fips_to_iso()
    scope_countries = {p.home, *p.footprint}
    mentions: dict[str, int] = {}
    blocks = [b.split("#") for b in (row.get("locations") or "").split(";") if b]
    for parts in blocks:
        iso = codes.get(parts[2]) if len(parts) > 2 else None
        if iso in scope_countries:
            mentions[iso] = mentions.get(iso, 0) + 1
    a.places = set(mentions)
    named = p.codes_in_title(title)
    a.in_title = bool(named)
    a.places |= named
    share = settings.number("FOOTPRINT_SHARE")
    a.about = named | {c for c, n in mentions.items() if n >= 2 and n >= share * len(blocks)}
    if mentions.get(p.home, 0) >= settings.integer("HOME_MENTIONS") or a.outlet.endswith(home_domain(p.home)):
        a.about.add(p.home)
        a.places.add(p.home)
    a.themes = {t.split(",")[0] for t in (row.get("themes") or "").split(";") if t}
    a.orgs = {o.split(",")[0].lower() for o in (row.get("orgs") or "").split(";") if o}
    a.rules = {r for r in ("home", "footprint", "place", "actor") if row.get(f"r_{r}")}
    return a


def from_provided(item, p: Places) -> Article:
    """A simulation's headline: places as given, or as named in the title."""
    title = clean_title(item.title)
    a = Article(url=item.url or f"provided:{item.id}", outlet=item.outlet or "provided", title=title,
                published_at=item.published_at.astimezone(UTC), rules={"provided"})
    scope = {p.home, *p.footprint, *p.named, *p.subdivisions}
    a.places = {c for c in item.places if c in scope} or p.codes_in_title(title)
    a.in_title = bool(p.codes_in_title(title))
    a.about = set(a.places)
    return a


def dedupe(articles: list[Article]) -> list[Article]:
    """One article per URL (the newest)."""
    seen: dict[str, Article] = {}
    for a in sorted(articles, key=lambda x: x.published_at, reverse=True):
        seen.setdefault(a.url, a)
    return list(seen.values())
