"""The task the validator judges (the investigation agent's ValidationTask, field by field:
agents/investigation-agent/app/contract.py) and the result it returns."""

from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from app.validation.vocab import (
    Alert,
    AlertBasis,
    AlertChange,
    Attention,
    BaselineBasis,
    CurrencyBasis,
    ErrorKind,
    ExpectedSize,
    Method,
    Move,
    NextCheckReason,
    Owner,
    Phase,
    Statistic,
    Verdict,
)

RunId = Annotated[str, Field(min_length=1, max_length=64)]
Slug = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_-]{1,79}$")]
UtcDatetime = Annotated[AwareDatetime, AfterValidator(lambda d: d.astimezone(UTC))]



class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------- the task


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
    model_config = ConfigDict(extra="ignore")  # a newer investigation may add fields

    task_id: Slug
    hypothesis_id: Slug
    event_id: Slug
    finding_ids: list[Slug] = Field(min_length=1)
    # what to measure
    data_source_id: str
    product_id: Slug  # the profile's product
    source_product_id: str | None = None  # the same product in the data source's catalog
    metric: str
    unit: str
    currency: str | None = None
    aggregation: str
    filter: dict[str, str] = Field(default_factory=dict)
    # when
    date_basis: Literal["local_business_date"] = "local_business_date"
    time_zone: str
    calendar_id: str | None = None
    anchor: UtcDatetime
    announced_at: date | None = None  # dated rules: when the rule was announced
    watch: BusinessDates
    baseline: Baseline
    reporting_lag_days: int = Field(ge=0)
    # how to judge (one verdict per task)
    method: Method
    thresholds: list[Threshold] = Field(min_length=1)  # all must hold
    threshold_set_id: str | None = None  # <metric>.<size> in the spec
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
    scope_note: str | None = None

    @model_validator(mode="after")
    def _baseline_before_watch(self) -> "ValidationTask":
        if self.baseline.until > self.watch.from_:
            raise ValueError("the baseline must end before the watch window starts")
        return self


# ----------------------------------------------------------------- result


class Check(Model):
    """One statistic with the threshold it was judged against, and its mirror."""

    statistic: Statistic
    value: float | None
    threshold: Threshold
    mirror: Threshold
    met: bool
    mirror_met: bool
    source: str | None = None  # percentile: empirical | t_prediction
    implicit: bool = False  # added by the method (level_change, trend)


class Placebo(Model):
    anchors: int
    fired: int
    fire_rate: float | None
    p_value: float | None


class Observation(Model):
    watch: dict[str, Any]
    baseline: dict[str, Any]
    change: dict[str, Any]
    statistics: list[Check]
    placebo: Placebo | None = None


class PreMaskResult(Model):
    """The part of the watch before relief started, judged on its own."""

    watch: BusinessDates
    verdict: Verdict
    statistics: list[Check]


class VerdictStep(Model):
    as_of: date
    verdict: Verdict
    final: bool


class Family(Model):
    event_id: str
    size: int


class ToolCall(Model):
    step: str
    tool: str | None = None
    args: dict[str, Any] = Field(default_factory=dict)
    status: Literal["ok", "error", "cached", "planned"] = "ok"
    error: str | None = None


class ValidationResult(Model):
    task_id: str
    task_hash: str
    hypothesis_id: str
    event_id: str
    family: Family
    owner: str
    product_id: str
    metric: str
    method: Method
    validator_version: str
    catalog_version: str | None
    threshold_set_id: str | None
    evaluated_as_of: date
    computed_at: datetime
    verdict: Verdict
    final: bool
    error_kind: ErrorKind | None = None
    pre_mask_result: PreMaskResult | None = None
    verdict_history: list[VerdictStep] = Field(default_factory=list)
    alert: Alert = "none"
    alert_change: AlertChange = "none"
    alert_basis: AlertBasis | None = None
    attention: Attention | None = None
    observed_direction: Literal["rise", "fall", "flat"] | None = None
    expected: dict[str, str]
    reasons: list[str]
    observation: Observation | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    next_check_after: date | None = None
    next_check_reason: NextCheckReason | None = None
    stop_after: date | None = None
    unchanged_since: date | None = None
    supersedes: VerdictStep | None = None
    tool_trace: list[ToolCall] = Field(default_factory=list)
