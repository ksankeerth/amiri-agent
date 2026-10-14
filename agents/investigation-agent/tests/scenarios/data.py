"""What amiri-server answers the investigation with, for scenarios: coverage and the
calendar, from fixtures. The Sri Lankan scenarios use the mock catalogs (their products'
ids are the mock source's); the JAPAC ones use coverage the server's spec builder wrote
(`uv run amiri coverage --profile tests/fixtures/profiles/<name>.json`)."""

import json
from datetime import date, timedelta
from pathlib import Path

from app.data_client import Calendar

FIXTURES = Path(__file__).parents[1] / "fixtures"
DAYS = [date.fromisoformat(d["date"]) for d in json.loads((FIXTURES / "calendar_2026.json").read_text())["days"]
        if d["business"]]  # fmt: skip


def _mock(kind: str) -> dict:
    source = json.loads((FIXTURES / f"catalog_{kind}.json").read_text())
    return {
        "data_source": {"data_source_id": f"mock-{kind}"},
        "products": [
            {
                "product_id": p["product_id"],
                "source_product_id": p["product_id"],
                "book_size": p["book_size"],
                "metrics": p["metrics"],
            }
            for p in source["products"]
        ],
    }


def coverage(name: str) -> dict:
    if name in ("mock-bank", "mock-insurer"):
        return _mock(name.removeprefix("mock-"))
    return json.loads(
        (FIXTURES / f"coverage_{name.replace('-', '_')}.json").read_text()
    )


class FixtureData:
    def __init__(self, name: str):
        self.body = coverage(name)
        self.mock = name.startswith("mock-")

    async def coverage(self, req):
        offered = {p["product_id"]: p for p in self.body["products"]}
        return {
            **self.body,
            "products": [
                offered[p.product_id] for p in req.products if p.product_id in offered
            ],
        }

    async def calendar(self, req, start, until):
        if self.mock:  # the Sri Lankan bank-holiday calendar of the mock data
            return Calendar([d for d in DAYS if start <= d < until], "lk-banks")
        days, d = [], start
        while (
            d < until
        ):  # weekdays (the server's holiday calendar isn't needed for these checks)
            if d.isoweekday() < 6:
                days.append(d)
            d += timedelta(days=1)
        return Calendar(days, f"{req.institution.country.lower()}-weekdays")
