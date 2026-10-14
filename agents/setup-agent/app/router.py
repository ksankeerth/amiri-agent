"""The router: which track a message belongs to.

Code decides whenever it can:
- the user picked a track (a chip or a tab): that track, no model call;
- an answer to the agent's own question: the current track;
- no institution yet (first setup): the institution track; the model is still asked for
  notes, the facts meant for later tracks, so they aren't lost.

Otherwise one structured model call chooses: sticky (stay in the current track unless the
message clearly belongs elsewhere), off-topic flagged, notes for other tracks. If every
router model fails, the turn stays in its current track; routing never fails a turn.
"""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app import models, settings
from app.contract import TRACK_IDS
from app.tracks import FIRST_SETUP, TRACKS

logger = logging.getLogger(__name__)


class RouterNote(BaseModel):
    track: str = Field(description="A track id the fact belongs to.")
    text: str = Field(description="The fact, in a few words, as the user said it.")


class RouterChoice(BaseModel):
    track: str = Field(description="The track id for this message.")
    clearly_elsewhere: bool = Field(description="True only if the message clearly belongs to another track than the current one.")
    reason: str = Field(description="A few words on why.")
    notes: list[RouterNote] = Field(default_factory=list,
                                    description="Facts in the message meant for other tracks than the chosen one.")


@dataclass
class Route:
    track: str  # where the turn goes
    changed: bool  # different from the current track: emit a track event
    reason: str
    notes: list[dict] = field(default_factory=list)  # {track, text}, for other tracks
    offtopic: bool = False
    model_calls: int = 0


ROUTER_PROMPT = """You route one message in the setup chat of Amiri Agent, a risk tool for a bank or insurer.
Choose the track it belongs to. Tracks:
{tracks}

Rules:
- Stay in the current track ({current}) unless the message clearly belongs to another track.
- A question that changes nothing and fits no track is "question"; anything unrelated to setting up
  Amiri Agent for this institution is "offtopic".
- Facts in the message that belong to other tracks go in notes (track id and the fact), so later tracks
  can use them. Don't put facts for the chosen track in notes.
- {setup}

Message: {message}
"""

RouterFn = Callable[[str, str | None, bool], Awaitable[tuple[RouterChoice | None, int]]]


async def gemini_router(message: str, current: str | None, has_institution: bool) -> tuple[RouterChoice | None, int]:
    """One structured call over ROUTER_MODELS. (None, calls) when every model failed."""
    tracks = "\n".join(f"- {t.id}: {t.about}" for t in TRACKS.values())
    setup = ("First setup: the institution doesn't exist yet, so the track is institution; put the other facts in notes."
             if not has_institution else
             f"Setup order: {' → '.join(FIRST_SETUP)}.")
    prompt = ROUTER_PROMPT.format(tracks=tracks, current=current or "none", setup=setup, message=json.dumps(message))
    # The whole choice gets ROUTER_TIMEOUT_SECONDS (the turn's first event must come within 10 s),
    # shared between the models so the next one still gets a chance.
    budget = settings.number("ROUTER_TIMEOUT_SECONDS")
    chain = models.router_chain()
    try:
        async with asyncio.timeout(budget):
            response, _ = await models.generate_content(
                _client(), chain, contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=RouterChoice,
                                                   temperature=0),
                timeout=max(3.0, budget / max(1, len(chain))))
    except Exception as e:  # every model failed, out of time, or a bad request: stay put
        logger.warning("router failed (%s); staying in %s", type(e).__name__, current)
        return None, 1
    try:
        return RouterChoice.model_validate_json(response.text or ""), 1
    except ValueError:
        logger.warning("router answered off-schema; staying in %s", current)
        return None, 1


_genai: genai.Client | None = None


def _client() -> genai.Client:
    global _genai
    if _genai is None:
        _genai = genai.Client(http_options=types.HttpOptions(retry_options=models.RETRY))
    return _genai


_router: RouterFn = gemini_router


def set_router(fn: RouterFn) -> None:
    """Tests: a scripted router in place of the model."""
    global _router
    _router = fn


async def route(*, text: str | None, is_answer: bool, requested: str | None, current: str | None,
                has_institution: bool) -> Route:
    if requested:
        return Route(requested, requested != current, "picked by the user")
    if is_answer:
        return Route(current or "institution", current is None, "answers the agent's question")
    choice, calls = await _router(text or "", current, has_institution)
    notes = [{"track": n.track, "text": n.text[:500]} for n in (choice.notes if choice else [])
             if n.track in TRACK_IDS and n.text.strip()]
    if not has_institution:
        notes = [n for n in notes if n["track"] != "institution"]
        return Route("institution", current != "institution", "first setup: the institution comes first", notes,
                     model_calls=calls)
    if choice is None or choice.track not in TRACK_IDS:
        stay = current or "question"
        return Route(stay, stay != current, "router unavailable: stays in the current track", model_calls=calls)
    if choice.track == "offtopic":
        return Route(current or "question", False, choice.reason, notes, offtopic=True, model_calls=calls)
    track = choice.track if (current is None or choice.track == current or choice.clearly_elsewhere) else current
    notes = [n for n in notes if n["track"] != track]
    return Route(track, track != current, choice.reason, notes, model_calls=calls)
