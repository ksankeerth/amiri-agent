"""Places: the scope's codes as GDELT sees them, and the names a headline would use.

GDELT 2.0 codes countries in FIPS 10-4, not ISO 3166 (Sri Lanka is CE, Kuwait KU, Oman MU). A
scope place is an ISO country (LK), an ISO subdivision (IN-TN) or a gazetteer place (chk:hormuz,
sea:red-sea; app/reference/gazetteer.json, a copy of the server's). Countries are matched by FIPS
code in an article's locations and by name in its title; subdivisions and gazetteer places by name
in the title (GDELT doesn't geocode straits, and a radius pulls in nearby cities' news).
"""

import json
import re
import unicodedata
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import pycountry

from app.packs import pack_for

REFERENCE = Path(__file__).parent / "reference"

# ISO 3166-1 alpha-2 -> FIPS 10-4, as GDELT uses them. Same letters where not listed.
ISO_TO_FIPS: dict[str, tuple[str, ...]] = {
    "AD": ("AN",), "AG": ("AC",), "AI": ("AV",), "AQ": ("AY",), "AS": ("AQ",), "AT": ("AU",), "AU": ("AS",),
    "AW": ("AA",), "AZ": ("AJ",), "BA": ("BK",), "BD": ("BG",), "BF": ("UV",), "BG": ("BU",), "BH": ("BA",),
    "BI": ("BY",), "BJ": ("BN",), "BL": ("TB",), "BM": ("BD",), "BN": ("BX",), "BO": ("BL",), "BS": ("BF",),
    "BW": ("BC",), "BY": ("BO",), "BZ": ("BH",), "CC": ("CK",), "CD": ("CG",), "CF": ("CT",), "CG": ("CF",),
    "CH": ("SZ",), "CI": ("IV",), "CK": ("CW",), "CL": ("CI",), "CN": ("CH",), "CR": ("CS",), "CW": ("UC",),
    "CX": ("KT",), "CZ": ("EZ",), "DE": ("GM",), "DK": ("DA",), "DM": ("DO",), "DO": ("DR",), "DZ": ("AG",),
    "EE": ("EN",), "EH": ("WI",), "ES": ("SP",), "GA": ("GB",), "GB": ("UK",), "GD": ("GJ",), "GE": ("GG",),
    "GF": ("FG",), "GG": ("GK",), "GM": ("GA",), "GN": ("GV",), "GQ": ("EK",), "GS": ("SX",), "GU": ("GQ",),
    "GW": ("PU",), "HN": ("HO",), "HT": ("HA",), "IE": ("EI",), "IL": ("IS",), "IQ": ("IZ",), "IS": ("IC",),
    "JP": ("JA",), "KH": ("CB",), "KI": ("KR",), "KM": ("CN",), "KN": ("SC",), "KP": ("KN",), "KR": ("KS",),
    "KW": ("KU",), "KY": ("CJ",), "LB": ("LE",), "LC": ("ST",), "LI": ("LS",), "LK": ("CE",), "LR": ("LI",),
    "LS": ("LT",), "LT": ("LH",), "LV": ("LG",), "MA": ("MO",), "MC": ("MN",), "ME": ("MJ",), "MF": ("RN",),
    "MG": ("MA",), "MH": ("RM",), "MM": ("BM",), "MN": ("MG",), "MO": ("MC",), "MP": ("CQ",), "MQ": ("MB",),
    "MS": ("MH",), "MU": ("MP",), "MW": ("MI",), "NA": ("WA",), "NE": ("NG",), "NG": ("NI",), "NI": ("NU",),
    "NU": ("NE",), "OM": ("MU",), "PA": ("PM",), "PF": ("FP",), "PG": ("PP",), "PH": ("RP",), "PM": ("SB",),
    "PN": ("PC",), "PR": ("RQ",), "PS": ("WE", "GZ"), "PT": ("PO",), "PW": ("PS",), "PY": ("PA",), "RS": ("RI",),
    "RU": ("RS",), "SB": ("BP",), "SC": ("SE",), "SD": ("SU",), "SE": ("SW",), "SG": ("SN",), "SJ": ("SV",),
    "SK": ("LO",), "SN": ("SG",), "SR": ("NS",), "SS": ("OD",), "ST": ("TP",), "SV": ("ES",), "SX": ("NN",),
    "SZ": ("WZ",), "TC": ("TK",), "TD": ("CD",), "TF": ("FS",), "TG": ("TO",), "TJ": ("TI",), "TK": ("TL",),
    "TL": ("TT",), "TM": ("TX",), "TN": ("TS",), "TO": ("TN",), "TR": ("TU",), "TT": ("TD",), "UA": ("UP",),
    "VA": ("VT",), "VG": ("VI",), "VI": ("VQ",), "VN": ("VM",), "VU": ("NH",), "YE": ("YM",), "YT": ("MF",),
    "ZA": ("SF",), "ZM": ("ZA",), "ZW": ("ZI",), "XK": ("KV",),
}

# Words a headline uses for a country besides its name: demonyms, short forms, main cities.
EXTRA_NAMES: dict[str, list[str]] = {
    "LK": ["sri lankan", "lankan", "colombo", "kandy", "galle", "jaffna", "ceylon", "cbsl"],
    "IN": ["indian", "mumbai", "new delhi", "chennai", "bengaluru", "kolkata", "hyderabad", "rbi"],
    "AE": ["uae", "emirates", "emirati", "dubai", "abu dhabi", "sharjah"],
    "SA": ["saudi", "riyadh", "jeddah"],
    "QA": ["qatari", "doha"],
    "KW": ["kuwaiti"],
    "BH": ["bahraini", "manama"],
    "OM": ["omani", "muscat"],
    "IR": ["iranian", "tehran"],
    "ID": ["indonesian", "jakarta", "bali", "java", "sumatra"],
    "MY": ["malaysian", "kuala lumpur"],
    "SG": ["singaporean"],
    "PH": ["philippine", "filipino", "manila"],
    "TH": ["thai", "bangkok"],
    "VN": ["vietnamese", "hanoi", "ho chi minh city"],
    "JP": ["japanese", "tokyo"],
    "CN": ["chinese", "beijing", "shanghai"],
    "PK": ["pakistani", "karachi", "islamabad"],
    "BD": ["bangladeshi", "dhaka"],
    "NP": ["nepali", "nepalese", "kathmandu"],
    "MV": ["maldivian"],
    "AU": ["australian", "sydney", "melbourne"],
    "KR": ["south korea", "south korean", "seoul"],
    "US": ["united states", "u.s."],
    "GB": ["united kingdom", "britain", "british", "u.k."],
}
# Why a place is in the scope, from the server's places_why: a country watched for one of these may count
# by its share of an article's place mentions; one watched only for a trade flow or a background risk must
# be named in the title (otherwise a big news country like the US floods the query with its domestic news).
SHARE_REASONS = ("footprint", "place to watch", "flow: remittances")
# Subdivision names too common to mean a place by themselves ("Western Province" is in several countries).
_GENERIC = re.compile(r"^(north|south|east|west|central|northern|southern|eastern|western|north[- ]\w+|south[- ]\w+)\b", re.I)


@cache
def gazetteer() -> dict[str, dict]:
    data = json.loads((REFERENCE / "gazetteer.json").read_text())
    return {p["code"]: p for p in data["places"]}


@cache
def themes_vocabulary() -> dict[str, dict]:
    return json.loads((REFERENCE / "themes.json").read_text())["themes"]


def home_domain(iso: str) -> str:
    """The country's internet domain ending: a home outlet (ft.lk) writes for the home market."""
    return "." + {"GB": "uk"}.get(iso.upper(), iso.lower())


def fips(iso: str) -> tuple[str, ...]:
    return ISO_TO_FIPS.get(iso.upper(), (iso.upper(),))


@cache
def fips_to_iso() -> dict[str, str]:
    out: dict[str, str] = {}
    for c in pycountry.countries:
        for f in fips(c.alpha_2):
            out.setdefault(f, c.alpha_2)
    for iso, fs in ISO_TO_FIPS.items():  # the listed ones win over a same-letter coincidence
        for f in fs:
            out[f] = iso
    return out


def country_names(iso: str) -> list[str]:
    c = pycountry.countries.get(alpha_2=iso.upper())
    names = [getattr(c, a) for a in ("common_name", "name") if c is not None and getattr(c, a, None)]
    names = [re.sub(r",.*$", "", n) for n in names]  # "Iran, Islamic Republic of" -> "Iran"
    return list(dict.fromkeys(n.lower() for n in [*names, *EXTRA_NAMES.get(iso.upper(), [])]))


def ascii_fold(text: str) -> str:
    """"Tamil Nādu" -> "Tamil Nadu": headlines rarely carry the marks."""
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def subdivision_names(code: str) -> list[str]:
    s = pycountry.subdivisions.get(code=code)
    if s is None or _GENERIC.match(s.name) or len(s.name) < 5:
        return []
    return list(dict.fromkeys([ascii_fold(s.name).lower(), s.name.lower()]))


def re2_escape(text: str) -> str:
    """Escapes RE2's special characters only (Python's re.escape also escapes spaces, which RE2 rejects)."""
    return re.sub(r"([\\.^$*+?()\[\]{}|/-])", r"\\\1", text)


def title_pattern(names: list[str]) -> str:
    """A case-insensitive RE2 pattern matching any of the names as whole words (empty: none)."""
    parts = sorted({re2_escape(n.lower()) for n in names if n.strip()}, key=len, reverse=True)
    # explicit boundaries: \b fails after a name ending in a dot ("u.s.")
    return r"(^|[^a-z0-9])(" + "|".join(parts) + r")([^a-z0-9]|$)" if parts else ""


@dataclass
class Places:
    """The scope, as the query and the story code need it."""

    home: str                                                   # ISO country
    home_fips: tuple[str, ...]
    home_names: list[str]
    footprint: list[str] = field(default_factory=list)          # other ISO countries in the scope
    footprint_fips: list[str] = field(default_factory=list)
    share_fips: list[str] = field(default_factory=list)         # footprint countries that may count by share
    footprint_names: list[str] = field(default_factory=list)    # countries, cities and subdivisions
    named: dict[str, list[str]] = field(default_factory=dict)   # gazetteer code -> its names
    subdivisions: dict[str, list[str]] = field(default_factory=dict)
    # A region pack that narrows home news to the footprint (app/packs/us.json); without one these stay empty.
    region: str | None = None
    home_adm1: list[str] = field(default_factory=list)          # GDELT ADM1 codes of the footprint states (USTX)
    home_outlets: list[str] = field(default_factory=list)       # the pack's home outlets (domains)
    relevant_outlets: list[str] = field(default_factory=list)   # home outlets for a relevant article only (stations)
    home_themes: str = ""      # a pack's relevance themes (pattern over GKG codes): a name or state match needs one,
    home_words: str = ""       # or one of its relevance words in the cleaned title (a pattern, as title_pattern)
    politics_themes: str = ""  # with one of these themes (elections, parties) only the title's words count

    def codes_in_title(self, title: str) -> set[str]:
        """Scope codes whose names the title uses."""
        t = title.lower()
        out = set()
        for code, ns in [(self.home, self.home_names), *[(c, country_names(c)) for c in self.footprint],
                         *self.named.items(), *self.subdivisions.items()]:
            p = title_pattern(ns)
            if p and re.search(p, t):
                out.add(code)
        return out


def watched_closely(reasons: list[str]) -> bool:
    return any(r.strip().lower().startswith(SHARE_REASONS) for r in reasons)


def places(home: str, scope_places: list[str], why: dict[str, list[str]] | None = None) -> Places:
    """`why` is the scope's places_why; without it every footprint country may count by share."""
    home = home.upper()
    p = Places(home=home, home_fips=fips(home), home_names=country_names(home))
    for code in scope_places:
        if code.startswith(("chk:", "sea:", "rgn:", "zone:")) or ":" in code:
            g = gazetteer().get(code)
            if g:  # an alias starting "the" ("the Gulf", "the Cape") is too vague for a headline: "the Gulf Coast"
                p.named[code] = [g["name"].lower(), *(a.lower() for a in g.get("aliases", []) if not a.lower().startswith("the "))]
        elif "-" in code:  # an ISO subdivision: its country is in the footprint, its name in titles
            names = subdivision_names(code)
            if names:
                p.subdivisions[code] = names
            if code.startswith(home + "-"):
                p.home_names.extend(n for n in names if n not in p.home_names)
            else:
                p.footprint_names.extend(names)
        elif code != home:
            p.footprint.append(code)
    p.footprint = list(dict.fromkeys(p.footprint))
    p.footprint_fips = list(dict.fromkeys(f for c in p.footprint for f in fips(c)))
    p.share_fips = list(dict.fromkeys(f for c in p.footprint if why is None or watched_closely(why.get(c, []))
                                      for f in fips(c)))
    p.footprint_names = list(dict.fromkeys([*p.footprint_names, *(n for c in p.footprint for n in country_names(c))]))
    pack = pack_for(home)
    if pack and pack.get("home_scope") == "footprint_regions":
        _home_is_the_footprint(p, pack, scope_places, why)
    return p


# the server marks a footprint place the institution covers only in part: "footprint (branches, part)"
_PART = re.compile(r"^footprint \([^)]*, part\)$")


def _home_is_the_footprint(p: Places, pack: dict, scope_places: list[str], why: dict[str, list[str]] | None) -> None:
    """A region pack's home: the footprint's states and cities, not the whole country. Its names are the
    states', the pack's aliases for them and the scope's own cities in the home country; the country's
    names ("united states", "u.s.") are dropped. Its GDELT ADM1 codes are the country's FIPS code and the
    state's (US-TX -> USTX, as in V2Locations' fourth field). A state covered only in part (California, for
    a Silicon Valley office) counts by the pack's names for the part alone: not by its own name or mentions.
    A name or state match counts only with one of the pack's relevance themes (home_themes). Home outlets are the
    pack's national ones and those of the states covered in full."""
    regions = list(dict.fromkeys(c.upper() for c in scope_places if c.upper().startswith(p.home + "-")))
    part = {r for r in regions if any(_PART.match(w.strip()) for w in (why or {}).get(r, []))}
    full = [r for r in regions if r not in part]
    country = set(country_names(p.home))
    part_names = {n for r in part for n in subdivision_names(r)}
    aliases = [a.lower() for r in regions for a in pack.get("aliases", {}).get(r, [])]
    for r in part:  # a part-covered state is found in a title only by the pack's names for the part
        part_aliases = [a.lower() for a in pack.get("aliases", {}).get(r, [])]
        if part_aliases:
            p.subdivisions[r] = part_aliases
        else:
            p.subdivisions.pop(r, None)
    cities = [n for code, ns in p.named.items() if gazetteer().get(code, {}).get("country") == p.home for n in ns]
    p.home_names = list(dict.fromkeys([*(n for n in p.home_names if n not in country and n not in part_names),
                                       *aliases, *cities]))
    p.home_adm1 = [fips(p.home)[0] + r.split("-", 1)[1] for r in full]
    p.home_outlets = domains([*pack.get("national_outlets", []),
                              *(o for r in full for o in pack.get("outlets", {}).get(r, []))])
    p.relevant_outlets = domains([o for r in full for o in pack.get("outlets_with_relevance", {}).get(r, [])])
    p.home_themes = theme_pattern(pack.get("relevance_themes", []))
    p.home_words = title_pattern(pack.get("relevance_words", []))
    p.politics_themes = theme_pattern(pack.get("politics_themes", []))
    p.region = pack["region"]


def theme_pattern(codes: list[str]) -> str:
    """An RE2 pattern for GKG theme codes in V2Themes ("CODE,offset;…" or "CODE;…"): a code ending in "_" is a
    prefix (ECON_ is every ECON_ code), any other is the exact code. Empty: none."""
    alts = sorted({re2_escape(c) + ("[A-Z0-9_]*" if c.endswith("_") else "") for c in codes if c})
    return r"(^|;)(" + "|".join(alts) + r")(,|;|$)" if alts else ""


def relevant(themes: set[str], title: str, p: Places) -> bool:
    """articles.py's side of the same rule: one of the article's theme codes is in the pack's list, or one of its
    relevance words is in the (cleaned) title."""
    if not p.home_themes and not p.home_words:
        return True
    political = bool(p.politics_themes) and any(re.search(p.politics_themes, t) for t in themes)
    by_theme = bool(p.home_themes) and not political and any(re.search(p.home_themes, t) for t in themes)
    return by_theme or bool(p.home_words and re.search(p.home_words, title.lower()))


def domains(names: list[str]) -> list[str]:
    """Outlet domains as GDELT's SourceCommonName gives them (lower case, no repeats): the query's parameters
    and on_domains use the same list."""
    return list(dict.fromkeys(n.strip().lower() for n in names if n and n.strip()))


def on_domains(outlet: str, names: list[str]) -> bool:
    """The outlet is one of these domains or a part of one (www.dallasnews.com), as the query matches them."""
    o = (outlet or "").lower()
    return any(o == d or o.endswith("." + d) for d in names)


def is_home_outlet(outlet: str, p: Places) -> bool:
    """An outlet that writes for the home market: on the home country's domain (ft.lk), or for a region
    pack one of its home outlets."""
    if p.region:
        return on_domains(outlet, p.home_outlets)
    return (outlet or "").lower().endswith(home_domain(p.home))
