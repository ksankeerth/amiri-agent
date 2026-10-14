"""Runs one investigation through the ADK runner: a fresh session per run."""

from google.adk.apps import App
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.agent import STATE_REQUEST, STATE_RESULT
from app.contract import InvestigationRequest, InvestigationResult

USER_ID = "server"


async def run_investigation(
    req: InvestigationRequest, agent_app: App | None = None
) -> InvestigationResult:
    if agent_app is None:
        from app.agent import app as agent_app

    sessions = InMemorySessionService()
    await sessions.create_session(
        app_name=agent_app.name,
        user_id=USER_ID,
        session_id=req.run_id,
        state={STATE_REQUEST: req.model_dump(mode="json", by_alias=True)},
    )
    runner = Runner(app=agent_app, session_service=sessions)
    async for _ in runner.run_async(
        user_id=USER_ID,
        session_id=req.run_id,
        new_message=types.Content(role="user", parts=[types.Part(text="Investigate.")]),
    ):
        pass
    session = await sessions.get_session(
        app_name=agent_app.name, user_id=USER_ID, session_id=req.run_id
    )
    return InvestigationResult.model_validate(session.state[STATE_RESULT])
