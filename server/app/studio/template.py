"""Scenario templates, built by code for whichever institution runs them.

A template is a what-if written by people: when it starts, which headlines arrive when, how a
price moves, the monitor that watches for it, and the stories it expects Amiri Agent to find. Building
it for an institution fills in that institution's currency, country, central bank and products;
numbers in headlines come from the price path, so they match the chart. No model is used.

Templates: currency depreciation (headlines and a price move written for the institution) and a blank
scenario (the person writes the headlines and chooses the price move). Either can be edited: a scenario's
`custom` holds its own headline list and, for the blank one, its price move. Cyclone Ditwah (real headlines,
verified by hand) comes later.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app import reference
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
    "blank": {
        "title": "Your own scenario",
        "summary": "Write the headlines yourself and choose how the exchange rate moves, if at all. Amiri Agent's monitor "
                   "reads your headlines and the investigation traces them to your products.",
        "tags": ["your headlines", "your price move"],
    },
}
STEPS = 21  # days a simulation runs


def currency_name(code: str) -> str:
    return next((c["name"] for c in reference.currencies() if c["code"] == code), code)


def available(template_id: str, ctx: dict) -> str | None:
    """None if the template can run for this institution, else why not."""
    if template_id not in TEMPLATES:
        return f"no template {template_id}"
    if template_id == "blank":
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


def _blank_monitor(ctx: dict, cur_name: str, country: str, bank: str) -> dict:
    """A blank scenario's monitor: anything in its headlines that could reach the institution."""
    products = ctx.get("products") or []
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
        "private": {"exposure": [{"id": f"product:{p['id']}", "how_it_reaches_us": ""} for p in products[:4]]},
        "alert_level": 5,
    }


def _custom_headlines(custom: dict, at, given: list[dict]) -> list[dict]:
    """The scenario's own headline list (edited, added, removed) in place of the template's; a template
    headline keeps its story, so "what Amiri Agent should find" still knows it."""
    story = {h["id"]: h["story"] for h in given}
    return [{"id": h["id"], "story": story.get(h["id"], "custom"), "at": at(h["day"], *(int(x) for x in h["time"].split(":"))),
             "title": h["title"], "day": h["day"], "time": h["time"]} for h in custom["headlines"]]


def build(template_id: str, ctx: dict, intensity: str, switched_off: list[str], custom: dict | None = None,
          title: str | None = None, start_day: date = date(2027, 3, 1)) -> dict:
    """The scenario for this institution: clock, headlines, price path, monitor, expected stories."""
    why = available(template_id, ctx)
    if why:
        raise Problem(422, "template_unavailable", f"This template can't run here: {why}.")
    k = INTENSITY[intensity]
    custom = custom or {}
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
