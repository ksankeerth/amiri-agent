"""Scenario templates, built by code for whichever institution runs them.

A template is a what-if written by people: when it starts, which headlines arrive when, how a
price moves, the monitor that watches for it, and the stories it expects AMIRI Agent to find. Building
it for an institution fills in that institution's currency, country, central bank and products;
numbers in headlines come from the price path, so they match the chart. No model is used.

Templates: currency depreciation (headlines and a price move written for the institution), a blank
scenario (the person writes the headlines and chooses the price move), and, for a US institution with
Texas in its footprint only, two Texas what-ifs: a winter storm (a freeze, a power-price spike, data
centers ordered off the grid, chip plants stopped, homes damaged) and a data-center land rush (land,
power and water go to data centers until the state pauses approvals and builders stall). Either can be edited: a scenario's
`custom` holds its own headline list and, for the blank one, its price move. Cyclone Ditwah (real headlines,
verified by hand) comes later.
"""

import itertools
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app import reference
from app.monitors.schemas import MonitorSpec
from app.problems import Problem

INTENSITY = {"low": 0.5, "medium": 1.0, "high": 1.5}
OUTLET = "Studio newswire (simulated)"

# Rough USD rates, only to draw the chart at a familiar level; the moves are what matter.
LEVELS = {"LKR": 300.0, "INR": 84.0, "PHP": 57.0, "IDR": 16000.0, "THB": 35.0, "VND": 25000.0, "MYR": 4.5,
          "SGD": 1.35, "BDT": 120.0, "PKR": 280.0, "NPR": 134.0, "AED": 3.67, "SAR": 3.75, "JPY": 150.0,
          "KRW": 1350.0, "CNY": 7.2, "HKD": 7.8, "TWD": 32.0, "AUD": 1.5, "NZD": 1.65, "GBP": 0.79, "EUR": 0.92}

TEMPLATES = {
    "currency-depreciation": {
        "title": "Currency depreciation",
        "summary": "The home currency falls about 10% against the US dollar over five business days. Importers "
                   "struggle, the central bank steps in, fuel prices rise, while remittances and exporters gain.",
        "tags": ["fx", "importers", "remittances", "exporters"],
    },
    "us-texas-winter-storm": {
        "title": "US · Texas winter storm and the grid",
        "summary": "An Arctic freeze knocks out Texas power plants. Wholesale power prices spike, the grid operator "
                   "orders data centers to cut power, chip plants stop and homes are damaged.",
        "tags": ["storm", "power prices", "data centers", "chip plants"],
        "region": "us",
        "start_day": date(2027, 2, 8),  # a February freeze, as in 2021
    },
    "us-texas-data-center-land-rush": {
        "title": "US · Texas data-center land rush",
        "summary": "Data-center developers buy up Texas land. Power prices climb with their demand, a drought sets "
                   "them against cities for water, and the state pauses new approvals, leaving builders stalled.",
        "tags": ["data centers", "land", "power prices", "water"],
        "region": "us",
        "start_day": date(2027, 7, 12),  # a Texas summer, when water and power run tightest
    },
    "blank": {
        "title": "Your own scenario",
        "summary": "Write the headlines yourself and choose how the exchange rate moves, if at all. AMIRI Agent's monitor "
                   "reads your headlines and the investigation traces them to your products.",
        "tags": ["your headlines", "your price move"],
    },
}
STEPS = 21  # days a simulation runs


def currency_name(code: str) -> str:
    return next((c["name"] for c in reference.currencies() if c["code"] == code), code)


def offered(template_id: str, ctx: dict) -> bool:
    """Whether the template is listed for this institution: a region's template only for that region's banks."""
    region = TEMPLATES[template_id].get("region")
    return region is None or (region == "us" and ctx.get("country") == "US")


def available(template_id: str, ctx: dict) -> str | None:
    """None if the template can run for this institution, else why not."""
    if template_id not in TEMPLATES:
        return f"no template {template_id}"
    if template_id == "blank":
        return None
    if template_id in US_TEXAS:
        if ctx.get("country") != "US":
            return "it's a US template, and the institution's home country isn't the United States"
        if "US-TX" not in _footprint(ctx):
            return "it's a Texas grid scenario, and the institution has no branches or customers in Texas"
        return None
    if ctx.get("currency") == "USD":
        return "the institution's base currency is the US dollar: there's no USD rate to move"
    return None


def _central_bank(ctx: dict) -> str:
    regs = ctx.get("regulators") or []
    home = next((r for r in regs if r.get("relation") == "home" and r.get("area") == "banking"), None)
    return home["name"] if home else f"The central bank of {reference.place_name(ctx['country']) or ctx['country']}"


def _monitor(ctx: dict, cur_name: str, country: str, bank: str) -> dict:
    """The template's monitor, from the profile (exposure ids that exist)."""
    products = ctx.get("products") or []
    exposed = [p for p in products if p.get("category") in ("trade_finance", "business_loan", "fx", "savings")][:3]
    segs = [s for s in ctx.get("segments") or [] if "import" in (s.get("label") or "").lower()][:1]
    return {
        "about": {"name": f"{cur_name} and importers", "owner": "Treasury", "check_frequency": 60, "kind": "events"},
        "public": {
            "watch": [{"name": cur_name, "type": "topic", "other_forms": [ctx["currency"]], "not_confused_with": []},
                      {"name": country, "type": "place", "other_forms": [], "not_confused_with": []},
                      {"name": "importers", "type": "sector", "other_forms": ["import businesses"], "not_confused_with": []},
                      {"name": bank, "type": "regulation", "other_forms": [], "not_confused_with": []}],
            "in_one_sentence": f"Moves in the {cur_name} and what they do to importers, remittances and prices in {country}.",
            "tell_me_if": [f"The {cur_name} falls sharply against the US dollar",
                           "Importers struggle to pay for imports or open letters of credit",
                           f"{bank} acts on or comments on the currency",
                           "Remittances, exports or fuel prices change because of the exchange rate"],
            "ignore": ["Routine daily exchange-rate tables with no unusual move"],
            "places": [ctx["country"]], "languages": ["en"],
        },
        "private": {"exposure": [{"id": f"product:{p['id']}", "how_it_reaches_us": ""} for p in exposed]
                                + [{"id": f"segment:{s['id']}", "how_it_reaches_us": ""} for s in segs]},
        "alert_level": 6,
    }


def _take(lists: list[list], cap: int, key=lambda x: x) -> list:
    """Up to `cap` items from several lists in turn (the first of each, then the second…), without repeats."""
    out, seen = [], set()
    for row in itertools.zip_longest(*lists):
        for x in row:
            if x is not None and key(x) not in seen and len(out) < cap:
                seen.add(key(x))
                out.append(x)
    return out


def _merged_monitor(ctx: dict, specs: list[dict], country: str) -> dict | None:
    """A blank scenario's monitor from the institution's live monitors: their watch lists, "tell me if" lines,
    places and exposures in turn, within one monitor's limits. None when it wouldn't be a valid monitor."""
    pub = [s.get("public") or {} for s in specs]
    home = f"Something happens in or around {country} that could reach the institution's customers or products"
    spec = {
        "about": {"name": "This scenario's news", "owner": "Risk management", "check_frequency": 60, "kind": "events"},
        "public": {
            "watch": _take([p.get("watch") or [] for p in pub], 12, key=lambda w: w["name"].lower()),
            "in_one_sentence": (f"What the institution's {len(specs)} live monitor{'s' if len(specs) != 1 else ''} "
                                f"watch for, and anything else that could reach {ctx['name']}'s customers."),
            "tell_me_if": _take([[home], *[p.get("tell_me_if") or [] for p in pub]], 8),
            "ignore": _take([p.get("ignore") or [] for p in pub], 8),
            "places": _take([[ctx["country"]], *[p.get("places") or [] for p in pub]], 20),
            "languages": ["en"],
        },
        "private": {"exposure": _take([(s.get("private") or {}).get("exposure") or [] for s in specs], 20,
                                      key=lambda e: e["id"])},
        "alert_level": max((s.get("alert_level") or 5) for s in specs),
    }
    try:
        return MonitorSpec.model_validate(spec).model_dump(mode="json")
    except ValidationError:
        return None


def _blank_monitor(ctx: dict, cur_name: str, country: str, bank: str) -> dict:
    """A blank scenario's monitor: what the live monitors watch for, or (without any) anything in its headlines
    that could reach the institution."""
    if ctx.get("live_monitors") and (merged := _merged_monitor(ctx, ctx["live_monitors"], country)):
        return merged
    return {
        "about": {"name": "This scenario's news", "owner": "Risk management", "check_frequency": 60, "kind": "events"},
        "public": {
            "watch": [{"name": country, "type": "place", "other_forms": [], "not_confused_with": []},
                      {"name": cur_name, "type": "topic", "other_forms": [ctx["currency"]], "not_confused_with": []},
                      {"name": bank, "type": "regulation", "other_forms": [], "not_confused_with": []}],
            "in_one_sentence": f"News that could change how {ctx['name']}'s customers save, borrow, pay or send money.",
            "tell_me_if": [f"Something happens in or around {country} that could reach the institution's customers or products",
                           f"The {cur_name}, interest rates or prices in {country} move",
                           f"{bank} or another regulator acts",
                           "A rival, a partner, or a market the institution depends on is in the news"],
            "ignore": ["Routine news with no change"],
            "places": [ctx["country"]], "languages": ["en"],
        },
        # no exposures: a monitor's exposures are its owner's words (they put news abroad in scope)
        "private": {"exposure": []},
        "alert_level": 5,
    }


def _custom_headlines(custom: dict, at, given: list[dict]) -> list[dict]:
    """The scenario's own headline list (edited, added, removed) in place of the template's; a template
    headline keeps its story, so "what AMIRI Agent should find" still knows it."""
    story = {h["id"]: h["story"] for h in given}
    return [{"id": h["id"], "story": story.get(h["id"], "custom"), "at": at(h["day"], *(int(x) for x in h["time"].split(":"))),
             "title": h["title"], "day": h["day"], "time": h["time"]} for h in custom["headlines"]]


def build(template_id: str, ctx: dict, intensity: str, switched_off: list[str], custom: dict | None = None,
          title: str | None = None, start_day: date | None = None) -> dict:
    """The scenario for this institution: clock, headlines, price path, monitor, expected stories."""
    why = available(template_id, ctx)
    if why:
        raise Problem(422, "template_unavailable", f"This template can't run here: {why}.")
    k = INTENSITY[intensity]
    custom = custom or {}
    start_day = start_day or TEMPLATES[template_id].get("start_day") or date(2027, 3, 1)
    cur, home = ctx["currency"], ctx["country"]
    cur_name, country = currency_name(cur), reference.place_name(home) or home
    bank = _central_bank(ctx)
    tz = ZoneInfo(ctx.get("time_zone") or "UTC")
    size = 10.0 * k  # % rise of USD/<cur> over the ramp
    ramp = 5  # business days

    def at(day: int, hh: int, mm: int = 0) -> str:
        return datetime.combine(start_day + timedelta(days=day - 1), time(hh, mm), tz).astimezone(ZoneInfo("UTC")).isoformat()

    def moved(b: int) -> float:  # % weaker by the close of business day b
        return round(size * min(b, ramp) / ramp, 1)

    has = lambda kind: any(f.get("kind") == kind for f in ctx.get("flows") or [])  # noqa: E731
    if template_id == "blank":
        return _build_blank(ctx, custom, title, at, cur, cur_name, country, bank, home, start_day, switched_off)
    if template_id == "us-texas-winter-storm":
        return _build_texas_storm(ctx, k, intensity, custom, title, at, switched_off)
    if template_id == "us-texas-data-center-land-rush":
        return _build_land_rush(ctx, k, intensity, custom, title, at, switched_off)
    headlines = [
        {"id": "h1", "story": "fx", "at": at(1, 10, 30),
         "title": f"{cur_name} falls {moved(1)}% against the dollar as importers rush for cover"},
        {"id": "h2", "story": "fx", "at": at(2, 11),
         "title": f"{country} importers struggle to open letters of credit as the {cur_name} slides {moved(2)}%"},
        {"id": "h3", "story": "central_bank", "at": at(3, 9, 30),
         "title": f"{bank} steps in, selling dollars to steady the {cur_name}"},
        {"id": "h4", "story": "remittance", "at": at(4, 14),
         "title": f"Money sent home to {country} is worth more as the {cur_name} weakens; remittance inflows rise"},
        {"id": "h5", "story": "exporters", "at": at(5, 12),
         "title": f"{country}'s exporters gain as the weaker {cur_name} lifts their earnings"},
        {"id": "h6", "story": "fuel", "at": at(8, 10),
         "title": f"Fuel prices in {country} set to rise as the {cur_name} stays {moved(5)}% weaker"},
    ]
    stories = [
        {"key": "fx", "label": f"The {cur_name} weakens", "tone": "bad",
         "themes": [{"theme": "fx", "direction": "weaker", "currency": cur}]},
        {"key": "central_bank", "label": f"{bank} steps in", "tone": "neutral",
         "themes": [{"theme": "regulation", "direction": "central_bank_direction"}]},
        {"key": "remittance", "label": "Remittances worth more at home", "tone": "good",
         "themes": [{"theme": "remittance", "direction": "up"}], "if_flows": "remittances_in"},
        {"key": "exporters", "label": "Exporters gain", "tone": "good",
         "themes": [{"theme": "sector", "direction": "boost"}]},
        {"key": "fuel", "label": "Fuel prices rise", "tone": "bad",
         "themes": [{"theme": "prices", "direction": "up", "item": "fuel"}]},
    ]
    headlines = [{**h, "day": d, "time": t} for h, (d, t) in zip(headlines, [(1, "10:30"), (2, "11:00"), (3, "09:30"),
                                                                             (4, "14:00"), (5, "12:00"), (8, "10:00")], strict=True)]
    if custom.get("headlines") is not None:
        headlines = _custom_headlines(custom, at, headlines)
    every = sorted(headlines, key=lambda h: h["at"])  # for the page: switched-off ones too, so their text isn't lost
    off = set(switched_off)
    headlines = [h for h in every if h["id"] not in off and h["story"] not in off]
    kept = {h["story"] for h in headlines}
    stories = [{**s, "expected": s["key"] in kept and (not s.get("if_flows") or has(s["if_flows"]))} for s in stories]
    return {
        "template_id": template_id, "title": title or TEMPLATES[template_id]["title"], "intensity": intensity,
        "institution": {"institution_id": ctx["institution_id"], "name": ctx["name"], "country": home,
                        "currency": cur, "time_zone": ctx.get("time_zone") or "UTC"},
        "clock": {"start_at": at(1, 0), "steps": STEPS, "step_hours": 24, "step_time": "18:00",
                  "first_step_at": at(1, 18)},
        "headlines": [{**h, "outlet": OUTLET} for h in headlines],
        "all_headlines": [{**h, "outlet": OUTLET} for h in every],
        "prices": {"symbol": f"USD/{cur}", "name": f"USD/{cur}", "level": LEVELS.get(cur, 100.0),
                   "sigma_daily_pct": 0.3, "seed": 20270301, "base_days": 90,
                   "shock": {"shape": "ramp", "size_pct": size, "start_day": 1, "ramp_business_days": ramp},
                   "theme": {"theme": "fx", "direction_up": "weaker", "direction_down": "stronger", "currency": cur},
                   "places": [home], "off": "prices" in off},
        "monitor": {"key": "currency-importers", "spec": _monitor(ctx, cur_name, country, bank)},
        "stories": stories,
        "expected_findings": {"timeseries": 0 if "prices" in off else 1, "monitor": 1 if headlines else 0},
    }


def _build_blank(ctx: dict, custom: dict, title: str | None, at, cur: str, cur_name: str, country: str, bank: str,
                 home: str, start_day: date, switched_off: list[str]) -> dict:
    """A blank scenario: the person's headlines and price move; no expected stories (nothing to score)."""
    off = set(switched_off)
    every = sorted(_custom_headlines({"headlines": custom.get("headlines") or []}, at, []), key=lambda h: h["at"])
    heads = [h for h in every if h["id"] not in off]
    move = custom.get("prices") or {"direction": "none", "size_pct": 0, "ramp_days": 5}
    quote = "EUR" if cur == "USD" else cur  # a US-dollar institution watches the dollar against the euro
    size = 0.0 if move["direction"] == "none" else move["size_pct"] * (1 if move["direction"] == "weaker" else -1)
    if cur == "USD":
        size = -size  # USD/EUR falls when the dollar weakens
    return {
        "template_id": "blank", "title": title or TEMPLATES["blank"]["title"], "intensity": "medium",
        "institution": {"institution_id": ctx["institution_id"], "name": ctx["name"], "country": home,
                        "currency": cur, "time_zone": ctx.get("time_zone") or "UTC"},
        "clock": {"start_at": at(1, 0), "steps": STEPS, "step_hours": 24, "step_time": "18:00",
                  "first_step_at": at(1, 18)},
        "headlines": [{**h, "outlet": OUTLET} for h in heads],
        "all_headlines": [{**h, "outlet": OUTLET} for h in every],
        "prices": {"symbol": f"USD/{quote}", "name": f"USD/{quote}", "level": LEVELS.get(quote, 100.0),
                   "sigma_daily_pct": 0.3, "seed": 20270301, "base_days": 90,
                   "shock": {"shape": "ramp", "size_pct": size, "start_day": 1, "ramp_business_days": move["ramp_days"]},
                   "theme": {"theme": "fx", "direction_up": "weaker", "direction_down": "stronger", "currency": quote},
                   "places": [home], "off": move["direction"] == "none" or "prices" in off,
                   "move": move},
        "monitor": {"key": "blank", "spec": _blank_monitor(ctx, cur_name, country, bank)},
        "stories": [],
        "expected_findings": {"timeseries": 0 if move["direction"] == "none" else 1, "monitor": 1 if heads else 0},
    }


# ---------------------------------------------------------------- US · Texas winter storm

STORM_LEVEL = 40.0  # $/MWh, a calm winter day's wholesale price; the shock is what matters
STORM_SPIKE_PCT = 600.0  # at medium intensity, over two business days (low 300%, high 900%)


def _footprint(ctx: dict) -> set[str]:
    return {f["code"] for f in ctx.get("footprint") or []}


def _texas_city(ctx: dict) -> str:
    """The first Texas city the institution watches (Austin for the demo bank), else "Texas"."""
    for code in (ctx.get("radar_scope") or {}).get("places") or []:
        if code.startswith("city:") and reference.parent_region(code) == "US-TX":
            return reference.place_name(code) or "Texas"
    return "Texas"


US_TEXAS = ("us-texas-winter-storm", "us-texas-data-center-land-rush")


def _exposed(ctx: dict) -> list[dict]:
    """The loans and deposits a Texas what-if reaches: business loans first, then retail loans, then savings."""
    order = ("business_loan", "retail_loan", "savings")
    products = [p for p in ctx.get("products") or [] if p.get("category") in order]
    return sorted(products, key=lambda p: order.index(p["category"]))[:6]


def _watch(name: str, kind: str, *other: str) -> dict:
    return {"name": name, "type": kind, "other_forms": list(other), "not_confused_with": []}


def _texas_monitor(ctx: dict, name: str, watch: list[dict], sentence: str, tell: list[str], ignore: list[str]) -> dict:
    return {
        "about": {"name": name, "owner": "Risk management", "check_frequency": 60, "kind": "events"},
        "public": {"watch": watch, "in_one_sentence": sentence, "tell_me_if": tell, "ignore": ignore,
                   "places": ["US", "US-TX"], "languages": ["en"]},
        "private": {"exposure": [{"id": f"product:{p['id']}", "how_it_reaches_us": ""} for p in _exposed(ctx)]},
        "alert_level": 6,
    }


def _build_texas(template_id: str, ctx: dict, intensity: str, custom: dict, title: str | None, at,
                 switched_off: list[str], headlines: list[dict], stories: list[dict], power: dict, monitor: dict) -> dict:
    """A Texas what-if: its headlines (day, time), its stories, a simulated wholesale power price and its monitor."""
    headlines = [{**h, "at": at(h["day"], *(int(x) for x in h["time"].split(":")))} for h in headlines]
    if custom.get("headlines") is not None:
        headlines = _custom_headlines(custom, at, headlines)
    every = sorted(headlines, key=lambda h: h["at"])
    off = set(switched_off)
    headlines = [h for h in every if h["id"] not in off and h["story"] not in off]
    kept = {h["story"] for h in headlines} | (set() if "prices" in off else {"power"})
    return {
        "template_id": template_id, "title": title or TEMPLATES[template_id]["title"], "intensity": intensity,
        "institution": {"institution_id": ctx["institution_id"], "name": ctx["name"], "country": ctx["country"],
                        "currency": ctx["currency"], "time_zone": ctx.get("time_zone") or "UTC"},
        "clock": {"start_at": at(1, 0), "steps": STEPS, "step_hours": 24, "step_time": "18:00",
                  "first_step_at": at(1, 18)},
        "headlines": [{**h, "outlet": OUTLET} for h in headlines],
        "all_headlines": [{**h, "outlet": OUTLET} for h in every],
        "prices": {"symbol": "TX-POWER", "name": "Texas wholesale power (simulated)", "level": STORM_LEVEL,
                   "base_days": 90, **power,
                   "theme": {"theme": "prices", "direction_up": "up", "direction_down": "down", "item": "electricity"},
                   "places": ["US-TX"], "off": "prices" in off},
        "monitor": {"key": template_id.removeprefix("us-texas-"), "spec": monitor},
        "stories": [{**st, "expected": st["key"] in kept} for st in stories],
        "expected_findings": {"timeseries": 0 if "prices" in off else 1, "monitor": 1 if headlines else 0},
    }


POWER_UP = {"theme": "prices", "direction": "up", "item": "electricity"}


def _build_texas_storm(ctx: dict, k: float, intensity: str, custom: dict, title: str | None, at,
                       switched_off: list[str]) -> dict:
    """A Texas freeze: headlines written for the institution's Texas city, and a wholesale power-price spike."""
    city = _texas_city(ctx)
    size = STORM_SPIKE_PCT * k
    headlines = [
        {"id": "h1", "story": "storm", "day": 1, "time": "09:00",
         "title": "Arctic blast heads for Texas; the grid operator warns data-center demand could push power use to a record"},
        {"id": "h2", "story": "power", "day": 2, "time": "07:30",
         "title": f"Rolling blackouts across Texas as power plants freeze; wholesale power prices jump {size:g}%"},
        {"id": "h3", "story": "industry", "day": 2, "time": "14:00",
         "title": "Texas grid operator orders data centers to cut power under its emergency rules for large users"},
        {"id": "h4", "story": "industry", "day": 3, "time": "10:00",
         "title": f"{city} chip plants halt production as power and water are cut"},
        {"id": "h5", "story": "storm", "day": 3, "time": "16:00",
         "title": f"Burst pipes damage thousands of {city} homes; insurers brace for claims"},
        {"id": "h6", "story": "industry", "day": 5, "time": "11:00",
         "title": "Texas data-center builders stop work as sites lose power; projects slip by weeks"},
        {"id": "h7", "story": "power", "day": 7, "time": "12:00",
         "title": "Texas businesses face record power bills after the freeze"},
    ]
    stories = [
        {"key": "storm", "label": "A winter storm hits Texas", "tone": "bad",
         "themes": [{"theme": "disaster", "direction": "domestic"}]},
        {"key": "power", "label": "Power prices spike", "tone": "bad", "themes": [POWER_UP]},
        {"key": "industry", "label": "Data centers and chip plants stop", "tone": "bad",
         "themes": [{"theme": "sector", "direction": "shock"}]},
    ]
    monitor = _texas_monitor(
        ctx, "Texas grid, storm and our borrowers",
        [_watch("Texas", "place"), _watch("Electric Reliability Council of Texas", "organisation", "ERCOT", "Texas grid operator"),
         _watch("Winter storm", "topic", "freeze", "Arctic blast"),
         _watch("Power prices", "topic", "wholesale power", "electricity prices"), _watch("Data centers", "sector", "data centres")],
        "A Texas freeze and what it does to the grid, power prices, data centers, plants and homes where our "
        "borrowers and depositors are.",
        ["A freeze or storm causes blackouts or damage in Texas", "Wholesale power prices in Texas spike",
         "The grid operator orders data centers or other large users to cut power",
         "Plants, data centers or construction sites in Texas stop because of the storm"],
        ["Routine weather forecasts with no outages or damage"])
    power = {"sigma_daily_pct": 4.0, "seed": 20270208,
             "shock": {"shape": "ramp", "size_pct": size, "start_day": 1, "ramp_business_days": 2}}
    return _build_texas("us-texas-winter-storm", ctx, intensity, custom, title, at, switched_off, headlines, stories,
                        power, monitor)


LAND_RUSH_RISE_PCT = 40.0  # wholesale power, at medium intensity, over ten business days (low 20%, high 60%)


def _build_land_rush(ctx: dict, k: float, intensity: str, custom: dict, title: str | None, at,
                     switched_off: list[str]) -> dict:
    """Land, power and water go to data centers, until the state pauses approvals and the builders stall.

    The trends are real (2026): developers paying many times farm value for land near power, a grid queue of
    data-center requests far above Texas's record peak, a state audit of those requests, and reports that data
    centers add strain to Texas's drought-hit water supply. The scenario's figures are illustrative."""
    city = _texas_city(ctx)
    rise = LAND_RUSH_RISE_PCT * k
    headlines = [
        {"id": "h1", "story": "land", "day": 1, "time": "09:00",
         "title": "Data-center developers pay up to ten times farm value for Texas land as the AI build-out spreads"},
        {"id": "h2", "story": "power", "day": 2, "time": "11:00",
         "title": "Data-center requests on the Texas grid now dwarf the state's record peak demand; power prices climb"},
        {"id": "h3", "story": "water", "day": 4, "time": "10:00",
         "title": "Drought tightens across Central Texas as data centers compete with cities and farms for water"},
        {"id": "h4", "story": "water", "day": 5, "time": "14:00",
         "title": f"{city} limits water use for large users as reservoirs fall"},
        {"id": "h5", "story": "stall", "day": 8, "time": "09:30",
         "title": "Texas pauses new data-center approvals to audit grid and water demand; builders halt sites"},
        {"id": "h6", "story": "stall", "day": 9, "time": "12:00",
         "title": "Texas data-center builders lay off crews as projects are put on hold"},
        {"id": "h7", "story": "power", "day": 11, "time": "10:00",
         "title": f"Texas businesses see power bills up {rise:g}% as data-center demand lifts wholesale prices"},
    ]
    stories = [  # the land headline sets the scene; a sector boom reaches none of a bank's loans or deposits
        {"key": "power", "label": "Power prices climb with data-center demand", "tone": "bad", "themes": [POWER_UP]},
        {"key": "water", "label": "Drought and water limits", "tone": "bad",
         "themes": [{"theme": "disaster", "direction": "domestic"}]},
        {"key": "stall", "label": "The state pauses approvals and builders stall", "tone": "bad",
         "themes": [{"theme": "sector", "direction": "shock"}]},
    ]
    monitor = _texas_monitor(
        ctx, "Texas data-center land, power and water",
        [_watch("Texas", "place"), _watch("Data centers", "sector", "data centres"),
         _watch("Electric Reliability Council of Texas", "organisation", "ERCOT", "Texas grid operator"),
         _watch("Power prices", "topic", "wholesale power", "electricity prices"),
         _watch("Water restrictions", "topic", "drought", "water limits"), _watch("Land prices", "topic", "farmland")],
        "Data centers taking Texas land, power and water, and what that does to the builders, businesses and "
        "households we lend to.",
        ["Data-center developers buy large tracts of Texas land or push land prices up",
         "Power demand or prices in Texas rise because of data centers",
         "Drought or water limits hit Texas cities, farms or large water users",
         "The state, a county or a city pauses, limits or rejects data-center projects"],
        ["Data-center announcements with no Texas site"])
    power = {"sigma_daily_pct": 2.5, "seed": 20270712,
             "shock": {"shape": "ramp", "size_pct": rise, "start_day": 1, "ramp_business_days": 10}}
    return _build_texas("us-texas-data-center-land-rush", ctx, intensity, custom, title, at, switched_off, headlines,
                        stories, power, monitor)
