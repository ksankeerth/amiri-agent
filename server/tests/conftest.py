"""Test fixtures: the real Postgres test database (compose.yaml), a fake Twelve
Data behind httpx's mock transport, and a clock that only moves when told."""

import math
import random
from datetime import UTC, datetime, timedelta

import httpx
import psycopg
import pytest

from app import settings
from app.clock import FixedClock
from app.investigation.client import InvestigationClient, MonitorClient, RadarClient
from app.main import create_app
from app.providers.twelvedata import TwelveDataClient

START = datetime(2026, 10, 7, 10, 30, tzinfo=UTC)  # a Wednesday


def hourly_walk(until: datetime, days: int, start_price: float, daily_sigma: float, seed: int,
                around_the_clock: bool = True) -> list[tuple[datetime, float]]:
    """Synthetic hourly closes on weekdays (24 h, or 09:00-15:00 for a session market)."""
    rnd = random.Random(seed)
    t = (until - timedelta(days=days)).replace(minute=0, second=0, microsecond=0)
    price, out = start_price, []
    hourly = daily_sigma / math.sqrt(24 if around_the_clock else 7)
    while t <= until:
        if t.weekday() < 5 and (around_the_clock or 9 <= t.hour <= 15):
            price *= math.exp(rnd.gauss(0, hourly))
            out.append((t, round(price, 4)))
        t += timedelta(hours=1)
    return out


class FakeTwelveData:
    """Serves /time_series and /symbol_search like Twelve Data, from in-memory bars."""

    def __init__(self, clock: FixedClock):
        self.clock = clock
        self.symbols: dict[str, dict] = {}
        self.fail_next: list[tuple[int, dict]] = []  # (http status, body)
        self.calls: list[httpx.Request] = []
        self.served = 0  # successful calls so far: the api-credits-used header

    def add(self, symbol: str, bars, type_="Physical Currency", plan_restricted=False):
        self.symbols[symbol] = {"bars": list(bars), "type": type_, "restricted": plan_restricted}

    def extend(self, symbol: str, hours: int, step_pct: float = 0.0):
        """Adds `hours` bars after the last one (weekdays), the first moved by step_pct."""
        bars = self.symbols[symbol]["bars"]
        t, p = bars[-1]
        added = 0
        first = True
        while added < hours:
            t += timedelta(hours=1)
            if t.weekday() >= 5:
                continue
            p = p * (1 + step_pct / 100) if first else p * 1.0001
            first = False
            bars.append((t, round(p, 4)))
            added += 1

    def bump(self, symbol: str, ts: datetime, pct: float):
        """Moves one bar's close by pct (a one-bar spike)."""
        bars = self.symbols[symbol]["bars"]
        i = next(i for i, b in enumerate(bars) if b[0] == ts)
        bars[i] = (ts, round(bars[i][1] * (1 + pct / 100), 4))

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        assert request.headers.get("authorization", "").startswith("apikey ")
        assert "apikey" not in str(request.url)
        if self.fail_next:
            status, body = self.fail_next.pop(0)
            return httpx.Response(status, json=body)
        q = request.url.params
        if request.url.path == "/symbol_search":
            data = [{"symbol": s, "instrument_name": s, "instrument_type": v["type"], "exchange": "PHYSICAL CURRENCY",
                     "country": "", "currency": s.split("/")[-1], "access": {"plan": "Basic"}}
                    for s, v in self.symbols.items() if q["symbol"].upper() in s]
            return httpx.Response(200, json={"data": data, "status": "ok"})
        sym = q["symbol"]
        s = self.symbols.get(sym)
        if s is None:
            return httpx.Response(404, json={"code": 404, "message": f"**symbol** {sym} not found", "status": "error"})
        if s["restricted"]:
            return httpx.Response(403, json={"code": 403, "message": f"{sym} is available starting with the Grow plan", "status": "error"})
        now = self.clock.now()
        visible = [b for b in s["bars"] if b[0] <= now]  # includes the hour still forming
        if "start_date" in q:
            start = datetime.strptime(q["start_date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
            visible = [b for b in visible if b[0] >= start]
        else:
            visible = visible[-int(q.get("outputsize", 30)):]
        if not visible:
            return httpx.Response(400, json={"code": 400, "message": "No data is available on the specified dates. Try setting different start/end dates.", "status": "error"})
        values = [{"datetime": t.strftime("%Y-%m-%d %H:%M:%S"), "open": str(c), "high": str(c), "low": str(c), "close": str(c)}
                  for t, c in visible]
        self.served += 1  # like Twelve Data: the header is the running total, not this call's cost
        return httpx.Response(200, headers={"api-credits-used": str(self.served)}, json={
            "meta": {"symbol": sym, "interval": "1h", "currency_base": sym.split("/")[0],
                     "currency_quote": sym.split("/")[-1], "type": s["type"]},
            "values": values, "status": "ok"})


@pytest.fixture
def clock():
    return FixedClock(START)


@pytest.fixture
def fake(clock):
    f = FakeTwelveData(clock)
    f.add("USD/LKR", hourly_walk(START, 120, 300.0, 0.004, seed=1))
    f.add("AED/LKR", hourly_walk(START, 120, 82.0, 0.004, seed=2))
    f.add("USD/INR", hourly_walk(START, 120, 84.0, 0.003, seed=3))
    f.add("XAU/USD", hourly_walk(START, 120, 3400.0, 0.01, seed=4))
    f.add("BNO", hourly_walk(START, 120, 30.0, 0.015, seed=5, around_the_clock=False), type_="ETF")
    f.add("XBR/USD", hourly_walk(START, 120, 80.0, 0.02, seed=6), plan_restricted=True)
    return f


@pytest.fixture
def env(monkeypatch):
    values = {
        "TWELVEDATA_API_KEY": "test-key", "TWELVEDATA_CREDITS_PER_MINUTE": "8",
        "TWELVEDATA_CREDITS_PER_DAY": "800", "SERIES_MAX": "8", "SERIES_FETCH_EVERY_MINUTES": "60",
        "SERIES_REFRESH_COOLDOWN_SECONDS": "120", "SERIES_BACKFILL_BARS": "2000",
        "SERIES_Z_THRESHOLD": "3", "SERIES_SIGMA_DAYS": "60", "SERIES_MIN_SIGMA_DAYS": "20",
        "SERIES_WINDOWS_DAYS": "1,3,5", "SERIES_COOLDOWN_HOURS": "24",
        "SERIES_STALE_AFTER_HOURS_24H": "6", "SERIES_STALE_AFTER_HOURS_SESSION": "30",
        "AUTO_MIGRATE": "true", "CORS_ORIGINS": "",
        "SINGLE_INSTITUTION": "false",  # many tests set up more than one; test_one_institution checks the rule
        "INSTITUTION_ID": "bank-a",  # whatever a local .env says (it may point at a demo institution)
        "MOCK_INSTITUTIONS": "true",
    }
    for k, v in values.items():
        monkeypatch.setenv(k, v)
    return monkeypatch


_built = False


def reset_database(url: str) -> None:
    """The first test rebuilds the schema (migrations and reference data run at app start);
    later tests empty the data tables and keep the reference data."""
    global _built
    try:
        conn = psycopg.connect(url, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as e:
        pytest.skip(f"test database unreachable ({e}); start it with: docker compose up -d postgres")
    with conn:
        if not _built:
            for schema in ("studio", "cases", "assistant", "signals", "core", "ref", "ops"):
                conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
            conn.execute("DROP TABLE IF EXISTS public.schema_migrations")
            _built = True
            return
        tables = conn.execute(
            "SELECT schemaname || '.' || tablename AS t FROM pg_tables WHERE schemaname IN ('signals', 'core', 'assistant', 'cases', 'studio', 'ops')"
        ).fetchall()
        if tables:
            conn.execute(f"TRUNCATE {', '.join(t[0] for t in tables)} RESTART IDENTITY CASCADE")


USAGE = {"model": "fake", "model_calls": 1, "tool_calls": 0, "duration_ms": 1}


class FakeInvestigationAgent:
    """The investigation agent's API (POST/GET /investigations): one event per run with every
    finding in it, one hypothesis for the first product, a task when validation is on."""

    def __init__(self):
        self.requests: list[dict] = []
        self.fail_next: list[int] = []  # HTTP statuses to answer POSTs with, in order
        self.runs: dict[str, dict] = {}
        self.pending = False  # True: GET answers "running"
        self.forget: set[str] = set()  # run_ids GET answers 404 for, once (another instance, a restart)
        self.themes: list[dict] | None = None  # how it classifies a finding that came without themes
        self.classify = None  # (finding) -> (themes, expected direction "rise"/"fall"): one event per theme, like the agent

    def result(self, req: dict) -> dict:
        if self.classify and not req.get("extend"):
            return self.classified(req)
        f = req["findings"]
        p = req["products"][0]
        ext = req.get("extend")
        event = {"event_id": ext["event_id"] if ext else "e-1", "title": "The LKR weakened (6%)",
                 "finding_ids": [x["finding_id"] for x in f],
                 "themes": ext["themes"] if ext else (f[0]["themes"] or self.themes or [{"theme": "macro", "direction": "worse"}]),
                 "country": "home",
                 "anchor": f[0]["created_at"], "anchor_basis": "move_start", "places": f[0]["places"], "regions": []}
        moves = [abs(s["change_pct"]) for x in f for s in x["evidence"].get("signals") or [] if "change_pct" in s]
        if moves:  # like the agent: a market move's event is sized from its signals
            event["size"] = {"unit": "pct", "value": round(max(moves), 2)}
        hyp = {"hypothesis_id": "h-1", "event_id": event["event_id"], "finding_ids": event["finding_ids"], "product_id": p["product_id"],
               "product_type": "savings", "angle": "flows", "mechanism_id": "savings.flows.x", "chain_label": "Savings fall",
               "statement": "The LKR weakened. Expected: savings fall.", "segment": None,
               "expected": {"metric": "deposit_inflow", "direction": "fall", "size": "medium", "timing": "weeks"}}
        tasks = [{"task_id": "t-1", "hypothesis_id": "h-1", "event_id": event["event_id"], "metric": "deposit_inflow"}] if req["validation"] else []
        return {"stop_reason": "finished", "tracks_version": "test", "mode": "tasks" if req["validation"] else "report_only",
                "report": f"# Investigation for {req['institution']['name']}\n", "untracked_products": [],
                "classifications": [], "events": [event], "out_of_scope": [],
                "screening": [{"event_id": event["event_id"], "product_type": "savings", "angle": "segment", "decision": "rejected",
                               "product_ids": [], "mechanism_ids": [], "reason": "Not exposed."}],
                "hypotheses": [hyp], "tasks": tasks, "context": [], "tool_trace": [], "usage": USAGE}

    def classified(self, req: dict) -> dict:
        """One event per distinct lead theme, each with one hypothesis on the first product."""
        groups: dict[str, list] = {}
        for f in req["findings"]:
            themes, direction = self.classify(f)
            groups.setdefault(str(themes), [themes, direction, []])[2].append(f)
        p = req["products"][0]
        events, hyps = [], []
        for i, (themes, direction, fs) in enumerate(groups.values(), start=1):
            events.append({"event_id": f"e-{i}", "title": fs[0]["title"][:80], "finding_ids": [x["finding_id"] for x in fs],
                           "themes": themes, "country": "home", "anchor": fs[0]["created_at"], "anchor_basis": "news_time",
                           "places": fs[0]["places"], "regions": []})
            hyps.append({"hypothesis_id": f"h-{i}", "event_id": f"e-{i}", "finding_ids": events[-1]["finding_ids"],
                         "product_id": p["product_id"], "product_type": "savings", "angle": "flows",
                         "mechanism_id": "savings.flows.x", "chain_label": "Deposits move",
                         "statement": "Expected: deposits move.", "segment": None,
                         "expected": {"metric": "deposit_inflow", "direction": direction, "size": "medium", "timing": "weeks"}})
        return {"stop_reason": "finished", "tracks_version": "test", "mode": "report_only",
                "report": "# Investigation\n", "untracked_products": [], "classifications": [], "events": events,
                "out_of_scope": [], "screening": [], "hypotheses": hyps, "tasks": [], "context": [], "tool_trace": [], "usage": USAGE}

    def handler(self, request: httpx.Request) -> httpx.Response:
        import json as _json
        if request.method == "POST":
            if self.fail_next:
                return httpx.Response(self.fail_next.pop(0), json={"error": "scripted failure"})
            body = _json.loads(request.content)
            self.requests.append(body)
            self.runs[body["run_id"]] = body
            return httpx.Response(202, json={"run_id": body["run_id"], "status": "queued", "created_at": "2026-10-07T00:00:00Z"})
        run_id = request.url.path.rsplit("/", 1)[-1]
        if run_id in self.forget:
            self.forget.discard(run_id)
            self.runs.pop(run_id, None)
        if run_id not in self.runs:
            return httpx.Response(404, json={"error": f"no run {run_id}"})
        if self.pending:
            return httpx.Response(200, json={"run_id": run_id, "status": "running", "created_at": "2026-10-07T00:00:00Z"})
        return httpx.Response(200, json={"run_id": run_id, "status": "completed", "result": self.result(self.runs[run_id])})


@pytest.fixture
def agent():
    return FakeInvestigationAgent()


class FakeMonitorAgent:
    """The monitor agent's check API (POST/GET /checks, contract 2.0): each check reports the
    pages in `pages` that are dated in its window and not in its recent_urls, one finding each."""

    def __init__(self):
        self.requests: list[dict] = []
        self.runs: dict[str, dict] = {}
        self.fail_next: list[int] = []  # HTTP statuses to answer POSTs with, in order
        self.pending = False  # True: GET answers "running"
        self.forget: set[str] = set()  # run_ids GET answers 404 for, once
        self.fail_run = False  # True: GET answers "failed"
        self.pages: list[dict] = []  # {url, title, published_at, line, places?, key_date?}

    def result(self, req: dict) -> dict:
        if req.get("provided_news") is not None:  # a simulation: every given headline matches line 1
            items = req["provided_news"]
            return {"stop_reason": "finished", "summary": f"{len(items)} new.", "tool_trace": [],
                    "findings": [{"kind": "news_match", "title": n["title"], "explanation": f"Reported: {n['title']}.",
                                  "tell_me_if_lines": [1], "evidence": {"web": [], "news": [{"item_id": n["id"]}]},
                                  "places": [], "key_date": None} for n in items],
                    "sources": [{"ref": n["id"], "url": None, "title": n["title"], "outlet": n.get("outlet"),
                                 "published_at": n["published_at"]} for n in items],
                    "coverage": {"web_queries": 0, "pages_seen": 0, "pages_dated": 0, "pages_in_window": 0,
                                 "already_reported": 0, "provided_news": len(items)},
                    "usage": {"model": "fake", "model_calls": 1, "tool_calls": 1, "duration_ms": 5}}
        since, until = (datetime.fromisoformat(req["window"][k]) for k in ("since", "until"))
        hits = [p for p in self.pages if since <= datetime.fromisoformat(p["published_at"]) <= until
                and p["url"] not in req["recent_urls"]]
        findings = [{"kind": "news_match", "title": p["title"], "explanation": f"Reported: {p['title']}.",
                     "tell_me_if_lines": [p.get("line", 1)], "evidence": {"web": [{"url": p["url"], "title": None}], "news": []},
                     "places": p.get("places", []), "key_date": p.get("key_date")} for p in hits]
        sources = [{"ref": p["url"], "url": p["url"], "title": p["title"], "outlet": p["url"].split("/")[2],
                    "published_at": p["published_at"]} for p in hits]
        return {"stop_reason": "finished", "summary": f"{len(hits)} new." if hits else "Nothing new.",
                "findings": findings, "sources": sources,
                "coverage": {"web_queries": 2, "pages_seen": len(self.pages), "pages_dated": len(self.pages),
                             "pages_in_window": len(hits), "already_reported": 0, "provided_news": 0},
                "tool_trace": [], "usage": {"model": "fake", "model_calls": 1, "tool_calls": 2, "duration_ms": 5}}

    def handler(self, request: httpx.Request) -> httpx.Response:
        import json as _json
        base = {"monitor_id": "x", "monitor_version": 1, "created_at": "2026-10-07T00:00:00Z"}
        if request.method == "POST":
            if self.fail_next:
                return httpx.Response(self.fail_next.pop(0), json={"error": "scripted failure"})
            body = _json.loads(request.content)
            self.requests.append(body)
            self.runs[body["run_id"]] = body
            return httpx.Response(202, json={**base, "run_id": body["run_id"], "status": "queued"})
        run_id = request.url.path.rsplit("/", 1)[-1]
        if run_id in self.forget:
            self.forget.discard(run_id)
            self.runs.pop(run_id, None)
        if run_id not in self.runs:
            return httpx.Response(404, json={"error": f"no run {run_id}", "run_id": run_id})
        if self.pending:
            return httpx.Response(200, json={**base, "run_id": run_id, "status": "running"})
        if self.fail_run:
            return httpx.Response(200, json={**base, "run_id": run_id, "status": "failed", "error": "Every model was busy.",
                                             "finished_at": "2026-10-07T00:00:09Z"})
        return httpx.Response(200, json={**base, "run_id": run_id, "status": "completed",
                                         "result": self.result(self.runs[run_id])})


@pytest.fixture
def monitor_agent():
    return FakeMonitorAgent()


@pytest.fixture
def radar_agent():
    from app.radar.fake_agent import FakeRadar

    return FakeRadar(canned=False)  # quiet unless a test scripts its stories


@pytest.fixture
async def app(env, fake, clock, agent, monitor_agent, radar_agent):
    url = settings.raw("TEST_DATABASE_URL")
    reset_database(url)
    provider = TwelveDataClient(transport=httpx.MockTransport(fake.handler))
    investigation = InvestigationClient("http://agent.test", transport=httpx.MockTransport(agent.handler))
    monitor = MonitorClient("http://monitor.test", transport=httpx.MockTransport(monitor_agent.handler))
    radar = RadarClient("http://radar.test", transport=httpx.MockTransport(radar_agent.handler))
    application = create_app(database_url=url, provider=provider, clock=clock, investigation=investigation,
                             monitor=monitor, radar=radar)
    async with application.router.lifespan_context(application):
        yield application
    await provider.aclose()
    await investigation.aclose()
    await monitor.aclose()
    await radar.aclose()


@pytest.fixture
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def sql(app):
    """Runs SQL on the test database (for checks and for setting up odd states)."""

    async def run(query: str, params=None):
        async with app.state.pool.connection() as conn:
            cur = await conn.execute(query, params)
            return await cur.fetchall() if cur.description else None

    return run
