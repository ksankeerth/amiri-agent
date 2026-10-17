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
    return p
