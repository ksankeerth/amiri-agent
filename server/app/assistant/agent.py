"""The connection from amiri-server to the chat agent (amiri-assistant, Google ADK).

The server owns sessions, the transcript and proposals (service.py). This module
is the only place that talks to the agent. It turns one user message into a stream
of AssistantEvents, the server's own event protocol, which the web app renders.

Three backends, chosen by ASSISTANT_BACKEND:

- none (default): not connected. Every turn answers with an `error` event
  (code assistant_not_connected). The forms still do everything.
- stub: canned replies in-process, for UI work.
- http: the setup agent service at ASSISTANT_URL, through the contract in contract.py
  (the real amiri-setup-agent, or `uv run amiri fake-agent`).
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx
from pydantic import ValidationError

from app import settings
from app.assistant import contract
from app.text import plural

EventType = Literal["message", "text_delta", "question", "track", "track_notes", "track_concluded", "proposal",
                    "usage", "error"]


@dataclass
class AssistantEvent:
    """One thing the setup agent says or does, in the server's protocol.

    message          {text}                                a finished reply (stored)
    text_delta       {text}                                streaming part of a reply (not stored)
    question         {question_id, text, options, multi}   ask the user to pick (chips)
    track            {track, reason?}                      the router moved to a track (tracks.py)
    track_notes      {notes: [{track, text}]}               facts for other tracks, said early (kept for them)
    track_concluded  {track, summary}                      a track is done (read-only tracks, or after its proposal)
    proposal         {proposal_id}                         the agent called POST /api/v1/proposals (its tool);
                                                           the server already stored it and fills it in
    usage            {model_calls, input_tokens, output_tokens}  added up per session (not shown)
    error            {code, message}                       the turn failed; nothing was changed

    A message may also carry {cites: [...]}: where its numbers come from. The server
    flags numbers in a reply that neither the user typed nor the profile or reference
    data contains (unverified_numbers), whatever the agent claims.
    """

    type: EventType
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class TurnInput:
    """What the agent gets for one turn (on top of the session's context pack)."""

    session_id: str
    thread_id: str
    agent_session: str | None        # the ADK session id
    institution_id: str | None       # None during first setup, before the institution exists
    user_id: str                     # the person; tools act on their behalf
    text: str | None                 # a typed message
    answer: dict | None              # or an answer to a question: {question_id, options}
    requested_track: str | None      # the track the user picked (chip or tab); routing is then code
    current_track: str | None        # where the conversation is
    profile_version: int | None      # now
    profile_changes: list[dict] = field(default_factory=list)  # changes by forms since the agent last looked
    track_notes: list[dict] = field(default_factory=list)      # notes kept for the current track
    turn_id: str | None = None
    english: bool = True


class Assistant(Protocol):
    name: str

    def connected(self) -> bool: ...

    async def start_session(self, session_id: str, thread_id: str, user_id: str, context: dict) -> str | None:
        """Creates the agent's own session from the context pack; returns its id (stored as agent_session)."""
        ...

    def run(self, turn: TurnInput) -> AsyncIterator[AssistantEvent]:
        """One turn: the agent's reply as events. Must not raise; report failures as error events."""
        ...


# ---------------------------------------------------------------- none


class NotConnected:
    name = "none"

    def connected(self) -> bool:
        return False

    async def start_session(self, session_id, thread_id, user_id, context) -> str | None:
        return None

    async def run(self, turn: TurnInput) -> AsyncIterator[AssistantEvent]:
        yield AssistantEvent("error", {
            "code": "assistant_not_connected",
            "message": "The setup assistant isn't connected yet. Your message is saved; "
                       "use the forms to make changes (they do everything the assistant can).",
        })


# ---------------------------------------------------------------- stub (UI development only)


KEYWORDS = [
    ("customers_products", ("customer", "segment", "product", "loan", "deposit", "policy", "cover", "savings")),
    ("footprint_flows", ("branch", "footprint", "operate", "flow", "remittance", "export", "import", "region")),
    ("rules", ("regulat", "rule", "sanction", "central bank", "supervis", "ofac")),
    ("rivals_partners", ("rival", "compet", "partner", "reinsur", "correspondent")),
    ("risks", ("risk", "flood", "cyclone", "conflict", "hazard", "drought")),
    ("history", ("who added", "who changed", "history", "how did")),
    ("agent_view", ("radar", "agent see", "scope")),
    ("verification", ("verify", "check", "missing", "complete")),
    ("institution", ("we are", "we're", "bank", "insurer", "currency", "time zone")),
]


class StubAssistant:
    """Canned replies that exercise every event type the UI handles. No model, no agent.
    Routing is keyword matching, a stand-in for the real router."""

    name = "stub"

    def connected(self) -> bool:
        return True

    async def start_session(self, session_id, thread_id, user_id, context) -> str | None:
        return f"stub-{session_id}"

    async def run(self, turn: TurnInput) -> AsyncIterator[AssistantEvent]:
        said = turn.text if turn.text is not None else ", ".join((turn.answer or {}).get("options", []))
        low = said.lower()
        track = turn.requested_track
        if not track:
            track = next((t for t, words in KEYWORDS if any(w in low for w in words)), None)
        if not track:
            track = "offtopic" if turn.current_track is None and turn.institution_id else (turn.current_track or "institution")
        if track != turn.current_track:
            yield AssistantEvent("track", {"track": track, "reason": "stub keyword routing"})
        if turn.profile_changes:
            yield AssistantEvent("message", {"text": f"(Stub) I see {plural(len(turn.profile_changes), 'change')} made with the forms since we last spoke."})
        reply = (f"(Stub assistant, {track}) You said: “{said}”. The real setup agent isn't connected; "
                 "this only shows how replies look.")
        for word in reply.split(" "):
            yield AssistantEvent("text_delta", {"text": word + " "})
        yield AssistantEvent("message", {"text": reply})
        if track == "institution" and turn.institution_id is None and turn.answer is None:
            yield AssistantEvent("question", {"question_id": f"q-{uuid.uuid4().hex[:8]}",
                                              "text": "What kind of institution are you?", "options": ["Bank", "Insurer"], "multi": False})
        if any(w in low for w in ("done", "that's all", "conclude")):
            yield AssistantEvent("track_concluded", {"track": track, "summary": "(stub) concluded on request"})


# ---------------------------------------------------------------- the setup agent over HTTP (contract.py)


async def parse_sse(lines: AsyncIterator[str]) -> AsyncIterator[tuple[str, dict]]:
    """Server-sent events -> (event, data)."""
    event, data = "message", ""
    async for line in lines:
        if line == "":
            if data:
                yield event, json.loads(data)
            event, data = "message", ""
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data += line[5:].strip()
    if data:
        yield event, json.loads(data)


class HttpAgent:
    """The setup agent (amiri-setup-agent, or the fake agent) through the contract in contract.py.
    Every event is validated; anything off-contract ends the turn with agent_contract_violation."""

    name = "http"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.url = settings.raw("ASSISTANT_URL").rstrip("/")
        t = settings.number("ASSISTANT_TIMEOUT_SECONDS")
        self.client = httpx.AsyncClient(base_url=self.url, transport=transport,
                                        timeout=httpx.Timeout(connect=5.0, read=t, write=10.0, pool=5.0))
        self._ok: bool | None = None

    def connected(self) -> bool:
        return bool(self._ok)

    async def health(self) -> bool:
        try:
            r = await self.client.get("/health", headers=await self._headers())
            self._ok = r.status_code == 200 and r.json().get("status") == "ok"
        except (httpx.HTTPError, ValueError):
            self._ok = False
        return self._ok

    async def _headers(self) -> dict[str, str]:
        h = {contract.HEADER: contract.CONTRACT_VERSION}
        if settings.raw("ASSISTANT_AUTH") == "id_token":  # Cloud Run service-to-service
            import google.auth.transport.requests
            import google.oauth2.id_token

            token = await asyncio.to_thread(google.oauth2.id_token.fetch_id_token,
                                            google.auth.transport.requests.Request(), self.url)
            h["Authorization"] = f"Bearer {token}"
        return h

    async def start_session(self, session_id, thread_id, user_id, context) -> str | None:
        body = contract.AgentSessionIn(
            session_id=session_id, thread_id=thread_id, user_id=user_id, institution_id=(context.get("institution") or {}).get("institution_id"),
            server_url=settings.raw("SERVER_PUBLIC_URL"), context=contract.ContextPack(**json.loads(json.dumps(context, default=str))))
        try:
            r = await self.client.post("/sessions", json=body.model_dump(mode="json"), headers=await self._headers())
            if r.status_code != 201:
                self._ok = r.status_code < 500
                return None
            self._ok = True
            return contract.AgentSessionOut(**r.json()).agent_session_id
        except (httpx.HTTPError, ValueError):
            self._ok = False
            return None

    async def run(self, turn: TurnInput) -> AsyncIterator[AssistantEvent]:
        if not turn.agent_session:
            yield AssistantEvent("error", {"code": "assistant_not_connected",
                                           "message": "The setup agent didn't start this session; it may be down. The forms still work."})
            return
        body = contract.TurnIn(
            turn_id=turn.turn_id or "turn", session_id=turn.session_id, thread_id=turn.thread_id,
            institution_id=turn.institution_id, user_id=turn.user_id, text=turn.text,
            answer=contract.Answer(**turn.answer) if turn.answer else None, requested_track=turn.requested_track,
            current_track=turn.current_track, profile_version=turn.profile_version,
            profile_changes=json.loads(json.dumps(turn.profile_changes, default=str)), track_notes=turn.track_notes)
        try:
            async with self.client.stream("POST", f"/sessions/{turn.agent_session}/turns", json=body.model_dump(mode="json"),
                                          headers=await self._headers()) as r:
                if r.status_code == 404:
                    yield AssistantEvent("error", {"code": "agent_session_lost",
                                                   "message": "The setup agent lost this session (it restarted); your next message starts a new one."})
                    return
                if r.status_code != 200:
                    detail = (await r.aread()).decode(errors="replace")[:300]
                    yield AssistantEvent("error", {"code": "assistant_failed", "message": f"The setup agent answered {r.status_code}: {detail}"})
                    return
                self._ok = True
                async for event, data in parse_sse(r.aiter_lines()):
                    if event == "done":
                        break
                    try:
                        ev = contract.parse_event(event, data)
                    except ValidationError as e:
                        yield AssistantEvent("error", {"code": "agent_contract_violation",
                                                       "message": f"The setup agent sent an invalid {event!r} event: {e.errors()[0]['msg']} "
                                                                  f"at {'.'.join(str(x) for x in e.errors()[0]['loc'])}"})
                        return
                    yield AssistantEvent(ev.type, ev.model_dump(exclude={"type"}))  # type: ignore[attr-defined]
        except httpx.TimeoutException:
            yield AssistantEvent("error", {"code": "assistant_timeout", "message": "The setup agent didn't answer in time."})
        except httpx.HTTPError as e:
            self._ok = False
            yield AssistantEvent("error", {"code": "assistant_unavailable", "message": f"The setup agent can't be reached ({type(e).__name__})."})


def make_assistant() -> Assistant:
    backend = settings.raw("ASSISTANT_BACKEND").lower()
    if backend == "stub":
        return StubAssistant()
    if backend in ("http", "adk"):
        return HttpAgent()
    return NotConnected()
