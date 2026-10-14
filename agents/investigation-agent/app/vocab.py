"""The fixed lists the investigation works from.

Every choice the model makes, and every field in the contract that names a
theme, product type, angle, method or verdict, comes from here. Code checks
the model's choices against these lists; nothing outside them is accepted.
"""

from typing import Literal, get_args

# ------------------------------------------------------------------ themes
# Theme ids are Metrics Spec v1.0's (vocabularies.themes); the directions are Amiri Agent's,
# in neutral words (amiri-server app/reference/themes.json).

Theme = Literal[
    "fx",
    "rates",
    "prices",
    "commodities",
    "remittance",
    "regulation",
    "competitor",
    "macro",
    "sector",
    "disaster",
    "trust",
    "markets",
]

# The direction (or subtype) each theme allows. For `trust` it is the subject:
# whose trust event it is. `fx` names the currency that moved (ThemeTag.currency).
THEME_DIRECTIONS: dict[str, tuple[str, ...]] = {
    "fx": ("weaker", "stronger"),
    "rates": ("up", "down"),
    "prices": ("up", "down"),
    "commodities": ("up", "down"),
    "remittance": ("up", "down"),
    "regulation": (
        "tax",
        "central_bank_direction",
        "central_bank_relief",
        "insurance_regulator_rule",
        "import_control_tighter",
        "import_control_looser",
        "tariff",
    ),
    "competitor": ("cheaper", "new_product", "partner_switch"),
    "macro": ("worse", "better"),
    "sector": ("shock", "boost"),
    "disaster": ("domestic", "abroad"),
    "trust": ("own", "rival", "system"),
    "markets": ("equity_down", "equity_up", "bonds_down", "bonds_up"),
}

PriceItem = Literal["fuel", "electricity", "food", "general"]
CommodityItem = Literal["gold", "crops", "oil"]
DisasterItem = Literal[
    "flood", "storm", "earthquake", "drought", "fire", "epidemic", "haze"
]
Item = Literal[
    "fuel",
    "electricity",
    "food",
    "general",
    "gold",
    "crops",
    "oil",
    "flood",
    "storm",
    "earthquake",
    "drought",
    "fire",
    "epidemic",
    "haze",
]
ITEMS: dict[str, tuple[str, ...]] = {
    "prices": ("fuel", "electricity", "food", "general"),
    "commodities": ("gold", "crops", "oil"),
    "disaster": ("flood", "storm", "earthquake", "drought", "fire", "epidemic", "haze"),
}
# A disaster item as the Metrics Spec's `peril` value (property and crop cover), where there is one.
DISASTER_PERIL = {
    "flood": "flood",
    "storm": "storm",
    "earthquake": "earthquake",
    "drought": "drought",
    "fire": "fire",
}

# Where an event is, for this institution: its home country, a country it operates in
# (branches, subsidiaries), elsewhere, or worldwide.
Country = Literal["home", "footprint", "other", "global"]
# How a foreign event reaches the institution, if at all.
Channel = Literal["remittance", "sector", "none"]

# ---------------------------------------------------------------- products

InstitutionType = Literal["bank", "insurer"]

ProductType = Literal[
    # bank
    "savings",
    "fc_deposit",
    "retirement",
    "pawning",
    "retail_loan",
    "leasing",
    "credit_card",
    "business_loan",
    "trade_finance",
    "agri_loan",
    "remittance",
    "payments",
    "customer_fx",
    "wealth",
    "bancassurance",
    # insurer
    "life",
    "health",
    "motor",
    "travel",
    "property",
    "marine",
    "agriculture",
    "micro_insurance",
    "liability",
]

PRODUCT_TYPES: dict[str, tuple[str, ...]] = {
    "bank": (
        "savings",
        "fc_deposit",
        "retirement",
        "pawning",
        "retail_loan",
        "leasing",
        "credit_card",
        "business_loan",
        "trade_finance",
        "agri_loan",
        "remittance",
        "payments",
        "customer_fx",
        "wealth",
        "bancassurance",
    ),
    "insurer": (
        "life",
        "health",
        "motor",
        "travel",
        "property",
        "marine",
        "agriculture",
        "micro_insurance",
        "liability",
    ),
}

# Metrics Spec v1.0 product types (banks) and categories (insurers) -> the tracks' types.
# A product with no entry has no tracks (the insurer's company level is read through coverage groups).
SPEC_BANK_TYPES: dict[str, str] = {
    "current_account": "savings",
    "savings_account": "savings",
    "term_deposit": "savings",
    "fc_deposit": "fc_deposit",
    "retirement_plan": "retirement",
    "gold_loan": "pawning",
    "personal_loan": "retail_loan",
    "housing_loan": "retail_loan",
    "education_loan": "retail_loan",
    "other_secured_consumer": "retail_loan",
    "personal_overdraft": "retail_loan",
    "vehicle_lease": "leasing",
    "auto_loan": "leasing",
    "credit_card": "credit_card",
    "charge_card": "credit_card",
    "working_capital": "business_loan",
    "term_loan": "business_loan",
    "program_lending": "business_loan",
    "import_lc": "trade_finance",
    "import_collections": "trade_finance",
    "export_finance": "trade_finance",
    "crop_loan": "agri_loan",
    "agri_term_loan": "agri_loan",
    "agri_value_chain": "agri_loan",
    "inward_remittance": "remittance",
    "outward_remittance": "remittance",
    "digital_banking": "payments",
    "self_service": "payments",
    "agent_banking": "payments",
    "domestic_payments": "payments",
    "merchant_acquiring": "payments",
    "spot_fx": "customer_fx",
    "investment_funds": "wealth",
    "structured_products": "wealth",
    "securities_sold": "wealth",
    "bancassurance": "bancassurance",
}
SPEC_INSURER_CATEGORIES: dict[str, str] = {
    "life": "life",
    "health": "health",
    "motor": "motor",
    "travel": "travel",
    "property": "property",
    "marine": "marine",
    "agriculture": "agriculture",
    "micro_insurance": "micro_insurance",
    "liability": "liability",
}


def track_type(
    institution_type: str, category: str, product_type: str | None
) -> str | None:
    """The tracks' product type for a Metrics Spec product, or None when no tracks cover it."""
    if institution_type == "insurer":
        return SPEC_INSURER_CATEGORIES.get(category)
    return SPEC_BANK_TYPES.get(product_type or "")


ANGLES: dict[str, tuple[str, ...]] = {
    "savings": ("flows", "rate_competitiveness", "segment", "lifecycle", "channel"),
    "fc_deposit": ("fc_flows",),
    "retirement": ("contributions", "early_withdrawals", "fund_returns"),
    "pawning": ("collateral", "demand", "redemption", "pricing"),
    "retail_loan": ("repayment_stress", "demand", "prepayment", "segment"),
    "leasing": ("repayment_stress", "new_business"),
    "credit_card": ("stress",),
    "business_loan": (
        "fx_mismatch",
        "utilization",
        "repayment_stress",
        "concentration",
    ),
    "trade_finance": ("fx_mismatch", "trade_controls", "exports"),
    "agri_loan": ("repayment_stress", "restructure", "demand"),
    "remittance": ("volume", "corridor", "competition"),
    "payments": ("channel", "cash", "merchant"),
    "customer_fx": ("demand",),
    "wealth": ("flows",),
    "bancassurance": ("new_business",),
    "marine": ("volume", "reinsurance"),
    "agriculture": ("claims", "reinsurance"),
    "micro_insurance": ("lapses", "claims", "reinsurance"),
    "liability": ("new_business", "retention", "reinsurance"),
    "life": ("new_business", "lapses", "claims", "investment", "reinsurance"),
    "health": ("claim_frequency", "claim_severity", "retention", "reinsurance"),
    "motor": ("claim_severity", "claim_frequency", "portfolio", "reinsurance"),
    "travel": ("demand", "claim_severity", "claims", "reinsurance"),
    "property": ("catastrophe", "rebuild_cost", "reinsurance"),
}

# Who acts on a task.
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

# ------------------------------------------------- mechanisms and checks

Timing = Literal["days", "weeks", "months"]
Strength = Literal["primary", "secondary"]
Move = Literal["rise", "fall"]
ExpectedSize = Literal["small", "medium", "large"]

# How the validator judges a task (one verdict per task).
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
    "forecast_gap_pp",  # trend: mean gap of the watch months to the projected baseline trend
]
# Dated rules: before the effective date (anticipation) or after it (effect).
Phase = Literal["effect", "anticipation"]
# Judge in the metric's own currency (USD for remittances, LCs, travel claims) or in the base currency.
CurrencyBasis = Literal["original", "base"]

Verdict = Literal[
    "confirms", "contradicts", "no_effect", "insufficient_data", "masked", "not_yet"
]

DATE_BASIS = "local_business_date"  # in the institution's time zone, on its data source's calendar

# What the anchor (the time windows are measured from) was taken from.
AnchorBasis = Literal["effective_from", "period_start", "move_start", "published_at"]

OutOfScopeReason = Literal[
    "not_home_country", "no_theme", "below_min_size", "merged_into_event", "after_as_of"
]
ScreeningDecision = Literal["kept", "rejected", "cut_by_cap"]


def values(literal) -> tuple[str, ...]:
    return get_args(literal)


def check_tables() -> None:
    """The tables agree with the Literal types (run by the tests)."""
    assert set(THEME_DIRECTIONS) == set(values(Theme))
    assert set(ANGLES) == set(values(ProductType))
    assert {t for ts in PRODUCT_TYPES.values() for t in ts} == set(values(ProductType))
    assert set(SPEC_BANK_TYPES.values()) == set(PRODUCT_TYPES["bank"])
    assert set(SPEC_INSURER_CATEGORIES.values()) == set(PRODUCT_TYPES["insurer"])
    assert set(ITEMS["prices"]) == set(values(PriceItem)) and set(
        ITEMS["commodities"]
    ) == set(values(CommodityItem))
    assert set(ITEMS["disaster"]) == set(values(DisasterItem))
    assert {i for items in ITEMS.values() for i in items} == set(values(Item))
