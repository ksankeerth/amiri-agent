"""The example file: a sample institution's data in the import format (amiri-institution-data/1), the way
GET /api/v1/data-connection:example hands it out and the tests import it.

The sample is the installation's own kind (a bank, or an insurer), shaped by its profile (or the bundled demo profile
when there is none yet), with one planted scenario by default so Verification has something to find. Every metric
the profile's products take from the Metrics Spec (required and recommended) is in it, with its history_months
of history (39 months for seasonal, recent-vs-prior and trend tests, 27 for level tests): the window the
validator's baselines read, the same period one and two years back. Series come as the total and each single
breakdown (filter_sets [[], [d1], [d2]]); pairs of breakdowns would more than double the file. Values that were
revised (claims still developing, a late revision) carry their earlier values as vintages, from the catalog's
vintage_history_from."""

import json
import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app import settings
from app.clock import Clock
from app.demo import DEMOS
from app.institutions.service import Institutions
from app.mockinst import conditions as cond
from app.mockinst import data
from app.mockinst.data import DEVELOPMENT
from app.mockinst.model import DEVELOPS, Institution, Metric, Product, build
from app.problems import Problem

FORMAT = "amiri-institution-data/1"
SPEC_VERSION = "1.0.0"
KINDS = ("bank", "insurer")
SCENARIO = {"bank": ["remittances_fall"], "insurer": ["floods"]}  # the demo's own, as in demo/…/world.md
CALENDAR_AHEAD_DAYS = 366  # the calendar runs a year past as_of (C17)
_cache: dict[tuple, tuple[bytes, str]] = {}


def bundled(kind: str) -> dict:
    return json.loads((settings.PROJECT / "app" / "seeds" / DEMOS[kind]["file"]).read_text())


async def profile_for(institutions: Institutions) -> tuple[dict, str, str, int | None]:
    """(profile, kind, where it came from, its version): the installation's own; the demo of its kind while it
    has no products; the demo bank when there is no installation."""
    try:
        p = await institutions.profile(settings.raw("INSTITUTION_ID"))
    except Problem:
        p = None
    kind = p["institution"].get("institution_type") if p else None
    if kind not in KINDS:
        return bundled("bank"), "bank", "bundled", None
    live = [x for x in p["sections"].get("products") or [] if x.get("status") not in ("closing", "closed")]
    if not live:  # nothing to shape it by yet: the demo of the same kind
        return bundled(kind), kind, "bundled", None
    return ({"institution": p["institution"], "sections": p["sections"]}, kind, "installation",
            p["institution"].get("profile_version"))


def scenario_conditions(kind: str, scenario: str | None) -> list[dict]:
    """?scenario=a,b (data conditions of the sample), none, or empty for the demo's own."""
    if scenario is None or not scenario.strip():
        return [{"id": i} for i in SCENARIO[kind]]
    if scenario.strip() == "none":
        return []
    ids = [s.strip() for s in scenario.split(",") if s.strip()]
    known = {p.id for p in cond.presets(kind)}  # type: ignore[arg-type]
    bad = [i for i in ids if i not in known]
    if bad:
        raise Problem(422, "validation_error", f"{', '.join(bad)} isn't a scenario of the sample {kind}; "
                      f"choose from {', '.join(sorted(known))}, or none.")
    return [{"id": i} for i in ids]


async def example(institutions: Institutions, clock: Clock, scenario: str | None) -> tuple[bytes, str]:
    """The example file as JSON bytes, and its file name."""
    profile, kind, source, version = await profile_for(institutions)
    conds = scenario_conditions(kind, scenario)
    today = clock.now().astimezone(ZoneInfo(profile["institution"]["time_zone"])).date()
    key = (kind, source, profile["institution"].get("institution_id"), version, today, json.dumps(conds))
    if key not in _cache:
        doc = build_file(profile, kind, today, conds, source)
        slug = re.sub(r"[^a-z0-9]+", "-", profile["institution"]["name"].lower()).strip("-")[:40]
        _cache.clear()  # one at a time: a bank's file is about 15 MB
        _cache[key] = (json.dumps(doc, separators=(",", ":")).encode(), f"{slug}-data-{doc['as_of']}.json")
    return _cache[key]


def build_file(profile: dict, kind: str, today: date, conditions: list[dict], source: str = "bundled",
               products: list[str] | None = None) -> dict:
    """The import file for `profile`'s sample on `today` (local), with `conditions` planted. `products` keeps
    only those product ids (tests use it to stay quick)."""
    inst = build(profile, kind, today)
    if products is not None:
        inst.products = [p for p in inst.products if p.id in products]
    active = cond.active(kind, conditions, today)  # type: ignore[arg-type]
    as_of = today - timedelta(days=1)
    first = min((m.history_from for p in inst.products for m in p.metrics.values()), default=as_of)
    vintages_from = date(first.year + 1, first.month, 1)
    planted = [f"{cond.BY_ID[i].label} (from {a.start.isoformat()}" + (f", {a.size:g}" if a.size is not None else "")
               + ")" for i, a in active.items()]
    return {
        "format": FORMAT, "metrics_spec": SPEC_VERSION, "as_of": as_of.isoformat(),
        "about": (f"Synthetic data from AMIRI Agent's sample {kind}, shaped by {inst.name} "
                  f"({'your profile' if source == 'installation' else 'the bundled demo profile'}). "
                  + (f"Planted: {'; '.join(planted)}." if planted else "Nothing planted.")),
        "catalog": _catalog(inst, active, today, vintages_from),
        "calendar": _calendar(inst, first, as_of + timedelta(days=CALENDAR_AHEAD_DAYS)),
        "breaks": data.breaks(inst, active),
        "series": [s for p in inst.products for m in p.metrics.values()
                   for s in _series(inst, p, m, active, as_of, vintages_from)],
    }


def _catalog(inst: Institution, active: dict, today: date, vintages_from: date) -> dict:
    cal_id = f"{inst.country.lower()}-banks"
    products = []
    for p in inst.products:
        metrics = [{
            "key": m.key, "grain": m.spec["grain"], "day_basis": m.spec.get("day_basis"), "unit": m.spec["unit"],
            "currency_rule": m.spec["currency_rule"], "capability_level": "L4",
            "history_from": m.history_from.isoformat(), "max_lag_days": data.lag_days(m, active),
            "breakdowns": m.breakdowns, "filter_sets": [[]] + [[d] for d in m.breakdowns], "extras": [],
            "notes": None} for m in p.metrics.values()]
        products.append({
            "product_id": p.id, "name": p.name, "category": p.category, "product_type": p.product_type,
            "scope": "product", "shariah_compliant": p.islamic,
            "launched_on": p.launched_on.isoformat() if p.launched_on else None,
            "book_size": {"value": p.book, "unit": "currency", "currency": p.currency,
                          "as_of": (today - timedelta(days=today.day)).isoformat()},
            "metrics": metrics})
    return {
        "spec_version": SPEC_VERSION,
        "generated_at": datetime.combine(today, datetime.min.time()).isoformat() + "Z",
        "profile": {
            "institution_type": inst.kind, "legal_entity_name": inst.legal_name, "lei": inst.lei,
            "country": inst.country, "spec_version": SPEC_VERSION, "time_zone": inst.time_zone,
            "business_calendars": [{"id": cal_id, "primary": True, "weekend_days": data.weekend_days(inst),
                                    "regions": [], "source": "served", "url": None}],
            "base_currency": inst.currency, "base_currency_history": [], "pivot_currency": "USD",
            "fx_reference_sources": [{"use": "default", "name": "central bank daily reference rate",
                                      "rate_type": "mid", "fixing_time": None}],
            "inflation_regime": "normal", "region_basis": "home_branch" if inst.kind == "bank" else None,
            "region_levels": {"l1": "iso_3166_2", "l2": "mapped"}, "sector_classification": "ISIC Rev.4",
            "accounting_framework": {"framework": "IFRS 9", "dpd_materiality": None,
                                     "dpd_reset_on_restructure": False, "dpd_note": None},
            "suppression": {"min_contributors": 10, "dominance_one": 0.5, "dominance_two": 0.85, "local_rule": None},
            "renewal_grace_days": 30 if inst.kind == "insurer" else None,
            "free_look_days": 15 if inst.kind == "insurer" else None,
            "capability_level": "L4", "vintages_kept": True, "vintage_history_from": vintages_from.isoformat(),
            "segment_snapshot": "weekly_snapshot", "shariah_compliant": inst.islamic},
        "products": products,
        "dimension_values": {"region_l1": [{"value": c, "label": label, "parent": None, "official_code": c,
                                            "calendar_id": cal_id} for c, label in inst.region_labels.items()]},
        "aliases": [], "deprecations": [],
        "declarations": {"cost_index_baskets": [], "gold_reference": None, "mcc_to_isic": None,
                         "micro_insurance_ceiling": None, "remittance_currency_source": [],
                         "offered_rate_reference_tenors": []}}


def _calendar(inst: Institution, start: date, until: date) -> dict:
    return {"calendar_id": f"{inst.country.lower()}-banks", "primary": True, "regions": [],
            "time_zone": inst.time_zone, "weekend_days": data.weekend_days(inst),
            "days": [{"date": d.date.isoformat(), "business": d.business, "partial": False,
                      "holidays": [{"name": n, "moving": False, "kind": "public"} for n in d.holidays],
                      "flags": list(d.flags), "month_bday": d.month_bday, "month_bday_from_end": d.month_bday_from_end}
                     for d in data.days(inst, start, until)]}


VALUES = ("value", "numerator", "denominator", "exposure", "volume")


def _values(r: data.Row) -> tuple:
    return tuple(getattr(r, k) for k in VALUES)


def _series(inst: Institution, prod: Product, m: Metric, active: dict, as_of: date, vintages_from: date) -> list[dict]:
    """The total and one series per value of each breakdown, rows as the API returns them today."""
    cur = m.currency if m.spec["unit"] == "currency" else None
    if m.spec["unit"] == "currency" and cur is None:
        cur = prod.currency
    filters = [{}] + [{d: v} for d, values in m.breakdowns.items() for v in values]
    return [{"product_id": prod.id, "metric": m.key, "filter": f, "currency": cur,
             "rows": _rows(inst, prod, m, f, active, as_of, vintages_from)} for f in filters]


def _rows(inst: Institution, prod: Product, m: Metric, filt: dict, active: dict, as_of: date,
          vintages_from: date) -> list[dict]:
    until = as_of + timedelta(days=1)

    def read(**kw) -> list[data.Row]:
        return data.series(inst, prod, m, filt, m.history_from, until, kw.pop("kt", as_of), kw.pop("same_age", None),
                           kw.pop("kt_given", False), active)[0]

    latest = read()
    # earlier values: what was known at each age a claim develops through, and before a late revision
    samples: dict[date, list[tuple[date, tuple]]] = {}
    if m.key in DEVELOPS:
        lag = data.lag_days(m, active)
        for age in sorted({lag, *(a for a, _ in DEVELOPMENT if a > lag)}):
            for r in read(same_age=age):
                if r.vintage == "same_age":
                    samples.setdefault(r.start, []).append((r.data_as_of, _values(r)))
    rev = active.get("late_revision")
    if rev is not None and data.revision_metric(prod) == m.key and rev.start <= as_of:
        for r in read(kt=rev.start - timedelta(days=1), kt_given=True):
            if r.published_at:
                samples.setdefault(r.start, []).append((r.published_at, _values(r)))
        for r in read(kt=rev.start, kt_given=True):
            samples.setdefault(r.start, []).append((rev.start, _values(r)))
    out = []
    for r in latest:
        row: dict = {"from": r.start.isoformat(), "until": r.until.isoformat()}
        for k in VALUES:
            v = getattr(r, k)
            if v is not None or k == "value":
                row[k] = v
        if r.suppressed:
            row["suppressed"] = True
            row["suppression_reason"] = r.suppression_reason
        if r.backfilled:
            row["backfilled"] = True
        else:
            row["published_at"] = r.published_at.isoformat() if r.published_at else None
        if r.published_at and r.start >= vintages_from and r.start in samples:
            states: dict[date, tuple] = {}
            for d, vals in sorted(samples[r.start]):
                if r.published_at <= d < as_of:
                    states[d] = vals
            states[as_of] = _values(r)
            seq: list[tuple[date, tuple]] = []
            for d, vals in sorted(states.items()):
                if not seq or seq[-1][1] != vals:
                    seq.append((d, vals))
            if len(seq) > 1:
                row["vintages"] = [{"superseded_on": seq[i + 1][0].isoformat(),
                                    **{k: v for k, v in zip(VALUES, seq[i][1], strict=True) if v is not None}}
                                   for i in range(len(seq) - 1)]
        out.append(row)
    return out
