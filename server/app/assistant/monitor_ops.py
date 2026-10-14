"""The monitors track's proposals.

A proposal of kind "monitors" creates monitors (from a profile item, or written from scratch)
or changes existing ones. It is checked like a profile proposal (422 with `errors` the agent
repairs from): the spec's own rules and the profile's exposure ids; numbers only as the user
typed them or code drafted them; nothing copied from the private fields into the public ones
(public fields become web searches); no second monitor for an item already watched; no change
that changes nothing. Confirming creates or updates each monitor and submits it for approval;
a Risk Manager approves it on the Monitors page as for any monitor.
"""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from app.assistant import numbers
from app.institutions.service import Institutions
from app.monitors import request as build
from app.monitors import templates
from app.monitors.schemas import MonitorSpec
from app.monitors.service import Monitors
from app.problems import Problem

MAX_OPS = 10
NGRAM = 4  # private text copied into a public field: this many words in a row


class OriginRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: Literal["risk-exposures", "regulators", "rivals", "flows", "counterparties"]
    item_id: str


class MonitorOp(BaseModel):
    """create: a new monitor (origin_ref: the profile item it watches, from GET /monitors:template);
    update: the next version of an existing one (monitor_id). spec: the whole spec, as GET /monitors:template
    or GET /monitors/{id} returns it, with the track's changes."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["create", "update"]
    monitor_id: str | None = None
    origin_ref: OriginRef | None = None
    spec: dict[str, Any]


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _grams(texts: list[str]) -> set[tuple[str, ...]]:
    out = set()
    for t in texts:
        w = _words(t)
        out |= {tuple(w[i:i + NGRAM]) for i in range(len(w) - NGRAM + 1)}
    return out


def _public(spec: dict) -> list[str]:
    p, ex = spec.get("public") or {}, (spec.get("public") or {}).get("example_headlines") or {}
    return [(spec.get("about") or {}).get("name") or "", p.get("in_one_sentence") or "", *(p.get("tell_me_if") or []),
            *(p.get("ignore") or []), *(m.get("headline") or "" for m in ex.get("match") or []),
            *(ex.get("not_match") or []),
            *(w for c in p.get("watch") or [] for w in [c.get("name") or "", *(c.get("other_forms") or [])])]


def _private(spec: dict) -> list[str]:
    v = spec.get("private") or {}
    return [*(e.get("how_it_reaches_us") or "" for e in v.get("exposure") or []), *(v.get("serious") or []),
            v.get("notes") or ""]


def private_in_public(spec: dict, public_names: list[str], index: int) -> list[dict]:
    """Private text repeated in a public field. Names from the profile and code's draft are public anyway."""
    leaked = (_grams(_private(spec)) & _grams(_public(spec))) - _grams(public_names)
    if not leaked:
        return []
    shown = sorted(" ".join(g) for g in leaked)[:3]
    return [{"operation": index, "section": "monitors", "field": "public", "code": "private_in_public",
             "message": f"the public fields repeat private text ({'; '.join(shown)}); public fields become web "
                        "searches, so keep how it reaches us and what counts as serious out of them"}]


def summary(spec: dict) -> dict:
    a, p = spec.get("about") or {}, spec.get("public") or {}
    return {"name": a.get("name"), "sentence": p.get("in_one_sentence"), "tell_me_if": p.get("tell_me_if"),
            "places": p.get("places"), "check_frequency": a.get("check_frequency"),
            "exposure": [e.get("id") for e in (spec.get("private") or {}).get("exposure") or []]}


async def check(ops: list[MonitorOp], institution_id: str, typed: set[float], monitors: Monitors,
                institutions: Institutions, today: datetime) -> list[dict]:
    """The proposal's changes for the card, or Problem 422 with every error found."""
    if not ops:
        raise Problem(422, "validation_error", "A monitors proposal needs at least one monitor.")
    if len(ops) > MAX_OPS:
        raise Problem(422, "validation_error", f"Propose at most {MAX_OPS} monitors at a time.")
    state = await institutions.state(institution_id)
    inst = build.institution(state)
    names = [inst["name"], *(x.get("name") or x.get("label") or "" for k in ("products", "segments", "rivals",
             "regulators", "counterparties", "risks") for x in inst[k])]  # fmt: skip
    existing = {r["monitor_id"]: r for r in await monitors.summaries(institution_id)}
    watched = {(r["origin_ref"]["section"], r["origin_ref"]["item_id"]): r["monitor_id"]
               for r in existing.values() if r["origin_ref"] and r["status"] != "retired"}
    errors: list[dict] = []
    changes: list[dict] = []
    seen_refs: set[tuple[str, str]] = set()
    for i, op in enumerate(ops):
        try:
            spec = MonitorSpec.model_validate(op.spec)
        except ValidationError as e:
            errors += [{"operation": i, "section": "monitors", "field": "spec." + ".".join(str(x) for x in er["loc"]),
                        "code": "invalid", "message": er["msg"].removeprefix("Value error, ")} for er in e.errors()]
            continue
        data = spec.model_dump(mode="json")
        backed: list[dict] = []
        before = None
        if op.op == "create":
            if op.monitor_id:
                errors.append({"operation": i, "section": "monitors", "code": "invalid",
                               "message": "create takes no monitor_id; to change a monitor, use update"})
            if op.origin_ref:
                ref = (op.origin_ref.section, op.origin_ref.item_id)
                if ref in watched:
                    errors.append({"operation": i, "section": "monitors", "code": "already_monitored",
                                   "monitor_id": watched[ref],
                                   "message": f"{watched[ref]} already watches this item; propose an update to it instead"})
                if ref in seen_refs:
                    errors.append({"operation": i, "section": "monitors", "code": "invalid",
                                   "message": "two monitors for the same profile item in one proposal"})
                seen_refs.add(ref)
                try:
                    draft, _ = templates.draft(state, *ref)
                    backed.append(draft)
                except Problem as e:
                    errors.append({"operation": i, "section": "monitors", "code": "not_found", "message": e.detail})
        else:
            m = existing.get(op.monitor_id or "")
            if not m:
                errors.append({"operation": i, "section": "monitors", "code": "not_found",
                               "message": f"no monitor {op.monitor_id} for this institution"})
                continue
            if m["status"] == "retired":
                errors.append({"operation": i, "section": "monitors", "code": "monitor_retired",
                               "message": f"{op.monitor_id} is retired and can't change"})
                continue
            _, current = await monitors.latest_spec(m["monitor_id"])
            if current == data:
                errors.append({"operation": i, "section": "monitors", "code": "no_change",
                               "message": f"{op.monitor_id}: this spec is its current version"})
            backed.append(current)
            before = summary(current)
        bad = await monitors.unknown_exposures(institution_id, spec)
        if bad:
            errors.append({"operation": i, "section": "monitors", "field": "spec.private.exposure", "code": "invalid",
                           "message": f"exposures not in the profile: {', '.join(bad)}"})
        errors += numbers.check_monitor(data, typed, names, backed, i, today.year)
        errors += private_in_public(data, [*names, *(t for b in backed for t in _public(b))], i)
        changes.append({"section": "monitors", "id": op.monitor_id, "op": op.op, "before": before, "after": summary(data)})
    if errors:
        raise Problem(422, "validation_error", "The monitors proposal breaks the track's rules.", errors=errors)
    return changes


async def apply(ops: list[MonitorOp], institution_id: str, actor: str, note: str, monitors: Monitors) -> dict:
    """Creates or updates each monitor and submits it for approval."""
    out = []
    for op in ops:
        spec = MonitorSpec.model_validate(op.spec)
        if op.op == "create":
            m = await monitors.create(institution_id, spec, actor, origin="setup",
                                      origin_ref=op.origin_ref.model_dump() if op.origin_ref else None,
                                      drafted=templates.DRAFTED, note=note)
        else:
            m = await monitors.update(op.monitor_id, spec, actor, note)
        m = await monitors.transition(m["monitor_id"], "submit", actor)
        out.append({"monitor_id": m["monitor_id"], "version": m["latest_version"], "status": m["status"],
                    "name": m["name"]})
    return {"monitors": out}

