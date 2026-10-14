"""amiri-server's API, as the agent's tools call it.

Every call names the person the agent acts for (X-Amiri-On-Behalf-Of) and that it is the
assistant (X-Amiri-Source); with SERVER_AUTH=id_token it also carries a Google ID token
for the server (Cloud Run). The agent only reads, plus POST /api/v1/proposals: proposals
are its only writes, and the user confirms each one in the web app.
"""

import asyncio
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app import settings


class ServerError(Exception):
    """The server couldn't be reached, or answered 5xx."""


@dataclass
class Reply:
    status: int
    body: Any

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


class ServerApi:
    def __init__(self, base_url: str, user_id: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self.user_id = user_id
        self.client = httpx.AsyncClient(base_url=self.base_url, transport=transport,
                                        timeout=httpx.Timeout(settings.number("SERVER_TIMEOUT_SECONDS"), connect=5.0))
        self._token: str | None = None

    async def _headers(self) -> dict[str, str]:
        h = {"X-Amiri-On-Behalf-Of": self.user_id, "X-Amiri-Source": "assistant", "X-Amiri-Actor": self.user_id}
        if settings.raw("SERVER_AUTH") == "id_token":
            import google.auth.transport.requests
            import google.oauth2.id_token

            if self._token is None:
                self._token = await asyncio.to_thread(google.oauth2.id_token.fetch_id_token,
                                                      google.auth.transport.requests.Request(), self.base_url)
            h["Authorization"] = f"Bearer {self._token}"
        return h

    async def call(self, method: str, path: str, *, params: dict | None = None, json: Any = None) -> Reply:
        try:
            r = await self.client.request(method, path, params={k: v for k, v in (params or {}).items() if v is not None},
                                          json=json, headers=await self._headers())
        except httpx.HTTPError as e:
            raise ServerError(f"amiri-server can't be reached ({type(e).__name__})") from e
        if r.status_code >= 500:
            raise ServerError(f"amiri-server answered {r.status_code}: {r.text[:200]}")
        try:
            body = r.json() if r.content else None
        except ValueError:
            body = r.text
        return Reply(r.status_code, body)

    async def get(self, path: str, **params) -> Reply:
        return await self.call("GET", path, params=params)

    async def post(self, path: str, json: Any = None, **params) -> Reply:
        return await self.call("POST", path, params=params, json=json)

    async def put(self, path: str, json: Any = None) -> Reply:
        return await self.call("PUT", path, json=json)

    async def aclose(self) -> None:
        await self.client.aclose()


def seg(x: str) -> str:
    """One path segment, escaped."""
    return quote(str(x), safe="")
