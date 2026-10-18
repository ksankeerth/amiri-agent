"""One turn: route the message, then let the track answer.

Events, in order: an empty `text_delta` at once (the turn has started), `track` when the track changes, `track_notes` for facts meant for other
tracks, then the track's own events (message, question, proposal, track_concluded), and
`usage` last. Nothing here raises into the stream: a failure ends the turn with an
`error` event the server shows, and the forms still work.
"""

import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator, Callable

from google.auth.exceptions import DefaultCredentialsError
from google.genai import errors
from pydantic import BaseModel

from app import router, settings
from app.contract import (
    ErrorEv,
    MessageEv,
    Note,
    TextDeltaEv,
    TrackEv,
    TrackNotesEv,
    TurnIn,
    UsageEv,
)
from app.router import Route
from app.server_api import ServerError
from app.sessions import Session
from app.tracks import TRACKS

logger = logging.getLogger(__name__)


class Usage:
    def __init__(self) -> None:
        self.model_calls = self.input_tokens = self.output_tokens = 0


Responder = Callable[[Session, TurnIn, Route, Usage], AsyncIterator[BaseModel]]


async def not_built(s: Session, turn: TurnIn, r: Route, usage: Usage) -> AsyncIterator[BaseModel]:
    """Until the track loop exists (app/track_loop.py, next): says so instead of pretending."""
    yield MessageEv(text=f"I'm in the {TRACKS[r.track].label} track, but its conversation isn't built yet. "
                         "The forms on this page do everything in the meantime.")


_responder: Responder = not_built


def set_responder(fn: Responder) -> None:
    global _responder
    _responder = fn


SHORT_REPLY = re.compile(r"^\s*(yes|yeah|yep|yup|y|no|nope|n|ok|okay|sure|please|go ahead|do it|sounds good|correct|"
                         r"right|agreed|fine|all of them|all|both|none|neither|not now|later|skip)\b", re.I)


def is_short_reply(text: str | None) -> bool:
    """A yes, no, ok, both, none, …, of a few words: an answer to the question just asked, not a new topic."""
    return bool(text) and len(text) <= 60 and bool(SHORT_REPLY.match(text))


def offtopic_reply(track: str | None) -> str:
    back = f" Back to {TRACKS[track].label.lower()}: " if track and track in TRACKS and track not in ("question",) else " "
    return ("I can only help set up Amiri Agent for your institution: who you are, where you operate, your customers, "
            f"products, flows, rules, rivals, risks and monitors.{back}what would you like to do next?")


async def run_turn(s: Session, turn: TurnIn) -> AsyncIterator[BaseModel]:
    """One turn, and one log line when it ends: the track, what it ended with, its model calls (never the text)."""
    started = time.monotonic()
    kinds: list[str] = []
    error = None
    async for ev in _turn(s, turn):
        kinds.append(ev.type)  # type: ignore[attr-defined]
        if isinstance(ev, ErrorEv):
            error = ev.code
        elif isinstance(ev, UsageEv):
            outcome = ("error " + error if error else "proposal" if "proposal" in kinds else
                       "question" if "question" in kinds else "concluded" if "track_concluded" in kinds else "reply")
            (logger.warning if error else logger.info)(
                "turn %s in %s: %s in %.1f s, %d model calls, %d+%d tokens", turn.turn_id, s.current_track or "-",
                outcome, time.monotonic() - started, ev.model_calls, ev.input_tokens, ev.output_tokens)
        yield ev


async def _turn(s: Session, turn: TurnIn) -> AsyncIterator[BaseModel]:
    usage = Usage()
    yield TextDeltaEv(text="")  # the turn has started (the first event is due within 10 s; deltas aren't stored)
    try:
        async with asyncio.timeout(settings.number("TURN_TIMEOUT_SECONDS")):
            if not (turn.text and turn.text.strip()) and not turn.answer:
                yield ErrorEv(code="empty_turn", message="A turn needs a message or an answer.")
                return
            current = turn.current_track or s.current_track
            # A short yes/no typed straight after the agent asked something answers it, like a chip would: it stays
            # in the track that asked (seen: "Yes please." routed to another track and the accept was lost).
            replying = turn.answer is not None or (s.state.get("asked") and is_short_reply(turn.text))
            r = await router.route(text=turn.text, is_answer=bool(replying), requested=turn.requested_track,
                                   current=current, has_institution=turn.institution_id is not None)
            usage.model_calls += r.model_calls
            if r.changed:
                yield TrackEv(track=r.track, reason=r.reason[:300] or None)
            if r.notes:
                yield TrackNotesEv(notes=[Note(**n) for n in r.notes])
            s.current_track = r.track
            if r.offtopic:
                yield MessageEv(text=offtopic_reply(current))
            else:
                async for ev in _responder(s, turn, r, usage):
                    yield ev
    except TimeoutError:
        yield ErrorEv(code="turn_timeout", message="This took too long and was stopped. Try again, or a shorter message.")
    except ServerError as e:
        yield ErrorEv(code="server_unavailable", message=str(e))
    except errors.APIError as e:
        # Busy, out of quota or timed out: every model was tried (app/models.py fails over) and waiting can help.
        # Anything else (a 400: the request itself is wrong) fails at once, the same on every model, every time:
        # say so, and log it, so it gets fixed rather than retried.
        if e.code in (408, 429) or (e.code or 0) >= 500:
            why = "out of quota" if e.code == 429 else "busy"
            yield ErrorEv(code="models_busy", message=f"The models are {why} right now. Try again in a minute; the forms still work.")
        else:
            logger.error("turn %s: the model refused the request (%s): %s", turn.turn_id, e.code, str(e)[:500])
            yield ErrorEv(code="model_request_failed",
                          message=f"Something went wrong on our side (model error {e.code}); trying again won't help. The forms still work.")
    except DefaultCredentialsError:
        yield ErrorEv(code="models_unavailable", message="The setup agent has no model credentials (GEMINI_API_KEY or "
                                                         "Vertex AI). The forms still work.")
    except Exception as e:  # never a broken stream
        logger.exception("turn %s failed", turn.turn_id)
        yield ErrorEv(code="agent_failed", message=f"The setup agent failed ({type(e).__name__}).")
    finally:
        s.turns += 1
    yield UsageEv(model_calls=usage.model_calls, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
