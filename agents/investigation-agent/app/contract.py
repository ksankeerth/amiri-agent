"""Request and response models for the investigation API. Mirrors openapi.yaml.

The shared Finding, the theme vocabulary and the data read through amiri-server are as
amiri-server defines them. Fixed lists (themes, product types, angles,
methods, verdicts) come from app/vocab.py.
"""

import zoneinfo
from datetime import UTC, date
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from app.vocab import (
    ANGLES,
    ITEMS,
    THEME_DIRECTIONS,
    AnchorBasis,
    BaselineBasis,
    Channel,
    Country,
    CurrencyBasis,
    ExpectedSize,
    InstitutionType,
    Item,
    Method,
    Move,
    OutOfScopeReason,
    Owner,
    Phase,
    ProductType,
    ScreeningDecision,
    Statistic,
    Theme,
    Timing,
    track_type,
)

RunId = Annotated[str, Field(min_length=1, max_length=64)]
Slug = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{1,79}$")]
UtcDatetime = Annotated[AwareDatetime, AfterValidator(lambda d: d.astimezone(UTC))]
ShortText = Annotated[str, Field(min_length=1, max_length=400)]

RunStatusValue = Literal["queued", "running", "completed", "stopped_early", "failed"]
FindingSource = Literal["timeseries", "radar", "monitor"]
FindingKind = Literal["signal_move", "story", "news_match"]
ToolName = Literal[
    "get_coverage",
    "get_calendar",
    "classify_finding",
    "screen",
    "add_hypothesis",
    "finish",
]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ request


class Segment(Model):
    id: str
    label: str
    note: str | None = None


class Flow(Model):
    """A money or trade flow from the profile: where foreign news reaches the institution."""

    kind: str  # remittances_in, remittances_out, exports, imports, ...
    local: str  # place code at home or in the footprint
    counterpart: str  # place code abroad


class FootprintCountry(Model):
    """A country other than home where the institution operates (branches, subsidiaries)."""

    country: str = Field(pattern=r"^[A-Z]{2}$")
    currency: str | None = Field(
        None, pattern=r"^[A-Z]{3}$", description="Its currency, ISO 4217."
    )


class Institution(Model):
    """The institution being investigated for (from the server's profile context)."""

    name: str
    institution_type: InstitutionType
    country: str = Field(pattern=r"^[A-Z]{2}$", description="Home country, ISO 3166-1.")
    country_name: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$", description="Base currency, ISO 4217.")
    time_zone: str = Field(
        description="IANA time zone: local dates and business days are in it."
    )
    footprint: list[FootprintCountry] = Field(
        default_factory=list, description="Countries other than home."
    )
    summary: str
    segments: list[Segment] = Field(default_factory=list)
    rivals: list[str] = Field(default_factory=list)
    regulators: list[str] = Field(default_factory=list)
    flows: list[Flow] = Field(default_factory=list)
    corridors: list[str] = Field(
        default_factory=list, description="Remittance corridor countries."
    )
    notes: str | None = None

    @model_validator(mode="after")
    def _zone(self) -> "Institution":
        try:
            zoneinfo.ZoneInfo(self.time_zone)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError) as e:
            raise ValueError(f"unknown time zone {self.time_zone!r}") from e
        return self

    def zone(self) -> zoneinfo.ZoneInfo:
        return zoneinfo.ZoneInfo(self.time_zone)

    def footprint_countries(self) -> set[str]:
        return {f.country for f in self.footprint}

    def currency_country(self, currency: str) -> str | None:
        """home, a footprint country's code, or None for a currency the institution doesn't book in."""
        if currency == self.currency:
            return "home"
        return next((f.country for f in self.footprint if f.currency == currency), None)


class SignalRecord(Model):
    """A market move a finding cites, as the server's series detector wrote it."""

    series_id: str
    symbol: str
    interval: str = "1h"
    direction: Literal["up", "down"]
    start_at: UtcDatetime
    end_at: UtcDatetime
    ref_level: float
    obs_level: float
    change_pct: float
    z: float | None = None
    typical_daily_move_pct: float | None = None
    window_days: int | None = None
    description: str


class Headline(Model):
    title: str
    published_at: UtcDatetime
    outlet: str | None = None
    url: str | None = None


class WebPage(Model):
    url: str = Field(pattern=r"^https?://")
    title: str | None = None


class FindingEvidence(Model):
    signals: list[SignalRecord] = Field(default_factory=list)
    headlines: list[Headline] = Field(default_factory=list)
    web: list[WebPage] = Field(default_factory=list)


class Period(Model):
    start: date
    end: date

    @model_validator(mode="after")
    def _ordered(self) -> "Period":
        if self.end < self.start:
            raise ValueError("period.end must not be before period.start")
        return self


class Finding(Model):
    """One finding from any source: a market series move, a Radar
    story or a monitor's news match. When the source set `themes`, the agent uses them
    and doesn't classify the finding."""

    finding_id: Slug
    institution_id: str | None = None
    source: FindingSource
    source_ref: dict[str, Any] = Field(default_factory=dict)
    kind: FindingKind
    title: str
    explanation: str
    score: float = Field(ge=0, le=100)
    themes: list["ThemeTag"] = Field(default_factory=list, max_length=4)
    places: list[str] = Field(
        default_factory=list, description="Place codes (ISO 3166 or gazetteer)."
    )
    evidence: FindingEvidence
    effective_from: date | None = None
    period: Period | None = None
    created_at: UtcDatetime | None = None

    @model_validator(mode="after")
    def _has_evidence(self) -> "Finding":
        e = self.evidence
        if not (e.signals or e.headlines or e.web):
            raise ValueError(f"finding {self.finding_id} has no evidence")
        if any(t.implied for t in self.themes):
            raise ValueError(
                f"finding {self.finding_id}: implied themes are added by the agent, not sent"
            )
        return self


class Product(Model):
    """A product from the institution's profile, in Metrics Spec terms."""

    product_id: Slug
    name: str
    category: str
    product_type: str | None = None
    countries: list[str] = Field(
        default_factory=list,
        description="Where it is booked (ISO 3166-1); empty: home and every footprint country.",
    )


class PlaceInfo(Model):
    """What the server's gazetteer knows about a place code."""

    country: str = Field(pattern=r"^[A-Z]{2}$")
    region_l1: str | None = None  # ISO 3166-2 first level
    region_l2: str | None = None


class Extend(Model):
    """A development brought new themes to an open event: build hypotheses for these only."""

    event_id: Slug
    themes: list["ThemeTag"] = Field(min_length=1, max_length=4)


class Limits(Model):
    max_model_calls: int = Field(default=80, ge=5, le=200)
    max_tasks: int = Field(default=15, ge=1, le=50)
    max_types_per_event: int = Field(default=8, ge=1, le=13)
    max_angles_per_type: int = Field(default=2, ge=1, le=5)
    timeout_seconds: int = Field(default=600, ge=30, le=1800)


class InvestigationRequest(Model):
    run_id: RunId
    institution_id: str = Field(min_length=1, max_length=64)
    server_url: str = Field(
        pattern=r"^https?://",
        description="amiri-server: coverage and calendar (/api/v1/internal/…).",
    )
    institution: Institution
    products: list[Product] = Field(min_length=1)
    findings: list[Finding] = Field(min_length=1, max_length=20)
    place_info: dict[str, PlaceInfo] = Field(
        default_factory=dict,
        description="Country and regions of place codes in the findings (city:jaffna -> LK, LK-4, LK-41).",
    )
    # Which tracks to use; None means the agent's built-in tracks. Part of the
    # request, so the same run_id with different tracks is a different request.
    tracks_version: str | None = None
    as_of: UtcDatetime | None = Field(
        None,
        description="The run's now (a sandbox's virtual time); default the real time.",
    )
    validation: bool = Field(
        True,
        description="Metrics validation is on: build validation tasks. Off: stop at hypotheses and the report.",
    )
    extend: Extend | None = Field(
        None, description="Add to an open event: its id, and the new themes only."
    )
    limits: Limits = Field(default_factory=Limits)

    @model_validator(mode="after")
    def _references_resolve(self) -> "InvestigationRequest":
        def dupes(ids: list[str]) -> list[str]:
            return sorted({i for i in ids if ids.count(i) > 1})

        if d := dupes([f.finding_id for f in self.findings]):
            raise ValueError(f"finding_id listed more than once: {', '.join(d)}")
        if d := dupes([p.product_id for p in self.products]):
            raise ValueError(f"product_id listed more than once: {', '.join(d)}")
        return self

    def tracked(self) -> dict[str, tuple[Product, str]]:
        """product_id -> (product, the tracks' product type) for products the tracks cover."""
        out = {}
        for p in self.products:
            t = track_type(
                self.institution.institution_type, p.category, p.product_type
            )
            if t:
                out[p.product_id] = (p, t)
        return out


# ----------------------------------------------------------------- response


class ThemeTag(Model):
    theme: Theme
    direction: str
    item: Item | None = None  # prices and commodities only
    sector: str | None = None  # sector only
    currency: str | None = Field(
        None, pattern=r"^[A-Z]{3}$"
    )  # fx only: the currency that moved (default: base)
    implied: bool = False  # added by code from another theme, not chosen

    @model_validator(mode="after")
    def _valid_pairing(self) -> "ThemeTag":
        if self.direction not in THEME_DIRECTIONS[self.theme]:
            raise ValueError(
                f"{self.theme} direction must be one of {THEME_DIRECTIONS[self.theme]}"
            )
        if self.item is not None and self.item not in ITEMS.get(self.theme, ()):
            raise ValueError(f"item {self.item} is not one of {self.theme}'s items")
        if self.sector is not None and self.theme != "sector":
            raise ValueError("sector is only for the sector theme")
        if self.currency is not None and self.theme != "fx":
            raise ValueError("currency is only for the fx theme")
        return self


class Size(Model):
    """How big the driver was, read by code from the evidence."""

    value: float
    unit: Literal["pct", "bp"]


class Classification(Model):
    finding_id: Slug
    themes: list[ThemeTag] = Field(max_length=4)
    country: Country
    channel: Channel = "none"


class Event(Model):
    """Findings about the same move, grouped and netted by code."""

    event_id: Slug
    title: str = ""  # the event in words, by code ("The LKR weakened (1.45%)")
    finding_ids: list[Slug] = Field(min_length=1)
    themes: list[ThemeTag] = Field(min_length=1)
    country: Country
    anchor: UtcDatetime
    anchor_basis: AnchorBasis
    size: Size | None = None
    typical_daily_move_pct: float | None = (
        None  # of the series behind it, when a series moved
    )
    country_code: str | None = None  # the footprint country, when country is footprint
    places: list[str] = Field(default_factory=list)
    regions: list[str] = Field(
        default_factory=list
    )  # ISO 3166-2 codes, from places and place_info
    countries: list[str] = Field(default_factory=list)  # ISO 3166-1 codes of the places


class OutOfScope(Model):
    finding_id: Slug
    reason: OutOfScopeReason
    event_id: Slug | None = None  # for merged_into_event
    note: ShortText | None = None


class Screening(Model):
    event_id: Slug
    product_type: ProductType
    angle: str
    decision: ScreeningDecision
    product_ids: list[Slug] = Field(default_factory=list)  # products kept
    mechanism_ids: list[str] = Field(default_factory=list)  # mechanisms listed by code
    reason: ShortText

    @model_validator(mode="after")
    def _angle_of_type(self) -> "Screening":
        if self.angle not in ANGLES[self.product_type]:
            raise ValueError(f"{self.angle} is not an angle of {self.product_type}")
        if self.decision == "kept" and not self.product_ids:
            raise ValueError("a kept screening names its products")
        return self


class SegmentFilter(Model):
    dimension: str
    value: str


class Expectation(Model):
    metric: str
    direction: Move
    size: ExpectedSize
    timing: Timing


class Hypothesis(Model):
    hypothesis_id: Slug
    event_id: Slug
    finding_ids: list[Slug] = Field(min_length=1)
    product_id: Slug
    product_type: ProductType
    angle: str
    mechanism_id: str
    chain_label: (
        str  # the mechanism's effect, for the impact chain (code, not model text)
    )
    statement: str  # built by code from the mechanism; the model chooses, not writes
    segment: SegmentFilter | None = None
    expected: Expectation


class BusinessDates(Model):
    """Local business dates (the institution's time zone and calendar): `from` inclusive, `until` exclusive."""

    from_: date = Field(alias="from")
    until: date

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _ordered(self) -> "BusinessDates":
        if self.until <= self.from_:
            raise ValueError("until must be after from")
        return self


class Baseline(BusinessDates):
    basis: BaselineBasis


class Threshold(Model):
    statistic: Statistic
    op: Literal[">=", "<="]
    value: float


class MaskRule(Model):
    """Mask this task's verdict if `metric` rises more than `rise_pp` above its baseline."""

    metric: str
    rise_pp: float = Field(gt=0)


class Amount(Model):
    value: float
    unit: str


class ValidationTask(Model):
    task_id: Slug
    hypothesis_id: Slug
    event_id: Slug
    finding_ids: list[Slug] = Field(min_length=1)
    # what to measure
    data_source_id: str
    product_id: Slug  # the profile's product
    source_product_id: str | None = (
        None  # the same product in the data source's catalog
    )
    metric: str
    unit: str
    currency: str | None = None
    aggregation: str
    filter: dict[str, str] = Field(default_factory=dict)
    # when
    date_basis: Literal["local_business_date"] = "local_business_date"
    time_zone: str
    calendar_id: str | None = (
        None  # the data source's calendar the business days came from
    )
    anchor: UtcDatetime
    announced_at: date | None = None  # dated rules: when the rule was announced
    watch: BusinessDates
    baseline: Baseline
    reporting_lag_days: int = Field(ge=0)
    # how to judge (one verdict per task)
    method: Method
    thresholds: list[Threshold] = Field(min_length=1)  # all must hold
    threshold_set_id: str | None = None  # <metric>.<size> in the catalog
    expected_direction: Move
    adverse_direction: Move
    expected_size: ExpectedSize
    min_volume: int | None = None
    # validation rules
    phase: Phase = "effect"
    currency_basis: CurrencyBasis = "original"
    vintage_rule: Literal["same_age"] = "same_age"
    segment_frozen_at: date | None = None
    masking: list[MaskRule] = Field(default_factory=list)
    dominance_limit: float = Field(default=0.5, gt=0, le=1)
    catalog_version: str | None = None
    # for the banker
    owner: Owner
    book_size: Amount | None = None
    scope_note: ShortText | None = (
        None  # e.g. the event is abroad and the data can't isolate that book
    )

    @model_validator(mode="after")
    def _baseline_before_watch(self) -> "ValidationTask":
        if self.baseline.until > self.watch.from_:
            raise ValueError("the baseline must end before the watch window starts")
        return self


class ContextItem(Model):
    """A number to report with an event, with no verdict (exposure shares, structural angles)."""

    context_id: Slug
    event_id: Slug
    data_source_id: str
    product_id: Slug
    angle: str
    metric: str
    filter: dict[str, str] = Field(default_factory=dict)
    as_of: date
    why: ShortText


class ToolCall(Model):
    step: int = Field(ge=1)
    tool: ToolName
    args: dict[str, Any]
    status: Literal["ok", "blocked", "error"]
    message: str | None = None
    result: Any = None


class Usage(Model):
    model: str
    model_calls: int = Field(ge=0)
    tool_calls: int = Field(ge=0)
    duration_ms: int = Field(ge=0)


class Untracked(Model):
    """A product the tracks don't cover (trade finance, remittances, payments...): never screened."""

    product_id: Slug
    product_type: str | None
    reason: ShortText


class InvestigationResult(Model):
    stop_reason: Literal["finished", "call_limit", "timeout"]
    tracks_version: str
    mode: Literal["tasks", "report_only"] = (
        "tasks"  # report_only: metrics validation is off, no tasks
    )
    as_of: UtcDatetime | None = (
        None  # the request's as_of (a sandbox's time), when given
    )
    extended_event_id: str | None = None  # the open event this run added to (extend)
    report: str = ""  # the investigation for people (markdown, built by code)
    untracked_products: list[Untracked] = Field(default_factory=list)
    classifications: list[Classification]
    events: list[Event]
    out_of_scope: list[OutOfScope]
    screening: list[Screening]
    hypotheses: list[Hypothesis]
    tasks: list[ValidationTask]
    context: list[ContextItem]
    tool_trace: list[ToolCall]
    usage: Usage

    @model_validator(mode="after")
    def _references_resolve(self) -> "InvestigationResult":
        events = {e.event_id for e in self.events}
        hypotheses = {h.hypothesis_id for h in self.hypotheses}
        for h in self.hypotheses:
            if h.event_id not in events:
                raise ValueError(
                    f"hypothesis {h.hypothesis_id}: unknown event {h.event_id}"
                )
        for t in self.tasks:
            if t.hypothesis_id not in hypotheses:
                raise ValueError(
                    f"task {t.task_id}: unknown hypothesis {t.hypothesis_id}"
                )
            if t.event_id not in events:
                raise ValueError(f"task {t.task_id}: unknown event {t.event_id}")
        return self


class InvestigationStatus(Model):
    run_id: RunId
    status: RunStatusValue
    created_at: UtcDatetime
    started_at: UtcDatetime | None = None
    finished_at: UtcDatetime | None = None
    result: InvestigationResult | None = None
    error: str | None = None

    @model_validator(mode="after")
    def _fields_match_status(self) -> "InvestigationStatus":
        s = self.status
        if s in ("queued", "running"):
            if self.result is not None or self.error is not None or self.finished_at:
                raise ValueError(f"a {s} run has no result, error or finished_at")
        elif s in ("completed", "stopped_early"):
            if (
                self.result is None
                or self.started_at is None
                or self.finished_at is None
            ):
                raise ValueError(f"a {s} run needs result, started_at and finished_at")
            if self.error is not None:
                raise ValueError(f"a {s} run has no error")
        elif s == "failed":
            if self.error is None or self.finished_at is None:
                raise ValueError("a failed run needs error and finished_at")
            if self.result is not None:
                raise ValueError("a failed run has no result")
        return self


class Error(Model):
    error: str
    run_id: str | None = None


Finding.model_rebuild()
Extend.model_rebuild()
