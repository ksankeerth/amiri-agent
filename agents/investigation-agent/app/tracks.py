"""The built-in investigation tracks as data.

A mechanism says: when an event has one of these (theme, direction) triggers,
and its size is at least min_size, this metric of this product type should move
this way, within this timing. Code lists the mechanisms an event triggers; the
model only confirms or rejects them, and picks among the listed options.
"""

from dataclasses import dataclass, field

from app.vocab import ANGLES, THEME_DIRECTIONS

TRACKS_VERSION = "builtin-v2.1"

ANY = None  # any price item


@dataclass(frozen=True)
class Trigger:
    theme: str
    direction: str
    items: tuple[str, ...] | None = ANY  # prices and commodities: which items count


@dataclass(frozen=True)
class Mechanism:
    mechanism_id: str  # product_type.angle.name
    triggers: tuple[Trigger, ...]
    text: str  # what happens, completes "<event>, so ..."
    metrics: tuple[
        str, ...
    ]  # preferred first; the first one the product offers is used
    expect: str  # rise | fall
    timing: str  # days | weeks | months
    strength: str = "primary"
    min_size: tuple[float, str] | None = (
        None  # (value, "pct" | "bp"); see TUNED_TYPICAL_DAILY_PCT
    )
    segment_dim: str | None = (
        None  # the breakdown the model may pick a value of; "region" and "corridor": by code
    )
    segment_value: str | None = (
        None  # a fixed segment (e.g. importer), if the catalog has it
    )
    fixed_filter: dict[str, str] = field(default_factory=dict)  # e.g. claim_type=flood
    phase: str = "effect"
    only_spec_types: tuple[
        str, ...
    ] = ()  # limit to products of these Metrics Spec types
    context: bool = False  # reported as context, never validated
    size: str = "medium"

    @property
    def product_type(self) -> str:
        return self.mechanism_id.split(".")[0]

    @property
    def angle(self) -> str:
        return self.mechanism_id.split(".")[1]


def T(spec: str, items: tuple[str, ...] | None = ANY) -> Trigger:
    theme, direction = spec.split(":")
    return Trigger(theme, direction, items)


GENERAL = ("general", "food")
GOLD = ("gold",)
CROPS = ("crops",)
EPIDEMIC = ("epidemic", "haze")
WATER_WIND_QUAKE = ("flood", "storm", "earthquake")
PHYSICAL = (
    "flood",
    "storm",
    "earthquake",
    "drought",
    "fire",
)  # damage to property, crops, vehicles
ITEM = "{item}"  # in fixed_filter: the event's disaster item, as the spec's value (vocab.DISASTER_PERIL)
PRICES_UP = T("prices:up")
PRICES_UP_GENERAL = T("prices:up", GENERAL)
INSURER_TYPES = (
    "life",
    "health",
    "motor",
    "travel",
    "property",
    "marine",
    "agriculture",
    "micro_insurance",
    "liability",
)

M = Mechanism
MECHANISMS: list[Mechanism] = [
    # ------------------------------------------------------------ savings
    M("savings.flows.prices_withdrawals", (PRICES_UP_GENERAL,), "households draw down savings to cover higher prices",
      ("withdrawals",), "rise", "weeks", "secondary", min_size=(1.5, "pct")),
    M("savings.flows.own_trust_run", (T("trust:own"),), "large depositors move money out",
      ("large_depositor_net_flow", "withdrawals"), "fall", "days", size="large"),
    M("savings.flows.rival_trust_inflow", (T("trust:rival"),), "depositors move money in from the troubled institution",
      ("deposit_inflow",), "rise", "days"),
    M("savings.flows.tax_anticipation", (T("regulation:tax"),), "depositors rush to place term deposits before the tax applies",
      ("td_placements",), "rise", "weeks", phase="anticipation", only_spec_types=("term_deposit",)),
    M("savings.flows.tax_effect", (T("regulation:tax"),), "depositors move savings elsewhere once the tax applies",
      ("withdrawals",), "rise", "months"),
    M("savings.rate_competitiveness.rate_moves", (T("rates:down"), T("rates:up"), T("competitor:cheaper")),
      "depositors move to rivals if our rates lag theirs", ("td_non_renewal_outflow", "withdrawals"), "rise", "weeks"),
    M("savings.rate_competitiveness.after_tax_yield", (T("regulation:tax"),), "a lower after-tax yield pushes term deposits out at maturity",
      ("td_non_renewal_outflow", "withdrawals"), "rise", "months", "secondary"),
    M("savings.segment.remittance_volume", (T("remittance:down"),), "remittance-linked customers receive less from abroad",
      ("inward_remittance_credits",), "fall", "months", min_size=(3, "pct"), segment_value="remittance_linked"),
    M("savings.segment.remittance_fx", (T("fx:weaker"),), "migrant workers send more while the currency is weak",
      ("inward_remittance_credits",), "rise", "months", "secondary", min_size=(5, "pct"), segment_value="remittance_linked"),
    M("savings.segment.sector_shock", (T("sector:shock"),), "workers in the hit sector draw down savings",
      ("net_deposits", "deposit_inflow"), "fall", "months", segment_dim="employer_sector"),
    M("savings.segment.disaster", (T("disaster:domestic"),), "customers in the affected regions draw down savings",
      ("net_deposits", "deposit_inflow"), "fall", "weeks", "secondary", segment_dim="region"),
    M("savings.lifecycle.squeeze", (T("macro:worse"), PRICES_UP_GENERAL), "fewer households open new accounts",
      ("new_accounts",), "fall", "months", "secondary"),
    M("savings.lifecycle.own_trust", (T("trust:own"),), "customers close accounts", ("customer_closures",), "rise", "days"),
    M("savings.channel.own_trust", (T("trust:own"),), "transactions fail in our own systems",
      ("failed_transactions_own",), "rise", "days"),
    M("savings.channel.disaster", (T("disaster:domestic"),), "digital transactions drop in the affected regions",
      ("digital_transactions",), "fall", "days", "secondary", segment_dim="region"),
    # ---------------------------------------------------------- fc_deposit
    M("fc_deposit.fc_flows.remittance", (T("remittance:down"),), "foreign-currency inflows fall",
      ("deposit_inflow",), "fall", "months", min_size=(3, "pct")),
    M("fc_deposit.fc_flows.conversion_rule", (T("regulation:central_bank_direction"),), "customers convert foreign currency to local currency",
      ("withdrawals",), "rise", "weeks"),
    # ---------------------------------------------------------- retirement
    M("retirement.contributions.squeeze", (PRICES_UP_GENERAL, T("sector:shock"), T("macro:worse")),
      "members pause contributions", ("contributions",), "fall", "months"),
    M("retirement.early_withdrawals.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "members cash out early",
      ("early_withdrawals",), "rise", "months"),
    M("retirement.early_withdrawals.own_trust", (T("trust:own"),), "members withdraw for fear of a loss",
      ("early_withdrawals",), "rise", "months"),
    M("retirement.fund_returns.markets", (T("markets:bonds_down"), T("markets:equity_down")), "the fund's value falls",
      ("fund_return_20d",), "fall", "weeks"),
    # ------------------------------------------------------------- pawning
    M("pawning.collateral.gold_down", (T("commodities:down", GOLD),), "more loans exceed the loan-to-value limit",
      ("loans_above_ltv_limit",), "rise", "days", min_size=(3, "pct")),
    M("pawning.collateral.currency_stronger", (T("fx:stronger"),), "gold is worth less in local currency, so more loans exceed the limit",
      ("loans_above_ltv_limit",), "rise", "days", "secondary", min_size=(3, "pct")),
    M("pawning.demand.cash_stress", (PRICES_UP, T("remittance:down"), T("macro:worse"), T("disaster:domestic")),
      "more households pawn gold for cash", ("new_pledges",), "rise", "weeks"),
    M("pawning.redemption.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "fewer customers redeem their gold on time",
      ("overdue_pawns", "redemptions"), "rise", "months"),
    M("pawning.redemption.gold_fall", (T("commodities:down", GOLD),), "redeeming is no longer worth it, so more loans go to auction",
      ("auctions",), "rise", "months", min_size=(8, "pct")),
    M("pawning.pricing.rival", (T("competitor:cheaper"),), "a cheaper rival takes new pawns", ("new_pledges",), "fall", "weeks"),
    M("pawning.pricing.rate_cut", (T("rates:down"),), "we become dearer than rivals if we don't cut", ("new_pledges",),
      "fall", "weeks", "secondary"),
    # --------------------------------------------------------- retail_loan
    M("retail_loan.repayment_stress.rates_up", (T("rates:up"),), "variable-rate borrowers struggle with higher instalments",
      ("installment_collection_rate",), "fall", "weeks", min_size=(50, "bp"), segment_value="variable"),
    M("retail_loan.repayment_stress.prices", (PRICES_UP_GENERAL,), "borrowers struggle with higher living costs",
      ("installment_collection_rate",), "fall", "weeks", "secondary"),
    M("retail_loan.repayment_stress.sector", (T("sector:shock"),), "borrowers employed in the hit sector miss instalments",
      ("installment_collection_rate",), "fall", "weeks", segment_dim="employer_sector"),
    M("retail_loan.repayment_stress.remittance", (T("remittance:down"),), "remittance-dependent borrowers miss instalments",
      ("installment_collection_rate",), "fall", "months", "secondary", segment_value="remittance_linked"),
    M("retail_loan.repayment_stress.disaster", (T("disaster:domestic"),), "borrowers in the affected regions ask to reschedule",
      ("restructure_requests",), "rise", "weeks", segment_dim="region"),
    M("retail_loan.demand.rate_cut", (T("rates:down"),), "cheaper credit brings more applications", ("applications",),
      "rise", "weeks", "secondary"),
    M("retail_loan.demand.macro", (T("macro:worse"),), "uncertainty cuts loan applications", ("applications",),
      "fall", "months", "secondary"),
    M("retail_loan.prepayment.refinance", (T("rates:down"), T("competitor:cheaper")), "borrowers repay early to refinance elsewhere",
      ("prepayments",), "rise", "weeks"),
    M("retail_loan.segment.disaster", (T("disaster:domestic"),), "restructure requests concentrate in the affected regions",
      ("restructure_requests",), "rise", "weeks", segment_dim="region"),
    M("retail_loan.segment.sector", (T("sector:shock"),), "arrears concentrate among the hit sector's employees",
      ("installment_collection_rate",), "fall", "months", segment_dim="employer_sector"),
    # ------------------------------------------------------------- leasing
    M("leasing.repayment_stress.fuel", (T("prices:up", ("fuel",)),), "three-wheeler and van drivers miss instalments",
      ("installment_collection_rate",), "fall", "weeks", segment_value="three_wheeler"),
    M("leasing.new_business.looser", (T("regulation:import_control_looser"),), "more vehicles are imported and leased",
      ("new_leases",), "rise", "months"),
    M("leasing.new_business.tighter", (T("regulation:import_control_tighter"),), "fewer vehicles are imported and leased",
      ("new_leases",), "fall", "months"),
    # --------------------------------------------------------- credit_card
    M("credit_card.stress.squeeze", (PRICES_UP_GENERAL, T("rates:up")), "cardholders pay off less of their balances",
      ("card_payment_rate",), "fall", "weeks"),
    # ------------------------------------------------------- business_loan
    M("business_loan.fx_mismatch.imports", (T("fx:weaker"),), "importers' costs rise, so they open fewer letters of credit",
      ("lc_openings", "import_bills"), "fall", "weeks", min_size=(1, "pct"), segment_value="importer"),
    # ------------------------------------------------------- trade_finance
    # The Metrics Spec serves LC openings and import bills under trade finance; a source
    # that serves them per business-loan product is caught by the business_loan one above.
    M("trade_finance.fx_mismatch.imports", (T("fx:weaker"),), "importers' costs rise, so they open fewer letters of credit",
      ("lc_openings", "import_bills"), "fall", "weeks", min_size=(1, "pct"), segment_value="importer"),
    M("business_loan.fx_mismatch.importer_collections", (T("fx:weaker"),), "importers struggle to meet instalments",
      ("installment_collection_rate",), "fall", "weeks", "secondary", min_size=(1, "pct"), segment_value="importer"),
    M("business_loan.utilization.importers", (T("fx:weaker"),),
      "importers draw more on their working-capital lines to pay for dearer imports",
      ("facility_utilization",), "rise", "weeks", min_size=(1, "pct"), segment_value="importer"),
    M("business_loan.utilization.costs", (PRICES_UP, T("rates:up")),
      "businesses draw more on their working-capital lines to cover higher costs",
      ("facility_utilization",), "rise", "weeks"),
    M("business_loan.repayment_stress.sector", (T("sector:shock"), T("macro:worse")), "businesses in the hit sector miss instalments",
      ("installment_collection_rate", "returned_cheque_rate"), "fall", "weeks", segment_dim="sector"),
    M("business_loan.repayment_stress.costs", (T("rates:up"), PRICES_UP), "higher costs squeeze debt service",
      ("installment_collection_rate",), "fall", "weeks", "secondary", min_size=(50, "bp")),
    M("business_loan.repayment_stress.disaster", (T("disaster:domestic"),), "businesses in the affected regions ask to reschedule",
      ("restructure_requests",), "rise", "weeks", segment_dim="region"),
    M("business_loan.concentration.sector", (T("sector:shock"),), "the book's exposure to the hit sector",
      ("exposure",), "rise", "days", segment_dim="sector", context=True),
    # ---------------------------------------------------------------- life
    M("life.new_business.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "households buy fewer policies",
      ("new_policies",), "fall", "months"),
    M("life.new_business.rival", (T("competitor:new_product"), T("competitor:partner_switch")), "a rival's move takes new business",
      ("new_policies",), "fall", "weeks", segment_dim="sales_channel"),
    M("life.lapses.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "policyholders stop paying premiums",
      ("premium_collection_rate",), "fall", "weeks"),
    M("life.lapses.surrenders", (T("rates:up"),), "high deposit rates make endowments less attractive",
      ("surrenders",), "rise", "months", "secondary", min_size=(100, "bp"), only_spec_types=("savings_life",)),
    M("life.claims.epidemic", (T("disaster:domestic", EPIDEMIC),), "more death claims", ("death_claims",), "rise", "months"),
    M("life.investment.rates_up", (T("rates:up"), T("markets:bonds_down")), "bond losses weigh on capital",
      ("solvency_ratio",), "fall", "months", context=True),
    M("life.investment.rates_down", (T("rates:down"),), "new money earns less than the guaranteed rates",
      ("new_money_yield_vs_guarantee",), "fall", "months", context=True),
    # -------------------------------------------------------------- health
    M("health.claim_frequency.disaster", (T("disaster:domestic"),), "more claims from the affected regions",
      ("claims_per_1000",), "rise", "weeks", segment_dim="region"),
    M("health.claim_severity.costs", (T("fx:weaker"), PRICES_UP_GENERAL), "imported drugs and procedures cost more",
      ("procedure_cost_index",), "rise", "months", min_size=(3, "pct")),
    M("health.retention.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "fewer members renew", ("renewal_rate",),
      "fall", "months", "secondary"),
    M("health.retention.rival", (T("competitor:new_product"), T("competitor:cheaper")), "members move to a rival",
      ("renewal_rate",), "fall", "months"),
    # --------------------------------------------------------------- motor
    M("motor.claim_severity.parts", (T("fx:weaker"),), "imported parts cost more", ("parts_cost_index",),
      "rise", "months", min_size=(3, "pct")),
    M("motor.claim_frequency.disaster", (T("disaster:domestic", WATER_WIND_QUAKE),), "vehicle damage claims rise in the affected regions",
      ("claims_per_1000",), "rise", "weeks", segment_dim="region", fixed_filter={"claim_type": "natural_peril"}),
    M("motor.claim_frequency.fuel", (T("prices:up", ("fuel",)),), "people drive less, so claims fall", ("claims_per_1000",),
      "fall", "weeks", "secondary", min_size=(10, "pct")),
    M("motor.portfolio.looser", (T("regulation:import_control_looser"),), "more vehicles are imported and insured",
      ("new_policies",), "rise", "months"),
    M("motor.portfolio.tighter", (T("regulation:import_control_tighter"),), "fewer vehicles are imported and insured",
      ("new_policies",), "fall", "months"),
    M("motor.portfolio.rival", (T("competitor:cheaper"),), "customers renew with a cheaper rival", ("renewal_rate",),
      "fall", "months"),
    # -------------------------------------------------------------- travel
    M("travel.demand.fx", (T("fx:weaker"),), "leisure travel gets dearer, so fewer policies are sold",
      ("new_policies",), "fall", "weeks", "secondary", min_size=(3, "pct"), segment_value="leisure"),
    M("travel.demand.abroad", (T("disaster:abroad"),), "travel to the affected destination drops", ("new_policies",),
      "fall", "weeks", segment_dim="destination_region"),
    M("travel.claim_severity.fx", (T("fx:weaker"),), "claims paid in USD cost more in local currency", ("median_claim_cost",),
      "rise", "weeks", min_size=(5, "pct"), context=True),
    M("travel.claims.abroad", (T("disaster:abroad"),), "more claims from travellers abroad", ("claims_per_1000",),
      "rise", "months", segment_dim="destination_region"),
    # ------------------------------------------------------------ property
    M("property.catastrophe.disaster", (T("disaster:domestic", PHYSICAL),), "damage claims rise in the affected regions",
      ("claims_per_1000",), "rise", "weeks", segment_dim="region", fixed_filter={"peril": ITEM}),
    M("property.rebuild_cost.costs", (T("fx:weaker"), PRICES_UP_GENERAL, T("disaster:domestic")),
      "rebuilding costs more", ("median_claim_cost",), "rise", "months", "secondary",
      min_size=(3, "pct"), context=True),
    # ------------------------------------------------- trade_finance (more)
    M("trade_finance.trade_controls.tighter", (T("regulation:import_control_tighter"),),
      "importers open fewer letters of credit under tighter import controls", ("lc_openings", "import_bills"),
      "fall", "weeks"),
    M("trade_finance.trade_controls.looser", (T("regulation:import_control_looser"),),
      "importers open more letters of credit once controls ease", ("lc_openings", "import_bills"), "rise", "months"),
    M("trade_finance.trade_controls.tariff", (T("regulation:tariff"),), "dearer imports mean fewer import bills",
      ("import_bills", "lc_openings"), "fall", "months", "secondary"),
    M("trade_finance.exports.buyers", (T("sector:shock"), T("disaster:abroad")),
      "exporters receive less from the hit market", ("export_receipts",), "fall", "months", segment_dim="corridor"),
    M("trade_finance.exports.fx_stronger", (T("fx:stronger"),), "a stronger currency makes exports dearer abroad",
      ("export_receipts",), "fall", "months", "secondary", min_size=(5, "pct")),
    # ------------------------------------------------------------ agri_loan
    M("agri_loan.repayment_stress.disaster", (T("disaster:domestic"),), "farmers in the affected regions miss instalments",
      ("installment_collection_rate",), "fall", "weeks", segment_dim="region"),
    M("agri_loan.restructure.disaster", (T("disaster:domestic"),), "farmers in the affected regions ask to reschedule",
      ("restructure_requests",), "rise", "weeks", segment_dim="region"),
    M("agri_loan.repayment_stress.crop_prices", (T("commodities:down", CROPS),), "lower crop prices cut farm income",
      ("installment_collection_rate", "roll_rate_to_30"), "fall", "months", min_size=(10, "pct")),
    M("agri_loan.demand.input_costs", (T("prices:up", ("fuel",)), T("regulation:import_control_tighter")),
      "dearer fuel and inputs push farmers to borrow more", ("disbursements",), "rise", "months", "secondary"),
    M("agri_loan.demand.rate_cut", (T("rates:down"),), "cheaper credit brings more farm loans", ("disbursements",),
      "rise", "months", "secondary"),
    # ----------------------------------------------------------- remittance
    M("remittance.volume.remittance_down", (T("remittance:down"),), "fewer remittances come in",
      ("inward_remittances",), "fall", "months", min_size=(3, "pct")),
    M("remittance.volume.remittance_up", (T("remittance:up"),), "more remittances come in",
      ("inward_remittances",), "rise", "months", "secondary", min_size=(3, "pct")),
    M("remittance.volume.currency_weaker", (T("fx:weaker"),), "migrant workers send more while the currency is weak",
      ("inward_remittances",), "rise", "months", "secondary", min_size=(5, "pct")),
    M("remittance.corridor.abroad", (T("remittance:down"),), "remittances from the affected country fall",
      ("inward_remittances",), "fall", "months", segment_dim="corridor"),
    M("remittance.competition.rival", (T("competitor:cheaper"), T("competitor:new_product")),
      "senders move to a cheaper rival", ("inward_remittances",), "fall", "weeks"),
    M("remittance.volume.outflow_rule", (T("regulation:central_bank_direction"),), "tighter rules cut money sent abroad",
      ("outward_remittances",), "fall", "weeks"),
    # ------------------------------------------------------------- payments
    M("payments.channel.own_trust", (T("trust:own"),), "transactions fail in our own systems",
      ("failed_transactions_own",), "rise", "days"),
    M("payments.channel.disaster", (T("disaster:domestic"),), "digital transactions drop in the affected regions",
      ("digital_transactions",), "fall", "days", "secondary", segment_dim="region"),
    M("payments.cash.trust", (T("trust:own"), T("trust:system")), "customers take out cash",
      ("cash_withdrawals",), "rise", "days"),
    M("payments.cash.disaster", (T("disaster:domestic"),), "cash withdrawals rise in the affected regions",
      ("cash_withdrawals",), "rise", "days", "secondary", segment_dim="region"),
    M("payments.merchant.sector", (T("sector:shock"),), "card spending at merchants in the hit sector falls",
      ("merchant_acquiring_volume",), "fall", "weeks", segment_dim="merchant_sector"),
    # ---------------------------------------------------------- customer_fx
    M("customer_fx.demand.currency_weaker", (T("fx:weaker"),), "customers buy foreign currency to protect savings",
      ("customer_fx_purchases",), "rise", "days", min_size=(1, "pct")),
    M("customer_fx.demand.fx_rule", (T("regulation:central_bank_direction"),), "new rules cut customers' foreign currency purchases",
      ("customer_fx_purchases",), "fall", "weeks"),
    # --------------------------------------------------------------- wealth
    M("wealth.flows.markets_down", (T("markets:equity_down"), T("markets:bonds_down")), "investors redeem funds",
      ("investment_redemptions",), "rise", "days"),
    M("wealth.flows.rates_up", (T("rates:up"),), "deposits pay more, so fewer subscribe to funds",
      ("investment_subscriptions",), "fall", "months", "secondary", min_size=(50, "bp")),
    M("wealth.flows.own_trust", (T("trust:own"),), "investors take their money out", ("investment_redemptions",),
      "rise", "days"),
    # -------------------------------------------------------- bancassurance
    M("bancassurance.new_business.squeeze", (PRICES_UP_GENERAL, T("macro:worse")), "customers buy less insurance",
      ("bancassurance_new_premium",), "fall", "months", "secondary"),
    M("bancassurance.new_business.partner", (T("competitor:partner_switch"),), "the insurance partner moves to a rival",
      ("bancassurance_new_premium",), "fall", "months"),
    # --------------------------------------------------------------- marine
    M("marine.volume.trade", (T("regulation:tariff"), T("regulation:import_control_tighter")), "fewer shipments are insured",
      ("insured_shipments",), "fall", "months"),
    M("marine.volume.abroad", (T("disaster:abroad"), T("sector:shock")), "shipments to and from the affected country fall",
      ("insured_shipments",), "fall", "weeks", segment_dim="corridor"),
    # ---------------------------------------------------------- agriculture
    M("agriculture.claims.disaster", (T("disaster:domestic", PHYSICAL),), "crop and livestock claims rise in the affected regions",
      ("claims_per_1000",), "rise", "weeks", segment_dim="region", fixed_filter={"peril": ITEM}),
    # ------------------------------------------------------ micro_insurance
    M("micro_insurance.lapses.squeeze", (PRICES_UP_GENERAL, T("macro:worse"), T("disaster:domestic")),
      "low-income policyholders stop paying premiums", ("premium_collection_rate", "lapse_rate"), "fall", "weeks"),
    M("micro_insurance.claims.epidemic", (T("disaster:domestic", EPIDEMIC),), "more claims from the affected regions",
      ("claims_per_1000",), "rise", "weeks", segment_dim="region"),
    # ------------------------------------------------------------ liability
    M("liability.new_business.squeeze", (T("macro:worse"), T("sector:shock")), "businesses buy less liability cover",
      ("new_policies",), "fall", "months", segment_dim="sector"),
    M("liability.retention.rival", (T("competitor:cheaper"),), "clients renew with a cheaper rival", ("renewal_rate",),
      "fall", "months"),
]  # fmt: skip

# Every insurer type: USD reinsurance premiums.
MECHANISMS += [
    M(f"{t}.reinsurance.fx", (T("fx:weaker"),), "reinsurance premiums paid in USD cost more",
      ("reinsurance_cost",), "rise", "months", min_size=(3, "pct"), context=True)
    for t in INSURER_TYPES
]  # fmt: skip

BY_ID = {m.mechanism_id: m for m in MECHANISMS}

# A % minimum on a market move was set for a series moving this much on a typical day
# (a currency like LKR; gold). When the event's series says how much it typically moves,
# the minimum scales with it: 1% for importers is 4 typical days, so it is 0.4% for a
# currency that moves 0.1% a day and 2% for one that moves 0.5%.
TUNED_TYPICAL_DAILY_PCT = {"fx": 0.25, "commodities": 1.0}

# A commodity whose price passes straight through to consumer prices: crude oil -> fuel.
ITEM_IMPLIED = {("commodities", "oil"): ("prices", "fuel")}

# Themes added by code so overlapping themes don't drop candidates.
IMPLIED = {
    ("rates", "up"): [("markets", "bonds_down")],
    ("rates", "down"): [("markets", "bonds_up")],
    ("markets", "bonds_down"): [("rates", "up")],
}

# Who acts on a task: by product type, and by angle for insurers.
OWNER_BY_TYPE = {
    "savings": "retail_banking", "fc_deposit": "retail_banking", "retirement": "investments",
    "pawning": "pawning", "retail_loan": "retail_credit", "leasing": "retail_credit",
    "credit_card": "cards", "business_loan": "business_credit", "trade_finance": "business_credit",
    "agri_loan": "business_credit", "remittance": "retail_banking", "payments": "retail_banking",
    "customer_fx": "treasury", "wealth": "investments", "bancassurance": "retail_banking",
}  # fmt: skip
INSURER_OWNER_BY_ANGLE = {
    "claims": "claims", "claim_frequency": "claims", "claim_severity": "claims",
    "catastrophe": "claims", "rebuild_cost": "claims", "investment": "investments",
    "reinsurance": "actuarial",
}  # fmt: skip

# Loan stress metrics are masked when moratorium enrolment rises.
MASKED_BY_MORATORIUM = {"installment_collection_rate", "roll_rate_to_30", "dpd_30_plus"}
MASKING_RISE_PP = 2.0


def owner(product_type: str, angle: str) -> str:
    if product_type in OWNER_BY_TYPE:
        return OWNER_BY_TYPE[product_type]
    return INSURER_OWNER_BY_ANGLE.get(angle, "underwriting")


def check() -> None:
    """The tracks agree with the vocabulary (run by the tests)."""
    for m in MECHANISMS:
        assert m.angle in ANGLES[m.product_type], m.mechanism_id
        assert m.expect in ("rise", "fall") and m.timing in ("days", "weeks", "months")
        for t in m.triggers:
            assert t.direction in THEME_DIRECTIONS[t.theme], (m.mechanism_id, t)
    assert len(BY_ID) == len(MECHANISMS), "duplicate mechanism ids"
