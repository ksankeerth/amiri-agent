"""Code checks that keep findings to what their evidence says.

finish runs these before the verifier (app/verifier.py). They need no model
call and catch the inventions code can see:

- a number that is not in the cited evidence (or the monitor's own lines)
- an abbreviation (CBSL, IMF, FX) that is not in the evidence or the monitor
- a quote (in single or double quotes) that is not a cited headline or page title
- a headline or page title the agent saw but did not cite in that finding
- a title that is not one of the cited headlines or page titles (as code read them
  from the page; a site's " - Outlet" suffix may be left out)
- the same headline or page used in two findings
- talk about feeds, which coverage already reports exactly
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from itertools import combinations

from app.contract import Finding

ALWAYS_ALLOWED_ABBREVIATIONS = {"UTC"}

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_ABBREVIATION = re.compile(r"\b[A-Z][A-Z0-9]+\b")
# Straight or curly, double or single quotes. An apostrophe inside a word (as in
# CBSL's) is not a quote.
_QUOTED = re.compile(
    "\"([^\"]+)\"|\u201c([^\u201d]+)\u201d|\u2018([^\u2019]+)\u2019|(?<!\\w)'([^']+)'(?!\\w)"
)
_FEED_WORD = re.compile(r"\bfeeds?\b", re.IGNORECASE)
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")


@dataclass
class Cited:
    """What a finding's evidence says, as returned by the tools."""

    texts: list[str] = field(default_factory=list)
    values: list[float] = field(default_factory=list)
    times: list[str] = field(default_factory=list)
    headlines: list[tuple[str, str, str]] = field(
        default_factory=list
    )  # (ref, title, published_at)

    def add(self, other: "Cited") -> None:
        for name in ("texts", "values", "times", "headlines"):
            getattr(self, name).extend(getattr(other, name))


def cited(f: Finding, seen: dict) -> Cited:
    """The evidence a finding cites. Refs the tools never returned are skipped (finish reports them)."""
    c = Cited()
    for ref in f.evidence.news:
        n = seen["news"].get(ref.item_id)
        if n is None:
            continue
        c.texts += [n["title"], n.get("body") or "", n.get("outlet") or ""]
        c.times.append(n["published_at"])
        c.headlines.append((ref.item_id, n["title"], n["published_at"]))
    for ref in f.evidence.web:
        w = seen["web"].get(ref.url)
        if w is None:
            continue
        c.texts += [w.get("title") or "", w.get("answer") or "", w.get("outlet") or ""]
        if w.get("published_at"):
            c.times.append(w["published_at"])
        if w.get("title"):
            c.headlines.append((ref.url, w["title"], w.get("published_at") or ""))
    return c


def context_texts(spec: dict, institution: dict) -> tuple[list[str], list[str]]:
    """(texts whose numbers a finding may repeat, texts whose abbreviations it may use)."""
    public = spec.get("public") or {}
    private = spec.get("private") or {}
    number_texts = [*public.get("tell_me_if", []), *private.get("serious", [])]
    return number_texts, [*_strings(spec), *_strings(institution)]


def _strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def _parse(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _num(text: str) -> float:
    return round(float(text), 4)


def _numbers_in(text: str) -> list[str]:
    return _NUMBER.findall(_THOUSANDS.sub("", text))


def allowed_numbers(c: Cited, extra_texts: list[str], extra: list[int]) -> set[float]:
    allowed = {_num(n) for t in [*c.texts, *extra_texts] for n in _numbers_in(t)}
    for v in c.values:
        allowed |= {round(abs(v), d) for d in range(5)}
    parsed = [t for t in (_parse(ts) for ts in c.times) if t]
    for t in parsed:
        allowed |= {t.year, t.month, t.day, t.hour, t.minute, t.hour % 12 or 12}
    for a, b in combinations(parsed, 2):
        minutes = abs((a - b).total_seconds()) / 60
        allowed |= {round(minutes), round(minutes / 60, 1), round(minutes / 60)}
    allowed |= {float(n) for n in extra}
    return allowed


def allowed_abbreviations(texts: list[str]) -> set[str]:
    return ALWAYS_ALLOWED_ABBREVIATIONS | {
        a for t in texts for a in _ABBREVIATION.findall(t)
    }


def _norm(text: str) -> str:
    quotes = "\"'\u201c\u201d\u2018\u2019"
    return " ".join(text.lower().strip().strip(quotes).rstrip(".").split())


def text_problems(
    where: str,
    text: str,
    numbers: set[float],
    abbreviations: set[str],
    quotable: list[str],
    uncited_titles: list[str],
) -> list[str]:
    problems = []
    bad_numbers = [n for n in _numbers_in(text) if _num(n) not in numbers]
    if bad_numbers:
        problems.append(
            f"{where} has numbers that are not in its evidence: {', '.join(dict.fromkeys(bad_numbers))}"
        )
    bad_abbr = [a for a in _ABBREVIATION.findall(text) if a not in abbreviations]
    if bad_abbr:
        problems.append(
            f"{where} uses names that are not in its evidence or the monitor: {', '.join(dict.fromkeys(bad_abbr))}"
        )
    sources = [_norm(q) for q in quotable]
    for m in _QUOTED.finditer(text):
        quote = _norm(next(g for g in m.groups() if g))
        if not any(quote in s for s in sources):
            problems.append(
                f'{where} quotes "{quote}", which is not a cited headline or page title; '
                "quote only headlines the finding cites, word for word"
            )
    lowered = _norm(text)
    for title in dict.fromkeys(uncited_titles):
        if _norm(title) in lowered:
            problems.append(
                f'{where} mentions the headline "{title}" without citing it; '
                "add it to the evidence or leave it out"
            )
    if _FEED_WORD.search(text):
        problems.append(
            f"{where} talks about feeds; leave that out (coverage reports what was read)"
        )
    return problems


def _uncited(seen_titles: list[str], c: Cited) -> list[str]:
    cited_titles = {title for _, title, _ in c.headlines}
    return [t for t in seen_titles if t not in cited_titles]


def _title_matches(title: str, sources: set[str]) -> bool:
    """The finding's title is a cited title, or one with the site's " - Outlet" suffix left out."""
    t = _norm(title)
    return any(t == s or (len(t) >= 20 and s.startswith(t)) for s in sources)


def finding_problems(
    i: int,
    f: Finding,
    c: Cited,
    number_texts: list[str],
    abbr_texts: list[str],
    seen_titles: list[str],
) -> list[str]:
    where = f"finding {i + 1}"
    numbers = allowed_numbers(c, number_texts, f.tell_me_if_lines)
    abbreviations = allowed_abbreviations([*c.texts, *abbr_texts])
    uncited = _uncited(seen_titles, c)
    problems = [
        p
        for name in ("title", "explanation")
        for p in text_problems(
            f"{where} {name}",
            getattr(f, name),
            numbers,
            abbreviations,
            c.texts,
            uncited,
        )
    ]
    titles = {_norm(title) for _, title, _ in c.headlines}
    if titles and not _title_matches(f.title, titles):
        problems.append(
            f"{where}: the title must be a cited headline or page title, word for word"
        )
    return problems


def reuse_problems(findings: list[Finding]) -> list[str]:
    first: dict[str, int] = {}
    problems = []
    for i, f in enumerate(findings):
        refs = [
            *(f"headline {n.item_id}" for n in f.evidence.news),
            *(f"page {w.url}" for w in f.evidence.web),
        ]
        for ref in dict.fromkeys(refs):
            if ref in first:
                problems.append(
                    f"{ref} is in findings {first[ref] + 1} and {i + 1}; use it in one finding only "
                    "(add the other finding's tell_me_if lines to it instead)"
                )
            else:
                first[ref] = i
    return problems


def summary_problems(
    summary: str,
    findings: list[Finding],
    all_cited: Cited,
    number_texts: list[str],
    abbr_texts: list[str],
    seen_titles: list[str],
) -> list[str]:
    lines = sorted({n for f in findings for n in f.tell_me_if_lines})
    numbers = allowed_numbers(all_cited, number_texts, lines)
    abbreviations = allowed_abbreviations(
        [*all_cited.texts, *abbr_texts, *(f.title for f in findings)]
    )
    return text_problems(
        "summary",
        summary,
        numbers,
        abbreviations,
        all_cited.texts,
        _uncited(seen_titles, all_cited),
    )
