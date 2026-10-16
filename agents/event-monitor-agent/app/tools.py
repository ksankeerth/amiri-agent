"""Agent tools.

Scope comes from session state, never from tool arguments: build_check_state puts the
request's window, web search budget and (in a simulation) its headlines in state["check"],
and every tool refuses anything outside it. Tools return a dict with status "ok",
"blocked" (refused by these rules) or "error".

A check reads the news one of two ways:
  web_search          Gemini with Google Search grounding; each source page is then read by
                      code for its own publication time and title (app/pages.py)
  list_provided_news  a simulation's headlines (provided_news); no search

State the tools keep while a check runs:
  seen      every page and headline a tool returned, with what code read from it; finish
            only accepts evidence from here and checks each finding's words against it
            (app/grounding.py, app/verifier.py)
  web_used  web searches run so far
  verify_rounds  times the verifier has reviewed a finish call
  result    the findings accepted by finish, and the sources they cite
"""

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from google.adk.tools import ToolContext
from pydantic import TypeAdapter, ValidationError

from app import grounding, settings
from app.contract import CheckRequest, Finding, domain
from app.pages import get_reader
from app.verifier import Review, get_verifier
from app.web_search import get_searcher

logger = logging.getLogger(__name__)

STATE_CHECK = "check"
STATE_MONITOR = "monitor"
STATE_INSTITUTION = "institution"
STATE_SEEN = "seen"
STATE_WEB_USED = "web_used"
STATE_VERIFY_ROUNDS = "verify_rounds"
STATE_RESULT = "result"
STATE_REPORTED = "already_reported"
STATE_WEB_FAILED = "web_failed"  # [error message] per failed search

NEWS_PAGE_SIZE = 25
MAX_QUERY_CHARS = 200
PRIVATE_WORD_MIN_LEN = 5
# The verifier rejects a finish call this many times at most. On the last round, findings
# it still flags are rewritten from their evidence instead, so a check always ends and no
# alert is lost.
MAX_VERIFY_ROUNDS = 2

_FINDINGS = TypeAdapter(list[Finding])


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def private_words(req: CheckRequest) -> list[str]:
    """Words from the private fields that never appear in the public ones.

    A web search query containing any of them is refused.
    """
    spec, inst = req.monitor.spec, req.institution
    public_text = [
        spec.about.name,
        spec.public.in_one_sentence,
        *spec.public.tell_me_if,
        *spec.public.ignore,
        *spec.public.places,
        *(
            w
            for chip in spec.public.watch
            for w in [chip.name, *chip.other_forms, *chip.not_confused_with]
        ),
        inst.name,
        inst.country,
        inst.country_name or "",
        inst.summary,
        *(p.name for p in inst.products),
        *(
            n.name
            for group in (inst.rivals, inst.regulators, inst.counterparties)
            for n in group
        ),
        *(s.label for s in inst.segments),
        *inst.corridors,
    ]
    private_text = [
        *(e.how_it_reaches_us for e in spec.private.exposure),
        *spec.private.serious,
        spec.private.notes,
        inst.notes or "",
    ]
    public = {w for t in public_text for w in _words(t)}
    return sorted(
        {
            w
            for t in private_text
            for w in _words(t)
            if len(w) >= PRIVATE_WORD_MIN_LEN and w not in public
        }
    )


def iso(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_check_state(req: CheckRequest) -> dict[str, Any]:
    """Initial session state for one check."""
    return {
        STATE_CHECK: {
            "run_id": req.run_id,
            "window": {"since": iso(req.window.since), "until": iso(req.window.until)},
            "web": {"max_queries": req.web_search.max_queries}
            if req.web_search
            else None,
            "provided": [n.model_dump(mode="json") for n in req.provided_news]
            if req.provided_news is not None
            else None,
            "recent_urls": list(req.recent_urls),
            "private_words": private_words(req),
            "grace_hours": settings.number("PAGE_DATE_GRACE_HOURS"),
        },
        STATE_MONITOR: {
            "monitor_id": req.monitor.monitor_id,
            "version": req.monitor.version,
            "spec": req.monitor.spec.model_dump(mode="json"),
        },
        STATE_INSTITUTION: req.institution.model_dump(mode="json", exclude_none=True),
        STATE_SEEN: _empty_seen(),
        STATE_WEB_USED: 0,
        STATE_VERIFY_ROUNDS: 0,
    }


# ----------------------------------------------------------------- helpers


def _empty_seen() -> dict:
    return {"web": {}, "news": {}}


def _blocked(message: str) -> dict:
    return {"status": "blocked", "message": message}


def _error(message: str) -> dict:
    return {"status": "error", "message": message}


def _check(tool_context: ToolContext) -> dict:
    return tool_context.state.get(STATE_CHECK) or {}


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def in_window(published: str | None, check: dict) -> bool | None:
    """True or False for a dated item; None when it has no date."""
    t = _parse(published)
    if t is None:
        return None
    since = _parse(check["window"]["since"]) - timedelta(
        hours=float(check.get("grace_hours") or 0)
    )
    until = _parse(check["window"]["until"]) + timedelta(hours=1)
    return since <= t <= until


def _remember(
    tool_context: ToolContext, *, web: dict | None = None, news: dict | None = None
) -> None:
    """Records what a tool returned. Keys: url, provided item id."""
    seen = tool_context.state.get(STATE_SEEN) or _empty_seen()
    tool_context.state[STATE_SEEN] = {
        "web": {**seen["web"], **(web or {})},
        "news": {**seen["news"], **(news or {})},
    }


# ------------------------------------------------------------------ tools


async def web_search(query: str, tool_context: ToolContext) -> dict:
    """Searches the web for news, within this check's budget.

    Write short queries from public words only (watched names, their other forms, places,
    the monitor's lines), in the monitor's languages. Each query uses one of the check's
    limited searches. Each source page is then read for its own publication time and title.

    Args:
        query: A short search query, without links.

    Returns:
        status; answer: what the search found; sources: the pages behind it, each with
        url, title and outlet as read from the page, published_at (null if the page has no
        date) and in_window (whether it is new for this check). Only sources in the window
        can support a finding. Cite web evidence by these urls only.
    """
    check = _check(tool_context)
    web = check.get("web")
    if not web:
        return _blocked(
            "web search is not allowed in this check (it reads the provided news)"
        )
    used = int(tool_context.state.get(STATE_WEB_USED) or 0)
    if used >= web["max_queries"]:
        return _blocked(f"web search budget used ({web['max_queries']} queries)")
    query = query.strip()
    if not query:
        return _error("query is empty")
    if len(query) > MAX_QUERY_CHARS:
        return _blocked(f"query is longer than {MAX_QUERY_CHARS} characters")
    if re.search(r"https?://|www\.", query, re.IGNORECASE):
        return _blocked("query contains a link")
    leaked = sorted(set(_words(query)) & set(check.get("private_words", [])))
    if leaked:
        return _blocked(f"query contains private words: {', '.join(leaked)}")

    tool_context.state[STATE_WEB_USED] = used + 1
    window = check["window"]
    # The search gets the window widened by the grace hours and keeps its dates; code alone decides
    # what is in the window (in_window), from each page's own date.
    since = _parse(window["since"]) - timedelta(hours=float(check.get("grace_hours") or 0))
    try:
        found = await get_searcher()(query, iso(since), window["until"])
    except Exception as e:
        tool_context.state[STATE_WEB_FAILED] = [*(tool_context.state.get(STATE_WEB_FAILED) or []), str(e)[:300]]
        return _error(f"web search failed: {e}")

    recent = set(check.get("recent_urls", []))
    fresh = [s for s in found["sources"] if s["url"] not in recent]
    pages = await asyncio.gather(*(get_reader()(s["url"]) for s in fresh))
    out, remembered = [], {}
    for s, p in zip(fresh, pages, strict=True):
        published = iso(p.published_at) if p.published_at else None
        entry = {
            "title": p.title or s.get("title") or "",
            "outlet": domain(p.url) or domain(s["url"]),
            "published_at": published,
            "in_window": in_window(published, check),
            "final_url": p.url,
            "answer": found["answer"],
        }
        remembered[s["url"]] = entry
        note = (
            "no publication date on the page"
            if published is None
            else None
            if entry["in_window"]
            else "published outside this check's window"
        )
        if p.error:
            note = f"could not read the page ({p.error})"
        out.append(
            {
                "url": s["url"],
                "title": entry["title"],
                "outlet": entry["outlet"],
                "published_at": published,
                "in_window": bool(entry["in_window"]),
                "note": note,
            }
        )
    _remember(tool_context, web=remembered)
    tool_context.state[STATE_REPORTED] = (
        int(tool_context.state.get(STATE_REPORTED) or 0)
        + len(found["sources"])
        - len(fresh)
    )
    return {
        "status": "ok",
        "query": query,
        "answer": found["answer"],
        "sources": out,
        "already_reported": len(found["sources"]) - len(fresh),
        "queries_left": web["max_queries"] - used - 1,
    }


def list_provided_news(cursor: str, tool_context: ToolContext) -> dict:
    """Reads the headlines this check was given (a simulation), oldest first, a page at a time.

    Args:
        cursor: "" for the first page, then the next_cursor of the previous page.

    Returns:
        status; items: id, title, published_at, outlet, body (if given); next_cursor ("" at the end).
        Cite them as evidence by id.
    """
    check = _check(tool_context)
    provided = check.get("provided")
    if provided is None:
        return _blocked("this check searches the web; it has no provided news")
    items = sorted(
        (n for n in provided if in_window(n["published_at"], check)),
        key=lambda n: n["published_at"],
    )
    start = int(cursor) if cursor.isdigit() else 0
    page = items[start : start + NEWS_PAGE_SIZE]
    _remember(tool_context, news={n["id"]: n for n in page})
    nxt = start + NEWS_PAGE_SIZE
    return {
        "status": "ok",
        "items": [
            {k: n.get(k) for k in ("id", "title", "published_at", "outlet", "body")}
            for n in page
        ],
        "next_cursor": str(nxt) if nxt < len(items) else "",
    }


# ------------------------------------------------------------------ finish


def _finding_problems(
    i: int, f: Finding, seen: dict, spec: dict, check: dict
) -> list[str]:
    where = f"finding {i + 1}"
    ev = f.evidence
    public = spec.get("public") or {}
    line_count = len(public.get("tell_me_if", []))
    problems = [
        f"{where}: url {w.url} was not returned by web_search"
        for w in ev.web
        if w.url not in seen["web"]
    ]
    problems += [f"{where}: headline {n.item_id} was not returned by list_provided_news"
                 for n in ev.news if n.item_id not in seen["news"]]  # fmt: skip
    for w in ev.web:
        page = seen["web"].get(w.url)
        if page is None:
            continue
        if page["published_at"] is None:
            problems.append(f"{where}: {w.url} has no publication date on the page, so it can't show the news is new; "
                            "cite another page or drop the finding")  # fmt: skip
        elif not page["in_window"]:
            problems.append(
                f"{where}: {w.url} was published {page['published_at']}, outside this check's window"
            )
        if w.url in set(check.get("recent_urls", [])):
            problems.append(f"{where}: {w.url} was already reported by this monitor")
    problems += [
        f"{where}: tell_me_if line {n} does not exist"
        for n in f.tell_me_if_lines
        if n > line_count
    ]
    if not (ev.web or ev.news):
        problems.append(f"{where}: a finding needs a web page or a headline")
    if not f.tell_me_if_lines:
        problems.append(f"{where}: a finding needs the tell_me_if line it meets")
    allowed_places = set(public.get("places") or [])
    bad = [p for p in f.places if p not in allowed_places]
    if bad:
        problems.append(f"{where}: places {', '.join(bad)} are not the monitor's places "
                        f"({', '.join(sorted(allowed_places)) or 'none'})")  # fmt: skip
    key_dates = {k["date"] for k in (spec.get("about") or {}).get("key_dates", [])}
    if f.key_date and f.key_date.isoformat() not in key_dates:
        problems.append(
            f"{where}: key_date {f.key_date} is not one of the monitor's key dates"
        )
    return problems


def _verifier_report(spec: dict, findings: list[Finding], seen: dict) -> dict:
    """What the verifier sees: the monitor's lines and each finding with the evidence it cites."""
    public = spec.get("public") or {}

    def evidence(f: Finding) -> dict:
        return {
            "headlines": [seen["news"][n.item_id] for n in f.evidence.news],
            "web_pages": [{"url": w.url, **{k: seen["web"][w.url].get(k) for k in ("title", "outlet", "published_at", "answer")}}
                          for w in f.evidence.web],
        }  # fmt: skip

    return {
        "monitor": {
            "watch": public.get("watch", []),
            "tell_me_if": [
                {"line": i, "text": t}
                for i, t in enumerate(public.get("tell_me_if", []), start=1)
            ],
            "ignore": public.get("ignore", []),
        },
        "findings": [
            {
                "finding": i,
                **f.model_dump(mode="json", exclude={"evidence"}),
                "evidence": evidence(f),
            }
            for i, f in enumerate(findings, start=1)
        ],
    }


def _apply_review(
    findings: list[Finding], review: Review
) -> tuple[dict[int, Finding], list[str], list[str]]:
    """The fixes finish makes itself, without asking the agent again.

    Removes lines the evidence does not meet, merges a finding into an earlier one about the
    same story, and drops a finding left with no line. Returns the findings kept (by their
    1-based number), what was adjusted, and what was dropped.
    """
    by_number = {r.finding: r for r in review.findings}
    kept: dict[int, Finding] = {}
    adjusted: list[str] = []
    dropped: list[str] = []
    for i, original in enumerate(findings, start=1):
        f = original.model_copy(deep=True)
        r = by_number.get(i)
        bad = sorted(set(r.unsupported_lines) & set(f.tell_me_if_lines)) if r else []
        if bad:
            f.tell_me_if_lines = [n for n in f.tell_me_if_lines if n not in bad]
            adjusted.append(
                f"finding {i}: removed line(s) {bad}, which its evidence does not meet"
            )
        target = kept.get(r.same_story_as) if r and r.same_story_as else None
        if target:
            target.evidence.news += [
                n for n in f.evidence.news if n not in target.evidence.news
            ]
            target.evidence.web += [
                w for w in f.evidence.web if w not in target.evidence.web
            ]
            target.tell_me_if_lines = sorted(
                {*target.tell_me_if_lines, *f.tell_me_if_lines}
            )
            target.places = sorted({*target.places, *f.places})
            adjusted.append(
                f"finding {i}: merged into finding {r.same_story_as} (same story)"
            )
            continue
        if not f.tell_me_if_lines:
            dropped.append(
                f"finding {i}: dropped, as a finding must meet a tell_me_if line"
            )
            continue
        kept[i] = f
    return kept, adjusted, dropped


def _when(ts: str) -> str:
    """2026-10-08T09:25:00Z -> "09:25 UTC on 8 Oct"."""
    t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return f"{t:%H:%M} UTC on {t.day} {t:%b}"


def _from_evidence(f: Finding, seen: dict) -> Finding:
    """The finding in words taken only from its evidence.

    Used when the reviewer still flags a finding's wording on the last round: the alert is
    kept, as the cited headlines and page titles quoted with their times, which cannot
    claim more than the evidence. Lines and evidence stay as they are.
    """
    items = [seen["news"][n.item_id] for n in f.evidence.news]
    items += [seen["web"][w.url] for w in f.evidence.web if w.url in seen["web"]]
    parts = [
        f'"{x["title"]}" was published at {_when(x["published_at"])}.'
        for x in items
        if x.get("published_at")
    ]
    title = items[0]["title"] if items else f.title
    return f.model_copy(
        update={"title": title, "explanation": " ".join(parts) or f.explanation}
    )


def _fallback_summary(findings: list[Finding]) -> str:
    if not findings:
        return "No finding was supported by its evidence."
    return "Findings: " + "; ".join(f.title for f in findings) + "."


def sources_of(findings: list[Finding], seen: dict) -> list[dict]:
    """Every cited page or headline, as code read it (what the server stores as evidence)."""
    out: dict[str, dict] = {}
    for f in findings:
        for w in f.evidence.web:
            p = seen["web"].get(w.url) or {}
            out[w.url] = {"ref": w.url, "url": p.get("final_url") or w.url, "title": p.get("title") or w.title or "",
                          "outlet": p.get("outlet"), "published_at": p.get("published_at")}  # fmt: skip
        for n in f.evidence.news:
            h = seen["news"].get(n.item_id) or {}
            out[n.item_id] = {"ref": n.item_id, "url": h.get("url"), "title": h.get("title", ""),
                              "outlet": h.get("outlet"), "published_at": h.get("published_at")}  # fmt: skip
    return list(out.values())


async def finish(
    summary: str, findings: list[Finding], tool_context: ToolContext
) -> dict:
    """Ends the check with your findings. Call it exactly once, last.

    Finding nothing is a normal result: call finish with findings []. Each finding is
    checked against its evidence: pages must be dated inside the check's window and not
    already reported; numbers, names and quotes must come from the evidence; places must be
    the monitor's; a reviewer checks every claim. Lines the evidence does not meet are
    removed for you and findings about the same story are merged. Any other problem comes
    back as "error" with what to fix; fix it and call finish again.

    Args:
        summary: One or two sentences on what you found.
        findings: Each with title (the cited headline or page title), explanation,
            tell_me_if_lines (numbers of the lines the evidence meets), evidence (web: url;
            news: item_id), places (from the monitor's places) and key_date (one of the
            monitor's key dates, or null).

    Returns:
        status "ok" when accepted; otherwise "error" with what to fix.
    """
    try:
        parsed = _FINDINGS.validate_python(
            [f.model_dump() if isinstance(f, Finding) else f for f in findings or []]
        )
    except ValidationError as e:
        return _error(f"findings do not match the expected shape: {e}")

    state = tool_context.state
    seen = state.get(STATE_SEEN) or _empty_seen()
    spec = (state.get(STATE_MONITOR) or {}).get("spec", {})
    check = _check(tool_context)
    number_texts, abbr_texts = grounding.context_texts(
        spec, state.get(STATE_INSTITUTION) or {}
    )
    problems = [
        p
        for i, f in enumerate(parsed)
        for p in _finding_problems(i, f, seen, spec, check)
    ]
    if problems:  # evidence must exist before its words can be checked
        return _error("; ".join(problems))
    cites = [grounding.cited(f, seen) for f in parsed]
    all_cited = grounding.Cited()
    for c in cites:
        all_cited.add(c)
    seen_titles = [n["title"] for n in seen["news"].values()] + [
        w["title"] for w in seen["web"].values() if w.get("title")
    ]
    problems = [
        *(p for i, (f, c) in enumerate(zip(parsed, cites, strict=True))
          for p in grounding.finding_problems(i, f, c, number_texts, abbr_texts, seen_titles)),
        *grounding.reuse_problems(parsed),
        *grounding.summary_problems(summary, parsed, all_cited, number_texts, abbr_texts, seen_titles),
    ]  # fmt: skip
    if problems:
        return _error("; ".join(problems))

    verifier = get_verifier()
    adjusted: list[str] = []
    dropped: list[str] = []
    if verifier and parsed:
        rounds = int(state.get(STATE_VERIFY_ROUNDS) or 0) + 1
        state[STATE_VERIFY_ROUNDS] = rounds
        try:
            review = await verifier(_verifier_report(spec, parsed, seen))
        except Exception as e:
            # Fail open: the code checks above still hold.
            logger.warning("verifier failed; keeping code-checked findings: %s", e)
            review = None
        if review:
            kept, reviewed, dropped = _apply_review(parsed, review)
            adjusted += reviewed
            if review.messages():
                if rounds < MAX_VERIFY_ROUNDS:
                    return _error("; ".join([
                        "a reviewer found claims the evidence does not support; rewrite them and call finish again",
                        *review.messages(), *reviewed]))  # fmt: skip
                # Last round: rather than loop or lose the alert, keep each still-flagged
                # finding in words taken only from its evidence.
                flagged = sorted(review.flagged() & kept.keys())
                for i in flagged:
                    kept[i] = _from_evidence(kept[i], seen)
                adjusted += [
                    f"finding {i}: rewritten from its evidence, as the reviewer still flagged: "
                    f"{'; '.join(r.claim_problems())}"
                    for r in review.findings
                    if r.finding in flagged
                ]
            parsed = list(kept.values())
            if dropped or review.flagged():
                summary = _fallback_summary(parsed)

    state[STATE_RESULT] = {
        "summary": summary,
        "findings": [f.model_dump(mode="json") for f in parsed],
        "sources": sources_of(parsed, seen),
    }
    tool_context.actions.skip_summarization = True
    out = {"status": "ok", "findings_accepted": len(parsed)}
    if adjusted:
        out["adjusted"] = adjusted
    if dropped:
        out["dropped"] = dropped
    return out


TOOLS = [web_search, list_provided_news, finish]
