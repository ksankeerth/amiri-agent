"""Monitor check scenarios (contract 2.0: web search only).

Each scenario is one monitor, one check window, and what web search returns: the sources
(with the pages' own titles and dates) and the search answer. It says what a correct check
reports: the findings (the line each meets and the pages it cites), and the pages it must
not cite. Search and pages are stubbed (repeatable, no grounding quota needed); the model
is live in tests.scenarios.run and scripted in tests/unit/test_scenarios.py.
"""

import copy
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import examples
from app.pages import Page


def t(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(UTC)


@dataclass
class Source:
    url: str
    title: str  # the page's own title
    published: str | None  # the page's own date, or None when it has none


@dataclass
class Expected:
    lines: set[int]  # the tell_me_if lines the finding meets (at least one of them)
    urls: set[str]  # it cites at least one of these


@dataclass
class Scenario:
    name: str
    about: str
    request: dict
    sources: list[Source]
    answer: str
    findings: list[Expected] = field(default_factory=list)
    must_not_cite: set[str] = field(default_factory=set)

    def pages(self) -> dict[str, Page]:
        return {
            s.url: Page(s.url, s.title, t(s.published) if s.published else None)
            for s in self.sources
        }


def monitor(**public_changes) -> dict:
    """The Gulf jobs monitor of the examples, changed."""
    r = copy.deepcopy(examples.REQUEST)
    r["recent_urls"] = []
    r["monitor"]["spec"]["public"].update(public_changes)
    return r


def ph_bank(spec_public: dict, name: str) -> dict:
    r = copy.deepcopy(examples.REQUEST)
    r["recent_urls"] = []
    r["institution"] = {
        "name": "Visayas Rural and Commercial Bank",
        "institution_type": "bank",
        "country": "PH",
        "country_name": "Philippines",
        "currency": "PHP",
        "time_zone": "Asia/Manila",
        "summary": "A Philippine bank: farm lending, SME credit, peso savings, remittances for OFW families.",
        "segments": [{"id": "ofw-families", "label": "OFW families"}],
        "products": [
            {
                "id": "ofw-remittances",
                "name": "OFW Remittances",
                "category": "remittances",
                "product_type": "inward_remittance",
            }
        ],
        "flows": [
            {
                "id": "remit-sa",
                "kind": "remittances_in",
                "local": "PH",
                "counterpart": "SA",
            }
        ],
        "corridors": ["SA", "AE"],
    }
    spec = r["monitor"]["spec"]
    spec["about"]["name"] = name
    spec["about"]["key_dates"] = []
    spec["private"]["exposure"] = [
        {"id": "segment:ofw-families", "how_it_reaches_us": "OFW pay funds deposits."}
    ]
    spec["public"].update(spec_public)
    return r


def id_insurer(spec_public: dict, name: str) -> dict:
    r = copy.deepcopy(examples.REQUEST)
    r["recent_urls"] = []
    r["institution"] = {
        "name": "Samudra Raya General Insurance",
        "institution_type": "insurer",
        "country": "ID",
        "country_name": "Indonesia",
        "currency": "IDR",
        "time_zone": "Asia/Jakarta",
        "summary": "An Indonesian general insurer: home and fire, private motor, crop cover.",
        "products": [
            {
                "id": "home-cover",
                "name": "Home and Fire",
                "category": "property",
                "product_type": "home",
            }
        ],
    }
    spec = r["monitor"]["spec"]
    spec["about"].update(name=name, key_dates=[], owner="Claims")
    spec["private"]["exposure"] = [
        {
            "id": "product:home-cover",
            "how_it_reaches_us": "Flood claims on insured homes.",
        }
    ]
    spec["public"].update(spec_public)
    return r


AN = "https://www.arabnews.com/node/2591234"
ARAMCO = "https://www.arabnews.com/node/2591300"
OLD_UAE = "https://www.khaleejtimes.com/uae/2025/visa-amnesty"
BLOG = "https://example-blog.net/post/gulf-jobs"

SCENARIOS = [
    Scenario(
        "quota_cut", "Saudi Arabia cuts foreign-worker quotas: line 2, one dated page; an old and an off-topic page.",
        monitor(),
        [Source(AN, "Saudi Arabia cuts quotas for foreign construction workers | Arab News", "2026-10-12T08:40:00Z"),
         Source(ARAMCO, "Saudi Aramco reports higher quarterly profit", "2026-10-12T09:10:00Z"),
         Source(OLD_UAE, "UAE extends visa amnesty for overstayers", "2025-12-01T10:00:00Z")],
        "Arab News reported on 12 October 2026 that Saudi Arabia cuts quotas for foreign construction workers. "
        "Saudi Aramco reported higher quarterly profit. In December 2025 the UAE extended a visa amnesty.",
        findings=[Expected({2}, {AN})], must_not_cite={ARAMCO, OLD_UAE},
    ),
    Scenario(
        "quiet", "Gulf business news, nothing that meets a line.",
        monitor(),
        [Source(ARAMCO, "Saudi Aramco reports higher quarterly profit", "2026-10-12T09:10:00Z"),
         Source("https://gulfnews.com/business/airshow-1.2", "Dubai Airshow opens with record orders",
                "2026-10-12T09:30:00Z")],
        "Saudi Aramco reported higher quarterly profit, and the Dubai Airshow opened with record orders.",
        must_not_cite={ARAMCO, "https://gulfnews.com/business/airshow-1.2"},
    ),
    Scenario(
        "undated_only", "The only matching page has no date: nothing can be reported.",
        monitor(),
        [Source(BLOG, "Saudi Arabia to cut foreign worker quotas, sources say", None)],
        "A blog says Saudi Arabia will cut foreign worker quotas.",
        must_not_cite={BLOG},
    ),
    Scenario(
        "confused_name", "A rival monitor: news about a different company with a similar name is not a match.",
        monitor(watch=[{"name": "Coastal Remit", "type": "organisation", "other_forms": ["CoastalRemit"],
                        "not_confused_with": ["Coastal Bank"]}],
                in_one_sentence="Moves by the remittance company Coastal Remit on the UAE-Sri Lanka corridor.",
                tell_me_if=["Coastal Remit cuts fees or adds corridors to Sri Lanka",
                            "Coastal Remit offers better exchange rates than banks"],
                example_headlines={"match": [], "not_match": []}),
        [Source("https://www.dailymirror.lk/business/coastal-bank-fined/1", "Coastal Bank fined for AML lapses",
                "2026-10-12T09:05:00Z"),
         Source("https://economynext.com/coastalremit-zero-fee-sri-lanka", "CoastalRemit drops fees on UAE to Sri Lanka transfers",
                "2026-10-12T09:20:00Z")],
        "Coastal Bank was fined for AML lapses. CoastalRemit dropped its fees on transfers from the UAE to Sri Lanka.",
        findings=[Expected({1}, {"https://economynext.com/coastalremit-zero-fee-sri-lanka"})],
        must_not_cite={"https://www.dailymirror.lk/business/coastal-bank-fined/1"},
    ),
    Scenario(
        "ph_tagalog", "A Philippine bank's Gulf-jobs monitor: a Tagalog headline about Saudi job cuts.",
        ph_bank({"watch": [{"name": "Saudi Arabia", "type": "place", "other_forms": ["KSA", "Saudi"], "not_confused_with": []},
                           {"name": "OFW", "type": "topic", "other_forms": ["overseas Filipino workers"], "not_confused_with": []}],
                 "in_one_sentence": "Events in the Gulf that could cut jobs or pay for overseas Filipino workers.",
                 "tell_me_if": ["Conflict or attacks affect a Gulf state where many OFWs work",
                                "A Gulf state announces job cuts, visa limits or wage controls for foreign workers"],
                 "example_headlines": {"match": [], "not_match": []},
                 "places": ["SA", "AE", "PH"], "languages": ["tl", "en"]}, "OFW jobs in the Gulf"),
        [Source("https://www.abante.com.ph/2026/10/12/saudi-ofw", "Saudi Arabia, magbabawas ng mga dayuhang manggagawa sa konstruksiyon",
                "2026-10-12T09:00:00Z")],
        "Abante reported on 12 October 2026 that Saudi Arabia will cut foreign construction workers "
        "(Saudi Arabia, magbabawas ng mga dayuhang manggagawa sa konstruksiyon).",
        findings=[Expected({2}, {"https://www.abante.com.ph/2026/10/12/saudi-ofw"})],
    ),
    Scenario(
        "id_flood", "An Indonesian insurer's flood monitor: Bahasa and English pages; the old flood is not reported.",
        id_insurer({"watch": [{"name": "Jakarta", "type": "place", "other_forms": ["DKI Jakarta"], "not_confused_with": []},
                              {"name": "floods", "type": "topic", "other_forms": ["banjir"], "not_confused_with": []}],
                    "in_one_sentence": "Floods that damage homes in Jakarta, where much of our home cover is.",
                    "tell_me_if": ["Floods damage homes in Jakarta", "The government declares a flood emergency in Jakarta"],
                    "example_headlines": {"match": [], "not_match": []},
                    "places": ["ID-JK"], "languages": ["id", "en"]}, "Jakarta floods"),
        [Source("https://www.kompas.com/2026/10/12/banjir-jakarta", "Banjir rendam ribuan rumah di Jakarta Timur",
                "2026-10-12T09:25:00Z"),
         Source("https://www.thejakartapost.com/2026/10/12/floods", "Floods inundate thousands of homes in East Jakarta",
                "2026-10-12T09:45:00Z"),
         Source("https://www.thejakartapost.com/2025/02/old-floods", "Jakarta floods displace thousands",
                "2025-02-10T03:00:00Z")],
        "Kompas and The Jakarta Post reported on 12 October 2026 that floods inundated thousands of homes in East "
        "Jakarta. In February 2025 floods displaced thousands in Jakarta.",
        findings=[Expected({1}, {"https://www.kompas.com/2026/10/12/banjir-jakarta",
                                 "https://www.thejakartapost.com/2026/10/12/floods"})],
        must_not_cite={"https://www.thejakartapost.com/2025/02/old-floods"},
    ),
]  # fmt: skip


def evaluate(s: Scenario, result: dict) -> list[dict]:
    """The scenario's checks against a check result (JSON)."""
    out = []
    found = result["findings"]
    cited = {w["url"] for f in found for w in f["evidence"]["web"]}
    for e in s.findings:
        ok = any(
            set(f["tell_me_if_lines"]) & e.lines
            and {w["url"] for w in f["evidence"]["web"]} & e.urls
            for f in found
        )
        out.append(
            {
                "check": f"a finding meets line {sorted(e.lines)} citing {sorted(e.urls)[0]}",
                "ok": ok,
            }
        )
    out.append(
        {
            "check": f"{len(s.findings)} finding(s)",
            "ok": len(found) == len(s.findings),
            "detail": [f["title"] for f in found],
        }
    )
    for u in sorted(s.must_not_cite):
        out.append({"check": f"does not cite {u}", "ok": u not in cited})
    out.append(
        {
            "check": "finished",
            "ok": result["stop_reason"] == "finished",
            "detail": result["stop_reason"],
        }
    )
    return out
