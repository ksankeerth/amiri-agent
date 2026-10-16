"""Where news reaches the institution, case by case: what the code alone decides.

Each case is one or two findings with ideal themes (as if the model read them perfectly), run through the
whole investigation with a model that keeps every candidate. So every expectation here is about the code:
the scope rule (home, footprint, remittance, trade, sea lanes, a monitor's exposures, world prices), the
footprint's books, and how findings group into events.

The institutions are two sample profiles, as the server sends them: a Sri Lankan bank (branches in three
Indian states, a representative office in Dubai) and an Indonesian general insurer (a representative office
in Singapore), with the server's coverage for the bank and its place info for the codes used.
"""

import asyncio
import json
from datetime import timedelta
from pathlib import Path

import pytest

from app.contract import InvestigationRequest
from app.data_client import Calendar
from app.investigate import Investigation

FIXTURES = Path(__file__).parents[1] / "fixtures"
BANK = json.loads((FIXTURES / "probe_bank.json").read_text())
INSURER = json.loads((FIXTURES / "probe_insurer.json").read_text())
WHEN = "2026-10-15T08:00:00Z"


class Data:
    def __init__(self, coverage):
        self.cov = coverage

    async def coverage(self, req):
        return self.cov or {"data_source": {"data_source_id": "none"}, "products": []}

    async def calendar(self, req, start, until):
        days = [start + timedelta(n) for n in range((until - start).days)]
        return Calendar([d for d in days if d.isoweekday() < 6], "test")


class KeepAll:
    """Screen keeps every product; choose takes the first option; classify isn't reached (themes are set)."""

    async def __call__(self, step, prompt, schema):
        props = schema["properties"]
        if step == "screen":
            return {"keep": True, "product_ids": props["product_ids"]["items"]["enum"], "reason": "test"}, "m"
        if step == "classify":
            return {"themes": [], "country": "other", "channel": "none"}, "m"
        field, spec = next(iter(props.items()))
        return {field: spec["enum"][0]}, "m"


def T(theme, direction, **kw):
    return {"theme": theme, "direction": direction, **kw}


def F(title, places, *themes, when=WHEN, exposure=None):
    return {"title": title, "places": places, "themes": list(themes), "when": when, "exposure": exposure}


def run(profile, findings):
    body = {
        "run_id": "inv-test", "institution_id": "probe", "server_url": "http://localhost:9",
        "institution": profile["institution"], "products": profile["products"],
        "place_info": {p: profile["place_info"][p] for f in findings for p in f["places"] if p in profile["place_info"]},
        "findings": [
            {"finding_id": f"f{i}", "source": "monitor", "source_ref": {}, "kind": "news_match", "title": f["title"],
             "explanation": f["title"], "score": 70, "themes": f["themes"], "places": f["places"],
             "evidence": {"headlines": [{"title": f["title"], "published_at": f["when"]}]},
             **({"exposure": f["exposure"]} if f["exposure"] else {})}
            for i, f in enumerate(findings, 1)
        ],
    }
    req = InvestigationRequest.model_validate(body)
    return asyncio.run(Investigation(req, KeepAll(), Data(profile["coverage"])).run())


def products(result, event_id=None):
    return {h.product_id for h in result.hypotheses if event_id in (None, h.event_id)}


OIL_UP = T("commodities", "up", item="oil")
HORMUZ_EXPOSURE = {
    "products": ["import-lcs"], "segments": ["sme-importers"], "flows": [{"kind": "imports", "counterpart": "AE"}],
    "notes": ["Crude passes Hormuz; a stop raises the import bill."],
}

# id, profile, findings, expected: ("aside", words in the note) | (events, channel, must reach, must not reach)
CASES = [
    # ---- abroad, reached by trade, sea lanes, world prices or a monitor's exposures
    ("B1 Hormuz sinkings: the lane Colombo – Hormuz – Gulf", BANK,  # noqa: RUF001
     [F("Two cargo ships sunk in Strait of Hormuz", ["chk:hormuz", "IR"], OIL_UP)],
     (1, "sector", {"vehicle-loans", "sme-working-capital"}, set())),
    ("B1b the same news placed in Iran only, from a monitor naming its exposures", BANK,
     [F("Ship sunk off Iran", ["IR"], OIL_UP, exposure=HORMUZ_EXPOSURE)],
     (1, "exposure", {"vehicle-loans"}, set())),
    ("B1c Iran only, no exposures: only world prices come home", BANK,
     [F("Iran oil exports fall", ["IR"], OIL_UP)],
     (1, "none", {"vehicle-loans"}, set())),
    ("B2 Ryazan refinery hit: Russia buys our tea, and oil is a world price", BANK,
     [F("Drones hit Ryazan refinery", ["RU"], OIL_UP)],
     (1, "sector", {"vehicle-loans"}, set())),
    ("B3 Brent jumps, no place", BANK,
     [F("Brent jumps 6% as Gulf attacks spread", [], OIL_UP)],
     (1, "none", {"vehicle-loans", "crop-loans"}, set())),
    ("B12 Red Sea attacks: the lane Colombo – Suez – Europe carries garment exports", BANK,  # noqa: RUF001
     [F("Houthis attack ships in the Red Sea", ["chk:bab-el-mandeb", "sea:red-sea", "YE"],
        T("sector", "shock", sector="shipping"))],
     (1, "sector", set(), set())),
    ("B19 US tariffs on Sri Lankan apparel: the US buys our garments", BANK,
     [F("US raises tariff on Sri Lankan apparel to 30%", ["US"], T("regulation", "tariff"))],
     (1, "sector", {"export-finance"}, {"import-lcs"})),
    ("B20 refinery fire in Singapore, where our fuel comes from", BANK,
     [F("Fire shuts Singapore refinery", ["SG"], T("disaster", "abroad", item="fire"))],
     (1, "sector", {"import-lcs"}, {"export-finance"})),
    ("B10b floods in Delhi: India, but not where the branches are; India sells us goods", BANK,
     [F("Floods in Delhi", ["IN-DL"], T("disaster", "domestic", item="flood"))],
     (1, "sector", {"import-lcs"}, {"crop-loans", "housing-loans"})),
    # ---- remittance corridors, including the UAE, where the bank only has a representative office
    ("B5 Saudi layoffs: fewer remittances", BANK,
     [F("Saudi contractors lay off foreign workers", ["SA"], T("sector", "shock", sector="construction"))],
     (1, "remittance", {"inward-remittances", "migrant-savings"}, {"export-finance"})),
    ("B6 UAE layoffs: a corridor, not a home market (the Dubai desk lends nothing)", BANK,
     [F("Dubai firms cut migrant workers' jobs", ["AE"], T("sector", "shock", sector="construction"))],
     (1, "remittance", {"inward-remittances", "migrant-savings"}, {"corporate-term-loans", ".sector"})),
    ("B7 UAE remittances stated to fall", BANK,
     [F("Remittances from the UAE expected to fall", ["AE"], T("remittance", "down"))],
     (1, "remittance", {"inward-remittances"}, set())),
    # ---- the footprint: only what is booked there
    ("B16 Indian rupee record low: only the INR book, not Sri Lankan importers", BANK,
     [F("Indian rupee hits record low", ["IN"], T("fx", "weaker", currency="INR"))],
     (1, "none", {"fx-spot"}, {"import-lcs", "migrant-savings", "corporate-term-loans", "sme-term-loans"})),
    ("B10 cyclone in Tamil Nadu: the branches' state, but no Sri Lankan pawning book there", BANK,
     [F("Cyclone makes landfall near Chennai", ["IN-TN"], T("disaster", "domestic", item="storm"))],
     (1, "none", set(), {"gold-loans", "housing-loans", "crop-loans"})),
    # ---- home
    ("B11 floods in the Eastern Province", BANK,
     [F("Floods in Batticaloa and Ampara", ["LK-5"], T("disaster", "domestic", item="flood"))],
     (1, "none", {"crop-loans", "housing-loans"}, set())),
    ("B14 a rival bank run", BANK,
     [F("Depositors queue at a rival bank", ["LK"], T("trust", "rival"))],
     (1, "none", {"savings-accounts"}, set())),
    ("B15 the rupee weakens", BANK,
     [F("Rupee falls to 336 per dollar", ["LK"], T("fx", "weaker", currency="LKR"))],
     (1, "none", {"import-lcs", "fx-spot"}, set())),
    ("B17 CBSL raises its policy rate", BANK,
     [F("CBSL raises policy rate by 50 bp", ["LK"], T("rates", "up"))],
     (1, "none", {"fixed-deposits", "housing-loans"}, set())),
    ("B18 fuel prices rise at home", BANK,
     [F("CPC raises diesel and petrol prices", ["LK"], T("prices", "up", item="fuel"))],
     (1, "none", {"vehicle-loans"}, set())),
    ("B21 gold falls 6%", BANK,
     [F("Gold falls 6% as the dollar surges", [], T("commodities", "down", item="gold"))],
     (1, "none", {"gold-loans"}, set())),
    # ---- grouping: different items or sectors are different events
    ("B8 gold up and oil up the same day are two events", BANK,
     [F("Gold hits a record", ["LK"], T("commodities", "up", item="gold")),
      F("Oil jumps", ["LK"], OIL_UP, when="2026-10-15T10:00:00Z")],
     (2, "none", {"vehicle-loans"}, set())),
    ("B9 a tourism shock and an apparel shock are two events", BANK,
     [F("Hotel bookings collapse", ["LK"], T("sector", "shock", sector="tourism")),
      F("Garment orders cancelled", ["LK"], T("sector", "shock", sector="apparel"), when="2026-10-15T12:00:00Z")],
     (2, "none", set(), set())),
    # ---- sanctions, travel rules, and import rules: ours or a market's
    ("B22 OFAC sanctions a Gulf exchange house: remittances through it stall", BANK,
     [F("OFAC sanctions a Gulf exchange house", ["US", "AE"], T("regulation", "sanctions"))],
     (1, "remittance", {"inward-remittances"}, set())),
    ("B23 the US tightens imports of garments: our exporters, not our vehicle leasing", BANK,
     [F("US tightens import rules on apparel", ["US"], T("regulation", "import_control_tighter"))],
     (1, "sector", {"export-finance"}, {"vehicle-loans", "crop-loans", "import-lcs"})),
    ("B24 Sri Lanka tightens vehicle imports: our leasing", BANK,
     [F("Sri Lanka restricts vehicle imports", ["LK"], T("regulation", "import_control_tighter"))],
     (1, "none", {"vehicle-loans", "import-lcs"}, {"export-finance"})),
    ("I9b Saudi cuts the Hajj quota, read as a travel rule: pilgrim travel", INSURER,
     [F("Saudi Arabia cuts Indonesia's Hajj quota", ["SA"], T("regulation", "travel_tighter"))],
     (1, "remittance", {"pilgrim-travel"}, {"private-motor"})),
    # ---- known gaps, kept visible: foreign rates in a booked currency, sanctions (no theme yet)
    ("B4 the Fed hikes (gap: foreign rates aren't carried yet)", BANK,
     [F("Fed raises rates by 50 bp", ["US"], T("rates", "up"))],
     ("aside", "US: a trade partner")),
    ("B13 OFAC sanctions a Gulf exchange house: fewer remittances (a sanctions theme is still a gap)", BANK,
     [F("OFAC sanctions a Gulf exchange house", ["US", "AE"], T("regulation", "central_bank_direction"))],
     (1, "remittance", {"inward-remittances"}, set())),
    # ---- the insurer
    ("I1 Gulf war-risk premiums: no lane or flow of Indonesia's, and no monitor", INSURER,
     [F("Gulf war-risk premiums jump", ["chk:hormuz", "IR"], T("sector", "shock", sector="shipping"))],
     ("aside", "no flow to ID")),
    ("I1b the same news from a monitor naming the marine books", INSURER,
     [F("Gulf war-risk premiums jump", ["chk:hormuz", "IR"], T("sector", "shock", sector="shipping"),
        exposure={"products": ["marine-hull", "marine-cargo"], "notes": ["Indonesian fleets trade to the Gulf."]})],
     (1, "exposure", {"marine-hull"}, set())),
    ("I2 reinsurers raise rates (no flow; needs a monitor's exposures)", INSURER,
     [F("Reinsurers signal higher 1 January rates", ["DE", "CH"], T("sector", "shock", sector="reinsurance"))],
     ("aside", "no flow to ID")),
    ("I3 MSCI downgrade, index down (gap: no investment portfolio product)", INSURER,
     [F("MSCI consults on a downgrade; index falls 7%", ["ID"], T("markets", "equity_down"))],
     (1, "none", set(), set())),
    ("I4 rupiah past 18,000", INSURER,
     [F("Rupiah weakens past 18,000 per dollar", ["ID"], T("fx", "weaker", currency="IDR"))],
     (1, "none", {"private-motor", "group-health"}, set())),
    ("I5 Malaysia lays off Indonesian workers", INSURER,
     [F("Malaysian plantations lay off Indonesian workers", ["MY"], T("sector", "shock", sector="plantations"))],
     (1, "remittance", set(), set())),
    ("I6 earthquake in West Java", INSURER,
     [F("Earthquake hits Cianjur", ["ID-JB"], T("disaster", "domestic", item="earthquake"))],
     (1, "none", {"home-cover", "commercial-property"}, set())),
    ("I7 coal falls 15%: China buys our coal", INSURER,
     [F("Coal falls 15% as China cuts imports", ["CN"], T("commodities", "down"))],
     (1, "sector", set(), set())),
    ("I8 Singapore marine rates: a representative office writes no policies", INSURER,
     [F("Singapore marine insurers cut cargo rates", ["SG"], T("competitor", "cheaper"))],
     ("aside", "no flow to ID")),
    ("I9 the Hajj quota misread as an import control: set aside (I9b reads it right)", INSURER,
     [F("Saudi Arabia cuts Indonesia's Hajj quota", ["SA"], T("regulation", "import_control_tighter"))],
     ("aside", "remittances to ID")),
    ("I10 floods in North Jakarta", INSURER,
     [F("Floods inundate North Jakarta", ["ID-JK"], T("disaster", "domestic", item="flood"))],
     (1, "none", {"home-cover", "private-motor"}, set())),
    ("I11 typhoon in Taiwan, where Indonesian workers are", INSURER,
     [F("Typhoon hits Taiwan factories", ["TW"], T("disaster", "abroad", item="storm"))],
     (1, "remittance", set(), set())),
]


@pytest.mark.parametrize("name,profile,findings,expected", CASES, ids=[c[0].split(" ")[0] for c in CASES])
def test_where_news_reaches(name, profile, findings, expected):
    result = run(profile, findings)
    if expected[0] == "aside":
        assert result.events == [], f"{name}: expected set aside, got {[e.title for e in result.events]}"
        notes = " ".join(o.note or "" for o in result.out_of_scope)
        assert {o.reason for o in result.out_of_scope} == {"not_home_country"} and expected[1] in notes, notes
        return
    n, channel, reach, avoid = expected
    cut = [f"{s.product_type}/{s.angle}" for s in result.screening if s.decision == "cut_by_cap"]
    assert not cut, f"{name}: the cap pushed out {cut}"
    assert len(result.events) == n, f"{name}: {[(e.title, [t.theme for t in e.themes]) for e in result.events]}"
    assert {c.channel for c in result.classifications} == {channel}, result.classifications
    got = products(result)
    assert reach <= got, f"{name}: missing {reach - got}; got {sorted(got)}"
    assert not ({a for a in avoid if not a.startswith(".")} & got), f"{name}: should not reach {avoid & got}"
    for suffix in (a for a in avoid if a.startswith(".")):  # a kind of effect, by its mechanism's name
        wrong = [h.mechanism_id for h in result.hypotheses if h.mechanism_id.endswith(suffix)]
        assert not wrong, f"{name}: {wrong}"


def test_two_items_on_one_day_keep_their_own_effects():
    result = run(BANK, [F("Gold hits a record", ["LK"], T("commodities", "up", item="gold")),
                        F("Oil jumps", ["LK"], OIL_UP, when="2026-10-15T10:00:00Z")])
    by_item = {e.themes[0].item: e for e in result.events}
    assert set(by_item) == {"gold", "oil"}
    assert "vehicle-loans" in products(result, by_item["oil"].event_id)
    assert "vehicle-loans" not in products(result, by_item["gold"].event_id)


def test_the_screen_sees_how_the_monitor_s_owner_says_it_reaches_us():
    prompts = []

    class Spy(KeepAll):
        async def __call__(self, step, prompt, schema):
            prompts.append(prompt)
            return await super().__call__(step, prompt, schema)

    req = InvestigationRequest.model_validate({
        "run_id": "inv-test", "institution_id": "probe", "server_url": "http://localhost:9",
        "institution": BANK["institution"], "products": BANK["products"],
        "findings": [{"finding_id": "f1", "source": "monitor", "kind": "news_match", "title": "Ship sunk off Iran",
                      "explanation": "x", "score": 70, "themes": [OIL_UP], "places": ["IR"],
                      "evidence": {"headlines": [{"title": "Ship sunk off Iran", "published_at": WHEN}]},
                      "exposure": HORMUZ_EXPOSURE}],
    })
    asyncio.run(Investigation(req, Spy(), Data(BANK["coverage"])).run())
    assert any("Crude passes Hormuz; a stop raises the import bill." in p for p in prompts)


def test_an_insurer_is_told_why_a_markets_move_reaches_nothing():
    result = run(INSURER, [F("MSCI consults on a downgrade; index falls 7%", ["ID"], T("markets", "equity_down"))])
    assert result.hypotheses == [] and "investment portfolio" in result.report
    assert "none of the institution's products has a track for markets equity down" in result.report


def _rupee(size_pct: float | None) -> dict:
    """The rupee weaker: from news with no size ("near 331"), or a series move of size_pct."""
    f = {"finding_id": "f1", "source": "monitor", "kind": "news_match", "score": 60, "places": ["LK"],
         "title": "Rupee closes near 331 to the dollar", "explanation": "x",
         "themes": [T("fx", "weaker", currency="LKR")],
         "evidence": {"headlines": [{"title": "Rupee closes near 331 to the dollar", "published_at": WHEN}]}}
    if size_pct is not None:
        f |= {"source": "timeseries", "kind": "signal_move", "title": f"USD/LKR up {size_pct}%",
              "evidence": {"signals": [{"series_id": "usd_lkr", "symbol": "USD/LKR", "direction": "up",
                                        "start_at": "2026-10-14T08:00:00Z", "end_at": WHEN, "ref_level": 330.0,
                                        "obs_level": 330.0 * (1 + size_pct / 100), "change_pct": size_pct,
                                        "typical_daily_move_pct": 0.22, "description": "move"}]}}
    return f


def _run_one(finding: dict):
    req = InvestigationRequest.model_validate({
        "run_id": "inv-test", "institution_id": "probe", "server_url": "http://localhost:9",
        "institution": BANK["institution"], "products": BANK["products"], "findings": [finding]})
    return asyncio.run(Investigation(req, KeepAll(), Data(BANK["coverage"])).run())


def test_a_quoted_level_is_not_a_move_but_a_measured_one_is():
    level = {h.mechanism_id for h in _run_one(_rupee(None)).hypotheses}
    moved = {h.mechanism_id for h in _run_one(_rupee(2.0)).hypotheses}
    gated = "fc_deposit.fc_flows.currency_weaker"  # secondary, from a 1% move
    assert "trade_finance.fx_mismatch.imports" in level  # a primary effect stays: the model judges
    assert gated not in level and gated in moved


def test_one_shock_reported_abroad_and_at_home_is_one_event():
    """"Iran closes Hormuz" (oil up, abroad) and "fuel rationing" (fuel prices and oil up, at home): one world
    price move, one event, at home, so one set of effects and alerts."""
    result = run(BANK, [F("Iran closes the Strait of Hormuz", ["chk:hormuz", "IR"], OIL_UP),
                        F("Fuel rationing at stations", ["LK"], T("prices", "up", item="fuel"), OIL_UP,
                          when="2026-10-16T08:00:00Z")])
    assert len(result.events) == 1 and result.events[0].country == "home"
    assert {o.reason for o in result.out_of_scope} == {"merged_into_event"}


def test_a_resize_lists_only_what_qualifies_at_the_new_size():
    """The rupee slid from 1.09% to 6.45%: the effects that need a bigger move now qualify; the ones the event
    already had at 1.09% aren't listed again."""
    f = _rupee(6.45)
    req = InvestigationRequest.model_validate({
        "run_id": "inv-test", "institution_id": "probe", "server_url": "http://localhost:9",
        "institution": BANK["institution"], "products": BANK["products"], "findings": [f],
        "extend": {"event_id": "ev-open-1", "themes": [T("fx", "weaker", currency="LKR")], "resize": True,
                   "previous_size": {"value": 1.09, "unit": "pct"}}})
    resized = {h.mechanism_id for h in asyncio.run(Investigation(req, KeepAll(), Data(BANK["coverage"])).run()).hypotheses}
    full = {h.mechanism_id for h in _run_one(_rupee(6.45)).hypotheses}
    small = {h.mechanism_id for h in _run_one(_rupee(1.09)).hypotheses}
    assert "remittance.volume.currency_weaker" in resized  # 5% minimum: not at 1.09%, yes at 6.45%
    assert not (resized & small)  # nothing the event already had
    assert resized == full - small


def test_a_move_below_its_effects_minimum_says_so():
    """An insurer's claim-cost effects need a bigger rupiah move than 2.49% (at the rupiah's 0.29% typical day)."""
    f = _rupee(2.49) | {"places": ["ID"], "themes": [T("fx", "weaker", currency="IDR")]}
    f["evidence"]["signals"][0] |= {"symbol": "USD/IDR", "series_id": "usd_idr", "typical_daily_move_pct": 0.2948}
    req = InvestigationRequest.model_validate({
        "run_id": "inv-test", "institution_id": "probe", "server_url": "http://localhost:9",
        "institution": INSURER["institution"], "products": INSURER["products"], "findings": [f]})
    result = asyncio.run(Investigation(req, KeepAll(), Data(None)).run())
    assert result.hypotheses == []
    assert "the move (2.49%) is below the size its effects need (from about" in result.report
    assert "has a track for" not in result.report


def test_an_insurer_hears_about_the_portfolio_even_when_other_effects_exist():
    result = run(INSURER, [F("MSCI consults on a downgrade", ["ID"], T("markets", "equity_down"), T("macro", "worse"))])
    assert result.hypotheses and "investment portfolio" in result.report


def test_a_shipping_shock_reaches_marine_war_risk_and_a_tourism_shock_does_not():
    from app.candidates import triggered
    from app.contract import Event, ThemeTag
    from app.tracks import MECHANISMS

    war = next(m for m in MECHANISMS if m.mechanism_id == "marine.volume.war_risk")

    def event(sector):
        return Event(event_id="e-1", finding_ids=["f1"], country="other", anchor=WHEN, anchor_basis="published_at",
                     themes=[ThemeTag(theme="sector", direction="shock", sector=sector)])

    assert triggered(war, event("shipping")) and triggered(war, event("Maritime shipping"))
    assert not triggered(war, event("tourism")) and not triggered(war, event(None))


def test_unknown_places_with_no_exposure_are_unplaced():
    """A place code the server can't resolve doesn't put the finding anywhere (the model's reading decides)."""
    result = run(BANK, [F("Something somewhere", ["xx:unknown"], OIL_UP)])
    assert len(result.events) == 1  # world prices still count

