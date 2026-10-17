"""Stories: articles grouped, scored by code, matched to memory, and made into the contract's stories.

Every number here is code. The judge (app/judge.py) only gives each shortlisted story a relevance
category, a title, a summary from its headlines, a "why", themes when sure, whether it's a
remembered story or develops one, and the send call; this module checks those and turns them into
the contract's Story.

Score (0-100):
    footprint     = the best of the places the story is about (articles.py), from the scope's reasons
                    (home 1.0, footprint 0.9, place to watch 0.85, flow 0.8, risk 0.7, otherwise 0.5);
                    0.4 when it only mentions scope places
    corroboration = min(1, log2(1 + sources) / log2(9)), sources = independent reports (copies of
                    one syndicated article count once). It weighs little: a local paper's one report
                    about the home country matters more than a wire story on fifty sites.
    freshness     = 0.5 ** (hours since the latest headline / 24): Radar reads once a day, so the
                    morning's news and last evening's differ a little, not twice
    named         = 1.0 if a scope place, a named actor or the home country is in a title, else 0.85
    themed        = by the money and business GKG codes (queries.score_themes) its best article
                    carries: two or more 1.0, one 0.9 (GDELT's tagging is noisy), none 0.8;
                    provided news has no codes and counts 1.0
    pre_score     = footprint x (0.7 + 0.3 x corroboration) x (0.75 + 0.25 x freshness) x named x themed
    score         = round(100 x pre_score x {high 1.0, medium 0.6, low 0.3}[relevance])
"""

import hashlib
import math
from dataclasses import dataclass, field
from datetime import datetime

from app import settings
from app.articles import Article
from app.contract import Headline, RadarRunRequest, Story, Theme
from app.geo import themes_vocabulary
from app.memory import Remembered
from app.queries import score_themes

SIMILAR = 0.3       # title overlap (Jaccard) for two articles to be one story
REMEMBER = 0.25     # term overlap for a remembered story to be offered to the judge
SAME = 0.5          # term overlap (and a shared place) at which code keeps a remembered fingerprint by itself
WEIGHT = {"high": 1.0, "medium": 0.6, "low": 0.3}
MAX_HEADLINES = 8
ANCHORS = ("chk:",)  # straits: narrow enough to group a run's headlines by (seas, cities and ports aren't: "Red Sea Global")


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


@dataclass
class Candidate:
    key: str
    articles: list[Article] = field(default_factory=list)
    pre_score: float = 0.0
    remembered: list[Remembered] = field(default_factory=list)
    anchor: str | None = None   # the strait its headlines were grouped by

    @property
    def places(self) -> set[str]:
        return set().union(*(a.places for a in self.articles)) if self.articles else set()

    @property
    def about(self) -> set[str]:
        return set().union(*(a.about for a in self.articles)) if self.articles else set()

    @property
    def terms(self) -> set[str]:
        return set().union(*(a.tokens for a in self.articles)) if self.articles else set()

    @property
    def outlets(self) -> set[str]:
        return {a.outlet.lower() for a in self.articles}

    @property
    def sources(self) -> int:
        return len({a.family for a in self.articles})

    @property
    def latest(self) -> datetime:
        return max(a.published_at for a in self.articles)

    def headlines(self) -> list[Headline]:
        """The newest headline of each independent report: those naming the anchor (or else a scope place)
        first, then newest first."""
        seen: set[str] = set()
        out = []
        for a in sorted(self.articles, key=lambda x: (self.anchor in x.about, x.in_title, x.published_at), reverse=True):
            if a.family not in seen:
                seen.add(a.family)
                out.append(Headline(title=a.title[:300], url=a.url or None, outlet=a.outlet or None, published_at=a.published_at))
        return out[:MAX_HEADLINES]


def group(articles: list[Article]) -> list[Candidate]:
    """Single-link grouping: an article joins the story it shares a place with and whose titles it resembles most.

    Headlines naming the same strait (ANCHORS: "chk:hormuz") are one story in a run, whatever
    their words: a strait is a narrow subject, and one day's reports on it ("tanker explodes", "two ships
    sink") are one developing situation that title overlap can't join."""
    out: list[Candidate] = []
    anchored: dict[str, Candidate] = {}
    for a in sorted(articles, key=lambda x: x.published_at):
        anchor = min((p for p in a.about if p.startswith(ANCHORS)), default=None)
        if anchor in anchored:
            anchored[anchor].articles.append(a)
            continue
        best, best_sim = None, 0.0
        for c in out:
            if a.places and c.places and not (a.places & c.places):
                continue
            sim = max((1.0 if a.family == b.family else jaccard(a.tokens, b.tokens)) for b in c.articles)
            if sim >= SIMILAR and sim > best_sim:
                best, best_sim = c, sim
        if best is None:
            best = Candidate(key=f"s{len(out) + 1}")
            out.append(best)
        best.articles.append(a)
        if anchor:
            anchored[anchor] = best
            best.anchor = best.anchor or anchor
    return out


def place_weight(code: str, req: RadarRunRequest) -> float:
    if code == req.institution.country:
        return 1.0
    reasons = req.scope.places_why.get(code, [])
    best = 0.5
    for r in reasons:
        r = r.lower()
        best = max(best, 1.0 if r.startswith("footprint (home)") else 0.9 if r.startswith("footprint") else
                   0.85 if r.startswith("place to watch") else 0.8 if r.startswith("flow") else 0.7 if r.startswith("risk") else 0.5)
    return best


def score(c: Candidate, req: RadarRunRequest) -> float:
    footprint = max((place_weight(p, req) for p in c.about), default=0.4)
    corroboration = min(1.0, math.log2(1 + c.sources) / math.log2(9))
    hours = max(0.0, (req.window.until - c.latest).total_seconds() / 3600)
    freshness = 0.5 ** (hours / 24)
    named = 1.0 if any(a.in_title or a.rules & {"home", "actor", "place", "provided"} for a in c.articles) else 0.85
    codes = score_themes(req.institution.institution_type)
    hits = max(99 if "provided" in a.rules else sum(t.startswith(codes) for t in a.themes) for a in c.articles)
    themed = 1.0 if hits >= 2 else 0.9 if hits == 1 else 0.8
    return footprint * (0.7 + 0.3 * corroboration) * (0.75 + 0.25 * freshness) * named * themed


def primary_place(c: Candidate, req: RadarRunRequest) -> str:
    """The place a story is mostly about: its best-weighted `about` place ("" when none)."""
    return max(sorted(c.about), key=lambda p: place_weight(p, req), default="")


def shortlist(cands: list[Candidate], req: RadarRunRequest, memory: list[Remembered]) -> list[Candidate]:
    """Scores every candidate, keeps the best SHORTLIST_FACTOR x max_stories, and finds remembered look-alikes.

    No one place takes more than a third of the shortlist (unless too few others qualify): a busy home
    news day mustn't push a strait the institution watches out of the judge's sight."""
    for c in cands:
        c.pre_score = score(c, req)
    size = settings.integer("SHORTLIST_FACTOR") * req.limits.max_stories
    ranked = sorted(cands, key=lambda c: c.pre_score, reverse=True)
    per_place: dict[str, int] = {}
    keep, rest = [], []
    for c in ranked:
        k = primary_place(c, req)
        if len(keep) < size and per_place.get(k, 0) < max(3, size // 3):
            keep.append(c)
            per_place[k] = per_place.get(k, 0) + 1
        else:
            rest.append(c)
    keep = sorted(keep + rest[: size - len(keep)], key=lambda c: c.pre_score, reverse=True)
    for c in keep:
        sims = [(jaccard(c.terms, m.terms), m) for m in memory if (m.places & c.places) or not c.places]
        c.remembered = [m for s, m in sorted(sims, key=lambda x: x[0], reverse=True) if s >= REMEMBER][:3]
    return keep


def fingerprint(institution: str, c: Candidate) -> str:
    first = min(c.articles, key=lambda a: a.published_at)
    raw = f"{institution}|{first.url}|{first.published_at.isoformat()}"
    return "rdr-" + hashlib.sha1(raw.encode()).hexdigest()[:12]


def valid_themes(themes: list[dict], req: RadarRunRequest) -> list[Theme]:
    """Only themes from the vocabulary, with a direction it allows, and in the scope's themes."""
    vocab, allowed = themes_vocabulary(), set(req.scope.themes)
    out = []
    for t in themes:
        v = vocab.get(t.get("theme", ""))
        if v and (not allowed or t["theme"] in allowed) and t.get("direction") in v["directions"]:
            out.append(Theme(theme=t["theme"], direction=t["direction"], item=t.get("item") or None,
                             currency=t.get("currency") or None))
    return out


@dataclass
class Judgement:
    """What the judge says about one candidate (app/judge.py)."""

    relevance: str
    send: bool
    why: str
    title: str
    summary: str
    themes: list[dict] = field(default_factory=list)
    same_as: str | None = None
    continues: str | None = None


def unjudged(c: Candidate, reason: str) -> Judgement:
    """When the model can't be asked (the daily model budget): code's own wording, held back."""
    heads = c.headlines()
    return Judgement(relevance="low", send=False, why=reason, title=heads[0].title,
                     summary="; ".join(h.title for h in heads[:3]))


def to_story(c: Candidate, j: Judgement, req: RadarRunRequest) -> Story:
    remembered = {m.fingerprint for m in c.remembered}
    if j.same_as in remembered:
        fp = j.same_as
    else:  # the judge didn't say so, but code sees the same story: keep its fingerprint
        close = [m for m in c.remembered if m.places & c.places and jaccard(c.terms, m.terms) >= SAME]
        fp = close[0].fingerprint if close else fingerprint(req.institution.name, c)
    development = j.continues if (j.continues in set(req.seen) and j.continues != fp) else None
    relevance = j.relevance if j.relevance in WEIGHT else "low"
    scope = set(req.scope.places)
    places = sorted(c.about & scope) or sorted(c.places & scope) or sorted(c.about | c.places)  # what it's about first
    return Story(
        fingerprint=fp, title=(j.title or c.headlines()[0].title).strip()[:300],
        summary=(j.summary or c.headlines()[0].title).strip()[:1200], places=places,
        themes=valid_themes(j.themes, req), relevance=relevance,
        score=max(0, min(100, round(100 * c.pre_score * WEIGHT[relevance]))),
        publishers=max(1, len(c.outlets)), headlines=c.headlines(), development_of=development,
        send=bool(j.send) and relevance != "low", why=(j.why or "No reason given.").strip()[:300])


def finish(stories: list[Story], max_stories: int) -> list[Story]:
    """Best first, cut to max_stories; at most SEND_MAX_PER_RUN sent (the best ones keep it)."""
    best: dict[str, Story] = {}
    for s in sorted(stories, key=lambda s: s.score, reverse=True):
        best.setdefault(s.fingerprint, s)  # two candidates found to be one remembered story: keep the stronger
    out = list(best.values())[:max_stories]
    sent = 0
    for i, s in enumerate(out):
        if s.send:
            sent += 1
            if sent > settings.integer("SEND_MAX_PER_RUN"):
                out[i] = s.model_copy(update={"send": False})
    return out
