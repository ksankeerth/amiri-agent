"""Institution profile: the institution and the sections of its profile.

Field rules live here (formats, codes, ranges). Rules that need the rest of the
profile (a product's category must suit a bank or an insurer, references must
exist, names must be unique) live in rules.py, so a batch checks them against
the profile as it will be after every operation.
"""

import re
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app import reference, spec

SLUG = r"^[a-z0-9][a-z0-9_-]{0,63}$"


# ---------------------------------------------------------------- code types


def _country(v: str) -> str:
    v = v.strip().upper()
    if not reference.is_country(v):
        raise ValueError(f"{v} is not an ISO 3166-1 alpha-2 country code")
    return v


def _norm_place(v: str) -> str:
    v = v.strip()
    return v.lower() if ":" in v else v.upper()


def _place(v: str) -> str:
    """Any known place: ISO 3166-1/-2, or a gazetteer place (chk:, sea:, port:, city:)."""
    v = _norm_place(v)
    if not reference.is_place(v):
        raise ValueError(f"{v} is not a known place (ISO 3166 code, or a gazetteer code; GET /reference/places)")
    return v


def _iso_place(v: str) -> str:
    v = _norm_place(v)
    if not reference.is_iso_place(v):
        raise ValueError(f"{v} is not an ISO 3166-1 country or ISO 3166-2 region code")
    return v


def _currency(v: str) -> str:
    v = v.strip().upper()
    if not reference.is_currency(v):
        raise ValueError(f"{v} is not an ISO 4217 currency code")
    return v


def _time_zone(v: str) -> str:
    if not reference.is_time_zone(v):
        raise ValueError(f"{v} is not an IANA time zone (e.g. Asia/Colombo)")
    return v


def _unique(v: list) -> list:
    return list(dict.fromkeys(v))


Country = Annotated[str, AfterValidator(_country)]
Place = Annotated[str, AfterValidator(_place)]
IsoPlace = Annotated[str, AfterValidator(_iso_place)]
Currency = Annotated[str, AfterValidator(_currency)]
TimeZone = Annotated[str, AfterValidator(_time_zone)]
Slug = Annotated[str, Field(pattern=SLUG)]
Text = Annotated[str, Field(max_length=600)]
Places = Annotated[list[Place], Field(max_length=60), AfterValidator(_unique)]
Ids = Annotated[list[Slug], Field(max_length=100), AfterValidator(_unique)]
Names = Annotated[list[Annotated[str, Field(min_length=1, max_length=80)]], Field(max_length=10), AfterValidator(_unique)]

InstitutionType = Literal["bank", "insurer"]
SUBTYPES: dict[str, list[str]] = {
    "bank": ["commercial", "savings", "cooperative", "development", "islamic", "microfinance",
             "finance_company", "digital", "rural"],
    "insurer": ["life", "general", "composite", "health", "takaful", "reinsurer", "micro"],
}


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------------------------------------------------------------- the institution


class InstitutionFields(Model):
    """Everything about the institution itself. All optional here; create checks required ones."""

    name: str | None = Field(None, min_length=1, max_length=120)
    legal_name: str | None = Field(None, max_length=200)
    short_name: str | None = Field(None, max_length=30)
    institution_type: InstitutionType | None = None
    subtype: str | None = Field(None, description="bank: " + ", ".join(SUBTYPES["bank"]) +
                                "; insurer: " + ", ".join(SUBTYPES["insurer"]))
    islamic: bool | None = Field(None, description="Islamic bank, Islamic window or takaful.")
    lei: str | None = Field(None, pattern=r"^[A-Z0-9]{18}[0-9]{2}$", description="ISO 17442 Legal Entity Identifier.")
    home_country: Country | None = None
    base_currency: Currency | None = None
    time_zone: TimeZone | None = None
    clearing_currencies: Annotated[list[Currency], Field(max_length=20), AfterValidator(_unique)] | None = Field(
        None, description="Currencies it pays and settles in abroad (drives sanctions-regime suggestions).")
    summary: Text | None = None
    governance_body: str | None = Field(None, max_length=120, description="Who owns risk decisions, e.g. Board Risk Committee.")
    size_band: Literal["small", "mid", "large", "systemic"] | None = None
    fiscal_year_start_month: int | None = Field(None, ge=1, le=12)
    website: str | None = Field(None, pattern=r"^https?://", max_length=200)


class InstitutionCreate(InstitutionFields):
    institution_id: Slug | None = Field(None, description="Default: from the name.")
    name: str = Field(min_length=1, max_length=120)
    institution_type: InstitutionType
    home_country: Country
    base_currency: Currency
    time_zone: TimeZone


class InstitutionPatch(InstitutionFields):
    """Change any field; send null to clear an optional one. The type can't change once products exist."""


# ---------------------------------------------------------------- sections


class FootprintItem(Model):
    """Where the institution operates: a country, or a region of one."""

    code: IsoPlace
    role: Literal["home", "branches", "subsidiary", "representative_office", "agents", "digital_only"] = "branches"
    scope: Literal["all", "part"] = "all"
    branch_count: int | None = Field(None, ge=0, le=100_000)
    note: Text | None = None


class WatchPlace(Model):
    """A place outside the footprint that matters (a remittance source, a chokepoint)."""

    name: str = Field(min_length=1, max_length=80)
    code: Place | None = None
    kind: Literal["country", "region", "city", "port", "chokepoint", "area"] = "country"
    reason: Text | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)

    @model_validator(mode="after")
    def _coords(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("give both lat and lon, or neither")
        return self


class SpecValue(Model):
    """A Metrics Spec dimension value that identifies the group in the institution's data."""

    dimension: str
    value: str = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def _known(self):
        d = spec.dimension(self.dimension)
        if d is None:
            raise ValueError(f"{self.dimension} is not a Metrics Spec dimension usable for customer groups "
                             f"({', '.join(spec.SEGMENT_DIMENSIONS)})")
        if d["values"] is not None and self.value not in d["values"]:
            raise ValueError(f"{self.value} is not a value of {self.dimension} ({', '.join(d['values'])})")
        return self


IncomeSource = Literal["salary", "remittances", "business_income", "farm_income", "pension",
                       "government_transfers", "investment_income", "other"]


class Segment(Model):
    """A customer group. Categories only: never names of customers."""

    template_id: str | None = Field(None, description="The template it started from (GET /suggestions/segments).")

    label: str = Field(min_length=1, max_length=80)
    kind: Literal["individual", "business", "public_sector", "financial", "mixed"] = "individual"
    note: Text | None = None
    places: Places = []
    income_sources: Annotated[list[IncomeSource], AfterValidator(_unique)] = []
    spec_mapping: Annotated[list[SpecValue], Field(max_length=6)] = []
    share_of_customers_pct: float | None = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def _template(self):
        if self.template_id and reference.segment_template(self.template_id) is None:
            raise ValueError(f"no segment template {self.template_id}")
        return self


class Money(Model):
    amount: float = Field(ge=0)
    currency: Currency
    as_of: date | None = None


class DataLink(Model):
    """Where the product's numbers come from (a data connection and its catalog id)."""

    source_id: str | None = Field(None, max_length=64)
    catalog_product_id: str | None = Field(None, max_length=64)


class Product(Model):
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(description="Metrics Spec category (GET /reference/product-taxonomy).")
    product_type: str = Field(description="Metrics Spec product type within the category.")
    islamic: bool = False
    currencies: Annotated[list[Currency], Field(max_length=20), AfterValidator(_unique)] = []
    segments: Ids = []
    owner: str | None = Field(None, max_length=60, description="Business unit that owns it, e.g. Retail banking.")
    book_size: Money | None = None
    status: Literal["active", "launching", "closing", "closed"] = "active"
    launched_on: date | None = None
    data: DataLink | None = None
    attributes: Annotated[dict[str, str | float | int | bool], Field(max_length=20)] = Field(
        default_factory=dict, description="Type-specific details (an insurer's sum-insured band, a loan's tenor).")
    note: Text | None = None

    @model_validator(mode="after")
    def _taxonomy(self):
        c = spec.category(self.category)
        if c is None:
            raise ValueError(f"{self.category} is not a Metrics Spec product category")
        if self.product_type not in [p["id"] for p in c["product_types"]]:
            raise ValueError(f"{self.product_type} is not a product type of {self.category} "
                             f"({', '.join(p['id'] for p in c['product_types'])})")
        return self


FlowKind = Literal["remittances_in", "remittances_out", "tourism", "services", "exports", "imports"]


class FlowValue(Model):
    amount: float = Field(ge=0)
    currency: Currency = "USD"
    year: int = Field(ge=1990, le=2100)


class FlowSource(Model):
    """Where a figure came from. The server keeps this right when a figure is edited."""

    kind: Literal["dataset", "user", "assistant"] = "user"
    dataset: str | None = Field(None, max_length=160)
    dataset_year: int | None = Field(None, ge=1990, le=2100)
    sample: bool = False
    original_amount: float | None = Field(None, ge=0, description="The dataset's figure, kept when a user corrects it.")
    edited_by: str | None = Field(None, max_length=120)
    edited_at: str | None = None


class Flow(Model):
    """Money or goods moving between a place in the footprint and a country abroad."""

    kind: FlowKind
    local: IsoPlace = Field(description="The end inside the footprint (country or region).")
    counterpart: Country = Field(description="The country at the other end.")
    route_id: str | None = Field(None, description="The sea route the goods take (GET /reference/routes).")
    figure_id: str | None = Field(None, description="The reference figure it came from.")
    label: str | None = Field(None, max_length=120)
    goods: str | None = Field(None, max_length=80, description="For exports and imports.")
    value: FlowValue | None = None
    source: FlowSource = FlowSource()
    status: Literal["suggested", "confirmed"] = "confirmed"
    segments: Ids = []
    note: Text | None = None

    @model_validator(mode="after")
    def _refs(self):
        if self.route_id and reference.route(self.route_id) is None:
            raise ValueError(f"no route {self.route_id}")
        if self.figure_id and reference.flow_figure(self.figure_id) is None:
            raise ValueError(f"no reference figure {self.figure_id}")
        return self


class Regulator(Model):
    """A regulator or regime. Give regulator_id (from the rule table) and the rest is filled from it."""

    regulator_id: str | None = Field(None, description="The rule table's id (GET /suggestions/regulators).")
    name: str = Field(min_length=1, max_length=120)
    short: str | None = Field(None, max_length=20)
    country: Country | None = Field(None, description="Null for global standards and regimes.")
    area: Literal["banking", "insurance", "securities", "aml", "data_protection", "sanctions",
                  "conduct", "standards", "other"]
    relation: Literal["home", "host", "reach", "standard"] = Field(
        description="home: the home country; host: a country it operates in; reach: applies through a "
                    "currency or market (e.g. OFAC via USD clearing); standard: a global standard.")
    basis: Literal["rule", "user"] = "user"
    rule_ref: str | None = Field(None, max_length=80, description="Which rule-table entry suggested it.")
    controls: Annotated[list[Annotated[str, Field(min_length=1, max_length=120)]], Field(max_length=12)] = []
    note: Text | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_rule_table(cls, v):
        if isinstance(v, dict) and v.get("regulator_id"):
            r = reference.regulator(v["regulator_id"])
            if r is None:
                raise ValueError(f"no regulator {v['regulator_id']} in the rule table")
            defaults = {"name": r["name"], "short": r.get("short"), "country": r.get("country"),
                        "area": r["area"], "basis": "rule", "rule_ref": r["regulator_id"],
                        "controls": r.get("controls", []),
                        "relation": r.get("relation") or ("standard" if r.get("country") is None else "home")}
            v = {**defaults, **{k: x for k, x in v.items() if x is not None}}
        return v


InstitutionKind = Literal["bank", "insurer", "takaful", "wallet", "fintech", "microfinance", "cooperative",
                          "finance_company", "broker", "remittance_company", "other"]


class Rival(Model):
    name: str = Field(min_length=1, max_length=120)
    type: InstitutionKind = "bank"
    places: Places = []
    categories: Annotated[list[str], Field(max_length=23), AfterValidator(_unique)] = Field(
        [], description="Metrics Spec categories where it competes.")
    overlap: Literal["high", "medium", "low"] = "medium"
    aliases: Names = Field([], description="Other names news uses for it.")
    website: str | None = Field(None, pattern=r"^https?://", max_length=200)
    note: Text | None = None

    @model_validator(mode="after")
    def _cats(self):
        bad = [c for c in self.categories if spec.category(c) is None]
        if bad:
            raise ValueError(f"not Metrics Spec categories: {', '.join(bad)}")
        return self


class Counterparty(Model):
    """A firm the institution depends on (correspondent bank, reinsurer, payment scheme). Never a customer."""

    name: str = Field(min_length=1, max_length=120)
    kind: Literal["correspondent_bank", "reinsurer", "payment_scheme", "clearing_house", "technology_provider",
                  "distribution_partner", "outsourcer", "other"]
    places: Places = []
    importance: Literal["critical", "important", "other"] = "important"
    aliases: Names = []
    note: Text | None = None


class Touches(Model):
    segments: Ids = []
    products: Ids = []
    flows: Ids = []
    routes: Annotated[list[str], Field(max_length=20), AfterValidator(_unique)] = []
    watch_places: Ids = []

    @model_validator(mode="after")
    def _routes(self):
        bad = [r for r in self.routes if reference.route(r) is None]
        if bad:
            raise ValueError(f"no routes {', '.join(bad)}")
        return self


class RiskExposure(Model):
    """A known risk that meets something the institution depends on (the setup's hotspots).
    Give hazard_id (from the risk finder) and the title, kind and months are filled from it."""

    title: str = Field(min_length=1, max_length=120)
    hazard_id: str | None = Field(None, description="The hazard library's id (GET /reference/hazards).")
    kind: Literal["conflict", "climate", "economic", "regulatory", "market", "health", "technology", "other"]
    places: Places = []
    months: Annotated[list[int], Field(max_length=12), AfterValidator(lambda v: sorted(set(v)))] = Field(
        [], description="Months of the year it is likely (1-12); empty: any time.")
    touches: Touches = Touches()
    source: Literal["finder", "user", "assistant"] = "user"
    status: Literal["active", "dismissed"] = Field("active", description="dismissed: the finder won't offer it again.")
    note: Text | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_hazard(cls, v):
        if isinstance(v, dict) and v.get("hazard_id"):
            h = reference.hazard(v["hazard_id"])
            if h is None:
                raise ValueError(f"no hazard {v['hazard_id']}")
            defaults = {"title": h["name"], "kind": h["kind"], "months": h["months"], "places": h["places"]}
            v = {**defaults, **{k: x for k, x in v.items() if x is not None}}
        return v

    @model_validator(mode="after")
    def _months(self):
        if any(m < 1 or m > 12 for m in self.months):
            raise ValueError("months are 1 to 12")
        return self


SECTIONS: dict[str, type[Model]] = {
    "footprint": FootprintItem,
    "watch-places": WatchPlace,
    "segments": Segment,
    "products": Product,
    "flows": Flow,
    "regulators": Regulator,
    "rivals": Rival,
    "counterparties": Counterparty,
    "risk-exposures": RiskExposure,
}
SECTION_LIMITS = {"footprint": 100, "watch-places": 100, "segments": 30, "products": 120, "flows": 300,
                  "regulators": 60, "rivals": 60, "counterparties": 60, "risk-exposures": 60}
# The field that names an item (for ids and uniqueness), per section.
NAME_FIELD = {"footprint": "code", "watch-places": "name", "segments": "label", "products": "name",
              "flows": None, "regulators": "name", "rivals": "name", "counterparties": "name", "risk-exposures": "title"}
SectionName = Literal["footprint", "watch-places", "segments", "products", "flows", "regulators", "rivals",
                      "counterparties", "risk-exposures"]


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s or "item")[:56]


# ---------------------------------------------------------------- batch


class Operation(Model):
    """One change. section "institution" changes the institution's own fields (op update)."""

    op: Literal["create", "update", "delete"]
    section: Literal["institution", "footprint", "watch-places", "segments", "products", "flows",
                     "regulators", "rivals", "counterparties", "risk-exposures"]
    id: Slug | None = Field(None, description="Required for update and delete; optional for create.")
    data: dict[str, Any] | None = Field(None, description="create: the item; update: the fields to change.")
    if_version: int | None = Field(None, description="Fail with conflict unless the item is at this version.")
    force: bool = Field(False, description="delete: also remove references to the item from other items.")


class Batch(Model):
    operations: Annotated[list[Operation], Field(min_length=1, max_length=300)]
    dry_run: bool = False
    if_profile_version: int | None = Field(None, description="Fail with conflict unless the profile is at this version.")
