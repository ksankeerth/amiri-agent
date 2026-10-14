"""One investigation, from findings to validation tasks.

  1. read the institution's data coverage      (code, through amiri-server)
  2. classify each finding                     (model: classify; skipped when the
                                                finding's source set its themes)
     where it is about, and the channel         (code, from its places and the flows)
  3. group into events, set anchors and sizes  (code)
  4. list product type x angle candidates      (code)
  5. screen each candidate                     (model: screen)
  6. per kept product: mechanism and segment   (model: choose, only when there's a choice)
  7. build the hypothesis and its task         (code)

Model calls are capped (limits.max_model_calls) and the run has a timeout; when
either stops it, the result so far is returned with stop_reason call_limit or
timeout.
"""

import asyncio
import time
from datetime import timedelta

from app.candidates import Candidate, list_candidates
from app.contract import (
    Classification,
    ContextItem,
    Event,
    Expectation,
    Finding,
    Hypothesis,
    InvestigationRequest,
    InvestigationResult,
    Screening,
    SegmentFilter,
    ToolCall,
    Untracked,
    Usage,
    ValidationTask,
)
from app.data_client import Calendar, Data, DataError
from app.normalize import Reading, extend_into, normalize, where
from app.report import build_report
from app.steps import (
    Llm,
    choose_mechanism_prompt,
    choose_segment_prompt,
    classify_prompt,
    classify_schema,
    describe_event,
    enum_schema,
    read_classification,
    read_screening,
    screen_prompt,
    screen_schema,
)
from app.tasks import Choice, build_task, fixed_filter, local_date, pick_metric
from app.tracks import TRACKS_VERSION, Mechanism

STEP_TOOL = {
    "classify": "classify_finding",
    "screen": "screen",
    "choose": "add_hypothesis",
}
CALENDAR_SPAN = timedelta(days=200)

PHRASES = {
    ("fx", "weaker"): "The {currency} weakened",
    ("fx", "stronger"): "The {currency} strengthened",
    ("rates", "up"): "Rates rose",
    ("rates", "down"): "Rates fell",
    ("prices", "up"): "Prices rose",
    ("commodities", "down"): "{item} fell",
    ("commodities", "up"): "{item} rose",
    ("remittance", "down"): "Remittances fell",
    ("disaster", "domestic"): "A disaster hit",
    ("trust", "rival"): "A rival institution had a trust event",
    ("trust", "own"): "We had a trust event",
    ("macro", "worse"): "The economic outlook worsened",
    ("sector", "shock"): "A sector was hit",
}


class CallLimit(Exception):
    pass


def phrase(event: Event, currency: str) -> str:
    lead = event.themes[0]
    text = PHRASES.get(
        (lead.theme, lead.direction),
        f"{lead.theme} ({lead.direction.replace('_', ' ')})",
    ).format(
        currency=lead.currency or currency,
        item=(lead.item or "The commodity").capitalize(),
    )
    if lead.theme == "disaster" and event.places:
        text += f" in {' and '.join(event.places)}"
    if event.size:
        text += f" ({event.size.value:g}{'%' if event.size.unit == 'pct' else ' bp'})"
    return text


class Investigation:
    def __init__(self, req: InvestigationRequest, llm: Llm, data: Data):
        self.req, self.llm, self.data = req, llm, data
        self.tracked = req.tracked()  # product_id -> (product, the tracks' type)
        self.untracked = [
            Untracked(product_id=p.product_id, product_type=p.product_type,
                      reason=f"No investigation tracks for {p.category}"
                      + (f" / {p.product_type}" if p.product_type else "") + " yet.")
            for p in req.products if p.product_id not in self.tracked
        ]  # fmt: skip
        self.limits = req.limits
        self.classifications: list[Classification] = []
        self.events: list[Event] = []
        self.out_of_scope = []
        self.screening: list[Screening] = []
        self.hypotheses: list[Hypothesis] = []
        self.tasks: list[ValidationTask] = []
        self.context: list[ContextItem] = []
        self.trace: list[ToolCall] = []
        self.model_calls = 0
        self.models_used: list[str] = []
        self.stop_reason = "finished"
        self.catalog: dict[
            str, dict
        ] = {}  # product_id -> its coverage (metrics offered)
        self.data_source_id = "unknown"
        self.catalog_version: str | None = None
        self.zone = req.institution.zone()
        self._cal: dict[str, Calendar] = {}  # event_id -> the calendar around it

    # ----------------------------------------------------------------- run

    async def run(self) -> InvestigationResult:
        started = time.monotonic()
        try:
            async with asyncio.timeout(self.limits.timeout_seconds):
                await self._run()
        except TimeoutError:
            self.stop_reason = "timeout"
        except CallLimit:
            self.stop_reason = "call_limit"
        return self.result(int((time.monotonic() - started) * 1000))

    def _record(
        self, tool: str, args: dict, status: str, result=None, message=None
    ) -> None:
        self.trace.append(
            ToolCall(
                step=len(self.trace) + 1,
                tool=tool,
                args=args,
                status=status,
                result=result,
                message=message,
            )
        )

    async def _step(self, step: str, prompt: str, schema: dict, args: dict) -> dict:
        if self.model_calls >= self.limits.max_model_calls:
            raise CallLimit
        self.model_calls += 1
        try:
            answer, used = await self.llm(step, prompt, schema)
        except Exception as e:
            self._record(
                STEP_TOOL[step], args, "error", message=f"{type(e).__name__}: {e}"
            )
            raise
        self.models_used.append(used)
        self._record(STEP_TOOL[step], args, "ok", result=answer)
        return answer

    async def _run(self) -> None:
        await self._read_coverage()
        readings: dict[str, Reading] = {}
        inst = self.req.institution
        for f in self.req.findings:
            placed = where(f.places, inst, self.req.place_info)
            if f.themes:  # set by the source (a series, Radar): no model call
                r = Reading(f.finding_id, list(f.themes))
            elif placed and placed[:2] == (
                "other",
                "none",
            ):  # abroad, no way home: nothing to classify
                r = Reading(f.finding_id, [])
            else:
                answer = await self._step(
                    "classify",
                    classify_prompt(f, inst),
                    classify_schema(inst),
                    {"finding_id": f.finding_id},
                )
                r = read_classification(f, answer, inst)
            if placed:
                r.country, r.channel, r.why, r.country_code = placed
            elif r.country == "footprint" and len(inst.footprint) == 1:
                r.country_code = inst.footprint[0].country
            readings[f.finding_id] = r
            self.classifications.append(
                Classification(
                    finding_id=f.finding_id,
                    themes=r.themes,
                    country=r.country,
                    channel=r.channel,
                )
            )
        norm = normalize(
            self.req.findings, readings, inst, self.req.place_info, self.req.as_of
        )
        if self.req.extend:
            norm = extend_into(norm, self.req.extend.event_id, self.req.extend.themes)
        self.events, self.out_of_scope = norm.events, norm.out_of_scope
        for e in self.events:
            e.title = phrase(e, inst.currency)
        await self.prefetch_calendars()
        for event in self.events:
            await self._investigate(event)

    async def _read_coverage(self) -> None:
        try:
            body = await self.data.coverage(self.req)
        except DataError as e:
            self._record(
                "get_coverage",
                {"institution_id": self.req.institution_id},
                "error",
                message=str(e),
            )
            return
        source = body.get("data_source") or {}
        self.data_source_id = source.get("data_source_id") or "unknown"
        self.catalog_version = source.get("catalog_version")
        offered = {
            p["product_id"]: p for p in body.get("products", []) if p.get("metrics")
        }
        groups = body.get("groups") or []
        for pid, (product, _) in self.tracked.items():
            own = offered.get(pid)
            shared = [
                {**m, "group_id": g["group_id"], "group_name": g["name"]}
                for g in groups
                if g.get("institution_wide") or g.get("category") == product.category
                for m in g.get("metrics", [])
            ]
            if own or shared:
                have = {m["metric"] for m in (own or {}).get("metrics", [])}
                self.catalog[pid] = {
                    **(own or {"product_id": pid}),
                    "metrics": [
                        *(own or {}).get("metrics", []),
                        *(m for m in shared if m["metric"] not in have),
                    ],
                }
        self._record(
            "get_coverage",
            {"institution_id": self.req.institution_id},
            "ok",
            result={"data_source_id": self.data_source_id, "products": sorted(offered)},
        )

    # ---------------------------------------------------------- per event

    def _findings(self, event: Event) -> list[Finding]:
        return [f for f in self.req.findings if f.finding_id in event.finding_ids]

    async def _investigate(self, event: Event) -> None:
        products = {
            pid: (
                ttype,
                (self.catalog.get(pid, {}).get("book_size") or {}).get("value", 0.0),
                p.product_type,
            )
            for pid, (p, ttype) in self.tracked.items()
            if event.country != "footprint"
            or not p.countries
            or event.country_code in p.countries
        }
        listing = list_candidates(event, products, self.limits)
        text = describe_event(event, self._findings(event))
        for c in listing.context:
            self._add_context(event, c)
        for c in listing.cut_by_cap:
            self.screening.append(
                Screening(
                    event_id=event.event_id,
                    product_type=c.product_type,
                    angle=c.angle,
                    decision="cut_by_cap",
                    mechanism_ids=[m.mechanism_id for m in c.mechanisms],
                    reason="Beyond this run's limits on product types and angles per event.",
                )
            )
        for c in listing.to_screen:
            await self._screen(event, text, c)

    def _add_context(self, event: Event, c: Candidate) -> None:
        for pid in c.product_ids:
            product = self.catalog.get(pid)
            metrics = {m["metric"]: m for m in (product or {}).get("metrics", [])}
            for m in c.mechanisms:
                metric = pick_metric(m, metrics)
                if metric:
                    self.context.append(
                        ContextItem(
                            context_id=f"c-{len(self.context) + 1}",
                            event_id=event.event_id,
                            data_source_id=self.data_source_id,
                            product_id=metrics[metric].get("group_id") or pid,
                            angle=c.angle,
                            metric=metric,
                            as_of=local_date(event.anchor, self.zone),
                            why=m.text,
                        )
                    )
                    break

    def _options(self, event: Event, c: Candidate, pid: str) -> list[Mechanism]:
        """The candidate's mechanisms that could give this product a task."""
        product = self.catalog.get(pid)
        metrics = {m["metric"]: m for m in (product or {}).get("metrics", [])}
        out = []
        for m in c.mechanisms:
            spec_type = self.tracked[pid][0].product_type
            if m.context or (m.only_spec_types and spec_type not in m.only_spec_types):
                continue
            if product is None:  # server unreachable: can't tell, keep it
                out.append(m)
                continue
            metric = pick_metric(m, metrics)
            if metric is None:
                continue
            if m.segment_dim == "region" and event.regions:
                if not _region_values(metrics[metric]["dimensions"], event.regions):
                    continue  # a national total would dilute a local effect into noise
            if m.segment_dim == "corridor":
                if not _corridor_values(metrics[metric]["dimensions"], event.countries):
                    continue  # the effect is the affected country's flow, or nothing
            out.append(m)
        return out

    def _measures(self, event: Event, m: Mechanism, pid: str) -> str:
        product = self.catalog.get(pid)
        metrics = {x["metric"]: x for x in (product or {}).get("metrics", [])}
        metric = pick_metric(m, metrics) if metrics else None
        if metric is None:
            return "catalog unavailable"
        dims = metrics[metric]["dimensions"]
        parts = [
            f"{k}={v}"
            for k, v in fixed_filter(m, event).items()
            if v in dims.get(k, [])
        ]
        if m.segment_value and any(m.segment_value in v for v in dims.values()):
            parts.append(m.segment_value)
        if m.segment_dim == "region" and event.regions:
            parts.append("per affected region")
        elif m.segment_dim == "corridor":
            parts.append("from the affected country")
        elif m.segment_dim and m.segment_dim in dims:
            parts.append(f"by {m.segment_dim}")
        return f"{metric}" + (f" ({', '.join(parts)})" if parts else "")

    async def _screen(self, event: Event, text: str, c: Candidate) -> None:
        names = {pid: p.name for pid, (p, _) in self.tracked.items()}
        offered = {pid: self._options(event, c, pid) for pid in c.product_ids}
        offered = {pid: opts for pid, opts in offered.items() if opts}
        if not offered:
            self.screening.append(
                Screening(
                    event_id=event.event_id,
                    product_type=c.product_type,
                    angle=c.angle,
                    decision="rejected",
                    mechanism_ids=[m.mechanism_id for m in c.mechanisms],
                    reason="None of these products offers a metric that could show this effect.",
                )
            )
            return
        narrowed = Candidate(c.event_id, c.product_type, c.angle, c.mechanisms,
                             sorted(offered), c.book_size)  # fmt: skip
        lines = {
            pid: f"{names.get(pid, pid)}; would check "
            + " or ".join(dict.fromkeys(self._measures(event, m, pid) for m in opts))
            for pid, opts in offered.items()
        }
        answer = read_screening(
            narrowed,
            await self._step(
                "screen",
                screen_prompt(self.req.institution, text, narrowed, lines),
                screen_schema(narrowed),
                {
                    "event_id": event.event_id,
                    "product_type": c.product_type,
                    "angle": c.angle,
                },
            ),
        )
        self.screening.append(
            Screening(
                event_id=event.event_id,
                product_type=c.product_type,
                angle=c.angle,
                decision="kept" if answer.keep else "rejected",
                product_ids=answer.product_ids,
                mechanism_ids=[m.mechanism_id for m in c.mechanisms],
                reason=answer.reason,
            )
        )
        for pid in answer.product_ids:
            await self._hypothesise(event, text, c, pid)

    async def _hypothesise(
        self, event: Event, text: str, c: Candidate, pid: str
    ) -> None:
        ref, ptype = self.tracked[pid]
        product = self.catalog.get(pid)
        metrics = {m["metric"]: m for m in (product or {}).get("metrics", [])}
        options = self._options(event, c, pid)
        if not options:
            return
        mechanism = options[0]
        if len(options) > 1:
            ids = [m.mechanism_id for m in options]
            answer = await self._step(
                "choose",
                choose_mechanism_prompt(text, ref.name, options),
                enum_schema("mechanism_id", ids),
                {"product_id": pid, "choose": "mechanism"},
            )
            mechanism = next(
                (m for m in options if m.mechanism_id == answer.get("mechanism_id")),
                options[0],
            )

        for segment in await self._segments(event, text, ref.name, mechanism, metrics):
            self._add(event, pid, ptype, mechanism, segment, product)

    async def _segments(
        self, event: Event, text: str, name: str, m: Mechanism, metrics: dict
    ) -> list[tuple[str, str] | None]:
        """Segments to test: one per affected region (code), or the model's pick, or none."""
        if not m.segment_dim:
            return [None]
        metric = pick_metric(m, metrics) if metrics else None
        values = [
            v
            for v in (
                metrics.get(metric, {}).get("dimensions", {}).get(m.segment_dim, [])
                if metric
                else []
            )
            if v != "other"
        ]
        if m.segment_dim == "region":
            dims = metrics.get(metric, {}).get("dimensions", {}) if metric else {}
            return list(_region_values(dims, event.regions)) or [None]
        if m.segment_dim == "corridor":
            dims = metrics.get(metric, {}).get("dimensions", {}) if metric else {}
            return list(_corridor_values(dims, event.countries)) or [None]
        if not values:
            return [None]
        options = [*values, "none"]
        answer = await self._step(
            "choose",
            choose_segment_prompt(text, name, m, m.segment_dim, options),
            enum_schema("segment", options),
            {"mechanism_id": m.mechanism_id, "choose": m.segment_dim},
        )
        value = answer.get("segment")
        return [(m.segment_dim, value)] if value in values else [None]

    def _add(self, event, pid, ptype, m: Mechanism, segment, product) -> None:
        hid = f"h-{len(self.hypotheses) + 1}"
        task = None
        if (
            product is not None
            and self.req.validation
            and len(self.tasks) < self.limits.max_tasks
        ):
            announced = min(
                (
                    h.published_at
                    for f in self._findings(event)
                    for h in f.evidence.headlines
                ),
                default=None,
            )
            choice = Choice(
                event,
                self.data_source_id,
                pid,
                ptype,
                m,
                segment,
                announced=local_date(announced, self.zone) if announced else None,
                source_product_id=product.get("source_product_id"),
                zone=self.zone,
                scope_note=self._scope_note(event),
            )
            task = build_task(
                f"t-{len(self.tasks) + 1}",
                hid,
                choice,
                product,
                self._cal.get(event.event_id) or Calendar(known=False),
                catalog_version=self.catalog_version,
            )
            if task and (g := metrics_of(product).get(task.metric, {})).get("group_id"):
                # the spec serves this metric for the whole category: measure it there
                task = task.model_copy(
                    update={
                        "product_id": g["group_id"],
                        "source_product_id": None,
                        "scope_note": (task.scope_note + " " if task.scope_note else "")
                        + f"Measured on {g['group_name'].lower()}: the spec serves {task.metric} for the whole category.",
                    }
                )
            if task and self._duplicate(task):
                return  # the same check already exists, from another angle
        metrics = {x["metric"]: x for x in (product or {}).get("metrics", [])}
        metric = (
            task.metric
            if task
            else (pick_metric(m, metrics) if metrics else None) or m.metrics[0]
        )
        if (
            segment is None and m.segment_value
        ):  # a fixed segment (importers), where the metric has it
            dims = (metrics.get(metric) or {}).get("dimensions", {})
            dim = next(
                (d for d, values in dims.items() if m.segment_value in values), None
            )
            segment = (dim, m.segment_value) if dim else None
        if task is None and any(
            (h.product_id, h.expected.metric, h.segment)
            == (
                pid,
                metric,
                SegmentFilter(dimension=segment[0], value=segment[1])
                if segment
                else None,
            )
            for h in self.hypotheses
            if h.event_id == event.event_id
        ):
            return  # the same thing to watch already, from another angle
        statement = (
            f"{phrase(event, self.req.institution.currency)}. Expected: {m.text}"
        )
        if segment:
            statement += f" ({segment[0].replace('_', ' ')}: {segment[1]})"
        self.hypotheses.append(
            Hypothesis(
                hypothesis_id=hid,
                event_id=event.event_id,
                finding_ids=event.finding_ids,
                product_id=pid,
                product_type=ptype,
                angle=m.angle,
                mechanism_id=m.mechanism_id,
                chain_label=m.text[0].upper() + m.text[1:],
                statement=statement + ".",
                segment=SegmentFilter(dimension=segment[0], value=segment[1])
                if segment
                else None,
                expected=Expectation(
                    metric=metric, direction=m.expect, size=m.size, timing=m.timing
                ),
            )
        )
        if task:
            self.tasks.append(task)

    def _duplicate(self, task: ValidationTask) -> bool:
        key = (
            task.product_id,
            task.metric,
            tuple(sorted(task.filter.items())),
            task.watch.from_,
            task.watch.until,
        )
        return any(
            (
                t.product_id,
                t.metric,
                tuple(sorted(t.filter.items())),
                t.watch.from_,
                t.watch.until,
            )
            == key
            for t in self.tasks
        )

    def _scope_note(self, event: Event) -> str | None:
        if event.country != "footprint":
            return None
        return (
            f"The event is in {event.country_code}; the data has no breakdown by booking country, "
            "so the whole book is checked and the effect may be diluted."
        )

    async def prefetch_calendars(self) -> None:
        """Business days around each event's anchor, from the server (best effort)."""
        for event in self.events:
            day = local_date(event.anchor, self.zone)
            try:
                cal = await self.data.calendar(
                    self.req, day - CALENDAR_SPAN, day + CALENDAR_SPAN
                )
            except DataError as e:
                cal = Calendar(known=False)
                self._record(
                    "get_calendar",
                    {"event_id": event.event_id},
                    "error",
                    message=f"{e}; days outside Saturday and Sunday are used",
                )
            self._cal[event.event_id] = cal

    # -------------------------------------------------------------- result

    def result(self, duration_ms: int) -> InvestigationResult:
        model = self.models_used[-1] if self.models_used else "none"
        result = InvestigationResult(
            stop_reason=self.stop_reason,
            tracks_version=TRACKS_VERSION,
            mode="tasks" if self.req.validation else "report_only",
            as_of=self.req.as_of,
            extended_event_id=self.req.extend.event_id if self.req.extend else None,
            untracked_products=self.untracked,
            classifications=self.classifications,
            events=self.events,
            out_of_scope=self.out_of_scope,
            screening=self.screening,
            hypotheses=self.hypotheses,
            tasks=self.tasks,
            context=self.context,
            tool_trace=self.trace,
            usage=Usage(
                model=model,
                model_calls=self.model_calls,
                tool_calls=len(self.trace),
                duration_ms=duration_ms,
            ),
        )
        result.report = build_report(self.req, result, self.catalog, phrase)
        return result


def _region_values(dims: dict, regions: list[str]) -> list[tuple[str, str]]:
    """The metric's region breakdown values the event touches: second level first, else first level."""
    for dim in ("region_l2", "region_l1"):
        hit = [v for v in dims.get(dim, []) if v in regions]
        if hit:
            return [(dim, v) for v in hit]
    return []


def _corridor_values(dims: dict, countries: list[str]) -> list[tuple[str, str]]:
    """The metric's corridor values (the other country of a cross-border flow) the event is in."""
    return [("corridor", c) for c in dims.get("corridor", []) if c in countries]


def metrics_of(product: dict | None) -> dict[str, dict]:
    return {m["metric"]: m for m in (product or {}).get("metrics", [])}
