"""Live investigation scenarios on the seeded mock data (amiri-agent/mcpservers), read
through amiri-server's coverage and calendar.

Each scenario is one request (findings for one institution) and what a correct
investigation produces: tasks that must exist, kept angles that must not, and
findings that must be out of scope. It also carries the reading a correct model
gives each finding it has to classify (news; a series move comes with its themes),
so tests/unit/test_scenarios.py can run every scenario offline with that reading and
prove the expectations are reachable.

Product ids here are the mock data source's own (source_product_id = product_id).

Run them live (amiri-server with the mock data source running) with:
    uv run python -m tests.scenarios.run
"""

import os
from dataclasses import dataclass, field

SERVER_URL = os.environ.get("AMIRI_SERVER_URL", "http://127.0.0.1:8000")

BANK = {
    "name": "Serendib Commercial Bank",
    "institution_type": "bank",
    "country": "LK",
    "country_name": "Sri Lanka",
    "currency": "LKR",
    "time_zone": "Asia/Colombo",
    "summary": "A Sri Lankan commercial bank serving retail households, migrant-worker families, "
    "pensioners, SMEs, importers, exporters and large corporates.",
    "rivals": ["HSBC Sri Lanka"],
    "regulators": ["Central Bank of Sri Lanka"],
    "flows": [{"kind": "remittances_in", "local": "LK", "counterpart": "AE"}],
    "corridors": ["AE", "SA", "QA", "KW"],
}
INSURER = {
    "name": "Serendib General Insurance",
    "institution_type": "insurer",
    "country": "LK",
    "country_name": "Sri Lanka",
    "currency": "LKR",
    "time_zone": "Asia/Colombo",
    "summary": "A Sri Lankan general insurer writing motor and home-and-fire policies.",
    "regulators": ["Insurance Regulatory Commission of Sri Lanka"],
}
BANK_PRODUCTS = [
    {"product_id": "youth_savings", "name": "Youth Savings Account", "category": "savings", "product_type": "savings_account"},
    {"product_id": "elders_savings", "name": "Elders Savings Account", "category": "savings", "product_type": "savings_account"},
    {"product_id": "term_deposit", "name": "Term Deposit", "category": "savings", "product_type": "term_deposit"},
    {"product_id": "migrant_savings", "name": "Migrant Family Savings Account", "category": "savings", "product_type": "savings_account"},
    {"product_id": "pawning_loan", "name": "Pawning Loan", "category": "gold_loan", "product_type": "gold_loan"},
    {"product_id": "personal_loan", "name": "Personal Loan", "category": "retail_loan", "product_type": "personal_loan"},
    {"product_id": "vehicle_leasing", "name": "Vehicle Leasing", "category": "vehicle_finance", "product_type": "vehicle_lease"},
    {"product_id": "credit_card", "name": "Credit Card", "category": "cards", "product_type": "credit_card"},
    {"product_id": "sme_loan", "name": "SME Loan", "category": "business_loan", "product_type": "working_capital"},
    {"product_id": "corporate_loan", "name": "Corporate Loan", "category": "business_loan", "product_type": "term_loan"},
    {"product_id": "startup_loan", "name": "Startup Loan", "category": "business_loan", "product_type": "term_loan"},
]  # fmt: skip
INSURER_PRODUCTS = [
    {"product_id": "motor", "name": "Motor Insurance", "category": "motor", "product_type": "private_motor"},
    {"product_id": "home_fire", "name": "Home and Fire Insurance", "category": "property", "product_type": "home"},
]  # fmt: skip


def signal(series_id, symbol, start, end, ref, obs, description, window_days=1):
    return {
        "series_id": series_id, "symbol": symbol, "direction": "up" if obs >= ref else "down",
        "start_at": start, "end_at": end, "ref_level": ref, "obs_level": obs,
        "change_pct": round((obs - ref) / ref * 100, 4), "window_days": window_days,
        "description": description,
    }  # fmt: skip


def headline(title, published_at, outlet="Daily Mirror"):
    return {"title": title, "published_at": published_at, "outlet": outlet}


def theme(spec: str) -> dict:
    """ "fx:weaker:LKR", "commodities:up:gold", "rates:down" -> a theme tag."""
    t, d, *extra = spec.split(":")
    key = "currency" if t == "fx" else "item"
    return {"theme": t, "direction": d, **({key: extra[0]} if extra else {})}


def move(fid, title, explanation, sig, themes, places=("LK",)):
    """A market series finding: the server's detector set its themes."""
    return {
        "finding_id": fid, "source": "timeseries", "source_ref": {"series_id": sig["series_id"]},
        "kind": "signal_move", "title": title, "explanation": explanation, "score": 70,
        "themes": [theme(t) for t in themes],
        "places": list(places), "evidence": {"signals": [sig]},
    }  # fmt: skip


def finding(fid, title, explanation, headlines=(), **extra):
    """A monitor's news match: no themes, so the agent classifies it."""
    return {
        "finding_id": fid, "source": "monitor", "source_ref": {"monitor_id": "mon-test"},
        "kind": "news_match", "title": title, "explanation": explanation, "score": 70,
        "evidence": {"headlines": list(headlines)}, **extra,
    }  # fmt: skip


@dataclass
class Scenario:
    name: str
    about: str
    institution: dict
    products: list[dict]
    findings: list[dict]
    # The reading a correct model gives each finding it classifies: finding_id -> answer.
    readings: dict[str, dict]
    # (product_id, metric or a tuple of acceptable metrics, filter subset) that must be among the tasks.
    tasks: list[tuple[str, str, dict]] = field(default_factory=list)
    no_tasks: bool = False
    # (product_id, angle) that must not be kept.
    not_kept: list[tuple[str, str]] = field(default_factory=list)
    # finding_id -> out-of-scope reason.
    out_of_scope: dict[str, str] = field(default_factory=dict)
    anchor_basis: str | None = None
    coverage: str = (
        ""  # tests/scenarios/data.py: mock-bank, mock-insurer, ph-bank, id-insurer
    )

    def __post_init__(self):
        if not self.coverage:
            bank = self.institution["institution_type"] == "bank"
            self.coverage = "mock-bank" if bank else "mock-insurer"

    def request(self, run_id: str) -> dict:
        return {"run_id": run_id, "institution_id": self.coverage, "server_url": SERVER_URL,
                "institution": self.institution, "products": self.products,
                "findings": self.findings}  # fmt: skip


def reading(
    *themes: str, country="home", channel="none", size=None, unit="none"
) -> dict:
    return {
        "themes": [theme(t) for t in themes],
        "country": country, "channel": channel, "size_value": size, "size_unit": unit,
        "effective_from": None,
    }  # fmt: skip


FLOOD = finding(
    "f-flood", "Floods in Ratnapura and Kalutara; CBSL asks banks to offer a 3-month moratorium",
    "Thousands displaced in Ratnapura and Kalutara districts; relief for affected borrowers.",
    headlines=[headline("Floods in Ratnapura and Kalutara; CBSL urges moratorium", "2026-11-25T04:00:00Z")],
    places=["LK-91", "LK-13"],  # Ratnapura and Kalutara districts (ISO 3166-2)
)  # fmt: skip

FX_MOVE = move(
    "f-ts-usd_lkr-2026100608", "USD/LKR up 1.45% in 1 trading day (5.0x typical)",
    "USD/LKR rose from 328.88 to 333.64 (+1.45%) over 1 trading day to 08:30 UTC on 6 Oct.",
    signal("usd_lkr", "USD/LKR", "2026-10-05T08:30:00Z", "2026-10-06T08:30:00Z", 328.88, 333.64,
           "USD/LKR rose from 328.88 to 333.64 (+1.45%) over 1 trading day to 08:30 UTC on 6 Oct, 5.0x its typical move."),
    ["fx:weaker:LKR"],
)  # fmt: skip

SCENARIOS = [
    Scenario(
        "fx_importers", "USD/LKR +1.45% in a trading day (series), and the news about it (monitor).",
        BANK, BANK_PRODUCTS,
        [FX_MOVE,
         finding("f-fx-news", "Rupee falls past 333 as importer dollar demand surges",
                 "Importers bought dollars; the rupee fell past 333.",
                 headlines=[headline("Rupee falls past 333 as importer dollar demand surges", "2026-10-06T08:06:00Z")])],
        {"f-fx-news": reading("fx:weaker")},
        # the fx_mismatch angle offers two mechanisms (fewer LCs, missed instalments): the model picks one
        tasks=[("sme_loan", ("lc_openings", "installment_collection_rate"), {"segment": "importer"}),
               ("sme_loan", "facility_utilization", {"segment": "importer"})],
        not_kept=[("pawning_loan", "collateral")], anchor_basis="move_start",
        out_of_scope={"f-fx-news": "merged_into_event"},
    ),
    Scenario(
        "fx_series_only", "The same move from the series alone: no model call to classify it.",
        BANK, BANK_PRODUCTS, [FX_MOVE], {},
        tasks=[("sme_loan", "lc_openings", {"segment": "importer"})], anchor_basis="move_start",
    ),
    Scenario(
        "fx_small_move", "USD/LKR +0.85%: below the importer mechanisms' 1% minimum.",
        BANK, BANK_PRODUCTS,
        [move("f-ts-usd_lkr-2026100809", "USD/LKR up 0.85% in 1 trading day (3.1x typical)",
              "USD/LKR rose from 330.73 to 333.53 (+0.85%).",
              signal("usd_lkr", "USD/LKR", "2026-10-07T09:30:00Z", "2026-10-08T09:30:00Z", 330.73, 333.53,
                     "USD/LKR rose from 330.73 to 333.53 (+0.85%) over 1 trading day, 3.1x its typical move."),
              ["fx:weaker:LKR"])],
        {}, no_tasks=True,
    ),
    Scenario(
        "foreign_fx_move", "USD/INR up 1.2%: a foreign currency with no flow home.",
        BANK, BANK_PRODUCTS,
        [move("f-ts-usd_inr-2026100608", "USD/INR up 1.2% in 1 trading day (4.0x typical)", "USD/INR rose 1.2%.",
              signal("usd_inr", "USD/INR", "2026-10-05T08:30:00Z", "2026-10-06T08:30:00Z", 84.0, 85.0,
                     "USD/INR rose from 84 to 85 (+1.19%) over 1 trading day."), [], places=["IN"])],
        {}, no_tasks=True, out_of_scope={"f-ts-usd_inr-2026100608": "not_home_country"},
    ),
    Scenario(
        "rate_cut", "CBSL cuts the Overnight Policy Rate by 25bp.",
        BANK, BANK_PRODUCTS,
        [finding("f-rate", "CBSL cuts Overnight Policy Rate by 25 basis points to 7.50%",
                 "The Central Bank of Sri Lanka cut its Overnight Policy Rate by 25 basis points.",
                 headlines=[headline("CBSL cuts Overnight Policy Rate by 25 basis points to 7.50%", "2026-10-01T02:05:00Z")])],
        {"f-rate": reading("rates:down", size=25, unit="bp")},
        tasks=[("term_deposit", "td_non_renewal_outflow", {})],
        not_kept=[("personal_loan", "repayment_stress")],
    ),
    Scenario(
        "remittance_down", "September remittances down 6% year on year (CBSL monthly data).",
        BANK, BANK_PRODUCTS,
        [finding("f-remit", "Workers' remittances US$ 610mn in September, down 6% year on year",
                 "CBSL monthly data show workers' remittances fell 6% year on year in September.",
                 headlines=[headline("Workers' remittances down 6% in September", "2026-10-12T05:00:00Z")],
                 period={"start": "2026-09-01", "end": "2026-09-30"})],
        {"f-remit": reading("remittance:down", size=6, unit="pct")},
        tasks=[("migrant_savings", "inward_remittance_credits", {"segment": "remittance_linked"}),
               ("pawning_loan", "new_pledges", {})],
        anchor_basis="period_start",
    ),
    Scenario(
        "flood_bank", "Floods in Ratnapura and Kalutara with a CBSL moratorium: the bank's view.",
        BANK, BANK_PRODUCTS, [FLOOD], {"f-flood": reading("disaster:domestic:flood")},
        tasks=[("personal_loan", "restructure_requests", {"region_l2": "LK-91"}),
               ("personal_loan", "restructure_requests", {"region_l2": "LK-13"})],
    ),
    Scenario(
        "flood_insurer", "The same floods: the insurer's view.",
        INSURER, INSURER_PRODUCTS, [FLOOD], {"f-flood": reading("disaster:domestic:flood")},
        tasks=[("home_fire", "claims_per_1000", {"peril": "flood", "region_l2": "LK-91"}),
               ("home_fire", "claims_per_1000", {"peril": "flood", "region_l2": "LK-13"}),
               ("motor", "claims_per_1000", {"claim_type": "natural_peril", "region_l2": "LK-91"})],
    ),
    Scenario(
        "gold_up", "Gold up 4.1% in 5 days (series): good news for pawning collateral.",
        BANK, BANK_PRODUCTS,
        [move("f-ts-xau_usd-2026101606", "Gold (XAU/USD) up 4.1% in 5 trading days (3.4x typical)",
              "Gold rose 4.1% in 5 trading days.",
              signal("xau_usd", "XAU/USD", "2026-10-12T06:00:00Z", "2026-10-16T06:00:00Z", 4000.0, 4164.0,
                     "Gold rose from 4000 to 4164 (+4.10%) over 5 trading days.", window_days=5),
              ["commodities:up:gold"])],
        {}, no_tasks=True,
    ),
    Scenario(
        "foreign_rate_cut", "A foreign central bank's rate cut, carried by a Colombo news site.",
        BANK, BANK_PRODUCTS,
        [finding("f-rbi", "Central bank cuts policy rate by 25 basis points",
                 "Repo-rate cut announced in Mumbai; carried by a Colombo news site.",
                 headlines=[headline("Central bank cuts policy rate by 25 basis points", "2026-10-08T04:45:00Z")])],
        {"f-rbi": reading("rates:down", country="other")},
        no_tasks=True, out_of_scope={"f-rbi": "not_home_country"},
    ),
    Scenario(
        "rival_failure", "CBSL cancels a finance company's licence: deposits may flow in.",
        BANK, BANK_PRODUCTS,
        [finding("f-rival", "CBSL cancels licence of Example Finance PLC",
                 "Depositors of Example Finance PLC are to be paid up to the deposit insurance limit.",
                 headlines=[headline("CBSL cancels licence of Example Finance PLC", "2026-10-21T13:00:00Z")])],
        {"f-rival": reading("trust:rival")},
        tasks=[("elders_savings", "deposit_inflow", {})],
    ),
]  # fmt: skip


PH_BANK = {
    "name": "Visayas Rural and Commercial Bank", "institution_type": "bank", "country": "PH",
    "country_name": "Philippines", "currency": "PHP", "time_zone": "Asia/Manila",
    "summary": "A Philippine rural and commercial bank: farm lending, SME credit, peso savings and remittances for "
    "overseas Filipino workers' families.",
    "flows": [{"kind": "remittances_in", "local": "PH", "counterpart": c} for c in ("SA", "AE", "US")],
    "corridors": ["SA", "AE", "US"],
}  # fmt: skip
PH_PRODUCTS = [
    {"product_id": "savings", "name": "Peso Savings", "category": "savings", "product_type": "savings_account"},
    {"product_id": "crop-loans", "name": "Crop Production Loans", "category": "agri_loan", "product_type": "crop_loan"},
    {"product_id": "sme-loans", "name": "SME Working Capital", "category": "business_loan", "product_type": "working_capital"},
    {"product_id": "ofw-remittances", "name": "OFW Remittances", "category": "remittances", "product_type": "inward_remittance"},
    {"product_id": "fx-desk", "name": "Customer FX", "category": "fx", "product_type": "spot_fx"},
    {"product_id": "bancassurance", "name": "Bancassurance", "category": "distribution", "product_type": "bancassurance"},
]  # fmt: skip
ID_INSURER = {
    "name": "Nusantara General Insurance", "institution_type": "insurer", "country": "ID",
    "country_name": "Indonesia", "currency": "IDR", "time_zone": "Asia/Jakarta",
    "summary": "An Indonesian general insurer: home and fire, private motor, rice crop cover, micro health and cargo.",
    "flows": [{"kind": "exports", "local": "ID", "counterpart": "CN"}, {"kind": "imports", "local": "ID", "counterpart": "SG"}],
}  # fmt: skip
ID_PRODUCTS = [
    {"product_id": "home-cover", "name": "Home and Fire", "category": "property", "product_type": "home"},
    {"product_id": "motor", "name": "Private Motor", "category": "motor", "product_type": "private_motor"},
    {"product_id": "crop-cover", "name": "Rice Crop Cover", "category": "agriculture", "product_type": "crop_indemnity"},
    {"product_id": "micro-health", "name": "Micro Health", "category": "micro_insurance", "product_type": "micro_health"},
    {"product_id": "cargo", "name": "Marine Cargo", "category": "marine", "product_type": "marine_cargo"},
]  # fmt: skip

SCENARIOS += [
    Scenario(
        "ph_typhoon", "A typhoon makes landfall in Eastern Visayas: farm borrowers there.",
        PH_BANK, PH_PRODUCTS,
        [finding("f-typhoon", "Typhoon makes landfall in Eastern Visayas; rice farms and roads flooded",
                 "PAGASA reports a super typhoon crossed Eastern Visayas; farms and roads were flooded.",
                 headlines=[headline("Super typhoon slams Eastern Visayas", "2026-10-20T03:00:00Z", "Inquirer")],
                 places=["PH-08"])],
        {"f-typhoon": reading("disaster:domestic:storm")},
        tasks=[("crop-loans", "installment_collection_rate", {"region_l1": "PH-08"}),
               ("crop-loans", "restructure_requests", {"region_l1": "PH-08"})],
        coverage="ph-bank",
    ),
    Scenario(
        "ph_saudi_jobs", "Saudi Arabia cuts foreign-worker quotas: remittances from there fall.",
        PH_BANK, PH_PRODUCTS,
        [finding("f-saudi", "Saudi Arabia cuts quotas for foreign construction workers",
                 "New quotas will cut tens of thousands of foreign construction jobs in Saudi Arabia.",
                 headlines=[headline("Saudi Arabia cuts foreign worker quotas", "2026-10-15T06:00:00Z", "Arab News")],
                 places=["SA"])],
        {"f-saudi": reading("remittance:down", country="other", channel="remittance")},
        tasks=[("ofw-remittances", "inward_remittances", {"corridor": "SA"})],
        coverage="ph-bank",
    ),
    Scenario(
        "ph_peso_move", "USD/PHP up 1.8% in a day (series): customers buy dollars.",
        PH_BANK, PH_PRODUCTS,
        [move("f-ts-usd_php-2026101506", "USD/PHP up 1.80% in 1 trading day (6.0x typical)", "USD/PHP rose 1.80%.",
              {**signal("usd_php", "USD/PHP", "2026-10-14T06:00:00Z", "2026-10-15T06:00:00Z", 58.0, 59.044,
                        "USD/PHP rose from 58.00 to 59.04 (+1.80%) over 1 trading day, 6.0x its typical move."),
               "typical_daily_move_pct": 0.3},
              ["fx:weaker:PHP"], places=["PH"])],
        {}, tasks=[("fx-desk", "customer_fx_purchases", {})], coverage="ph-bank",
    ),
    Scenario(
        "id_jakarta_flood", "Floods in Jakarta: home and motor claims there.",
        ID_INSURER, ID_PRODUCTS,
        [finding("f-jkt", "Floods inundate parts of Jakarta after record rainfall",
                 "BNPB reports floods across Jakarta; thousands of homes and vehicles were damaged.",
                 headlines=[headline("Banjir rendam Jakarta", "2026-11-10T02:00:00Z", "Kompas")], places=["ID-JK"])],
        {"f-jkt": reading("disaster:domestic:flood")},
        tasks=[("home-cover", "claims_per_1000", {"peril": "flood", "region_l1": "ID-JK"}),
               ("motor", "claims_per_1000", {"claim_type": "natural_peril"})],
        coverage="id-insurer",
    ),
    Scenario(
        "id_dengue", "A dengue outbreak: micro health claims, not property.",
        ID_INSURER, ID_PRODUCTS,
        [finding("f-dengue", "Dengue cases surge in West Java", "The health ministry reports a sharp rise in dengue cases.",
                 headlines=[headline("Kasus DBD melonjak di Jawa Barat", "2026-11-01T02:00:00Z", "Tempo")], places=["ID-JB"])],
        {"f-dengue": reading("disaster:domestic:epidemic")},
        tasks=[("micro-health", "claims_per_1000", {"region_l1": "ID-JB"})],
        not_kept=[("home-cover", "catastrophe")],
        coverage="id-insurer",
    ),
]  # fmt: skip


def evaluate(s: Scenario, result: dict) -> list[dict]:
    """The scenario's checks against an investigation result (JSON)."""
    checks = []
    tasks = result["tasks"]
    for product, metric, filt in s.tasks:
        options = (
            metric if isinstance(metric, tuple) else (metric,)
        )  # any of these is a right choice
        metric = " or ".join(options)
        ok = any(
            t["product_id"] == product and t["metric"] in options
            and all(t["filter"].get(k) == v for k, v in filt.items())
            for t in tasks
        )  # fmt: skip
        checks.append(
            {"check": f"task {product}.{metric} {filt or ''}".strip(), "ok": ok}
        )
    if s.no_tasks:
        checks.append({"check": "no tasks", "ok": not tasks,
                       "detail": [f"{t['product_id']}.{t['metric']}" for t in tasks]})  # fmt: skip
    kept = {
        (p, x["angle"])
        for x in result["screening"]
        if x["decision"] == "kept"
        for p in x["product_ids"]
    }
    for product, angle in s.not_kept:
        checks.append(
            {"check": f"not kept {product}.{angle}", "ok": (product, angle) not in kept}
        )
    reasons = {o["finding_id"]: o["reason"] for o in result["out_of_scope"]}
    for fid, reason in s.out_of_scope.items():
        checks.append({"check": f"{fid} out of scope: {reason}", "ok": reasons.get(fid) == reason,
                       "detail": reasons.get(fid)})  # fmt: skip
    if s.anchor_basis:
        bases = [e["anchor_basis"] for e in result["events"]]
        checks.append({"check": f"anchor from {s.anchor_basis}", "ok": s.anchor_basis in bases,
                       "detail": bases})  # fmt: skip
    checks.append({"check": "finished", "ok": result["stop_reason"] == "finished",
                   "detail": result["stop_reason"]})  # fmt: skip
    return checks
