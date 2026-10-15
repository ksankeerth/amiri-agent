"""The setup agent's chat and proposals (/api/v1).

The web app uses: status, tracks, thread, sessions, run_sse, proposals (confirm/reject).
The agent's tools use: sessions/{id}/context, threads/{id}/messages, threads/{id}/summary,
POST /proposals, and the institution profile's read endpoints.

Who: X-Amiri-Actor (the signed-in person's email; IAP later). The agent's own calls also
send X-Amiri-On-Behalf-Of (the person) and X-Amiri-Source: assistant.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.assistant.monitor_ops import MonitorOp
from app.assistant.service import AssistantService
from app.assistant.tracks import TRACKS
from app.institutions.schemas import Operation

router = APIRouter(prefix="/api/v1", tags=["setup agent"])
Actor = Annotated[str | None, Header(alias="X-Amiri-Actor", description="The signed-in person (email).")]
OnBehalf = Annotated[str | None, Header(alias="X-Amiri-On-Behalf-Of", description="The person the agent acts for.")]
TrackId = Literal[tuple(TRACKS)]  # type: ignore[valid-type]


def svc(request: Request) -> AssistantService:
    return request.app.state.assistant


def me(actor: str | None) -> str:
    return (actor or "anonymous")[:120]


class Status(BaseModel):
    backend: str
    connected: bool
    starting: bool = False                 # Cloud Run is starting the agent; check again shortly
    message: str | None
    keep_warm_seconds: int = 0             # while the chat is open, check this often (0: don't)
    keep_warm_idle_minutes: int = 0        # and stop after this long without anyone using the page


class TrackDef(BaseModel):
    track: str
    label: str
    tab: str | None
    setup_step: str | None
    writes: list[str]
    read_only: bool
    shown: bool
    order: int | None


class TrackState(TrackDef):
    status: Literal["not_started", "in_progress", "concluded"]
    summary: str | None
    notes: list[dict[str, Any]] = Field(default_factory=list, description="Facts said early, kept for this track.")
    updated_at: datetime | None


class Message(BaseModel):
    message_id: int
    session_id: str | None
    track: str | None
    role: str
    kind: str
    content: dict[str, Any]
    at: datetime


class Proposal(BaseModel):
    proposal_id: str
    thread_id: str
    session_id: str | None
    track: str
    kind: Literal["profile", "create_institution", "monitors"]
    institution_id: str | None
    created_by: str
    on_behalf_of: str
    summary: str
    operations: list[dict[str, Any]]
    institution: dict[str, Any] | None
    evidence: list[Any]
    changes: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    base_profile_version: int | None
    status: Literal["pending", "confirmed", "rejected", "expired", "failed"]
    decided_by: str | None
    decided_at: datetime | None
    result: dict[str, Any] | None
    created_at: datetime
    expires_at: datetime
    tab: str | None
    deletes: int = Field(description="Items it removes; 3 or more need confirm_deletes on confirm.")
    fits: bool | None = Field(None, description="Pending: does it still apply to the profile as it is now?")
    fit_errors: list[dict[str, Any]] = Field(default_factory=list)


class Thread(BaseModel):
    thread_id: str
    institution_id: str | None
    owner_user: str
    current_track: str | None
    summary: str | None
    created_at: datetime
    updated_at: datetime
    tracks: list[TrackState]
    messages: list[Message]
    next_before: int | None
    proposals: list[Proposal]
    active_session_id: str | None
    turn_in_progress: bool = Field(description="A reply is still being written (e.g. after a disconnect): poll the thread.")


class Session(BaseModel):
    session_id: str
    thread_id: str
    user_id: str
    agent_connected: bool
    seen_profile_version: int | None
    started_at: datetime
    last_active_at: datetime
    ended_at: datetime | None
    resumed: bool | None = None


class SessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    institution_id: str | None = Field(None, description="Omit during first setup, before the institution exists.")


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: str
    options: list[str] = Field(min_length=1)


class TurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    text: str | None = Field(None, min_length=1, max_length=4000)
    answer: Answer | None = None
    track: TrackId | None = Field(None, description="The track the user picked (chip or tab); routing is then code.")


class SummaryIn(BaseModel):
    summary: str = Field(min_length=1, max_length=8000)


class ProposalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    thread_id: str
    track: TrackId
    kind: Literal["profile", "create_institution", "monitors"] = "profile"
    summary: str = Field(min_length=1, max_length=400, description="One line the user reads, e.g. “Add Kerala and two customer groups”.")
    operations: list[Operation] = Field(default_factory=list, max_length=100, description="kind profile: :batch operations.")
    institution: dict[str, Any] | None = Field(None, description="kind create_institution: the institution's fields.")
    monitors: list[MonitorOp] = Field(default_factory=list, max_length=10,
                                      description="kind monitors (the monitors track): monitors to create or update.")
    evidence: list[dict[str, Any]] = Field(default_factory=list, description="Where each operation came from (suggestion, user message).")
    session_id: str | None = None
    on_behalf_of: str | None = Field(None, description="Default: X-Amiri-On-Behalf-Of, then X-Amiri-Actor.")


@router.get("/assistant/status", response_model=Status, summary="Is the setup agent connected? (ASSISTANT_BACKEND)")
async def status(request: Request):
    return await svc(request).status()


@router.get("/assistant/tracks", response_model=list[TrackDef], summary="The tracks: what each may change, its tab and setup step")
async def tracks(request: Request):
    return svc(request).tracks()


@router.get("/assistant/thread", response_model=Thread,
            summary="The institution's chat (or, before it exists, yours): messages, tracks, proposals, active session")
async def thread(request: Request, institution_id: str | None = None, actor: Actor = None,
                 limit: Annotated[int, Query(ge=1, le=500)] = 200):
    return await svc(request).thread(institution_id, me(actor), limit)


@router.get("/assistant/threads/{thread_id}/messages", summary="Chat history, oldest first, paged back with before (agent tool)")
async def messages(request: Request, thread_id: str, before: int | None = None,
                   limit: Annotated[int, Query(ge=1, le=200)] = 50):
    return await svc(request).messages(thread_id, before, limit)


@router.put("/assistant/threads/{thread_id}/summary", summary="The running summary of earlier sessions (agent tool)")
async def save_summary(request: Request, thread_id: str, body: SummaryIn):
    return await svc(request).save_summary(thread_id, body.summary)


@router.post("/assistant/sessions", response_model=Session, status_code=201,
             summary="Start a session (or resume the active one); the server builds the context pack")
async def start_session(request: Request, body: SessionIn, actor: Actor = None):
    return await svc(request).start_session(body.institution_id, me(actor))


@router.get("/assistant/sessions/{session_id}/context", summary="The context pack the agent started this session with")
async def session_context(request: Request, session_id: str):
    return await svc(request).session_context(session_id)


@router.post("/assistant/sessions/{session_id}:end", response_model=Session)
async def end_session(request: Request, session_id: str):
    return await svc(request).end_session(session_id)


@router.post("/assistant/run_sse", summary="Send a message or an answer (optionally picking a track); the reply streams back",
             response_description="text/event-stream: start, track, text_delta*, message, question, proposal, track_concluded, error, done")
async def run_sse(request: Request, body: TurnIn, actor: Actor = None):
    s = svc(request)
    turn = await s.open_turn(body.session_id, body.text, body.answer.model_dump() if body.answer else None,
                             body.track, me(actor))
    return StreamingResponse(s.run(turn), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/proposals", response_model=Proposal, status_code=201,
             summary="A track's conclusion (agent tool): checked (track scope, numbers, dry run); applied only when confirmed")
async def create_proposal(request: Request, body: ProposalIn, actor: Actor = None, on_behalf: OnBehalf = None):
    return await svc(request).create_proposal(
        thread_id=body.thread_id, track=body.track, kind=body.kind, summary=body.summary,
        operations=body.operations, institution=body.institution, evidence=body.evidence, monitors=body.monitors,
        session_id=body.session_id, on_behalf_of=body.on_behalf_of or on_behalf or me(actor))


@router.get("/proposals", response_model=list[Proposal], summary="Proposals, newest first")
async def list_proposals(request: Request, thread_id: str | None = None, institution_id: str | None = None,
                         status: Literal["pending", "confirmed", "rejected", "expired", "failed"] | None = None):
    return await svc(request).list_proposals(thread_id, institution_id, status)


@router.get("/proposals/{proposal_id}", response_model=Proposal)
async def get_proposal(request: Request, proposal_id: str):
    return await svc(request).get_proposal(proposal_id)


@router.post("/proposals/{proposal_id}:confirm", response_model=Proposal,
             summary="Apply it (only the person it was made for); concludes its track")
async def confirm(request: Request, proposal_id: str, actor: Actor = None,
                  confirm_deletes: Annotated[int | None, Query(description="Required when it removes 3+ items: their number.")] = None):
    return await svc(request).decide(proposal_id, "confirm", me(actor), confirm_deletes)


@router.post("/proposals/{proposal_id}:reject", response_model=Proposal)
async def reject(request: Request, proposal_id: str, actor: Actor = None):
    return await svc(request).decide(proposal_id, "reject", me(actor))
