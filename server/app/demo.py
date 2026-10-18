"""The two demo institutions, invented for the demo: a bank and an insurer.

Their profiles live in app/seeds/ (the one copy: the repository's demo/ folder is written from them by
`uv run amiri demo-export`, and a test fails when the two drift apart). Everything that loads a demo
reads it from here: the prototype reset, the empty first screen, the demo-profile download, the CLI and
the sample institutions' reference APIs (app/mockinst).
"""

import json
from typing import Literal

from app import settings

Kind = Literal["bank", "insurer"]

DEMOS: dict[str, dict] = {
    "bank": {"file": "serendib_bank.json", "name": "Serendib Commercial Bank", "country": "Sri Lanka",
             "slug": "serendib-commercial-bank"},
    "insurer": {"file": "samudra_raya_general.json", "name": "Samudra Raya General Insurance", "country": "Indonesia",
                "slug": "samudra-raya-general-insurance"},
}


def profile(kind: Kind) -> dict:
    """The demo's whole profile in the import format: {"institution": {...}, "sections": {...}}."""
    return json.loads((settings.PROJECT / "app" / "seeds" / DEMOS[kind]["file"]).read_text())


FX_WEAKER_UP = {"theme": "fx", "direction_up": "weaker", "direction_down": "stronger"}
OIL = {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "oil"}

# The market series each demo watches (Twelve Data symbols), in the format the Market series page takes.
SERIES: dict[str, list[dict]] = {
    "bank": [
        {"symbol": "USD/LKR", "name": "Rupee vs dollar", "places": ["LK"], "theme": {**FX_WEAKER_UP, "currency": "LKR"}},
        {"symbol": "AED/LKR", "name": "Rupee vs UAE dirham (the Gulf remittance corridor)", "places": ["LK", "AE"],
         "theme": {**FX_WEAKER_UP, "currency": "LKR"}},
        {"symbol": "XAU/USD", "name": "Gold price (pawning)", "places": ["LK"],
         "theme": {"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "gold"}},
        {"symbol": "BNO", "name": "Brent oil fund (fuel imports)", "places": ["LK", "SA", "AE", "IR"], "theme": OIL},
    ],
    "insurer": [
        {"symbol": "USD/IDR", "name": "Rupiah vs dollar", "places": ["ID"], "theme": {**FX_WEAKER_UP, "currency": "IDR"}},
        {"symbol": "EIDO", "name": "MSCI Indonesia fund (shares in the investment book)", "places": ["ID"],
         "theme": {"theme": "markets", "direction_up": "equity_up", "direction_down": "equity_down"}},
        {"symbol": "BNO", "name": "Brent oil fund (marine and fuel costs)", "places": ["ID", "SA", "IR"], "theme": OIL},
        {"symbol": "EUR/USD", "name": "Euro vs dollar (reinsurance in euros)", "places": ["DE", "CH"],
         "theme": {"theme": "fx", "direction_up": "stronger", "direction_down": "weaker", "currency": "EUR"}},
    ],
}
