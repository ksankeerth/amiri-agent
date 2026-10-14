"""The contract between amiri-server and this agent, version 1.0.

Mirrors the server's `server/app/assistant/contract.py`, the single source; the server
writes it as `contracts/setup-agent-openapi.yaml`, and
tests/unit/test_contract.py checks these models against that file.

    GET  /health                             liveness: {"status": "ok"}
    GET  /health/details                     service, contract, sessions
    POST /sessions                           AgentSessionIn  -> 201 AgentSessionOut
    POST /sessions/{agent_session_id}/turns  TurnIn -> 200 text/event-stream of events

Every request carries `X-Amiri-Contract: 1.0` and every answer sends it back. Events are
server-sent events, `event: <type>` and `data: <json of the event without type>`.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

CONTRACT_VERSION = "1.0"
HEADER = "X-Amiri-Contract"
TRACK_IDS = ("institution", "footprint_flows", "customers_products", "rules", "rivals_partners", "risks",
             "monitors", "verification", "history", "agent_view", "question", "offtopic")
TrackId = Literal[TRACK_IDS]  # type: ignore[valid-type]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- server -> agent


class ContextPack(BaseModel):
    """What the agent starts a session with. Open to additions."""

    model_config = ConfigDict(extra="allow")
    thread_id: str
    institution: dict[str, Any] | None
    readiness: dict[str, Any] | None
    filled_by: dict[str, int] | None
    profile_version: int | None
    changes_since_last_session: list[dict[str, Any]]
    tracks: list[dict[str, Any]]
    track_definitions: list[dict[str, Any]]
    current_track: str | None
    thread_summary: str | None
    recent_messages: list[dict[str, Any]]
    pending_proposals: list[dict[str, Any]]


class AgentSessionIn(Strict):
    session_id: str
    thread_id: str
    user_id: str
    institution_id: str | None
    server_url: str
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
    institution_id: str | None
    user_id: str
    text: str | None = None
    answer: Answer | None = None
    requested_track: TrackId | None = None
    current_track: TrackId | None
    profile_version: int | None
    profile_changes: list[dict[str, Any]] = Field(default_factory=list)
    track_notes: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------- agent -> server (events)


class MessageEv(Strict):
    type: Literal["message"] = "message"
    text: str = Field(min_length=1, max_length=8000)
    cites: list[dict[str, Any]] = Field(default_factory=list)


class TextDeltaEv(Strict):
    type: Literal["text_delta"] = "text_delta"
    text: str


class QuestionEv(Strict):
    type: Literal["question"] = "question"
    question_id: str = Field(min_length=1, max_length=80)
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
    proposal_id: str


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


def sse(ev: BaseModel) -> str:
    """One event as a server-sent event (the type goes in the event line, not the data)."""
    return f"event: {ev.type}\ndata: {ev.model_dump_json(exclude={'type'})}\n\n"  # type: ignore[attr-defined]
