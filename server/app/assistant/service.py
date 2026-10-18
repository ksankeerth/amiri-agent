"""The setup agent's server side: one chat
thread per institution, sessions with the context pack the agent starts from, tracks,
and proposals. Complete here; the agent behind it is reached through agent.py.

Proposals are how the agent changes anything. It sends the profile batch operations
(or, for a new institution, its fields) with the track they belong to; the server
checks the track may write those sections, runs the number check and a dry run, and
stores the diff. Only the person it is for confirms; confirming applies it as a
normal batch (source "assistant", linked to the proposal) and concludes the track.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Any

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool
from pydantic import ValidationError

from app import reference, settings
from app.assistant import monitor_ops, numbers
from app.assistant.agent import Assistant, AssistantEvent, TurnInput
from app.assistant.tracks import RULES_INSTITUTION_FIELDS, TRACKS
from app.assistant.tracks import view as tracks_view
from app.clock import Clock
from app.institutions.schemas import InstitutionCreate, Operation
from app.institutions.service import Institutions, create_errors, region_errors
from app.monitors.service import Monitors
from app.problems import Problem

log = logging.getLogger("amiri.assistant")

RECENT_MESSAGES = 20
ENGLISH_ONLY = "Sorry, I can only help in English for now. The forms work in any case."


def english(text: str) -> bool:
    """Mostly Latin letters. Sinhala, Tamil and other scripts get the English-only reply."""
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return True
    return sum(1 for c in letters if ord(c) < 0x250) / len(letters) >= 0.7


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


class AssistantService:
    def __init__(self, pool: AsyncConnectionPool, institutions: Institutions, agent: Assistant, clock: Clock,
                 monitors: "Monitors | None" = None):
        self.pool, self.institutions, self.agent, self.clock = pool, institutions, agent, clock
        self.monitors = monitors  # the monitors track's proposals
        self._tasks: set[asyncio.Task] = set()  # turns running in the background

    async def status(self) -> dict:
        ok = await self.agent.health() if hasattr(self.agent, "health") else self.agent.connected()
        starting = not ok and bool(getattr(self.agent, "starting", False))
        message = None if ok else ("The setup assistant is starting; this can take up to a minute." if starting else
                                   "The setup agent isn't connected yet. Messages are saved; the forms do everything.")
        warm = self.agent.name == "http"  # only a separate service can be stopped by Cloud Run
        return {"backend": self.agent.name, "connected": ok, "starting": starting, "message": message,
                "keep_warm_seconds": settings.integer("ASSISTANT_KEEP_WARM_SECONDS") if warm else 0,
                "keep_warm_idle_minutes": settings.integer("ASSISTANT_KEEP_WARM_IDLE_MINUTES") if warm else 0}

    @staticmethod
    def tracks() -> list[dict]:
        return tracks_view()

    # ------------------------------------------------ threads

    async def _thread_row(self, conn, institution_id: str | None, user: str, create: bool) -> dict | None:
        if institution_id:
            cur = await conn.execute("SELECT * FROM assistant.threads WHERE institution_id = %s", (institution_id,))
        else:
            cur = await conn.execute("SELECT * FROM assistant.threads WHERE institution_id IS NULL AND owner_user = %s", (user,))
        t = await cur.fetchone()
        if t or not create:
            return t
        now = self.clock.now()
        tid = "thr-" + uuid.uuid4().hex[:12]
        await conn.execute(
            """INSERT INTO assistant.threads (thread_id, institution_id, owner_user, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (tid, institution_id, user, now, now))
        return await self._thread_row(conn, institution_id, user, create=False)

    async def _thread(self, conn, thread_id: str) -> dict:
        cur = await conn.execute("SELECT * FROM assistant.threads WHERE thread_id = %s", (thread_id,))
        t = await cur.fetchone()
        if not t:
            raise Problem(404, "not_found", f"No thread {thread_id}.")
        return t

    async def _track_states(self, conn, thread_id: str) -> list[dict]:
        cur = await conn.execute("SELECT track, status, summary, notes, updated_at FROM assistant.track_state WHERE thread_id = %s",
                                 (thread_id,))
        got = {r["track"]: r for r in await cur.fetchall()}
        return [{**t, "status": got.get(t["track"], {}).get("status", "not_started"),
                 "summary": got.get(t["track"], {}).get("summary"), "notes": got.get(t["track"], {}).get("notes") or [],
                 "updated_at": got.get(t["track"], {}).get("updated_at")} for t in tracks_view()]

    async def messages(self, thread_id: str, before: int | None, limit: int) -> dict:
        async with self.pool.connection() as conn:
            await self._thread(conn, thread_id)
            cur = await conn.execute(
                """SELECT message_id, session_id, track, role, kind, content, at FROM assistant.messages
                   WHERE thread_id = %s AND (%s::bigint IS NULL OR message_id < %s)
                   ORDER BY message_id DESC LIMIT %s""", (thread_id, before, before, limit + 1))
            rows = await cur.fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        return {"items": list(reversed(rows)), "next_before": rows[-1]["message_id"] if more else None}

    async def thread(self, institution_id: str | None, user: str, limit: int = 200) -> dict:
        """The chat as the web app shows it: messages, tracks, pending proposals, the active session."""
        if institution_id:
            await self.institutions.get(institution_id)  # 404
        async with self.pool.connection() as conn:
            t = await self._thread_row(conn, institution_id, user, create=True)
            tracks = await self._track_states(conn, t["thread_id"])
            cur = await conn.execute(
                """SELECT session_id FROM assistant.sessions WHERE thread_id = %s AND ended_at IS NULL
                   AND last_active_at > %s ORDER BY started_at DESC LIMIT 1""",
                (t["thread_id"], self.clock.now() - self._idle()))
            active = await cur.fetchone()
        msgs = await self.messages(t["thread_id"], None, limit)
        props = [await self._with_fit(p) for p in await self.list_proposals(t["thread_id"], None, None)]
        busy = t["turn_started_at"] is not None and t["turn_started_at"] > self.clock.now() - self._turn_timeout() - timedelta(seconds=30)
        return {**self._thread_view(t), "tracks": tracks, "messages": msgs["items"], "next_before": msgs["next_before"],
                "proposals": props, "active_session_id": active["session_id"] if active else None, "turn_in_progress": busy}

    async def _with_fit(self, p: dict) -> dict:
        """A pending proposal re-checked against the profile as it is now (scenario S14)."""
        p = {**p, "fits": None, "fit_errors": []}
        if p["status"] == "pending" and p["kind"] == "monitors" and self.monitors:
            try:
                await self._check_monitors(p["operations"], p["institution_id"], p["thread_id"])
                p["fits"] = True
            except Problem as e:
                p["fits"] = False
                p["fit_errors"] = e.extra.get("errors") or [{"code": e.code, "message": e.detail}]
            return p
        if p["status"] != "pending" or p["kind"] != "profile" or not p["institution_id"]:
            return p
        inst = await self.institutions.get(p["institution_id"])
        if inst["profile_version"] == p["base_profile_version"]:
            p["fits"] = True
            return p
        try:
            await self.institutions.batch(p["institution_id"], [Operation(**o) for o in p["operations"]], p["on_behalf_of"],
                                          "assistant", dry_run=True)
            p["fits"] = True
        except Problem as e:
            p["fits"] = False
            p["fit_errors"] = e.extra.get("errors") or [{"code": e.code, "message": e.detail}]
        return p

    @staticmethod
    def _thread_view(t: dict) -> dict:
        return {k: t[k] for k in ("thread_id", "institution_id", "owner_user", "current_track", "summary",
                                  "created_at", "updated_at")}

    async def save_summary(self, thread_id: str, summary: str) -> dict:
        async with self.pool.connection() as conn:
            t = await self._thread(conn, thread_id)
            await conn.execute("UPDATE assistant.threads SET summary = %s, updated_at = %s WHERE thread_id = %s",
                               (summary, self.clock.now(), thread_id))
        return {**self._thread_view(t), "summary": summary}

    async def _store(self, conn, thread_id: str, session_id: str | None, track: str | None, role: str, kind: str,
                     content: dict) -> int:
        now = self.clock.now()
        cur = await conn.execute(
            """INSERT INTO assistant.messages (thread_id, session_id, track, role, kind, content, at)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING message_id""",
            (thread_id, session_id, track, role, kind, Jsonb(content), now))
        await conn.execute("UPDATE assistant.threads SET updated_at = %s WHERE thread_id = %s", (now, thread_id))
        return (await cur.fetchone())["message_id"]

    async def _set_track(self, conn, thread_id: str, track: str, status: str, summary: str | None = None) -> None:
        await conn.execute(
            """INSERT INTO assistant.track_state (thread_id, track, status, summary, updated_at) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (thread_id, track) DO UPDATE SET status = EXCLUDED.status,
                 summary = coalesce(EXCLUDED.summary, assistant.track_state.summary), updated_at = EXCLUDED.updated_at""",
            (thread_id, track, status, summary, self.clock.now()))

    # ------------------------------------------------ sessions and the context pack

    @staticmethod
    def _idle() -> timedelta:
        return timedelta(minutes=settings.integer("ASSISTANT_SESSION_IDLE_MINUTES"))

    async def context_pack(self, thread: dict) -> dict:
        """What the agent starts a session with."""
        iid = thread["institution_id"]
        pack: dict[str, Any] = {"thread_id": thread["thread_id"], "institution": None, "readiness": None,
                                "filled_by": None, "profile_version": None, "changes_since_last_session": []}
        if iid:
            pack["institution"] = await self.institutions.context(iid)
            rd = await self.institutions.readiness_for(iid)
            pack["readiness"] = {"ready": rd["ready"], "open": [c for c in rd["checks"] if not c["ok"]],
                                 "warnings": rd["warnings"]}
            pack["profile_version"] = pack["institution"]["profile_version"]
            async with self.pool.connection() as conn:
                cur = await conn.execute(
                    """SELECT source, count(DISTINCT (section, item_id)) AS n FROM core.profile_changes
                       WHERE institution_id = %s AND op = 'create' AND item_id IS NOT NULL GROUP BY source""", (iid,))
                pack["filled_by"] = {r["source"]: r["n"] for r in await cur.fetchall()}
                cur = await conn.execute(
                    """SELECT seen_profile_version FROM assistant.sessions WHERE thread_id = %s AND seen_profile_version IS NOT NULL
                       ORDER BY started_at DESC LIMIT 1""", (thread["thread_id"],))
                last = await cur.fetchone()
            if last:
                pack["changes_since_last_session"] = (await self.institutions.history(
                    iid, None, None, 100, None, since_version=last["seen_profile_version"]))["items"]
        async with self.pool.connection() as conn:
            pack["tracks"] = [{"track": t["track"], "status": t["status"], "summary": t["summary"], "notes": t["notes"]}
                              for t in await self._track_states(conn, thread["thread_id"])]
        if iid and self.monitors:
            pack["monitors"] = [{k: m[k] for k in ("monitor_id", "name", "sentence", "status", "origin", "origin_ref",
                                                   "live_version", "latest_version", "latest_status")}
                                for m in await self.monitors.summaries(iid)]
        pack["track_definitions"] = tracks_view()
        pack["current_track"] = thread["current_track"]
        pack["thread_summary"] = thread["summary"]
        pack["recent_messages"] = (await self.messages(thread["thread_id"], None, RECENT_MESSAGES))["items"]
        pack["pending_proposals"] = [{"proposal_id": p["proposal_id"], "track": p["track"], "summary": p["summary"]}
                                     for p in await self.list_proposals(thread["thread_id"], None, "pending")]
        return pack

    async def start_session(self, institution_id: str | None, user: str) -> dict:
        """Starts a session (or resumes the active one) on the institution's thread."""
        if institution_id:
            await self.institutions.get(institution_id)
        now = self.clock.now()
        async with self.pool.connection() as conn:
            t = await self._thread_row(conn, institution_id, user, create=True)
            cur = await conn.execute(
                """SELECT * FROM assistant.sessions WHERE thread_id = %s AND user_id = %s AND ended_at IS NULL
                   AND last_active_at > %s ORDER BY started_at DESC LIMIT 1""", (t["thread_id"], user, now - self._idle()))
            s = await cur.fetchone()
        if s:
            return {**self._session_view(s), "resumed": True}
        pack = await self.context_pack(t)
        sid = "ses-" + uuid.uuid4().hex[:12]
        agent_session = await self.agent.start_session(sid, t["thread_id"], user, pack)
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO assistant.sessions (session_id, thread_id, user_id, agent_session, context,
                     seen_profile_version, started_at, last_active_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (sid, t["thread_id"], user, agent_session, Jsonb(json.loads(json.dumps(pack, default=str))),
                 pack["profile_version"], now, now))
            await conn.execute("UPDATE assistant.sessions SET ended_at = %s WHERE thread_id = %s AND ended_at IS NULL AND session_id <> %s",
                               (now, t["thread_id"], sid))
            await self._store(conn, t["thread_id"], sid, t["current_track"], "system", "session",
                              {"started": True, "profile_version": pack["profile_version"],
                               "changes_since_last_session": len(pack["changes_since_last_session"])})
            cur = await conn.execute("SELECT * FROM assistant.sessions WHERE session_id = %s", (sid,))
            s = await cur.fetchone()
        return {**self._session_view(s), "resumed": False}

    @staticmethod
    def _session_view(s: dict) -> dict:
        return {"session_id": s["session_id"], "thread_id": s["thread_id"], "user_id": s["user_id"],
                "agent_connected": s["agent_session"] is not None, "seen_profile_version": s["seen_profile_version"],
                "started_at": s["started_at"], "last_active_at": s["last_active_at"], "ended_at": s["ended_at"]}

    async def _session(self, conn, sid: str) -> dict:
        cur = await conn.execute("SELECT * FROM assistant.sessions WHERE session_id = %s", (sid,))
        s = await cur.fetchone()
        if not s:
            raise Problem(404, "not_found", f"No session {sid}.")
        return s

    async def session_context(self, sid: str) -> dict:
        async with self.pool.connection() as conn:
            return (await self._session(conn, sid))["context"]

    async def end_session(self, sid: str) -> dict:
        async with self.pool.connection() as conn:
            await self._session(conn, sid)
            await conn.execute("UPDATE assistant.sessions SET ended_at = coalesce(ended_at, %s) WHERE session_id = %s",
                               (self.clock.now(), sid))
            return self._session_view(await self._session(conn, sid))

    # ------------------------------------------------ one turn, streamed

    async def _rate_limit(self, conn, user: str, now: datetime) -> None:
        cur = await conn.execute(
            """SELECT count(*) FILTER (WHERE m.at > %(m)s) AS minute, count(*) FILTER (WHERE m.at >= %(d)s) AS day
               FROM assistant.messages m JOIN assistant.sessions s ON s.session_id = m.session_id
               WHERE m.role = 'user' AND m.kind IN ('text', 'answer') AND s.user_id = %(u)s AND m.at >= least(%(m)s, %(d)s)""",
            {"m": now - timedelta(minutes=1), "d": datetime.combine(now.date(), datetime.min.time(), now.tzinfo), "u": user})
        c = await cur.fetchone()
        if c["minute"] >= settings.integer("ASSISTANT_TURNS_PER_MINUTE"):
            raise Problem(429, "rate_limited", "Too many messages this minute; wait a moment.", retry_after=60)
        if c["day"] >= settings.integer("ASSISTANT_TURNS_PER_DAY"):
            raise Problem(429, "rate_limited", "Today's message limit for the setup agent is reached; the forms still work.",
                          retry_after=int((datetime.combine(now.date(), datetime.min.time(), now.tzinfo) + timedelta(days=1) - now).total_seconds()))

    async def open_turn(self, sid: str, text: str | None, answer: dict | None, track: str | None, user: str) -> TurnInput:
        """Checks the message, takes the thread's turn lock and stores the message before anything streams
        (so refusals are plain HTTP): one turn at a time per thread, rate limits, English only."""
        if (text is None) == (answer is None):
            raise Problem(422, "validation_error", "Send either text or an answer.")
        if track is not None and track not in TRACKS:
            raise Problem(422, "validation_error", f"No track {track}.")
        now = self.clock.now()
        async with self.pool.connection() as conn:
            s = await self._session(conn, sid)
            if s["user_id"] != user:
                raise Problem(403, "forbidden", "This session belongs to someone else.")
            if s["ended_at"] or s["last_active_at"] < now - self._idle():
                raise Problem(409, "session_ended", "The session ended; start a new one (the chat history stays).")
            await self._rate_limit(conn, user, now)
            turn_id = "turn-" + uuid.uuid4().hex[:10]
            cur = await conn.execute(
                """UPDATE assistant.threads SET turn_id = %s, turn_started_at = %s WHERE thread_id = %s
                   AND (turn_started_at IS NULL OR turn_started_at < %s) RETURNING *""",
                (turn_id, now, s["thread_id"], now - self._turn_timeout() - timedelta(seconds=30)))
            t = await cur.fetchone()
            if not t:
                raise Problem(409, "turn_in_progress", "A reply is still being written in this chat; wait for it to finish.")
            current = t["current_track"]
            if track and track != current:
                await self._store(conn, t["thread_id"], sid, track, "user", "track", {"track": track, "picked": True})
                await self._set_track(conn, t["thread_id"], track, "in_progress")
                await conn.execute("UPDATE assistant.threads SET current_track = %s WHERE thread_id = %s", (track, t["thread_id"]))
            await self._store(conn, t["thread_id"], sid, track or current, "user", "text" if text is not None else "answer",
                              {"text": text} if text is not None else (answer or {}))
            await conn.execute("UPDATE assistant.sessions SET last_active_at = %s WHERE session_id = %s", (now, sid))
            notes = []
            if track or current:
                cur = await conn.execute("SELECT notes FROM assistant.track_state WHERE thread_id = %s AND track = %s",
                                         (t["thread_id"], track or current))
                r = await cur.fetchone()
                notes = r["notes"] if r else []
        changes, version = [], None
        if t["institution_id"]:
            inst = await self.institutions.get(t["institution_id"])
            version = inst["profile_version"]
            if s["seen_profile_version"] is not None and version > s["seen_profile_version"]:
                changes = [c for c in (await self.institutions.history(
                    t["institution_id"], None, None, 100, None, since_version=s["seen_profile_version"]))["items"]
                    if c["source"] != "assistant"]
        turn = TurnInput(sid, t["thread_id"], s["agent_session"], t["institution_id"], user, text, answer,
                         track, track or current, version, changes, notes)
        turn.turn_id = turn_id
        turn.english = text is None or english(text)
        return turn

    @staticmethod
    def _turn_timeout() -> timedelta:
        return timedelta(seconds=settings.number("ASSISTANT_TIMEOUT_SECONDS"))

    def run(self, turn: TurnInput) -> AsyncIterator[str]:
        """Starts the turn in the background and streams its events. The turn runs to the end and is
        saved whole even if the browser goes away; the web app reloads the thread to catch up."""
        q: asyncio.Queue[str | None] = asyncio.Queue()
        task = asyncio.create_task(self._drive(turn, q))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

        async def stream() -> AsyncIterator[str]:
            while (item := await q.get()) is not None:
                yield item
        return stream()

    async def _allowed_numbers(self, turn: TurnInput) -> set[float]:
        """Numbers a reply may state: typed by the user, or anywhere in the profile, readiness and reference data."""
        async with self.pool.connection() as conn:
            allowed = await self._typed_numbers(conn, turn.thread_id)
        blobs: list[Any] = [[f["amount"], f["year"]] for f in reference.flow_figure_rows()]
        blobs += [h["months"] for h in reference.hazards()]
        if turn.institution_id:
            blobs.append(await self.institutions.profile(turn.institution_id))
            blobs.append(await self.institutions.context(turn.institution_id))
        allowed |= numbers.user_numbers([json.dumps(blobs, default=str)])
        allowed |= {float(i) for i in range(0, 32)}  # counts, days, months
        return allowed

    async def _agent_events(self, turn: TurnInput) -> AsyncIterator[AssistantEvent]:
        """The agent's events for one turn. When the agent no longer knows the session (it restarted: Cloud Run
        stopped it while idle, or a deploy), a new agent session is started from a fresh context pack and the
        message is sent once more. The agent never saw the turn the first time, so nothing runs twice. A session
        the agent couldn't start earlier (it was down) is started now."""
        if turn.agent_session is None:
            await self._renew_agent_session(turn)
        first = True
        async for ev in self.agent.run(turn):
            if first and ev.type == "error" and ev.data.get("code") == "agent_session_lost" \
                    and await self._renew_agent_session(turn):
                async for again in self.agent.run(turn):
                    yield again
                return
            first = False
            yield ev

    async def _renew_agent_session(self, turn: TurnInput) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM assistant.threads WHERE thread_id = %s", (turn.thread_id,))
            t = await cur.fetchone()
        pack = await self.context_pack(t)
        recent = pack["recent_messages"]
        if recent and recent[-1]["role"] == "user":  # the message being answered goes with the turn, not twice
            pack["recent_messages"] = recent[:-1]
        old, new = turn.agent_session, await self.agent.start_session(turn.session_id, turn.thread_id, turn.user_id, pack)
        if not new:
            return False
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE assistant.sessions SET agent_session = %s, context = %s WHERE session_id = %s",
                               (new, Jsonb(json.loads(json.dumps(pack, default=str))), turn.session_id))
        log.info("setup chat turn %s: %s; started agent session %s", turn.turn_id,
                 f"the agent had lost session {old} (it restarted)" if old else "the agent was down when the session started", new)
        turn.agent_session = new
        return True

    async def _drive(self, turn: TurnInput, q: asyncio.Queue) -> None:
        put = q.put_nowait
        put(sse("start", {"session_id": turn.session_id, "thread_id": turn.thread_id, "backend": self.agent.name,
                          "track": turn.current_track}))
        track = turn.current_track
        usage: dict[str, float] = {}
        try:
            if not turn.english:
                async with self.pool.connection() as conn:
                    mid = await self._store(conn, turn.thread_id, turn.session_id, track, "assistant", "text",
                                            {"text": ENGLISH_ONLY, "canned": "english_only"})
                put(sse("message", {"text": ENGLISH_ONLY, "canned": "english_only", "message_id": mid, "track": track}))
                return
            allowed = await self._allowed_numbers(turn)
            agen = self._agent_events(turn).__aiter__()
            deadline = asyncio.get_running_loop().time() + self._turn_timeout().total_seconds()
            while True:
                left = deadline - asyncio.get_running_loop().time()
                try:
                    ev = await asyncio.wait_for(agen.__anext__(), timeout=max(0.001, left))
                except StopAsyncIteration:
                    break
                except TimeoutError:
                    err = {"code": "assistant_timeout",
                           "message": "The setup agent took too long and was stopped; nothing was changed. Try again, or use the forms."}
                    async with self.pool.connection() as conn:
                        err["message_id"] = await self._store(conn, turn.thread_id, turn.session_id, track, "assistant", "error", err)
                    log.warning("setup chat turn %s: the agent took too long", turn.turn_id)
                    put(sse("error", {**err, "track": track}))
                    break
                data = dict(ev.data)
                if ev.type == "error":
                    log.warning("setup chat turn %s ended with %s: %s", turn.turn_id, data.get("code"),
                                str(data.get("message"))[:300])
                if ev.type == "error" and data.get("code") == "agent_session_lost":
                    async with self.pool.connection() as conn:  # the next message starts a new session
                        await conn.execute("UPDATE assistant.sessions SET ended_at = %s WHERE session_id = %s",
                                           (self.clock.now(), turn.session_id))
                if ev.type == "usage":
                    for k, v in data.items():
                        if isinstance(v, (int, float)):
                            usage[k] = usage.get(k, 0) + v
                    continue
                async with self.pool.connection() as conn:
                    if ev.type == "track":
                        if data.get("track") not in TRACKS:
                            continue
                        track = data["track"]
                        await self._set_track(conn, turn.thread_id, track, "in_progress")
                        await conn.execute("UPDATE assistant.threads SET current_track = %s WHERE thread_id = %s",
                                           (track, turn.thread_id))
                        # the message that led here belongs to the new track
                        await conn.execute(
                            """UPDATE assistant.messages SET track = %s WHERE message_id = (SELECT max(message_id)
                               FROM assistant.messages WHERE thread_id = %s AND role = 'user')""", (track, turn.thread_id))
                        t = TRACKS[track]
                        data |= {"label": t.label, "tab": t.tab, "setup_step": t.setup_step, "shown": t.shown}
                    if ev.type == "track_concluded" and data.get("track") in TRACKS:
                        await self._set_track(conn, turn.thread_id, data["track"], "concluded", data.get("summary"))
                    if ev.type == "track_notes":
                        kept = [n for n in data.get("notes", []) if n.get("track") in TRACKS and n.get("text")]
                        for n in kept:
                            await self._add_note(conn, turn.thread_id, n["track"], n["text"])
                        data = {"notes": kept}
                    if ev.type == "message":
                        bad = sorted(numbers.unbacked(data.get("text", ""), allowed))
                        if bad:
                            data["unverified_numbers"] = bad
                    if ev.type == "proposal":
                        # stored by create_proposal already; send it whole
                        data = {"proposal": await self.get_proposal(data["proposal_id"])}
                        cur = await conn.execute(
                            "SELECT message_id FROM assistant.messages WHERE thread_id = %s AND kind = 'proposal' "
                            "AND content ->> 'proposal_id' = %s", (turn.thread_id, data["proposal"]["proposal_id"]))
                        row = await cur.fetchone()
                        data["message_id"] = row["message_id"] if row else None
                    elif ev.type != "text_delta":
                        kind = {"message": "text", "track_notes": "notes"}.get(ev.type, ev.type)
                        data["message_id"] = await self._store(conn, turn.thread_id, turn.session_id, track, "assistant",
                                                               kind, data)
                put(sse(ev.type, {**data, "track": data.get("track", track)}))
        except Exception as e:  # the connector should report its own errors; this is the backstop
            log.exception("setup chat turn %s failed", turn.turn_id)
            err = {"code": "assistant_failed", "message": f"{type(e).__name__}: {e}"}
            async with self.pool.connection() as conn:
                await self._store(conn, turn.thread_id, turn.session_id, track, "assistant", "error", err)
            put(sse("error", err))
        finally:
            async with self.pool.connection() as conn:
                await conn.execute(
                    """UPDATE assistant.sessions SET last_active_at = %s, seen_profile_version = coalesce(%s, seen_profile_version),
                         usage = usage || (SELECT coalesce(jsonb_object_agg(k, coalesce((usage ->> k)::numeric, 0) + v::numeric),
                                                           '{}'::jsonb) FROM jsonb_each_text(%s::jsonb) AS x(k, v))
                       WHERE session_id = %s""",
                    (self.clock.now(), turn.profile_version, json.dumps(usage), turn.session_id))
                await conn.execute(
                    "UPDATE assistant.threads SET turn_id = NULL, turn_started_at = NULL WHERE thread_id = %s AND turn_id = %s",
                    (turn.thread_id, turn.turn_id))
            put(sse("done", {"track": track}))
            put(None)

    async def _add_note(self, conn, thread_id: str, track: str, text: str) -> None:
        note = Jsonb([{"text": text[:500], "at": self.clock.now().isoformat()}])
        await conn.execute(
            """INSERT INTO assistant.track_state (thread_id, track, status, notes, updated_at) VALUES (%s, %s, 'not_started', %s, %s)
               ON CONFLICT (thread_id, track) DO UPDATE SET notes = assistant.track_state.notes || EXCLUDED.notes,
                 updated_at = EXCLUDED.updated_at""", (thread_id, track, note, self.clock.now()))

    async def attach_user_thread(self, user: str, institution_id: str) -> None:
        """An institution created with the form takes over the user's setup chat (scenario S15)."""
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE assistant.threads SET institution_id = %s, updated_at = %s
                   WHERE owner_user = %s AND institution_id IS NULL
                     AND NOT EXISTS (SELECT 1 FROM assistant.threads WHERE institution_id = %s)""",
                (institution_id, self.clock.now(), user, institution_id))

    # ------------------------------------------------ proposals

    async def _typed_numbers(self, conn, thread_id: str) -> set[float]:
        cur = await conn.execute(
            "SELECT content FROM assistant.messages WHERE thread_id = %s AND role = 'user' AND kind IN ('text', 'answer')",
            (thread_id,))
        texts = []
        for r in await cur.fetchall():
            c = r["content"]
            texts.append(c.get("text") or " ".join(c.get("options", [])))
        return numbers.user_numbers(texts)

    async def create_proposal(self, *, thread_id: str, track: str, summary: str, on_behalf_of: str,
                              kind: str = "profile", operations: list[Operation] | None = None,
                              institution: dict | None = None, evidence: list | None = None,
                              session_id: str | None = None, monitors: list | None = None) -> dict:
        """Checks a track's conclusion; anything wrong fails here (422/409) so the agent can repair it."""
        t_def = TRACKS.get(track)
        if t_def is None or t_def.read_only:
            raise Problem(422, "validation_error", f"Track {track} can't propose changes.")
        async with self.pool.connection() as conn:
            thread = await self._thread(conn, thread_id)
            typed = await self._typed_numbers(conn, thread_id)
        iid = thread["institution_id"]
        errors: list[dict] = []
        if kind == "create_institution":
            if track != "institution":
                raise Problem(422, "validation_error", "Only the institution track creates the institution.")
            if iid:
                raise Problem(409, "institution_exists", "This thread's institution already exists; propose changes instead.")
            try:
                body = InstitutionCreate(**(institution or {}))
            except ValidationError as e:
                raise Problem(422, "validation_error", "The institution's fields are invalid.",
                              errors=[{"field": ".".join(str(x) for x in er["loc"]), "code": "invalid", "message": er["msg"]}
                                      for er in e.errors()]) from e
            fields = body.model_dump(mode="json", exclude_none=True)
            # the same region rule Apply enforces, so the agent hears it now rather than showing a card that can't apply
            if outside := region_errors(fields):
                raise Problem(422, "outside_region", "The home country or base currency is outside the region this "
                                                     "prototype supports; say so to the user instead of proposing it.",
                              errors=outside)
            # and the rest of what Apply checks (seen: subtype "non-life" proposed, refused only on Apply, then
            # proposed again because the agent never heard why at proposal time)
            if bad := create_errors(fields):
                raise Problem(422, "validation_error", "The institution's fields are invalid.", errors=bad)
            errors += numbers.check("institution", fields, typed)
            if errors:
                raise Problem(422, "validation_error", "Numbers in the proposal aren't backed.", errors=errors)
            changes = [{"section": "institution", "id": fields.get("institution_id"), "op": "create", "before": None, "after": fields}]
            deletes = 0
            ops_json: list = []
            warnings: list = []
            base = None
        elif kind == "monitors":
            if track != "monitors":
                raise Problem(422, "validation_error", "Only the monitors track proposes monitors.")
            if not iid:
                raise Problem(422, "validation_error", "No institution yet: the institution track proposes create_institution first.")
            ops_json = [m.model_dump(mode="json", exclude_none=True) if hasattr(m, "model_dump") else m
                        for m in monitors or []]
            changes = await self._check_monitors(ops_json, iid, thread_id)
            warnings, base = [], None
        else:
            if kind == "profile" and "monitors" in t_def.writes:
                raise Problem(422, "validation_error", "The monitors track proposes kind monitors.")
            if not iid:
                raise Problem(422, "validation_error", "No institution yet: the institution track proposes create_institution first.")
            ops = operations or []
            if not ops:
                raise Problem(422, "validation_error", "A proposal needs operations.")
            for i, op in enumerate(ops):
                if op.section not in t_def.writes:
                    errors.append({"operation": i, "section": op.section, "code": "outside_track",
                                   "message": f"the {track} track can't change {op.section}"})
                if track == "rules" and op.section == "institution" and set(op.data or {}) - RULES_INSTITUTION_FIELDS:
                    errors.append({"operation": i, "section": "institution", "code": "outside_track",
                                   "message": "the rules track may change only clearing_currencies"})
                if op.op != "delete":
                    errors += numbers.check(op.section, op.data, typed, i)
            if errors:
                raise Problem(422, "validation_error", "The proposal breaks the track's rules.", errors=errors)
            dry = await self.institutions.batch(iid, ops, on_behalf_of, "assistant", dry_run=True)
            if not dry["changes"]:
                raise Problem(422, "no_change", "These operations change nothing.")
            changes, warnings, base = dry["changes"], dry["warnings"], dry["profile_version"]
            ops_json = [o.model_dump(mode="json", exclude_none=True) for o in ops]
        deletes = sum(1 for c in changes if c["op"] == "delete")
        pid = "prop-" + uuid.uuid4().hex[:10]
        now = self.clock.now()
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO assistant.proposals (proposal_id, thread_id, session_id, track, kind, institution_id, created_by,
                     on_behalf_of, summary, operations, institution, evidence, changes, warnings, base_profile_version, deletes,
                     created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'assistant', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (pid, thread_id, session_id, track, kind, iid, on_behalf_of, summary, Jsonb(ops_json),
                 Jsonb(institution) if institution else None, Jsonb(evidence or []), Jsonb(changes), Jsonb(warnings), base,
                 deletes, now))
            await self._store(conn, thread_id, session_id, track, "assistant", "proposal",
                              {"proposal_id": pid, "summary": summary, "track": track})
        return await self.get_proposal(pid)

    async def _check_monitors(self, ops: list[dict], institution_id: str, thread_id: str) -> list[dict]:
        if self.monitors is None:
            raise Problem(503, "monitors_unavailable", "Monitors aren't available on this server.")
        try:
            parsed = [monitor_ops.MonitorOp(**o) for o in ops]
        except ValidationError as e:
            raise Problem(422, "validation_error", "The monitors operations are invalid.",
                          errors=[{"field": ".".join(str(x) for x in er["loc"]), "code": "invalid", "message": er["msg"]}
                                  for er in e.errors()]) from e
        async with self.pool.connection() as conn:
            typed = await self._typed_numbers(conn, thread_id)
        return await monitor_ops.check(parsed, institution_id, typed, self.monitors, self.institutions, self.clock.now())

    async def get_proposal(self, pid: str) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM assistant.proposals WHERE proposal_id = %s", (pid,))
            p = await cur.fetchone()
        if not p:
            raise Problem(404, "not_found", f"No proposal {pid}.")
        return self._proposal_view(p)

    def _proposal_view(self, p: dict) -> dict:
        ttl = timedelta(hours=settings.integer("ASSISTANT_PROPOSAL_TTL_HOURS"))
        status = "expired" if p["status"] == "pending" and p["created_at"] + ttl < self.clock.now() else p["status"]
        t = TRACKS.get(p["track"])
        return {**{k: p[k] for k in p if k != "status"}, "status": status, "expires_at": p["created_at"] + ttl,
                "tab": t.tab if t else None}

    async def list_proposals(self, thread_id: str | None, institution_id: str | None, status: str | None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT * FROM assistant.proposals
                   WHERE (%(t)s::text IS NULL OR thread_id = %(t)s) AND (%(i)s::text IS NULL OR institution_id = %(i)s)
                   ORDER BY created_at DESC LIMIT 100""", {"t": thread_id, "i": institution_id})
            rows = [self._proposal_view(p) for p in await cur.fetchall()]
        return [r for r in rows if status is None or r["status"] == status]

    async def decide(self, pid: str, action: str, user: str, confirm_deletes: int | None = None) -> dict:
        now = self.clock.now()
        p = await self.get_proposal(pid)
        if p["status"] != "pending":
            raise Problem(409, "not_pending", f"This proposal is {p['status']}.")
        if p["on_behalf_of"] != user:
            raise Problem(403, "forbidden", "Only the person it was made for can decide it.")
        if action == "confirm" and p["deletes"] >= 3 and confirm_deletes != p["deletes"]:
            raise Problem(409, "confirm_deletes_required",
                          f"This removes {p['deletes']} items; confirm again with confirm_deletes={p['deletes']}.",
                          deletes=p["deletes"])
        if action == "reject":
            await self._set(pid, "rejected", user, now, None)
            async with self.pool.connection() as conn:
                await self._store(conn, p["thread_id"], None, p["track"], "system", "applied",
                                  {"proposal_id": pid, "status": "rejected", "summary": p["summary"]})
            return await self.get_proposal(pid)
        actor = f"assistant for {user}"
        try:
            if p["kind"] == "monitors":
                await self._check_monitors(p["operations"], p["institution_id"], p["thread_id"])  # still fits?
                result = await monitor_ops.apply([monitor_ops.MonitorOp(**o) for o in p["operations"]],
                                                 p["institution_id"], actor, p["summary"], self.monitors)
            elif p["kind"] == "create_institution":
                inst = await self.institutions.create(InstitutionCreate(**p["institution"]), actor, "assistant",
                                                      proposal_id=pid)
                iid = inst["institution_id"]
                async with self.pool.connection() as conn:
                    await conn.execute("UPDATE assistant.threads SET institution_id = %s WHERE thread_id = %s",
                                       (iid, p["thread_id"]))
                    await conn.execute("UPDATE assistant.proposals SET institution_id = %s WHERE proposal_id = %s", (iid, pid))
                result = {"institution_id": iid, "profile_version": inst["profile_version"]}
            else:
                ops = [Operation(**o) for o in p["operations"]]
                res = await self.institutions.batch(p["institution_id"], ops, actor, "assistant", proposal_id=pid)
                result = {"profile_version": res["profile_version"], "changes": res["changes"],
                          "profile_changed_since": res["profile_version"] - 1 != p["base_profile_version"]}
        except Problem as e:
            # the profile changed since the proposal and it no longer fits, or a rule refused it: record it in the chat
            # too, so the person and the agent both see it failed (and the agent never says it was saved)
            await self._set(pid, "failed", user, now, {"code": e.code, "detail": e.detail, **e.extra})
            async with self.pool.connection() as conn:
                await self._store(conn, p["thread_id"], None, p["track"], "system", "applied",
                                  {"proposal_id": pid, "status": "failed", "summary": p["summary"],
                                   "code": e.code, "detail": e.detail})
            raise
        await self._set(pid, "confirmed", user, now, result)
        async with self.pool.connection() as conn:
            await self._set_track(conn, p["thread_id"], p["track"], "concluded", p["summary"])
            await self._store(conn, p["thread_id"], None, p["track"], "system", "applied",
                              {"proposal_id": pid, "status": "confirmed", "summary": p["summary"], "tab": p["tab"]})
        return await self.get_proposal(pid)

    async def _set(self, pid: str, status: str, user: str, now: datetime, result: Any) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE assistant.proposals SET status = %s, decided_by = %s, decided_at = %s, result = %s WHERE proposal_id = %s",
                (status, user, now, Jsonb(result) if result is not None else None, pid))
