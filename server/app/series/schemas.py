"""Request and response shapes of the market-series API."""

import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app import reference

SERIES_ID = r"^[a-z0-9][a-z0-9_]{1,39}$"
PLACE = r"^[A-Z]{2}(-[A-Z0-9]{1,3})?$"


def _check_places(v: list[str] | None) -> list[str] | None:
    if v is None:
        return v
    bad = [p for p in v if not re.match(PLACE, p)]
    if bad:
        raise ValueError(f"not ISO 3166 codes: {', '.join(bad)}")
    return list(dict.fromkeys(v))


class Theme(BaseModel):
    """What a move means, in the theme vocabulary (GET /api/v1/reference/themes)."""

    model_config = ConfigDict(extra="forbid")
    theme: str = Field(min_length=1, max_length=40, examples=["fx"])
    direction_up: str = Field(min_length=1, max_length=40, examples=["weaker"])
    direction_down: str = Field(min_length=1, max_length=40, examples=["stronger"])
    item: str | None = Field(None, max_length=40, examples=["gold"], description="prices and commodities only")
    currency: str | None = Field(None, pattern=r"^[A-Z]{3}$", examples=["LKR"],
                                 description="fx only: the currency whose move it is (ISO 4217)")

    @model_validator(mode="after")
    def _in_vocabulary(self) -> "Theme":
        for d in (self.direction_up, self.direction_down):
            if why := reference.theme_problem(self.theme, d, self.item, self.currency):
                raise ValueError(why)
        return self


class DetectorIn(BaseModel):
    """Any subset; the rest keep their current values (or the defaults)."""

    model_config = ConfigDict(extra="forbid")
    z_threshold: float | None = Field(None, ge=1, le=10)
    sigma_days: int | None = Field(None, ge=20, le=250)
    windows_days: list[int] | None = Field(None, min_length=1, max_length=4)
    cooldown_hours: int | None = Field(None, ge=0, le=168)
    stale_after_hours: int | None = Field(None, ge=1, le=168)

    @field_validator("windows_days")
    @classmethod
    def _windows(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return v
        if any(x < 1 or x > 20 for x in v):
            raise ValueError("each window is 1 to 20 trading days")
        return sorted(set(v))


class Detector(BaseModel):
    z_threshold: float
    sigma_days: int
    windows_days: list[int]
    cooldown_hours: int
    stale_after_hours: int


class SeriesCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(min_length=1, max_length=40, examples=["USD/LKR"])
    series_id: str | None = Field(None, pattern=SERIES_ID, description="Default: from the symbol (usd_lkr).")
    name: str | None = Field(None, min_length=1, max_length=60, description="Default: the symbol.")
    theme: Theme | None = Field(None, description="Default: set from the symbol (an FX pair: the currency that "
                                                  "moved; gold, oil); null for none.")
    places: list[str] = Field(default_factory=list, max_length=20, description="ISO 3166-1/-2 codes.")
    detector: DetectorIn | None = None

    _places = field_validator("places")(_check_places)


class SeriesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=60)
    theme: Theme | None = None
    places: list[str] | None = Field(None, max_length=20)
    detector: DetectorIn | None = None
    enabled: bool | None = None

    _places = field_validator("places")(_check_places)


SeriesState = Literal["pending", "warming_up", "normal", "moved", "stale", "paused"]
FetchStatus = Literal["ok", "no_new_data", "error"]


class Window(BaseModel):
    days: int
    bars: int
    ref_ts: datetime
    ref_close: float
    change_pct: float
    z: float | None


class Latest(BaseModel):
    bar_ts: datetime
    bar_end: datetime
    close: float
    change_1d_pct: float | None
    typical_daily_move_pct: float | None
    windows: list[Window]
    max_z: float | None
    max_z_days: int | None


class SparkPoint(BaseModel):
    date: date
    close: float


class FetchError(BaseModel):
    code: str
    message: str
    http_status: int | None = None
    at: datetime


class FetchState(BaseModel):
    last_at: datetime | None
    last_status: FetchStatus | None
    last_error: FetchError | None
    in_progress: bool
    next_scheduled_at: datetime | None
    refresh_available_at: datetime | None = Field(description="Null: refresh now.")


class LastFinding(BaseModel):
    finding_id: str
    at: datetime
    title: str


class Instrument(BaseModel):
    type: str | None = None
    exchange: str | None = None
    currency_base: str | None = None
    currency_quote: str | None = None
    currency: str | None = None
    exchange_timezone: str | None = None


class SeriesView(BaseModel):
    series_id: str
    symbol: str
    name: str
    provider: str
    interval: str
    instrument: Instrument
    theme: Theme | None
    places: list[str]
    detector: Detector
    enabled: bool
    state: SeriesState
    state_reason: str
    latest: Latest | None
    spark: list[SparkPoint]
    fetch: FetchState
    last_finding: LastFinding | None
    version: int
    created_at: datetime
    updated_at: datetime


class SeriesList(BaseModel):
    items: list[SeriesView]


class FetchOutcome(BaseModel):
    status: FetchStatus
    trigger: Literal["scheduled", "manual", "backfill"]
    bars_received: int
    bars_new: int
    latest_bar_ts: datetime | None
    finding_id: str | None


class RefreshResult(BaseModel):
    series: SeriesView
    fetch: FetchOutcome


class BarOut(BaseModel):
    ts: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None
    bars: int | None = Field(None, description="1d only: hourly bars in the day.")


class BarsPage(BaseModel):
    series_id: str
    interval: Literal["1h", "1d"]
    from_: datetime = Field(alias="from")
    until: datetime
    items: list[BarOut]
    model_config = ConfigDict(populate_by_name=True)


class ProviderCall(BaseModel):
    call_id: int
    at: datetime
    finished_at: datetime | None
    trigger: str
    status: str
    credits: int
    http_status: int | None
    error_code: str | None
    error_message: str | None
    bars_received: int | None
    bars_new: int | None
    duration_ms: int | None


class ProviderCallList(BaseModel):
    items: list[ProviderCall]


class FindingView(BaseModel):
    finding_id: str
    world: str = Field(description="live, or sandbox for a simulated move")
    source: str
    kind: str
    title: str
    explanation: str
    score: int
    themes: list[dict]
    places: list[str]
    effective_from: date | None
    period: dict | None
    evidence: dict
    status: str = Field(description="new, grouped (being investigated), linked (in an event) or set_aside")
    run_id: str | None = None
    outcome: dict | None = Field(None, description="{event_id}, or {reason, note} when set aside")
    created_at: datetime


class FindingList(BaseModel):
    items: list[FindingView]


class LookupItem(BaseModel):
    symbol: str
    name: str | None
    type: str | None
    exchange: str | None
    country: str | None
    currency: str | None
    plan: str | None = Field(None, description="Twelve Data plan needed, when it says.")
    watched: bool


class LookupResult(BaseModel):
    query: str
    items: list[LookupItem]
    cached: bool


class Credits(BaseModel):
    per_minute: int
    used_last_minute: int
    per_day: int
    used_today: int
    day_resets_at: datetime


class SeriesStatus(BaseModel):
    prototype: bool
    notes: list[str]
    limits: dict
    schedule: dict
    refresh: dict
    provider: dict
    detector_defaults: Detector


class SimulateIn(BaseModel):
    """A test move: one made-up hourly bar after the latest real one, change_pct away from its close."""

    model_config = ConfigDict(extra="forbid")
    change_pct: float = Field(ge=-50, le=50, examples=[2.5], description="The move, in percent of the latest close.")

    @field_validator("change_pct")
    @classmethod
    def _not_zero(cls, v: float) -> float:
        if v == 0:
            raise ValueError("a move of 0% can't fire")
        return v


class SimulateResult(BaseModel):
    fired: bool
    note: str
    detection: dict = Field(description="The detector's reading of the made-up bar (z per window).")
    finding: FindingView | None = Field(None, description="The sandbox finding, when it fired.")

