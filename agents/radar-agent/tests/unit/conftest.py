"""Shared fixtures: a Serendib-like request, GDELT-like rows, a fake BigQuery client and a scripted judge.
No network: nothing here calls BigQuery or a model."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.contract import RadarRunRequest
from app.judge import Asked

UNTIL = datetime(2026, 10, 17, 6, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    """Settings at their defaults, and a run store per test."""
    import os

    from app import settings

    for name in settings.SETTINGS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.db"))
    assert os.getenv("RUNS_DB_PATH")


def request(**kw) -> RadarRunRequest:
    body = {
        "run_id": kw.pop("run_id", "rad-test-1"),
        "institution": {"name": "Serendib Commercial Bank", "institution_type": kw.pop("institution_type", "bank"),
                        "country": "LK", "country_name": "Sri Lanka", "currency": "LKR", "time_zone": "Asia/Colombo",
                        "summary": "A commercial bank: deposits, SME loans, pawning, remittances.",
                        "segments": [{"id": "migrant-families", "label": "Migrant families"}],
                        "products": [{"id": "trade-finance", "name": "Trade Finance (Import LCs)"}],
                        "flows": [{"kind": "remittances_in", "local": "LK", "counterpart": "SA"}],
                        "rivals": [{"id": "seylan", "name": "Seylan Bank", "aliases": []}],
                        "regulators": [{"id": "cbsl", "name": "Central Bank of Sri Lanka", "aliases": ["CBSL"]}],
                        "counterparties": [{"id": "ansari", "name": "Al Ansari Exchange", "aliases": []}]},
        "scope": {"places": ["LK", "IN", "SA", "AE", "IN-TN", "LK-1", "chk:hormuz"],
                  "places_why": {"LK": ["footprint (home)"], "IN": ["footprint (branches)"],
                                 "SA": ["flow: remittances in with LK"], "AE": ["flow: remittances in with LK"],
                                 "chk:hormuz": ["place to watch: fuel imports"]},
                  "themes": ["fx", "rates", "remittance", "commodities", "regulation", "disaster", "competitor"],
                  "actors": ["CBSL", "Seylan Bank", "Al Ansari Exchange"]},
        "window": {"since": (UNTIL - timedelta(hours=24)).isoformat(), "until": UNTIL.isoformat()},
        "seen": kw.pop("seen", []),
        "limits": {"max_stories": 10, "max_model_calls": kw.pop("max_model_calls", 40), "timeout_seconds": 300,
                   "max_queries": 1, "max_bytes_per_query": 1_500_000_000},
    }
    body.update(kw)
    return RadarRunRequest.model_validate(body)


def row(title: str, url: str, outlet: str, hours_ago: float = 2, locations: str = "1#Sri Lanka#CE#CE##7#81#CE#10",
        themes: str = "", orgs: str = "", **rules) -> dict:
    t = UNTIL - timedelta(hours=hours_ago)
    return {"DATE": int(t.strftime("%Y%m%d%H%M%S")), "outlet": outlet, "url": url, "title": title, "locations": locations,
            "themes": themes, "orgs": orgs, "home_n": 3, "foot_n": 0, "all_n": 3,
            **{f"r_{k}": rules.get(k, False) for k in ("home", "footprint", "place", "actor")}}


ROWS = [  # what a day looked like on 16 Oct 2026, cut down
    row("Seylan Bank partners Colombo Motor Show 2026 | Daily FT", "https://ft.lk/1", "ft.lk", 3, home=True, actor=True),
    row("Seylan Bank partners Colombo Motor Show for tenth year", "https://economynext.com/2", "economynext.com", 2, home=True),
    row("24 Indian seafarers safe after tanker incidents in Strait of Hormuz", "https://aninews.in/3", "aninews.in", 1,
        locations="4#Strait of Hormuz#IR#IR##26.5#56.2#-1#5", place=True),
    row("24 Indian seafarers safe after tanker incidents in Strait of Hormuz", "https://indiagazette.com/4",
        "indiagazette.com", 1, locations="4#Strait of Hormuz#IR#IR##26.5#56.2#-1#5", place=True),
    row("Two ships sink near Strait of Hormuz after projectile attacks", "https://breitbart.com/5", "breitbart.com", 1.5,
        locations="4#Strait of Hormuz#IR#IR##26.5#56.2#-1#5", place=True),
    row("&#x90AE;&#x62A5;&#xFF1A;&#x57C3;", "https://163.com/6", "163.com", 1, home=True),
    row("Saudi Arabia tightens visa renewals for foreign workers", "https://arabnews.com/7", "arabnews.com", 4,
        locations="1#Saudi Arabia#SA#SA##25#45#SA#1;1#Saudi Arabia#SA#SA##25#45#SA#40",
        themes="WB_2836_MIGRATION_POLICIES_AND_JOBS,1", footprint=True),
]


class FakeJob:
    def __init__(self, rows, processed, billed, cache_hit=False):
        self._rows, self.total_bytes_processed, self.total_bytes_billed, self.cache_hit = rows, processed, billed, cache_hit

    def result(self):
        return [SimpleNamespace(items=lambda r=r: r.items()) for r in self._rows]


class FakeClient:
    """Plays BigQuery: dry runs report `dry_bytes`; runs return `rows`; list_jobs reports `billed` bytes."""

    def __init__(self, rows=None, dry_bytes=600_000_000, billed_today=0, list_fails=False):
        self.rows, self.dry_bytes, self.billed_today, self.list_fails = rows or [], dry_bytes, billed_today, list_fails
        self.queries: list = []  # (sql, job_config) of real runs

    def query(self, sql, job_config):
        if job_config.dry_run:
            return FakeJob([], self.dry_bytes, 0)
        self.queries.append((sql, job_config))
        return FakeJob(self.rows, self.dry_bytes, self.dry_bytes)

    def list_jobs(self, **kw):
        if self.list_fails:
            raise RuntimeError("no permission")
        return [SimpleNamespace(labels={"app": "amiri-radar"}, total_bytes_billed=self.billed_today),
                SimpleNamespace(labels={"app": "something-else"}, total_bytes_billed=10**12)]


def scripted(answers: dict | None = None, default: dict | None = None):
    """A judge that answers per story key (or `default` for any), counting its calls."""
    calls = []

    async def ask(session_id: str, state: dict) -> Asked:
        calls.append(state)
        out = []
        for s in state["batch"]:
            a = (answers or {}).get(s["key"]) or default or {"relevance": "medium", "send": False, "why": "Some link.",
                                                               "title": s["headlines"][0]["title"], "summary": "A summary."}
            out.append({"key": s["key"], **a})
        return Asked(stories=out, model="gemini-test", input_tokens=100, output_tokens=20)

    ask.calls = calls
    return ask

