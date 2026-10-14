"""Runs one check: a fresh agent session, limited in steps and time."""

import asyncio
import time

from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.agents.run_config import RunConfig
from google.adk.apps import App
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.contract import (
    CheckRequest,
    CheckResult,
    Coverage,
    Limits,
    ToolCall,
    Usage,
)
from app.tools import (
    STATE_CHECK,
    STATE_REPORTED,
    STATE_RESULT,
    STATE_SEEN,
    STATE_WEB_FAILED,
    STATE_WEB_USED,
    build_check_state,
)
from app.web_search import SearchUnavailable

USER_ID = "server"
START_MESSAGE = "Run the check."
_STATUSES = {"ok", "blocked", "error"}


async def run_check(req: CheckRequest, agent_app: App | None = None) -> CheckResult:
    if agent_app is None:
        from app.agent import app as agent_app

    limits = req.limits or Limits()
    sessions = InMemorySessionService()
    runner = Runner(app=agent_app, session_service=sessions)
    await sessions.create_session(
        app_name=agent_app.name,
        user_id=USER_ID,
        session_id=req.run_id,
        state=build_check_state(req),
    )

    events: list[Event] = []
    stop_reason = "finished"
    started = time.monotonic()
    try:
        async with asyncio.timeout(limits.timeout_seconds):
            async for event in runner.run_async(
                user_id=USER_ID,
                session_id=req.run_id,
                new_message=types.Content(
                    role="user", parts=[types.Part(text=START_MESSAGE)]
                ),
                run_config=RunConfig(max_llm_calls=limits.max_steps),
            ):
                events.append(event)
    except TimeoutError:
        stop_reason = "timeout"
    except LlmCallsLimitExceededError:
        stop_reason = "step_limit"
    duration_ms = int((time.monotonic() - started) * 1000)

    session = await sessions.get_session(
        app_name=agent_app.name, user_id=USER_ID, session_id=req.run_id
    )
    state = session.state
    failed = state.get(STATE_WEB_FAILED) or []
    if failed and len(failed) >= int(state.get(STATE_WEB_USED) or 0):
        raise SearchUnavailable(failed[-1])  # nothing was read: the check didn't happen
    result = state.get(STATE_RESULT)
    if result is None:
        summary = (
            f"Stopped ({stop_reason}) before the agent reported findings."
            if stop_reason != "finished"
            else "The agent ended without reporting findings."
        )
        result = {"summary": summary, "findings": [], "sources": []}
    elif stop_reason != "finished":
        stop_reason = "finished"  # finish was accepted before the limit was hit

    agent_name = agent_app.root_agent.name
    trace = tool_trace(events)
    model = agent_app.root_agent.model
    return CheckResult(
        stop_reason=stop_reason,
        summary=result["summary"],
        findings=result["findings"],
        sources=result.get("sources", []),
        coverage=coverage(state),
        tool_trace=trace,
        usage=Usage(
            model=getattr(model, "model", str(model)),
            model_calls=sum(
                1
                for e in events
                if e.author == agent_name
                and e.content
                and not e.get_function_responses()
            ),
            tool_calls=len(trace),
            duration_ms=duration_ms,
        ),
    )


def tool_trace(events: list[Event]) -> list[ToolCall]:
    """Every tool call the model made, with its response, numbered by model step.

    finish is left out when it simply accepted the findings; a rejected finish,
    or one that adjusted or dropped findings after review, stays in to show why.
    """
    step = 0
    by_id: dict[str, dict] = {}
    ordered: list[dict] = []
    for event in events:
        calls = event.get_function_calls()
        if calls:
            step += 1
        for call in calls:
            entry = {
                "step": step,
                "tool": call.name,
                "args": dict(call.args or {}),
                "status": "error",
                "message": "no response",
            }
            by_id[call.id] = entry
            ordered.append(entry)
        for response in event.get_function_responses():
            entry = by_id.get(response.id)
            if entry is None:
                continue
            body = dict(response.response or {})
            status = body.get("status")
            entry["status"] = (
                status if status in _STATUSES else "error" if "error" in body else "ok"
            )  # an error without a status: ADK refused the call (e.g. missing arguments)
            entry["message"] = body.get("message") or (
                str(body["error"])[:300] if "error" in body else None
            )
            entry["result"] = body
    return [
        ToolCall.model_validate(e)
        for e in ordered
        if not (
            e["tool"] == "finish"
            and e["status"] == "ok"
            and not {"adjusted", "dropped"} & (e.get("result") or {}).keys()
        )
    ]


def coverage(state: dict) -> Coverage:
    """What the check read: searches run, pages and how many were dated and new."""
    seen = state.get(STATE_SEEN) or {}
    pages = list((seen.get("web") or {}).values())
    provided = (state.get(STATE_CHECK) or {}).get("provided")
    return Coverage(
        web_queries=int(state.get(STATE_WEB_USED) or 0),
        web_failed=len(state.get(STATE_WEB_FAILED) or []),
        pages_seen=len(pages),
        pages_dated=sum(1 for p in pages if p.get("published_at")),
        pages_in_window=sum(1 for p in pages if p.get("in_window")),
        already_reported=int(state.get(STATE_REPORTED) or 0),
        provided_news=len(provided or []),
    )
