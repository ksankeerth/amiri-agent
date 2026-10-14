"""The investigation for people: a markdown report built by code from the result (no model).

Every sentence comes from the result: the event's phrase (theme, currency, size from the
signal), the mechanisms' effect text, the spec's metric names, and the screening reasons
(the model's one-line choices, already limited to the event's numbers). When metrics
validation is off it is the whole output; when it is on, it sums up what the tasks check.
"""

from app.contract import Event, InvestigationRequest, InvestigationResult
from app.tasks import local_date

OUT_OF_SCOPE = {
    "not_home_country": "not about where the institution operates",
    "no_theme": "no theme the investigation tracks",
    "below_min_size": "too small to matter",
    "merged_into_event": "the same move as another finding",
    "after_as_of": "dated after the run's time",
}
TIMING = {"days": "within days", "weeks": "within weeks", "months": "within months"}
WHERE = {
    "home": "at home",
    "footprint": "in a country it operates in",
    "other": "abroad",
    "global": "worldwide",
}


def _where(e: Event, req: InvestigationRequest) -> str:
    if e.country == "home":
        where = req.institution.country_name or req.institution.country
    elif e.country == "footprint" and e.country_code:
        where = f"{e.country_code} (where it operates)"
    else:
        where = WHERE[e.country]
    places = [p for p in e.places if p not in (req.institution.country, e.country_code)]
    return where + (f"; {', '.join(places)}" if places else "")


def build_report(
    req: InvestigationRequest, r: InvestigationResult, catalog: dict[str, dict], phrase
) -> str:
    inst = req.institution
    zone = inst.zone()
    names = {p.product_id: p.name for p in req.products}
    titles = {f.finding_id: f.title for f in req.findings}
    metric_names = {
        (pid, m["metric"]): m.get("name") or m["metric"]
        for pid, prod in catalog.items()
        for m in prod.get("metrics", [])
    }
    tasks = {t.hypothesis_id: t for t in r.tasks}
    lines = [f"# Investigation for {inst.name}", ""]
    if r.as_of:
        lines += [
            f"As of {r.as_of.astimezone(zone):%d %b %Y %H:%M} ({inst.time_zone}).",
            "",
        ]
    if r.extended_event_id:
        lines += [
            "This run adds the new themes of a later finding to an open event.",
            "",
        ]
    lines.append(
        f"{len(req.findings)} finding{'s' if len(req.findings) != 1 else ''}, "
        f"{len(r.events)} event{'s' if len(r.events) != 1 else ''}. "
        + (
            "Each effect below has a validation task that checks it against the institution's data."
            if r.mode == "tasks"
            else "Metrics validation is off: these are the effects to watch, not yet checked against data."
        )
    )
    if r.stop_reason != "finished":
        lines.append(
            f"The run stopped early ({r.stop_reason.replace('_', ' ')}); what follows is what it reached."
        )
    for e in r.events:
        lines += [
            "",
            f"## {phrase(e, inst.currency)}",
            "",
            f"{local_date(e.anchor, zone):%d %b %Y}, {_where(e, req)}. "
            f"From: {'; '.join(titles.get(f, f) for f in e.finding_ids)}.",
        ]
        hyps = [h for h in r.hypotheses if h.event_id == e.event_id]
        if hyps:
            lines += ["", "**What could be affected**", ""]
            for h in hyps:
                metric = metric_names.get(
                    (h.product_id, h.expected.metric),
                    h.expected.metric.replace("_", " "),
                )
                seg = (
                    f" ({h.segment.dimension.replace('_', ' ')}: {h.segment.value})"
                    if h.segment
                    else ""
                )
                move = "rise" if h.expected.direction == "rise" else "fall"
                line = (
                    f"- **{names.get(h.product_id, h.product_id)}**: {h.chain_label}. "
                    f"Watch {metric}{seg}: expected to {move} {TIMING[h.expected.timing]}."
                )
                if (t := tasks.get(h.hypothesis_id)) is not None:
                    line += f" Checked from {t.watch.from_:%d %b} to {t.watch.until:%d %b %Y} ({t.task_id})."
                    if t.scope_note:
                        line += f" {t.scope_note}"
                lines.append(line)
        else:
            lines += [
                "",
                "No product of the institution is exposed through the tracks.",
            ]
        aside = [
            s for s in r.screening if s.event_id == e.event_id and s.decision != "kept"
        ]
        if aside:
            lines += ["", "**Considered and set aside**", ""]
            lines += [
                f"- {s.product_type.replace('_', ' ')}, {s.angle.replace('_', ' ')}: {s.reason}"
                for s in aside
            ]
        ctx = [c for c in r.context if c.event_id == e.event_id]
        if ctx:
            lines += ["", "**For context**", ""]
            lines += [
                f"- {names.get(c.product_id, c.product_id)}: {c.why} "
                f"({metric_names.get((c.product_id, c.metric), c.metric)})"
                for c in ctx
            ]
    gone = [o for o in r.out_of_scope if o.reason != "merged_into_event"]
    if gone:
        lines += ["", "## Findings set aside", ""]
        lines += [
            f"- {titles.get(o.finding_id, o.finding_id)}: {OUT_OF_SCOPE[o.reason]}"
            + (f" ({o.note})" if o.note else "")
            + "."
            for o in gone
        ]
    if r.untracked_products:
        lines += ["", "## Products the investigation doesn't cover yet", ""]
        lines += [
            f"- {names.get(u.product_id, u.product_id)}: {u.reason}"
            for u in r.untracked_products
        ]
    return "\n".join(lines) + "\n"
