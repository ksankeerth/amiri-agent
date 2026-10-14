"""The contract between amiri-server and the Radar agent (agents/radar-agent), version 2.0.

The single source: the server validates every answer against these models, the fake agent
(app/radar/fake_agent.py) implements them, and `uv run amiri radar-contract` writes
contracts/radar-agent-openapi.yaml for whoever builds the agent.

    POST /radar-runs            RadarRunRequest -> 202 RadarRunStatus (the same run_id and body: 200, the run)
    GET  /radar-runs/{run_id}   -> RadarRunStatus (result when completed or stopped_early)
    GET  /health                {"status": "ok"}

A run reads GDELT in BigQuery for the window (code builds a few queries from the institution's
context, each capped by limits.max_bytes_per_query, at most limits.max_queries), groups articles
into stories, scores each in code (footprint match x corroboration x freshness x relevance
weight), and decides which to send for investigation (`send`, with `why`). With `provided_news`
(a simulation) it reads only those headlines: no BigQuery, no web search.
"""

from datetime import date
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

CONTRACT_VERSION = "2.0"
Code = Annotated[str, Field(pattern=r"^([A-Z]{2}(-[A-Z0-9]{1,3})?|[a-z]+:[a-z0-9_-]+)$")]
Fingerprint = Annotated[str, Field(min_length=4, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- server -> agent


class Named(Model):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)


class Institution(Model):
    """The institution, profile-shaped (the monitor agent gets the same)."""

    name: str
    institution_type: Literal["bank", "insurer"]
    country: str = Field(pattern=r"^[A-Z]{2}$")
    country_name: str | None = None
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    time_zone: str = "UTC"
    summary: str = ""
    segments: list[dict[str, Any]] = Field(default_factory=list)
    products: list[dict[str, Any]] = Field(default_factory=list)
    flows: list[dict[str, Any]] = Field(default_factory=list)
    corridors: list[str] = Field(default_factory=list)
    rivals: list[Named] = Field(default_factory=list)
    regulators: list[Named] = Field(default_factory=list)
    counterparties: list[Named] = Field(default_factory=list)
    risks: list[Named] = Field(default_factory=list)


class Scope(Model):
    """What Radar watches, computed by code from the profile (the institution context's radar_scope)."""

    places: list[Code] = Field(min_length=1)
    places_why: dict[str, list[str]] = Field(default_factory=dict, description="Why each place is in the scope.")
    themes: list[str] = Field(default_factory=list, description="Theme ids (GET /api/v1/reference/themes).")
    actors: list[str] = Field(default_factory=list, description="Regulators, rivals, counterparties by name.")


class Window(Model):
    since: AwareDatetime
    until: AwareDatetime

    @model_validator(mode="after")
    def _ordered(self) -> "Window":
        if self.until <= self.since:
            raise ValueError("window.until must be after window.since")
        return self


class ProvidedNews(Model):
    id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,64}$")
    title: str
    published_at: AwareDatetime
    outlet: str | None = None
    url: str | None = None
    body: str | None = None
    places: list[Code] = Field(default_factory=list)


class Limits(Model):
    max_stories: int = Field(10, ge=1, le=30)
    max_model_calls: int = Field(40, ge=1, le=200)
    timeout_seconds: int = Field(300, ge=30, le=900)
    max_queries: int = Field(3, ge=1, le=10, description="BigQuery queries per run, at most.")
    max_bytes_per_query: int = Field(2_000_000_000, ge=10_000_000,
                                     description="BigQuery maximum_bytes_billed for each query.")


class RadarRunRequest(Model):
    run_id: str = Field(min_length=1, max_length=64)
    institution: Institution
    scope: Scope
    window: Window
    seen: list[Fingerprint] = Field(default_factory=list, description="Stories already reported (for development_of).")
    provided_news: list[ProvidedNews] | None = Field(None, description="A simulation: read these only.")
    limits: Limits = Field(default_factory=Limits)


# ---------------------------------------------------------------- agent -> server


class Theme(Model):
    theme: str
    direction: str
    item: str | None = None
    currency: str | None = None


class Headline(Model):
    title: str
    url: str | None = None
    outlet: str | None = None
    published_at: AwareDatetime


class Story(Model):
    fingerprint: Fingerprint = Field(description="Stable for the same story across runs.")
    title: str = Field(min_length=1, max_length=300, description="One line, English.")
    summary: str = Field(min_length=1, max_length=1200, description="From the headlines only.")
    places: list[Code] = Field(default_factory=list, description="From the scope's places (or their parents).")
    themes: list[Theme] = Field(default_factory=list, description="Only when the agent is sure.")
    relevance: Literal["high", "medium", "low"]
    score: int = Field(ge=0, le=100, description="Code: footprint match x corroboration x freshness x relevance weight.")
    publishers: int = Field(ge=1, description="Distinct outlets.")
    headlines: list[Headline] = Field(min_length=1, description="The evidence.")
    development_of: Fingerprint | None = Field(None, description="Continues a story in the request's `seen`.")
    send: bool = Field(description="Investigate it: the agent's call, from the institution's context.")
    why: str = Field(min_length=1, max_length=300, description="One line: why it matters (or not) to this institution.")
    key_date: date | None = None


class Query(Model):
    name: str
    purpose: str = ""
    bytes_processed: int = Field(ge=0)
    rows: int = Field(ge=0)
    cached: bool = False


class Usage(Model):
    model: str
    model_calls: int = Field(ge=0)
    input_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)
    duration_ms: int = Field(ge=0)


class RadarRunResult(Model):
    stories: list[Story]
    queries: list[Query] = Field(default_factory=list)
    bytes_processed: int = Field(0, ge=0, description="The run's BigQuery total; the server's daily cap adds these up.")
    considered: int = Field(ge=0, description="Articles read.")
    shortlisted: int = Field(ge=0, description="Stories scored before the cut to max_stories.")
    stop_reason: Literal["finished", "call_limit", "timeout"]
    usage: Usage


class RadarRunStatus(Model):
    run_id: str
    status: Literal["queued", "running", "completed", "stopped_early", "failed"]
    created_at: AwareDatetime
    started_at: AwareDatetime | None = None
    finished_at: AwareDatetime | None = None
    result: RadarRunResult | None = None
    error: str | None = None

    @model_validator(mode="after")
    def _fields_match_status(self) -> "RadarRunStatus":
        if self.status in ("completed", "stopped_early") and self.result is None:
            raise ValueError(f"a {self.status} run needs its result")
        if self.status == "failed" and not self.error:
            raise ValueError("a failed run needs an error")
        return self

