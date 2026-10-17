"""Asking the judge about the shortlist, in batches, within the run's model-call limit.

Each batch is one model call in a fresh in-memory session. `ask` is replaceable (tests script it);
by default it runs the ADK agent in app/agent.py.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from google.adk.agents.run_config import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app import settings
from app.contract import RadarRunRequest
from app.geo import themes_vocabulary
from app.stories import Candidate, Judgement

log = logging.getLogger(__name__)


@dataclass
class Asked:
    stories: list[dict]                 # the model's Judged items, as dicts
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


Ask = Callable[[str, dict], Awaitable[Asked]]


@dataclass
class Judged:
    judgements: dict[str, Judgement] = field(default_factory=dict)
    calls: int = 0
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    call_limit: bool = False


async def adk_ask(session_id: str, state: dict) -> Asked:
    """One batch through the ADK judge agent."""
    from app.agent import Judgements
    from app.agent import app as agent_app

    sessions = InMemorySessionService()
    runner = Runner(app=agent_app, session_service=sessions)
    await sessions.create_session(app_name=agent_app.name, user_id="server", session_id=session_id, state=state)
    asked = Asked(stories=[])
    async for event in runner.run_async(user_id="server", session_id=session_id,
                                        new_message=types.Content(role="user", parts=[types.Part(text="Judge these stories.")]),
                                        run_config=RunConfig(max_llm_calls=2)):
        u = getattr(event, "usage_metadata", None)
        if u:
            asked.input_tokens += int(u.prompt_token_count or 0)
            asked.output_tokens += int(u.candidates_token_count or 0)
        asked.model = getattr(event, "model_version", None) or asked.model
    session = await sessions.get_session(app_name=agent_app.name, user_id="server", session_id=session_id)
    raw = (session.state if session else {}).get("judgements")
    if raw:
        asked.stories = [s.model_dump() for s in Judgements.model_validate(raw).stories]
    return asked


def institution_brief(req: RadarRunRequest) -> dict:
    i = req.institution
    return {"name": i.name, "institution_type": i.institution_type, "country": i.country, "country_name": i.country_name,
            "summary": i.summary,
            "segments": [s.get("label") or s.get("name") or s.get("id", "") for s in i.segments][:12],
            "products": [p.get("name", "") for p in i.products][:20],
            "flows": [f"{f.get('kind', '')} {f.get('local', '')} - {f.get('counterpart', '')}".strip() for f in i.flows][:12]}


def batch_item(c: Candidate, req: RadarRunRequest) -> dict:
    return {"key": c.key,
            "watched_places": {p: "; ".join(req.scope.places_why.get(p, [])) or "in scope" for p in sorted(c.places)},
            "headlines": [{"title": h.title, "outlet": h.outlet, "published_at": h.published_at.isoformat()} for h in c.headlines()],
            "remembered": [{"fingerprint": m.fingerprint, "title": m.title} for m in c.remembered]}


async def judge(cands: list[Candidate], req: RadarRunRequest, calls_left: int, ask: Ask = adk_ask,
                on_call: Callable[[], None] | None = None) -> Judged:
    """Judges candidates in order (best first) until done or out of calls."""
    out = Judged()
    size = max(1, settings.integer("JUDGE_BATCH_SIZE"))
    vocab = {k: dict(v["directions"]) for k, v in themes_vocabulary().items() if not req.scope.themes or k in req.scope.themes}
    for n in range(0, len(cands), size):
        if out.calls >= calls_left:
            out.call_limit = True
            break
        batch = cands[n:n + size]
        state = {"institution": institution_brief(req), "batch": [batch_item(c, req) for c in batch], "vocabulary": vocab}
        asked = await ask(f"{req.run_id}-{n // size}", state)
        out.calls += 1
        if on_call:
            on_call()
        out.model = asked.model or out.model
        out.input_tokens += asked.input_tokens
        out.output_tokens += asked.output_tokens
        keys = {c.key for c in batch}
        for s in asked.stories:
            if s.get("key") in keys:
                out.judgements[s["key"]] = Judgement(
                    relevance=s.get("relevance", "low"), send=bool(s.get("send")), why=s.get("why") or "",
                    title=s.get("title") or "", summary=s.get("summary") or "",
                    themes=[t if isinstance(t, dict) else dict(t) for t in s.get("themes") or []],
                    same_as=s.get("same_as") or None, continues=s.get("continues") or None)
    return out
