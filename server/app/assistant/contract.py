"""The contract between amiri-server and the setup agent (amiri-setup-agent), version 1.0.

The agent is a service with four endpoints; whatever it uses inside (Google ADK, a
router and track agents) stays on its side:

    GET  /health                           liveness: {"status": "ok"}
    GET  /health/details                   optional, as every Amiri Agent service
    POST /sessions                         AgentSessionIn  -> 201 AgentSessionOut
    POST /sessions/{agent_session_id}/turns  TurnIn -> 200 text/event-stream of Event

Every request carries `X-Amiri-Contract: 1.0`; the agent answers with the same header.
Events are server-sent events: `event: <type>` and `data: <json of the event>`. The
stream ends when the agent closes it (an `event: done` line is allowed and ignored).
Errors before the stream starts: RFC 9457 problem JSON (404 unknown session, 422 bad
request). The agent's tools are the server's own API,
called with X-Amiri-On-Behalf-Of: <user_id> and X-Amiri-Source: assistant.

These models are the single source: the server's connector validates every event
against them, the fake agent implements them, and `uv run amiri agent-contract` writes
contracts/setup-agent-openapi.yaml from them.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from app.assistant.tracks import TRACKS

CONTRACT_VERSION = "1.0"
HEADER = "X-Amiri-Contract"
TrackId = Literal[tuple(TRACKS)]  # type: ignore[valid-type]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- server -> agent


class ContextPack(BaseModel):
    """What the agent starts a session with. Open to additions."""

    model_config = ConfigDict(extra="allow")
    thread_id: str
    institution: dict[str, Any] | None = Field(description="GET /institutions/{id}/context; null before the institution exists.")
    readiness: dict[str, Any] | None = Field(description="{ready, open: [checks not ok], warnings}")
    filled_by: dict[str, int] | None = Field(description="Items created per source: form, assistant, setup, import.")
    profile_version: int | None
    changes_since_last_session: list[dict[str, Any]]
    tracks: list[dict[str, Any]] = Field(description="Per track: status, summary, notes.")
    track_definitions: list[dict[str, Any]] = Field(description="GET /assistant/tracks.")
    current_track: str | None
    thread_summary: str | None
    recent_messages: list[dict[str, Any]]
    pending_proposals: list[dict[str, Any]]


class AgentSessionIn(Strict):
    session_id: str = Field(description="The server's session id (for propose: session_id).")
    thread_id: str = Field(description="The chat thread (for propose: thread_id; get_chat_history).")
    user_id: str = Field(description="The person; send it as X-Amiri-On-Behalf-Of on tool calls.")
    institution_id: str | None
    server_url: str = Field(description="Base URL of amiri-server for the tools (…/api/v1/…).")
    context: ContextPack


class AgentSessionOut(Strict):
    agent_session_id: str


class Answer(Strict):
    question_id: str
    options: list[str] = Field(min_length=1)


class TurnIn(Strict):
    turn_id: str
    session_id: str
    thread_id: str
    institution_id: str | None = Field(description="Set once the institution exists (it may appear between turns).")
    user_id: str
    text: str | None = Field(None, description="A typed message (English).")
    answer: Answer | None = Field(None, description="Or the answer to a question the agent asked.")
    requested_track: TrackId | None = Field(None, description="The user picked this track: route there without a model call.")
    current_track: TrackId | None
    profile_version: int | None
    profile_changes: list[dict[str, Any]] = Field(default_factory=list, description="Form changes since the agent last looked.")
    track_notes: list[dict[str, Any]] = Field(default_factory=list, description="Notes kept for the current track.")


# ---------------------------------------------------------------- agent -> server (events)


class MessageEv(Strict):
    type: Literal["message"] = "message"
    text: str = Field(min_length=1, max_length=8000)
    cites: list[dict[str, Any]] = Field(default_factory=list, description="Where the reply's numbers come from.")


class TextDeltaEv(Strict):
    type: Literal["text_delta"] = "text_delta"
    text: str


class QuestionEv(Strict):
    type: Literal["question"] = "question"
    question_id: str = Field(min_length=1, max_length=80, description="Unique within the thread.")
    text: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=1, max_length=8)
    multi: bool = False


class TrackEv(Strict):
    type: Literal["track"] = "track"
    track: TrackId
    reason: str | None = None


class Note(Strict):
    track: TrackId
    text: str = Field(min_length=1, max_length=500)


class TrackNotesEv(Strict):
    type: Literal["track_notes"] = "track_notes"
    notes: list[Note] = Field(min_length=1)


class TrackConcludedEv(Strict):
    type: Literal["track_concluded"] = "track_concluded"
    track: TrackId
    summary: str = Field(min_length=1, max_length=400)


class ProposalEv(Strict):
    type: Literal["proposal"] = "proposal"
    proposal_id: str = Field(description="From the agent's POST /api/v1/proposals call in this turn.")


class UsageEv(Strict):
    type: Literal["usage"] = "usage"
    model_calls: int = Field(0, ge=0)
    input_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)


class ErrorEv(Strict):
    type: Literal["error"] = "error"
    code: str
    message: str


Event = Annotated[MessageEv | TextDeltaEv | QuestionEv | TrackEv | TrackNotesEv | TrackConcludedEv | ProposalEv
                  | UsageEv | ErrorEv, Field(discriminator="type")]
EVENT = TypeAdapter(Event)
EVENT_TYPES = ("message", "text_delta", "question", "track", "track_notes", "track_concluded", "proposal", "usage", "error")


def parse_event(event_type: str, data: dict) -> BaseModel:
    """Validates one event from the agent (raises pydantic.ValidationError)."""
    return EVENT.validate_python({**data, "type": event_type})
