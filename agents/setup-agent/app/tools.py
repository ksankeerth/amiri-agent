"""The track agents' tools: amiri-server's API, plus three that
speak to the user: ask_user (a question with options), propose (the track's conclusion, which
the server checks and the user confirms) and conclude (a track ending without changes).

Reads are open to every track that lists them (app/guides.py). The only write is propose:
the server refuses what the track may not change, numbers nobody gave, personal data and
anything the profile's rules refuse; the agent fixes and resends at most MAX_REPAIRS times
in a turn, then tells the user. Code fixes what the model must not choose: the track, the
proposal's kind, the thread and the person.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any

from google.adk.tools import ToolContext
from pydantic import BaseModel

from app import settings
from app.contract import ProposalEv, QuestionEv, TrackConcludedEv, TurnIn
from app.server_api import seg
from app.sessions import Session
from app.tracks import TRACKS

SUGGESTION_SECTIONS = ("products", "segments", "regulators", "flows", "risk-exposures", "rivals")
BOOKKEEPING = ("version", "created_at", "updated_at", "updated_by")
MAX_OPTIONS = 8


@dataclass
class TurnBox:
    """What one turn's tools share: the session, the turn, and the events they produce."""

    s: Session
    turn: TurnIn
    track: str
    events: list[BaseModel] = field(default_factory=list)
    repairs: int = 0
    proposed: str | None = None
    asked: bool = False
    concluded: bool = False

    @property
    def iid(self) -> str | None:
        return self.turn.institution_id

    @property
    def institution_type(self) -> str | None:
        return (self.s.state.get("institution") or {}).get("institution_type")


BOXES: dict[str, TurnBox] = {}  # ADK session id -> the turn running in it


def box(tool_context: ToolContext) -> TurnBox:
    return BOXES[tool_context.session.id]


def _err(message: str, **extra) -> dict:
    return {"status": "error", "message": message, **extra}


def _blocked(message: str, **extra) -> dict:
    return {"status": "blocked", "message": message, **extra}


def _no_institution(b: TurnBox) -> dict | None:
    return None if b.iid else _blocked("The institution doesn't exist yet: the institution track creates it first.")


def _strip(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in BOOKKEEPING}


# ---------------------------------------------------------------- reads


async def get_section(section: str, tool_context: ToolContext) -> dict:
    """The items of one profile section as they are now, with their ids (use them in update
    and delete operations, and in references between items).

    Args:
        section: footprint, watch-places, segments, products, flows, regulators, rivals,
            counterparties or risk-exposures; or "institution" for the institution's own fields.

    Returns:
        status; items (or fields for "institution"); origins: how each item got there.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/profile")
    if not r.ok:
        return _err(f"the profile couldn't be read ({r.status})")
    if section == "institution":
        return {"status": "ok", "fields": _strip(r.body["institution"])}
    if section not in r.body["sections"]:
        return _err(f"no section {section}; one of: institution, {', '.join(r.body['sections'])}")
    origins = r.body.get("origins", {}).get(section, {})
    return {"status": "ok", "section": section, "items": [_strip(i) for i in r.body["sections"][section]],
            "origins": {k: {"source": v.get("last_source"), "by": v.get("last_by")} for k, v in origins.items()}}


async def get_readiness(tool_context: ToolContext) -> dict:
    """What the profile still needs before it can go live (required) and what is recommended.

    Returns:
        status; ready; checks: id, level, ok, message, section.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/readiness")
    if not r.ok:
        return _err(f"readiness couldn't be read ({r.status})")
    return {"status": "ok", "ready": r.body["ready"],
            "checks": [{k: c[k] for k in ("id", "level", "ok", "message", "section")} for c in r.body["checks"]],
            "warnings": r.body.get("warnings", [])}


async def get_suggestions(section: str, tool_context: ToolContext) -> dict:
    """Code's suggestions for a section, from reference data (the product taxonomy, customer
    templates, the regulators' rule table, published flow figures, the risk finder, the list of
    licensed banks and insurers for rivals). Each item is ready to propose as it is ("item");
    "added" says it is already in the profile.

    Args:
        section: products, segments, regulators, flows, risk-exposures or rivals.

    Returns:
        status; items: {added, item, why?}. Numbers in an item (a flow's value, a hazard's months)
        come with its reference (figure_id, hazard_id) and may be proposed as they are.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    if section not in SUGGESTION_SECTIONS:
        return _err(f"suggestions exist for {', '.join(SUGGESTION_SECTIONS)}")
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/suggestions/{section}")
    if not r.ok:
        return _err(f"suggestions couldn't be read ({r.status})")
    return {"status": "ok", "section": section, "items": r.body["items"]}


async def search_places(query: str, countries_only: bool, tool_context: ToolContext) -> dict:
    """Finds place codes: countries (ISO 3166-1), regions (ISO 3166-2, e.g. IN-KL for Kerala),
    and gazetteer places (cities, ports, seas, straits). Use the codes it returns; never make one up.

    Args:
        query: a place name, e.g. "Kerala" or "Strait of Hormuz".
        countries_only: true to find countries only.

    Returns:
        status; items: code, name, kind, parent, country.
    """
    b = box(tool_context)
    r = await b.s.api.get("/api/v1/reference/places", q=query, kind="country" if countries_only else None, limit=10)
    if not r.ok:
        return _err(f"the place search failed ({r.status})")
    return {"status": "ok", "items": [{k: p.get(k) for k in ("code", "name", "kind", "parent", "country")}
                                      for p in r.body["items"]]}


_schema: dict | None = None


async def get_field_rules(section: str, tool_context: ToolContext) -> dict:
    """The fields of a section's items (or of the institution), as JSON Schema: names, types,
    allowed values, limits. Read it before writing an item that no suggestion gives you.

    Args:
        section: institution, or a profile section (segments, products, flows, …).

    Returns:
        status; schema.
    """
    global _schema
    b = box(tool_context)
    if _schema is None:
        r = await b.s.api.get("/api/v1/reference/profile-schema")
        if not r.ok:
            return _err(f"the schema couldn't be read ({r.status})")
        _schema = r.body
    s = _schema["institution"] if section == "institution" else _schema["sections"].get(section)
    if s is None:
        return _err(f"no section {section}")
    return {"status": "ok", "section": section, "schema": inline_refs(s), "limits": _schema.get("limits")}


def inline_refs(schema: dict) -> dict:
    """The schema with every "$ref": "#/$defs/X" replaced by X itself and $defs dropped. Gemini reads a "$ref" in a
    tool's result as a pointer to an attached part and refuses the whole call (400 INVALID_ARGUMENT), so the
    flows, products and segments schemas (Money, FlowSource, SpecValue, …) must not carry any."""
    defs = schema.get("$defs", {})

    def walk(x, depth=0):
        if depth > 20:  # a self-referencing type: stop rather than loop
            return {}
        if isinstance(x, dict):
            ref = x.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/$defs/") and ref[8:] in defs:
                return walk({**defs[ref[8:]], **{k: v for k, v in x.items() if k != "$ref"}}, depth + 1)
            return {k: walk(v, depth) for k, v in x.items() if k not in ("$defs", "$ref")}
        if isinstance(x, list):
            return [walk(v, depth) for v in x]
        return x

    return walk(schema)


async def get_reference(name: str, tool_context: ToolContext) -> dict:
    """Reference lists from the server.

    Args:
        name: product-taxonomy (categories and product types for this institution's type),
            segment-dimensions (how customer groups map to the Metrics Spec), institution-types
            (types and subtypes), currencies, time-zones, hazards or routes.

    Returns:
        status; items.
    """
    b = box(tool_context)
    names = ("product-taxonomy", "segment-dimensions", "institution-types", "currencies", "time-zones", "hazards", "routes")
    if name not in names:
        return _err(f"one of: {', '.join(names)}")
    params = {"institution_type": b.institution_type} if name == "product-taxonomy" else {}
    r = await b.s.api.get(f"/api/v1/reference/{name}", **params)
    if not r.ok:
        return _err(f"{name} couldn't be read ({r.status})")
    return {"status": "ok", "items": r.body["items"]}


async def get_history(limit: int, tool_context: ToolContext) -> dict:
    """The profile's changes, newest first: who, when, from where (form, assistant, setup,
    import), and the batch each belongs to (undo works per batch).

    Args:
        limit: how many changes (at most 50).

    Returns:
        status; items: change_id, at, actor, source, batch_id, section, item_id, op, before, after.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/history", limit=max(1, min(limit, 50)))
    if not r.ok:
        return _err(f"the history couldn't be read ({r.status})")
    return {"status": "ok", "items": r.body["items"]}


async def get_undo(batch_id: str, tool_context: ToolContext) -> dict:
    """The operations that would undo one batch of changes (not applied: propose them).

    Args:
        batch_id: from get_history.

    Returns:
        status; operations.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/history/batches/{seg(batch_id)}/undo")
    if not r.ok:
        return _err(f"no undo for {batch_id} ({r.status}): {r.body}")
    return {"status": "ok", **r.body}


async def get_agent_context(tool_context: ToolContext) -> dict:
    """The profile as the agents read it, with Radar's scope (places, themes, actors) and
    why each place is in it.

    Returns:
        status; context.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get(f"/api/v1/institutions/{seg(b.iid)}/context")
    if not r.ok:
        return _err(f"the context couldn't be read ({r.status})")
    return {"status": "ok", "context": r.body}


# ---------------------------------------------------------------- monitors


async def list_monitors(tool_context: ToolContext) -> dict:
    """The institution's monitors: id, name, sentence, status, the profile item each watches.

    Returns:
        status; items.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get("/api/v1/monitors", institution_id=b.iid)
    if not r.ok:
        return _err(f"monitors couldn't be read ({r.status})")
    keys = ("monitor_id", "name", "sentence", "status", "origin_ref", "check_frequency", "pending", "live_version")
    return {"status": "ok", "items": [{k: m.get(k) for k in keys} for m in r.body["items"]]}


async def get_monitor(monitor_id: str, tool_context: ToolContext) -> dict:
    """One monitor's current spec (change it and propose an update with the whole spec).

    Args:
        monitor_id: from list_monitors.

    Returns:
        status; monitor_id, status, spec.
    """
    b = box(tool_context)
    r = await b.s.api.get(f"/api/v1/monitors/{seg(monitor_id)}")
    if not r.ok:
        return _err(f"no monitor {monitor_id} ({r.status})")
    if r.body.get("institution_id") != b.iid:
        return _blocked("that monitor belongs to another institution")
    return {"status": "ok", "monitor_id": monitor_id, "monitor_status": r.body["status"], "spec": r.body["spec"]}


async def get_monitor_candidates(tool_context: ToolContext) -> dict:
    """Profile items a monitor can be drafted from (known risks, regulators, rivals, flows,
    counterparties). monitor_id is set when a monitor already watches the item: update that one.

    Returns:
        status; items: section, item_id, label, kind, monitor_id.
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get("/api/v1/monitors:draftable", institution_id=b.iid)
    if not r.ok:
        return _err(f"candidates couldn't be read ({r.status})")
    return {"status": "ok", "items": r.body["items"]}


async def get_monitor_template(section: str, item_id: str, tool_context: ToolContext) -> dict:
    """Code's draft of a monitor for one profile item: a whole spec and its origin_ref. Saves
    nothing. Edit the text to what the user asked for, then propose it.

    Args:
        section: the candidate's section.
        item_id: the candidate's item_id.

    Returns:
        status; spec; origin_ref; monitor_id (set when one already watches the item).
    """
    b = box(tool_context)
    if (blocked := _no_institution(b)) is not None:
        return blocked
    r = await b.s.api.get("/api/v1/monitors:template", institution_id=b.iid, section=section, item_id=item_id)
    if not r.ok:
        return _err(f"no draft for {section}/{item_id} ({r.status}): {r.body}")
    return {"status": "ok", **r.body}


# ---------------------------------------------------------------- to the user


def ask_user(question: str, options: list[str], multi: bool, tool_context: ToolContext) -> dict:
    """Asks the user a question with options to click (they can also type). Use it when the
    answer is a choice among known options. One question per turn; after it, end your turn.

    Args:
        question: the question, one or two sentences.
        options: 2 to 8 short options (from data or the conversation, never invented figures).
        multi: true if several options can be chosen.

    Returns:
        status.
    """
    b = box(tool_context)
    if b.asked:
        return _blocked("one question per turn: wait for the answer")
    opts = [o.strip()[:120] for o in options if o and o.strip()][:MAX_OPTIONS]
    if not opts or not question.strip():
        return _err("a question needs text and at least one option")
    qid = f"q-{uuid.uuid4().hex[:8]}"
    b.s.state.setdefault("questions", {})[qid] = {"text": question.strip(), "options": opts, "track": b.track}
    b.events.append(QuestionEv(question_id=qid, text=question.strip()[:2000], options=opts, multi=multi))
    b.asked = True
    tool_context.actions.skip_summarization = True  # the question is the reply: the turn ends here
    return {"status": "ok", "message": "The user sees the question and its options."}


async def propose(summary: str, operations: list[dict[str, Any]] | None, institution: dict[str, Any] | None,
                  monitors: list[dict[str, Any]] | None, evidence: list[dict[str, Any]] | None,
                  tool_context: ToolContext) -> dict:
    """Concludes the track with a proposal: the server checks it and the user sees a card
    "Shall I apply these changes?". Nothing changes until they apply it.

    Give exactly one of:
        operations: profile changes, each {op: create|update|delete, section, id (update and
            delete), data (create: the item; update: the fields that change)}. Prefer suggestion
            items as they are. Only sections this track writes.
        institution: the institution track before the institution exists: its fields (name,
            institution_type, subtype, home_country, base_currency, time_zone, …).
        monitors: the monitors track: [{op: create, origin_ref, spec} or {op: update, monitor_id,
            spec}], each spec whole (from get_monitor_template or get_monitor, edited).

    Args:
        summary: one line the user reads, e.g. "Add Kerala and the UAE→Kerala remittance flow".
        operations: see above, or null.
        institution: see above, or null.
        monitors: see above, or null.
        evidence: optional, where each change came from: [{operation: 0, from: "suggestion:flows/<figure_id>"}].

    Returns:
        status ok with proposal_id; or errors to fix (then call propose again); or blocked.
    """
    b = box(tool_context)
    t = TRACKS[b.track]
    if t.read_only:
        return _blocked(f"the {t.label} track changes nothing; answer, or conclude")
    if b.proposed:
        return _blocked("one proposal per turn: it is already on the user's screen")
    if b.track == "monitors":
        kind, body = "monitors", {"monitors": monitors or []}
    elif b.track == "institution" and not b.iid:
        kind, body = "create_institution", {"institution": institution or {}}
    else:
        kind, body = "profile", {"operations": operations or []}
    unused = [n for n, v in (("operations", operations), ("institution", institution), ("monitors", monitors))
              if v and n not in body]
    if unused:
        return _err(f"this track proposes {kind}: put the changes in {next(iter(body))}, not {', '.join(unused)}")
    r = await b.s.api.post("/api/v1/proposals", json={
        "thread_id": b.turn.thread_id, "session_id": b.turn.session_id, "track": b.track, "kind": kind,
        "summary": summary.strip()[:400] or t.label, "evidence": evidence or [], "on_behalf_of": b.turn.user_id, **body})
    if r.status == 201:
        b.proposed = r.body["proposal_id"]
        b.events.append(ProposalEv(proposal_id=b.proposed))
        return {"status": "ok", "proposal_id": b.proposed,
                "message": "The user sees the proposal as a card to apply. Tell them in a sentence or two what "
                           "it does and that nothing changes until they apply it."}
    b.repairs += 1
    errors = (r.body or {}).get("errors") if isinstance(r.body, dict) else None
    detail = (r.body or {}).get("detail") if isinstance(r.body, dict) else str(r.body)
    if b.repairs > settings.integer("MAX_REPAIRS"):
        return _blocked("The server refused the proposal again. Don't retry: tell the user plainly what couldn't be "
                        "proposed and why, and that the forms can do it.", detail=detail, errors=errors)
    return _err(f"The server refused the proposal ({r.status}): {detail}. Fix what the errors say and call propose "
                "again.", errors=errors)


def conclude(summary: str, tool_context: ToolContext) -> dict:
    """Ends this track without changes (a read-only track's answer is complete, or nothing needs
    changing). Not after propose: applying the proposal concludes the track.

    Args:
        summary: one line on what was settled. Never a change ("added …"): only an applied proposal saves anything.

    Returns:
        status.
    """
    b = box(tool_context)
    if b.proposed:
        return _blocked("a proposal is waiting: applying it concludes the track")
    # seen: a footprint card left unapplied, then "Added Seoul and Gyeonggi" as the track ended with nothing saved
    waiting = [p["summary"] for p in b.s.state.get("pending") or [] if p.get("track") == b.track]
    if waiting:
        return _blocked(f"“{waiting[-1]}” is still waiting for the user's Apply: nothing of it is saved. Don't say it "
                        "was added; ask the user to apply that card, or propose again if it's out of date")
    if b.track == "institution" and not b.iid:
        return _blocked("there is no institution yet (nothing was applied): the institution track can't end; "
                        "tell the user what's needed to create it")
    if b.concluded:
        return {"status": "ok"}
    b.events.append(TrackConcludedEv(track=b.track, summary=summary.strip()[:400] or TRACKS[b.track].label))
    b.concluded = True
    return {"status": "ok", "message": "Concluded. Offer the next step in a sentence."}


READS = [get_section, get_readiness, get_suggestions, search_places, get_field_rules, get_reference]
MONITOR_TOOLS = [list_monitors, get_monitor, get_monitor_candidates, get_monitor_template]
HISTORY_TOOLS = [get_history, get_undo]
