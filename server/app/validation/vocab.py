"""The fixed lists the validator works with.

Methods, statistics and the task's fields match the investigation agent's vocabulary
(agents/investigation-agent/app/vocab.py); verdicts, reasons and alerts are the
validator's own."""

from typing import Literal

VALIDATOR_VERSION = "2.1.0"  # 2.1: reads the Metrics Spec reference API

Move = Literal["rise", "fall"]
ExpectedSize = Literal["small", "medium", "large"]
Owner = Literal[
    "treasury",
    "retail_banking",
    "retail_credit",
    "business_credit",
    "pawning",
    "cards",
    "underwriting",
    "claims",
    "actuarial",
    "investments",
]
Method = Literal["recent_vs_prior", "seasonal_ratio", "level_change", "trend"]
BaselineBasis = Literal[
    "aligned_prior_spans", "rolling_seasonal_ratio", "anchor_level", "baseline_slope"
]
Statistic = Literal[
    "robust_z",
    "percentile",
    "pct_change",
    "pp_change",
    "pct_of_gross_inflow",
    "slope_change",
    "forecast_gap_pp",
]
Phase = Literal["effect", "anticipation"]
CurrencyBasis = Literal["original", "base"]

Verdict = Literal[
    "confirms",
    "contradicts",
    "no_effect",
    "insufficient_data",
    "masked",
    "not_yet",
    "error",
]
# error > not_yet > masked > insufficient_data > the test.
PRECEDENCE: tuple[str, ...] = ("error", "not_yet", "masked", "insufficient_data")

Alert = Literal["adverse", "developing", "opportunity", "none"]
AlertChange = Literal["raised", "escalated", "withdrawn", "confirmed", "none"]
AlertBasis = Literal["explained", "unexplained"]
Attention = Literal["dominated", "relief_active"]
ErrorKind = Literal["transient", "permanent"]
VintageRule = Literal["same_age", "latest"]
NextCheckReason = Literal[
    "next_period", "mask_publication", "stable_age_recheck", "transient_error"
]
PercentileSource = Literal["empirical", "t_prediction"]

# Reason codes, and the verdict each one leads to.
REASONS: dict[str, str] = {
    "watch_not_started": "not_yet",
    "not_published": "not_yet",
    "masked": "masked",
    "relief_period": "masked",
    "break_in_watch": "insufficient_data",
    "break_in_baseline": "insufficient_data",
    "too_few_spans": "insufficient_data",
    "below_min_volume": "insufficient_data",
    "small_denominator": "insufficient_data",
    "dominated": "insufficient_data",
    "suppressed": "insufficient_data",
    "zero_base": "insufficient_data",
    "metric_dropped": "error",
    "source_unreachable": "error",
    "source_rate_limited": "error",
    "invalid_task": "error",
    # These say why a verdict is what it is, or why it isn't final; no verdict of their own.
    "mask_not_published": "",
    "young_data_risk": "",
    "revised_data": "",
    "thresholds_met": "",
    "mirrored_thresholds_met": "",
    "noisy_metric": "",
    "unchanged_data": "",
}
# Plus "threshold_not_met:<statistic>" for every unmet threshold.

DATE_BASIS = "local_business_date"  # in the institution's time zone and calendar
