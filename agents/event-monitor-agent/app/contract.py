"""Request and response models for the check API (contract 2.0). Mirrors openapi.yaml.

A check reads the news by web
search (Gemini with Google Search grounding) within its window, or, in a simulation, the
headlines it is given; it reports news_match findings, each meeting at least one of the
monitor's "tell me if" lines. Code reads each cited page's own publication time and title.
"""

import re
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

RunId = Annotated[str, Field(min_length=1, max_length=64)]
UtcDatetime = Annotated[AwareDatetime, AfterValidator(lambda d: d.astimezone(UTC))]
PlaceCode = Annotated[
    str, Field(pattern=r"^([A-Z]{2}(-[A-Z0-9]{1,3})?|[a-z]+:[a-z0-9_-]+)$")
]

RunStatusValue = Literal["queued", "running", "completed", "stopped_early", "failed"]
ToolName = Literal["web_search", "list_provided_news", "finish"]
EXPOSURE_KINDS = (
    "product",
    "segment",
    "flow",
    "rival",
    "regulator",
    "counterparty",
    "risk",
)


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------ request


class KeyDate(Model):
    date: date
    label: str
    lead_days: Literal[1, 3, 7]


class SpecAbout(Model):
    name: str
    owner: str
    also_notify: list[str] = Field(default_factory=list)
    check_frequency: Literal[15, 60, 360, 1440]
    kind: Literal["events", "trend"] = "events"
    key_dates: list[KeyDate] = Field(default_factory=list)
    review_by: date | None = None


class WatchChip(Model):
    name: str
    type: Literal[
        "organisation", "place", "region", "person", "sector", "regulation", "topic"
    ]
    other_forms: list[str] = Field(default_factory=list)
    not_confused_with: list[str] = Field(default_factory=list)


class ExampleMatch(Model):
    headline: str
    line: int = Field(ge=1)


class ExampleHeadlines(Model):
    match: list[ExampleMatch] = Field(default_factory=list)
    not_match: list[str] = Field(default_factory=list)


class Sources(Model):
    mode: Literal["any_reputable", "trusted_only"] = "any_reputable"
    check_first: list[str] = Field(default_factory=list)


class SpecPublic(Model):
    watch: list[WatchChip] = Field(min_length=1)
    in_one_sentence: str
    tell_me_if: list[str] = Field(min_length=1)
    ignore: list[str] = Field(default_factory=list)
    example_headlines: ExampleHeadlines = Field(default_factory=ExampleHeadlines)
    places: list[PlaceCode] = Field(
        default_factory=list,
        description="Where it matters: ISO 3166 or gazetteer codes.",
    )
    languages: list[Annotated[str, Field(pattern=r"^[a-z]{2}$")]] = Field(
        default_factory=lambda: ["en"],
        min_length=1,
        description="ISO 639-1 codes of the news to read.",
    )
    sources: Sources = Field(default_factory=Sources)


class ExposureChoice(Model):
    id: str = Field(pattern=rf"^({'|'.join(EXPOSURE_KINDS)}):.+$")
    how_it_reaches_us: str = ""


class SpecPrivate(Model):
    exposure: list[ExposureChoice] = Field(default_factory=list)
    serious: list[str] = Field(default_factory=list)
    notes: str = ""


class MonitorSpec(Model):
    about: SpecAbout
    public: SpecPublic
    private: SpecPrivate = Field(default_factory=SpecPrivate)
    alert_level: int = Field(ge=0, le=10)

    @model_validator(mode="after")
    def _example_lines_exist(self) -> "MonitorSpec":
        n = len(self.public.tell_me_if)
        for m in self.public.example_headlines.match:
            if m.line > n:
                raise ValueError(
                    f"example headline refers to tell_me_if line {m.line}, but there are only {n}"
                )
        return self


class Monitor(Model):
    monitor_id: str = Field(max_length=64)
    version: int = Field(ge=1)
    spec: MonitorSpec


class Named(Model):
    """A profile item the monitor can name as an exposure."""

    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)


class Segment(Model):
    id: str
    label: str
    note: str | None = None


class Product(Model):
    id: str
    name: str
    category: str
    product_type: str | None = None


class Flow(Model):
    id: str
    kind: str
    local: str
    counterpart: str


class Institution(Model):
    """The institution, from its profile (the same context the investigation gets)."""

    name: str
    institution_type: Literal["bank", "insurer"]
    country: str = Field(pattern=r"^[A-Z]{2}$")
    country_name: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    time_zone: str = "UTC"
    summary: str = ""
    segments: list[Segment] = Field(default_factory=list)
    products: list[Product] = Field(default_factory=list)
    flows: list[Flow] = Field(default_factory=list)
    corridors: list[str] = Field(default_factory=list)
    rivals: list[Named] = Field(default_factory=list)
    regulators: list[Named] = Field(default_factory=list)
    counterparties: list[Named] = Field(default_factory=list)
    risks: list[Named] = Field(default_factory=list)
    notes: str | None = None

    def exposure_ids(self) -> set[str]:
        return (
            {f"product:{p.id}" for p in self.products}
            | {f"segment:{s.id}" for s in self.segments}
            | {f"flow:{f.id}" for f in self.flows}
            | {f"rival:{r.id}" for r in self.rivals}
            | {f"regulator:{r.id}" for r in self.regulators}
            | {f"counterparty:{c.id}" for c in self.counterparties}
            | {f"risk:{r.id}" for r in self.risks}
        )


class Window(Model):
    since: UtcDatetime
    until: UtcDatetime

    @model_validator(mode="after")
    def _since_before_until(self) -> "Window":
        if self.until <= self.since:
            raise ValueError("window.until must be after window.since")
        return self


class WebSearchScope(Model):
    max_queries: int = Field(default=3, ge=1, le=10)


class ProvidedNews(Model):
    """A headline given to the check (a simulation): read instead of searching the web."""

    id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,64}$")
    title: str
    published_at: UtcDatetime
    outlet: str | None = None
    url: str | None = None
    body: str | None = None


class Limits(Model):
    max_steps: int = Field(default=15, ge=1, le=20)
    timeout_seconds: int = Field(default=300, ge=10, le=600)


class CheckRequest(Model):
    run_id: RunId
    monitor: Monitor
    institution: Institution
    window: Window = Field(
        description="News published in this window is new for this check."
    )
    web_search: WebSearchScope | None = Field(
        None, description="Required unless provided_news is given."
    )
    provided_news: list[ProvidedNews] | None = Field(
        None,
        description="A simulation's headlines: the check reads these and searches nothing.",
    )
    recent_urls: list[str] = Field(
        default_factory=list, description="Pages this monitor already reported."
    )
    limits: Limits | None = None

    @model_validator(mode="after")
    def _references_resolve(self) -> "CheckRequest":
        if self.provided_news is None and self.web_search is None:
            raise ValueError(
                "a check needs web_search, or provided_news (a simulation)"
            )
        if self.provided_news is not None and self.web_search is not None:
            raise ValueError(
                "a simulation's check reads provided_news only; leave web_search out"
            )
        ids = [n.id for n in self.provided_news or []]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(
                f"provided_news id listed more than once: {', '.join(dupes)}"
            )
        known = self.institution.exposure_ids()
        unknown = [
            e.id for e in self.monitor.spec.private.exposure if e.id not in known
        ]
        if unknown:
            raise ValueError(
                f"spec.private.exposure ids not found in the institution profile: {', '.join(unknown)}"
            )
        return self


# ----------------------------------------------------------------- response


class WebRef(Model):
    url: str = Field(pattern=r"^https?://")
    title: str | None = None


class NewsRef(Model):
    item_id: str


class Evidence(Model):
    web: list[WebRef] = Field(default_factory=list)
    news: list[NewsRef] = Field(default_factory=list)  # provided_news (a simulation)


class Finding(Model):
    kind: Literal["news_match"] = "news_match"
    title: str
    explanation: str
    tell_me_if_lines: list[Annotated[int, Field(ge=1)]]
    evidence: Evidence
    places: list[PlaceCode] = Field(
        default_factory=list, description="From the monitor's places only."
    )
    key_date: date | None = Field(
        None, description="One of the monitor's key dates, when the news is about it."
    )


class Source(Model):
    """A cited page or headline as code read it: what the server stores as evidence."""

    ref: str  # the url, or the provided item id
    url: str | None = None
    title: str
    outlet: str | None = None
    published_at: UtcDatetime | None = None


class Coverage(Model):
    web_queries: int = Field(ge=0)
    web_failed: int = Field(0, ge=0, description="Searches that failed (quota, outage); none of them was read.")
    pages_seen: int = Field(ge=0)
    pages_dated: int = Field(ge=0)
    pages_in_window: int = Field(ge=0)
    already_reported: int = Field(ge=0)
    provided_news: int = Field(ge=0)


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


class CheckResult(Model):
    stop_reason: Literal["finished", "step_limit", "timeout"]
    summary: str
    findings: list[Finding]
    sources: list[Source] = Field(
        default_factory=list, description="Every page or headline the findings cite."
    )
    coverage: Coverage
    tool_trace: list[ToolCall]
    usage: Usage


class CheckStatus(Model):
    run_id: RunId
    monitor_id: str
    monitor_version: int
    status: RunStatusValue
    created_at: UtcDatetime
    started_at: UtcDatetime | None = None
    finished_at: UtcDatetime | None = None
    result: CheckResult | None = None
    error: str | None = None

    @model_validator(mode="after")
    def _fields_match_status(self) -> "CheckStatus":
        s = self.status
        if s in ("queued", "running"):
            if (
                self.result is not None
                or self.error is not None
                or self.finished_at is not None
            ):
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


def domain(url: str) -> str | None:
    m = re.match(r"^https?://(?:www\.)?([^/:]+)", url or "")
    return m.group(1).lower() if m else None
