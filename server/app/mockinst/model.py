"""A sample institution's shape, from a profile and the Metrics Spec: its products, the metrics each
offers, their breakdowns and cells, and the typical size of every number.

Everything here is deterministic: the same profile gives the same institution."""

import random
import zlib
from dataclasses import dataclass, field
from datetime import date, timedelta

import pycountry

from app import spec

# Breakdowns a sample serves (at most MAX_DIMS per metric, in the spec's order).
SUPPORTED_DIMS = ("segment", "region_l1", "size_band", "claim_type", "peril", "cover", "sales_channel", "channel",
                  "corridor", "employer_sector", "vehicle_type")
MAX_DIMS = 2
MIN_CONTRIBUTORS = 10

# Typical levels where a generic one would look wrong.
RATIO_LEVELS = {  # percent
    "installment_collection_rate": 96.0, "roll_rate_to_30": 2.0, "dpd_30_plus": 4.5, "facility_utilization": 58.0,
    "moratorium_enrolled": 0.4, "loans_above_ltv_limit": 3.0, "overdue_pawns": 6.0, "card_payment_rate": 42.0,
    "revolving_share": 38.0, "approval_rate": 62.0, "renewal_rate": 78.0, "premium_collection_rate": 91.0,
    "contribution_rate": 85.0, "failed_transactions_own": 1.2, "card_fraud_rate": 0.08, "returned_cheque_rate": 1.3,
    "solvency_ratio": 180.0,
}
RATE_LEVELS = {  # per 1,000 units at risk, per week (monthly metrics use about 4.3 times this)
    "claims_per_1000": 1.2, "customer_closures": 1.5, "early_withdrawals": 0.5, "restructure_requests": 0.4,
    "auctions": 1.0, "repossessions": 0.2, "lapse_rate": 2.0, "surrenders": 0.7, "death_claims": 0.05,
}
VOLUMES = {  # contributors behind a whole product (customers, obligors, policyholders)
    "business_loan": 2600, "trade_finance": 1800, "agri_loan": 9000, "marine": 1500, "liability": 4000,
    "insurer_company": 1, "wealth": 30000, "distribution": 20000,
}
DEFAULT_VOLUME = 80000
INSURER_FLOWS = {"gwp", "new_premium", "reinsurance_cost", "bancassurance_new_premium"}
FAST_COUNTS = {"new_pledges": 0.003, "redemptions": 0.003, "renewals": 0.002, "topups": 0.001,
               "digital_transactions": 1.5}  # per contributor a day; other counts use COUNT_PER_DAY
COUNT_PER_DAY = 0.001
# Base currency per US dollar, for amounts kept in the customer's currency and claim costs set in dollars.
FX_TO_BASE = {"LKR": 300.0, "IDR": 16300.0, "INR": 88.0, "PHP": 58.0, "BDT": 120.0, "PKR": 280.0, "NPR": 140.0,
              "MYR": 4.4, "THB": 34.0, "VND": 26000.0, "SGD": 1.3, "JPY": 150.0, "AED": 3.6725, "SAR": 3.75}
DEVELOPS = {"claims_per_1000", "death_claims"}  # reported late: values grow as claims come in


@dataclass
class Metric:
    spec: dict
    breakdowns: dict[str, list[str]]
    cells: list[tuple[dict[str, str], float]]   # (dimension values, share of the product)
    level: float          # flow/count: per day; ratio: %; rate: per 1,000 a week; level: its value; stock: total
    volume: int           # contributors behind the whole product
    exposure: float       # ratio denominator total, rate units at risk, or stock size
    currency: str | None
    history_from: date

    @property
    def key(self) -> str:
        return self.spec["key"]


@dataclass
class Product:
    id: str
    name: str
    category: str
    product_type: str | None
    book: float
    currency: str
    launched_on: date | None
    islamic: bool
    metrics: dict[str, Metric] = field(default_factory=dict)


@dataclass
class Institution:
    kind: str
    name: str
    legal_name: str
    lei: str | None
    country: str
    currency: str
    time_zone: str
    islamic: bool
    products: list[Product]
    region_labels: dict[str, str]

    def product(self, product_id: str) -> Product | None:
        return next((p for p in self.products if p.id == product_id), None)


def rng(*parts: object) -> random.Random:
    return random.Random(zlib.crc32("|".join(map(str, parts)).encode()))


def _months_before(d: date, months: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 - months, 12)
    return date(y, m + 1, 1)


def _region_l1(code: str, country: str) -> str | None:
    """A place's first-level region in the home country: a district becomes its province; an island
    group (Indonesia's ID-JW) is skipped in favour of the province under it."""
    sub = pycountry.subdivisions.get(code=code)
    if sub is None or sub.country_code != country:
        return None
    while sub.parent_code:
        parent = pycountry.subdivisions.get(code=sub.parent_code)
        if parent is None or parent.type.lower().startswith("geographical"):
            break
        sub = parent
    return sub.code


def regions(profile: dict) -> list[str]:
    """region_l1 values: the home country's regions the profile names, else its first few."""
    country = profile["institution"]["home_country"]
    s = profile["sections"]
    codes = [f["code"] for f in s.get("footprint", [])]
    for sec in ("segments", "risk-exposures"):
        for it in s.get(sec, []):
            codes += it.get("places") or []
    out = []
    for c in codes:
        r = _region_l1(c, country) if "-" in c else None
        if r and r not in out:
            out.append(r)
    if len(out) < 2:
        subs = sorted((x for x in pycountry.subdivisions.get(country_code=country) or []
                       if not x.parent_code), key=lambda x: x.code)
        out += [x.code for x in subs if x.code not in out][: 3 - len(out)]
    return out[:5]


def _segment_values(product: dict, segments: dict[str, dict], kind: str) -> list[str]:
    linked = [segments[i] for i in product.get("segments", []) if i in segments] or list(segments.values())
    vals = [m["value"] for s in linked for m in s.get("spec_mapping", []) if m["dimension"] == "segment"]
    vals = list(dict.fromkeys(vals))[:3]
    filler = "domestic_business" if product["category"] in ("business_loan", "trade_finance") else "other_individual"
    if filler not in vals:
        vals.append(filler)
    return vals


def _enum_values(dim: str, category: str) -> list[str]:
    d = spec.any_dimension(dim) or {}
    v = d.get("values")
    if isinstance(v, dict):  # values by line (claim types per category)
        v = v.get(category) or next(iter(v.values()), [])
    vals = [x for x in (v or []) if x != "unknown"]
    return vals[:3]


def _cells(key: str, breakdowns: dict[str, list[str]]) -> list[tuple[dict[str, str], float]]:
    cells: list[tuple[dict[str, str], float]] = [({}, 1.0)]
    for dim, values in breakdowns.items():
        r = rng(key, dim)
        weights = {v: 0.03 if v == "unknown" else r.uniform(0.5, 1.5) for v in values}
        total = sum(weights.values())
        cells = [({**c, dim: v}, s * w / total) for c, s in cells for v, w in weights.items()]
    return cells


def _level(m: dict, book: float, volume: int, kind: str, currency: str) -> tuple[float, float]:
    """(level, exposure) for one metric of one product."""
    key, k = m["key"], m["kind"]
    fx = FX_TO_BASE.get(currency, 1.0)
    if k == "flow":
        per_day = book / 365 if key in INSURER_FLOWS or kind == "insurer" else book * 0.004
        if m["currency_rule"] == "original":  # kept in the customer's currency: the pivot (US dollar)
            per_day /= fx
        return per_day, 0.0
    if k == "count":
        return max(3.0, volume * FAST_COUNTS.get(key, COUNT_PER_DAY)), 0.0
    if k == "stock":
        size = book * 400 if key == "sum_insured" else book  # an insurer's book is a year's premium
        return size, size
    if key == "median_claim_cost":
        return 900.0 * fx, 0.0
    if k == "ratio":
        return RATIO_LEVELS.get(key, 25.0), book if m["unit"] == "percent" else float(volume)
    if k == "rate":
        return RATE_LEVELS.get(key, 1.0), float(volume)
    unit = m["unit"]  # level
    return {"index": 100.0, "percent_pa": 9.0, "pp": 1.0, "percent": 0.8, "currency": 50_000.0}.get(unit, 1.0), 0.0


def build(profile: dict, kind: str, today: date) -> Institution:
    inst = profile["institution"]
    s = profile["sections"]
    segments = {it["id"]: it for it in s.get("segments", []) if it.get("id")}
    region_values = regions(profile)
    products = []
    for p in s.get("products", []):
        if p.get("status") in ("closing", "closed"):
            continue
        book_size = p.get("book_size") or {}
        book = float(book_size.get("amount") or 1e9)
        currency = book_size.get("currency") or inst["base_currency"]
        launched = date.fromisoformat(p["launched_on"]) if p.get("launched_on") else None
        prod = Product(p["id"], p["name"], p["category"], p.get("product_type"), book, currency, launched,
                       bool(p.get("islamic")))
        volume = VOLUMES.get(p["category"], DEFAULT_VOLUME)
        for m in spec.metrics(p["category"]):
            if m["scope"] != "product" or m["tier"] not in ("required", "recommended"):
                continue
            applies = m.get("applies_to")
            if isinstance(applies, list) and p.get("product_type") not in applies:  # "all" or a list of types
                continue
            dims = {}
            for dim in m.get("breakdowns", []):
                if dim not in SUPPORTED_DIMS or len(dims) >= MAX_DIMS:
                    continue
                vals = (_segment_values(p, segments, kind) if dim == "segment" else
                        region_values if dim == "region_l1" else _enum_values(dim, p["category"]))
                if len(vals) >= 2:
                    dims[dim] = [*vals, "unknown"]
            level, exposure = _level(m, book, volume, kind, currency)
            hist = _months_before(today, m.get("history_months") or 39)
            if launched and launched > hist:
                hist = launched
            while m["grain"] == "weekly" and hist.weekday() != 0:  # the first row is on the grid: a Monday
                hist += timedelta(days=1)
            cur = currency if m["unit"] == "currency" and m["currency_rule"] != "original" else (
                "USD" if m["currency_rule"] == "original" else None)
            prod.metrics[m["key"]] = Metric(m, dims, _cells(f"{p['id']}/{m['key']}", dims), level, volume, exposure,
                                            cur, hist)
        if prod.metrics:
            products.append(prod)
    labels = {}
    for code in region_values:
        sub = pycountry.subdivisions.get(code=code)
        labels[code] = sub.name if sub else code
    return Institution(kind, inst["name"], inst.get("legal_name") or inst["name"], inst.get("lei"),
                       inst["home_country"], inst["base_currency"], inst["time_zone"], bool(inst.get("islamic")),
                       products, labels)
