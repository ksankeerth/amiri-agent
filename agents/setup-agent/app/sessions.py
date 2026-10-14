"""The agent's sessions: one per server session (POST /sessions), kept in memory.

A session holds what the server sent when it started (the context pack), the client
for the server's API, and what the agent keeps between turns: the current track and
the track before an off-topic aside. A restart loses them; the server then tells the
user their next message starts a new session (the contract's 404).
"""

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from app import settings
from app.contract import AgentSessionIn
from app.server_api import ServerApi


@dataclass
class Session:
    id: str
    info: AgentSessionIn
    api: ServerApi
    current_track: str | None = None
    turns: int = 0
    last_used: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    state: dict[str, Any] = field(default_factory=dict)  # per-track memory (the track loop's)

    @property
    def context(self) -> dict[str, Any]:
        return self.info.context.model_dump()


class SessionStore:
    def __init__(self, transport=None):
        self._sessions: dict[str, Session] = {}
        self._transport = transport  # tests: the server's API in-process

    def create(self, info: AgentSessionIn) -> Session:
        self.purge()
        sid = "agent-" + uuid.uuid4().hex[:12]
        s = Session(sid, info, ServerApi(info.server_url, info.user_id, self._transport),
                    current_track=info.context.current_track)
        self._sessions[sid] = s
        return s

    def get(self, sid: str) -> Session | None:
        s = self._sessions.get(sid)
        if s:
            s.last_used = time.monotonic()
        return s

    def purge(self) -> int:
        cutoff = time.monotonic() - settings.number("SESSION_IDLE_HOURS") * 3600
        old = [k for k, s in self._sessions.items() if s.last_used < cutoff]
        for k in old:
            del self._sessions[k]
        return len(old)

    def __len__(self) -> int:
        return len(self._sessions)
