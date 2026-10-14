"""A fake setup agent that implements the contract (contract.py). No model.

    uv run amiri fake-agent            # http://localhost:8003; then ASSISTANT_BACKEND=http

By default it answers like the in-process stub (keyword routing, canned replies, a
question). For tests and demos it can play exact events: POST /_script with
{"events": [{"type": "message", "text": "…"}, …]} queues them for the next turn
(one list per turn, in order). It is also the reference the conformance check
(`uv run amiri agent-check`) is tested against.
"""

import json
import uuid
from collections import deque

from fastapi import Body, FastAPI, Response
from fastapi.responses import JSONResponse, StreamingResponse

from app.assistant import contract
from app.assistant.agent import StubAssistant, TurnInput


def create_fake_agent() -> FastAPI:
    app = FastAPI(title="amiri-setup-agent (fake)", version=contract.CONTRACT_VERSION,
                  description="Reference implementation of the setup agent contract (no model).")
    sessions: dict[str, contract.AgentSessionIn] = {}
    scripts: deque[list[dict]] = deque()
    stub = StubAssistant()

    def hdr(r: Response) -> None:
        r.headers[contract.HEADER] = contract.CONTRACT_VERSION

    @app.get("/health")
    async def health(response: Response):
        hdr(response)
        return {"status": "ok"}

    @app.get("/health/details")
    async def health_details(response: Response):
        hdr(response)
        return {"service": "amiri-setup-agent", "version": "fake", "status": "ok", "contract": contract.CONTRACT_VERSION,
                "sessions": len(sessions), "scripted_turns_queued": len(scripts)}

    @app.post("/sessions", status_code=201, response_model=contract.AgentSessionOut)
    async def create_session(body: contract.AgentSessionIn, response: Response):
        hdr(response)
        sid = "agent-" + uuid.uuid4().hex[:10]
        sessions[sid] = body
        return {"agent_session_id": sid}

    @app.post("/sessions/{agent_session_id}/turns")
    async def turn(agent_session_id: str, body: contract.TurnIn):
        if agent_session_id not in sessions:
            return JSONResponse({"type": "about:blank", "title": "Not found", "status": 404, "code": "not_found",
                                 "detail": f"No session {agent_session_id}."}, status_code=404,
                                media_type="application/problem+json", headers={contract.HEADER: contract.CONTRACT_VERSION})

        async def events():
            if scripts:
                for ev in scripts.popleft():
                    ev = dict(ev)
                    yield f"event: {ev.pop('type')}\ndata: {json.dumps(ev)}\n\n"
            else:
                t = TurnInput(body.session_id, body.thread_id, agent_session_id, body.institution_id, body.user_id,
                              body.text, body.answer.model_dump() if body.answer else None, body.requested_track,
                              body.current_track, body.profile_version, body.profile_changes, body.track_notes)
                async for ev in stub.run(t):
                    yield f"event: {ev.type}\ndata: {json.dumps(ev.data)}\n\n"
                yield f"event: usage\ndata: {json.dumps({'model_calls': 0, 'input_tokens': 0, 'output_tokens': 0})}\n\n"
            yield "event: done\ndata: {}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={contract.HEADER: contract.CONTRACT_VERSION})

    @app.post("/_script", include_in_schema=False, status_code=204)
    async def script(events: list[dict] = Body(..., embed=True)):
        scripts.append(events)
        return Response(status_code=204)

    @app.delete("/_script", include_in_schema=False, status_code=204)
    async def clear():
        scripts.clear()
        sessions.clear()
        return Response(status_code=204)

    return app


def contract_openapi() -> dict:
    """The contract as OpenAPI, with the event stream's schemas spelled out."""
    spec = create_fake_agent().openapi()
    spec["info"] = {"title": "Amiri Agent setup agent contract", "version": contract.CONTRACT_VERSION,
                    "description": (contract.__doc__ or "").strip()}
    events = contract.EVENT.json_schema(ref_template="#/components/schemas/{model}")
    comps = spec.setdefault("components", {}).setdefault("schemas", {})
    comps.update(events.pop("$defs", {}))
    comps["Event"] = events
    turns = spec["paths"]["/sessions/{agent_session_id}/turns"]["post"]
    turns["summary"] = "One turn: the agent's reply as server-sent events"
    turns["responses"]["200"] = {"description": "text/event-stream; each event is `event: <type>` + `data: <Event without type>`.",
                                 "content": {"text/event-stream": {"schema": {"$ref": "#/components/schemas/Event"}}}}
    for p in spec["paths"].values():
        for op in p.values():
            op.setdefault("parameters", []).append({"name": contract.HEADER, "in": "header", "required": True,
                                                    "schema": {"type": "string", "const": contract.CONTRACT_VERSION}})
    return spec
