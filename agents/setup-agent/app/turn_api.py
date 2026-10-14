"""The contract's endpoints (app/contract.py): sessions and turns, as amiri-server calls them."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.contract import (
    CONTRACT_VERSION,
    HEADER,
    AgentSessionIn,
    AgentSessionOut,
    TurnIn,
    sse,
)
from app.engine import run_turn
from app.sessions import SessionStore

router = APIRouter(tags=["contract"])
H = {HEADER: CONTRACT_VERSION}


def problem(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"type": f"https://amiri.dev/errors/{code}", "title": code.replace("_", " "), "status": status,
                         "code": code, "detail": detail}, status_code=status, media_type="application/problem+json",
                        headers=H)


def store(request: Request) -> SessionStore:
    return request.app.state.sessions


@router.get("/health/details", summary="Service, contract and sessions")
async def health_details(request: Request):
    from app import settings

    return JSONResponse({"service": "amiri-setup-agent", "status": "ok", "contract": CONTRACT_VERSION,
                         "sessions": len(store(request)), "models": {"agent": settings.names("AGENT_MODELS"),
                                                                     "router": settings.names("ROUTER_MODELS")}},
                        headers=H)


@router.post("/sessions", status_code=201, response_model=AgentSessionOut, summary="Start a session with the context pack")
async def create_session(request: Request, body: AgentSessionIn):
    s = store(request).create(body)
    return JSONResponse({"agent_session_id": s.id}, status_code=201, headers=H)


@router.post("/sessions/{agent_session_id}/turns", summary="One turn: the reply as server-sent events")
async def turn(request: Request, agent_session_id: str, body: TurnIn):
    s = store(request).get(agent_session_id)
    if s is None:
        return problem(404, "not_found", f"No session {agent_session_id} (the agent may have restarted).")

    async def stream():
        async with s.lock:  # one turn at a time per session
            async for ev in run_turn(s, body):
                yield sse(ev)
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream", headers=H)
