"""Conformance check for a setup agent service against the contract (contract.py).

    uv run amiri agent-check --url http://localhost:8003

Drives the agent directly, as the server would, and checks the protocol, not the
quality of its answers (that is the scenario catalogue: `uv run amiri scenarios`).
Every check prints PASS or FAIL with the reason; the exit code is the number of failures.
"""

import json
import time
import uuid
from dataclasses import dataclass, field

import httpx
from pydantic import ValidationError

from app.assistant import contract
from app.assistant.agent import parse_sse
from app.assistant.tracks import view as tracks_view

FIRST_EVENT_SECONDS = 10.0


@dataclass
class Result:
    check: str
    ok: bool
    detail: str = ""


@dataclass
class Turn:
    status: int
    events: list[tuple[str, dict]] = field(default_factory=list)
    invalid: list[str] = field(default_factory=list)
    first_event_s: float | None = None
    total_s: float = 0.0
    header: str | None = None


def sample_context(thread_id: str, institution: dict | None) -> dict:
    return contract.ContextPack(
        thread_id=thread_id, institution=institution, readiness=None, filled_by=None,
        profile_version=3 if institution else None, changes_since_last_session=[],
        tracks=[{"track": t["track"], "status": "not_started", "summary": None, "notes": []} for t in tracks_view()],
        track_definitions=tracks_view(), current_track=None, thread_summary=None, recent_messages=[],
        pending_proposals=[]).model_dump(mode="json")


SAMPLE_BANK = {"institution_id": "check-bank", "profile_version": 3, "name": "Check Bank", "institution_type": "bank",
               "subtype": "commercial", "islamic": False, "country": "LK", "currency": "LKR", "time_zone": "Asia/Colombo",
               "summary": "", "footprint": [{"code": "LK", "name": "Sri Lanka", "role": "home"}], "segments": [], "products": [],
               "flows": [], "corridors": [], "regulators": [], "rivals": [], "counterparties": [], "risk_exposures": [],
               "radar_scope": {"places": ["LK"], "named_places": [], "themes": [], "actors": [], "why": {}}}


class Checker:
    def __init__(self, url: str, transport: httpx.AsyncBaseTransport | None = None, server_url: str = "http://localhost:8000"):
        self.client = httpx.AsyncClient(base_url=url.rstrip("/"), transport=transport, timeout=httpx.Timeout(120.0, connect=5.0))
        self.server_url = server_url
        self.results: list[Result] = []
        self.h = {contract.HEADER: contract.CONTRACT_VERSION}

    def note(self, check: str, ok: bool, detail: str = "") -> bool:
        self.results.append(Result(check, ok, detail))
        return ok

    async def session(self, institution: dict | None) -> str | None:
        thread = "thr-check-" + uuid.uuid4().hex[:6]
        body = {"session_id": "ses-check-" + uuid.uuid4().hex[:6], "thread_id": thread, "user_id": "check@amiri.dev",
                "institution_id": institution["institution_id"] if institution else None, "server_url": self.server_url,
                "context": sample_context(thread, institution)}
        r = await self.client.post("/sessions", json=body, headers=self.h)
        what = "with an institution" if institution else "before the institution exists"
        if not self.note(f"POST /sessions ({what}) answers 201", r.status_code == 201, f"got {r.status_code}"):
            return None
        try:
            sid = contract.AgentSessionOut(**r.json()).agent_session_id
        except (ValidationError, ValueError) as e:
            self.note("POST /sessions returns {agent_session_id}", False, str(e)[:200])
            return None
        self.note("POST /sessions returns {agent_session_id}", True)
        self.note("POST /sessions sends the contract header", r.headers.get(contract.HEADER) == contract.CONTRACT_VERSION,
                  f"got {r.headers.get(contract.HEADER)!r}")
        self._ctx = body
        return sid

    async def turn(self, sid: str, institution_id: str | None, **kw) -> Turn:
        body = {"turn_id": "turn-" + uuid.uuid4().hex[:6], "session_id": self._ctx["session_id"], "thread_id": self._ctx["thread_id"],
                "institution_id": institution_id, "user_id": "check@amiri.dev", "text": None, "answer": None,
                "requested_track": None, "current_track": None, "profile_version": None, "profile_changes": [], "track_notes": [], **kw}
        t0 = time.monotonic()
        async with self.client.stream("POST", f"/sessions/{sid}/turns", json=body, headers=self.h) as r:
            out = Turn(r.status_code, header=r.headers.get(contract.HEADER))
            if r.status_code != 200:
                await r.aread()
                return out
            async for ev, data in parse_sse(r.aiter_lines()):
                if out.first_event_s is None:
                    out.first_event_s = time.monotonic() - t0
                if ev == "done":
                    break
                out.events.append((ev, data))
                try:
                    contract.parse_event(ev, data)
                except ValidationError as e:
                    out.invalid.append(f"{ev}: {e.errors()[0]['msg']} at {'.'.join(map(str, e.errors()[0]['loc']))}")
        out.total_s = time.monotonic() - t0
        return out

    def check_turn(self, name: str, t: Turn, *, need_reply: bool = True) -> None:
        self.note(f"{name}: answers 200 with an event stream", t.status == 200, f"got {t.status}")
        if t.status != 200:
            return
        self.note(f"{name}: every event matches the contract", not t.invalid, "; ".join(t.invalid)[:300])
        self.note(f"{name}: first event within {FIRST_EVENT_SECONDS:.0f} s", (t.first_event_s or 999) <= FIRST_EVENT_SECONDS,
                  f"{t.first_event_s:.1f} s" if t.first_event_s is not None else "no events")
        if need_reply:
            kinds = [e for e, _ in t.events]
            self.note(f"{name}: replies (message, question or error)", any(k in kinds for k in ("message", "question", "error")),
                      f"events: {kinds}")

    async def run(self) -> list[Result]:
        try:
            r = await self.client.get("/health", headers=self.h)
            self.note("GET /health answers {\"status\": \"ok\"}", r.status_code == 200 and r.json().get("status") == "ok",
                      f"got {r.status_code} {r.text[:80]}")
        except (httpx.HTTPError, ValueError) as e:
            self.note("GET /health answers {\"status\": \"ok\"}", False, f"{type(e).__name__}: {e}")
            return self.results

        # before the institution exists
        sid = await self.session(None)
        if sid:
            t = await self.turn(sid, None, text="We're a commercial bank in Sri Lanka.")
            self.check_turn("first-setup message", t)
            tracks = [d.get("track") for e, d in t.events if e == "track"]
            self.note("first-setup message: routes to the institution track (or stays without a track)",
                      all(x == "institution" for x in tracks), f"tracks: {tracks}")
            q = next((d for e, d in t.events if e == "question" and d.get("options") and d.get("question_id")), None)
            if q:
                t2 = await self.turn(sid, None, answer={"question_id": q["question_id"], "options": [q["options"][0]]})
                self.check_turn("answer to its question", t2)

        # with an institution
        sid = await self.session(SAMPLE_BANK)
        if sid:
            t = await self.turn(sid, "check-bank", text="Let's look at our risks.", requested_track="risks")
            self.check_turn("picked track", t)
            tracks = [d.get("track") for e, d in t.events if e == "track"]
            self.note("picked track: honours requested_track", all(x == "risks" for x in tracks), f"tracks: {tracks}")
            t = await self.turn(sid, "check-bank", text="Write me a poem about the sea.", current_track="risks")
            self.check_turn("off-topic", t)
            self.note("off-topic: no proposal", not any(e == "proposal" for e, _ in t.events))
            t = await self.turn(sid, "check-bank", text="Anything new?", current_track="risks",
                                profile_changes=[{"section": "rivals", "item_id": "gulf-pay", "op": "create", "source": "form"}])
            self.check_turn("form changes since the last turn", t)
            r = await self.client.post("/sessions/nope/turns", json={}, headers=self.h)
            self.note("unknown session: 404 or 422, not 5xx", r.status_code in (404, 422), f"got {r.status_code}")
            r = await self.client.post(f"/sessions/{sid}/turns", json={"bogus": True}, headers=self.h)
            self.note("bad request: 4xx, not 5xx", 400 <= r.status_code < 500, f"got {r.status_code}")
        return self.results


def report(results: list[Result]) -> str:
    lines = [f"{'PASS' if r.ok else 'FAIL'}  {r.check}{'' if r.ok or not r.detail else '  -- ' + r.detail}" for r in results]
    bad = sum(1 for r in results if not r.ok)
    lines.append(f"\n{len(results) - bad} passed, {bad} failed (contract {contract.CONTRACT_VERSION})")
    return "\n".join(lines)


def to_json(results: list[Result]) -> str:
    return json.dumps([r.__dict__ for r in results], indent=1)
