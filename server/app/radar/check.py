"""Conformance check of a Radar agent against the contract (app/radar/contract.py).

    uv run amiri radar-check --url http://localhost:8006

Drives the agent as the server would: a run for a sample bank, then a simulation run with
provided headlines. Checks the protocol and the rules the server relies on, not the quality of
the stories. Every check prints PASS or FAIL; the exit code is the number of failures.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from app.radar.contract import RadarRunStatus

TIMEOUT_S = 600


@dataclass
class Result:
    check: str
    ok: bool
    detail: str = ""


def sample_request(provided: bool = False) -> dict:
    now = time.time()
    iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
    req = {
        "run_id": f"rad-check-{uuid.uuid4().hex[:8]}",
        "institution": {"name": "Check Bank", "institution_type": "bank", "country": "LK", "country_name": "Sri Lanka",
                        "currency": "LKR", "time_zone": "Asia/Colombo", "summary": "A commercial bank: deposits, SME loans, pawning.",
                        "corridors": ["SA", "AE"], "flows": [{"id": "remit-sa", "kind": "remittances_in", "local": "LK", "counterpart": "SA"}],
                        "rivals": [{"id": "coastal-remit", "name": "Coastal Remit", "aliases": []}],
                        "regulators": [{"id": "cbsl", "name": "Central Bank of Sri Lanka", "aliases": ["CBSL"]}]},
        "scope": {"places": ["LK", "SA", "AE", "chk:hormuz"], "places_why": {"LK": ["footprint (home)"], "SA": ["flow: remittances"]},
                  "themes": ["fx", "remittance", "disaster", "regulation", "competitor"],
                  "actors": ["CBSL", "Coastal Remit"]},
        "window": {"since": iso(now - 6 * 3600), "until": iso(now)},
        "seen": ["check-seen-1"],
        "limits": {"max_stories": 5, "max_model_calls": 20, "timeout_seconds": 300, "max_queries": 2,
                   "max_bytes_per_query": 2_000_000_000},
    }
    if provided:
        req["provided_news"] = [{"id": "n1", "title": "Saudi Arabia tightens visa renewals for foreign workers",
                                 "published_at": iso(now - 3600), "outlet": "Studio wire", "places": ["SA"]},
                                {"id": "n2", "title": "Rupee falls 3% against the dollar", "published_at": iso(now - 1800),
                                 "outlet": "Studio wire", "places": ["LK"]}]
    return req


class Checker:
    def __init__(self, url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.c = httpx.AsyncClient(base_url=url.rstrip("/"), transport=transport, timeout=httpx.Timeout(60.0, connect=5.0))
        self.results: list[Result] = []

    def note(self, check: str, ok: bool, detail: str = "") -> bool:
        self.results.append(Result(check, ok, detail))
        return ok

    async def _finish(self, run_id: str) -> dict | None:
        t0 = time.monotonic()
        while time.monotonic() - t0 < TIMEOUT_S:
            r = await self.c.get(f"/radar-runs/{run_id}")
            if r.status_code != 200:
                self.note("GET /radar-runs/{id} answers 200 while the run exists", False, f"got {r.status_code}")
                return None
            body = r.json()
            if body.get("status") not in ("queued", "running"):
                return body
            await asyncio.sleep(2)  # the check tool polls; not production code
        self.note("the run finishes within 10 minutes", False)
        return None

    def _rules(self, name: str, req: dict, body: dict) -> None:
        try:
            st = RadarRunStatus.model_validate(body)
        except ValidationError as e:
            self.note(f"{name}: the answer matches the contract", False, str(e.errors()[0])[:300])
            return
        self.note(f"{name}: the answer matches the contract", True)
        if not self.note(f"{name}: the run completed", st.status in ("completed", "stopped_early"), f"{st.status}: {st.error}"):
            return
        res = st.result
        lim = req["limits"]
        self.note(f"{name}: at most max_stories stories", len(res.stories) <= lim["max_stories"], str(len(res.stories)))
        fps = [s.fingerprint for s in res.stories]
        self.note(f"{name}: fingerprints are unique", len(fps) == len(set(fps)), str(fps))
        allowed = set(req["scope"]["places"]) | {p.split("-")[0] for p in req["scope"]["places"]}
        stray = sorted({p for s in res.stories for p in s.places if p not in allowed and p.split("-")[0] not in allowed})
        self.note(f"{name}: story places come from the scope", not stray, f"outside the scope: {stray}")
        bad_dev = [s.development_of for s in res.stories if s.development_of and s.development_of not in req["seen"]]
        self.note(f"{name}: development_of names a story in `seen`", not bad_dev, str(bad_dev))
        self.note(f"{name}: at most max_queries queries", len(res.queries) <= lim["max_queries"], str(len(res.queries)))
        over = [q.name for q in res.queries if q.bytes_processed > lim["max_bytes_per_query"]]
        self.note(f"{name}: no query over max_bytes_per_query", not over, str(over))
        self.note(f"{name}: bytes_processed is the queries' total",
                  res.bytes_processed == sum(q.bytes_processed for q in res.queries), str(res.bytes_processed))
        if req.get("provided_news"):
            self.note(f"{name}: a simulation runs no BigQuery query", not res.queries and res.bytes_processed == 0,
                      f"{len(res.queries)} queries")

    async def run(self) -> list[Result]:
        try:
            r = await self.c.get("/health")
            self.note('GET /health answers {"status": "ok"}', r.status_code == 200 and r.json().get("status") == "ok", r.text[:80])
        except (httpx.HTTPError, ValueError) as e:
            self.note('GET /health answers {"status": "ok"}', False, f"{type(e).__name__}: {e}")
            return self.results
        for name, provided in (("live run", False), ("simulation run", True)):
            req = sample_request(provided)
            r = await self.c.post("/radar-runs", json=req)
            if not self.note(f"{name}: POST /radar-runs answers 202", r.status_code == 202, f"got {r.status_code} {r.text[:200]}"):
                continue
            again = await self.c.post("/radar-runs", json=req)
            self.note(f"{name}: the same run_id and body is not a new run (200 or 202)", again.status_code in (200, 202),
                      f"got {again.status_code}")
            body = await self._finish(req["run_id"])
            if body:
                self._rules(name, req, body)
        r = await self.c.get("/radar-runs/nope-unknown")
        self.note("an unknown run answers 404", r.status_code == 404, f"got {r.status_code}")
        r = await self.c.post("/radar-runs", json={"bogus": True})
        self.note("a bad request answers 4xx, not 5xx", 400 <= r.status_code < 500, f"got {r.status_code}")
        return self.results


def report(results: list[Result]) -> str:
    lines = [f"{'PASS' if r.ok else 'FAIL'}  {r.check}{'' if r.ok or not r.detail else '  -- ' + r.detail}" for r in results]
    bad = sum(1 for r in results if not r.ok)
    lines.append(f"\n{len(results) - bad} passed, {bad} failed (Radar contract 2.0)")
    return "\n".join(lines)
