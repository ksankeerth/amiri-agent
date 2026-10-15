"""Calls an agent's run API: POST /<runs>, then GET /<runs>/{run_id} (the investigation agent's
/investigations, the monitor agent's /checks). The same retry, auth and error handling for both."""

import asyncio

import httpx

from app import settings


class AgentError(Exception):
    """The agent couldn't be reached or refused the request."""

    def __init__(self, message: str, *, retry: bool = True, cold: bool = False):
        super().__init__(message)
        self.retry = retry  # False: the request itself was refused (4xx); sending it again won't help
        self.cold = cold  # no answer in time, or not up yet: an agent starting from zero (Cloud Run) looks like this


class AgentClient:
    url_setting = "INVESTIGATION_URL"
    auth_setting = "INVESTIGATION_AUTH"
    runs = "investigations"

    def __init__(self, url: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self.url = (url if url is not None else settings.raw(self.url_setting)).rstrip("/")
        self.client = httpx.AsyncClient(base_url=self.url or "http://unset", transport=transport,
                                        timeout=httpx.Timeout(30.0, connect=5.0))

    def connected(self) -> bool:
        return bool(self.url)

    async def _headers(self) -> dict[str, str]:
        if settings.raw(self.auth_setting) != "id_token":
            return {}
        import google.auth.transport.requests
        import google.oauth2.id_token

        token = await asyncio.to_thread(google.oauth2.id_token.fetch_id_token,
                                        google.auth.transport.requests.Request(), self.url)
        return {"Authorization": f"Bearer {token}"}

    async def _call(self, method: str, path: str, **kw) -> dict:
        try:
            r = await self.client.request(method, path, headers=await self._headers(), **kw)
        except httpx.HTTPError as e:
            cold = isinstance(e, httpx.TimeoutException | httpx.ConnectError | httpx.RemoteProtocolError)
            raise AgentError(f"{type(e).__name__}: {e}", cold=cold) from e
        if r.status_code in (200, 202):
            return r.json()
        raise AgentError(f"HTTP {r.status_code}: {r.text[:500]}", retry=r.status_code >= 500 or r.status_code == 404,
                         cold=r.status_code in (429, 502, 503, 504))

    async def start(self, request: dict) -> dict:
        try:
            return await self._call("POST", f"/{self.runs}", json=request)
        except AgentError as e:
            if not e.cold:
                raise
            # An agent that Cloud Run is starting from zero can take longer than the timeout to answer its first
            # call. The same run_id and body returns the same run, so sending it again is safe: once, waiting longer.
            t = settings.number("AGENT_COLD_START_TIMEOUT_SECONDS")
            return await self._call("POST", f"/{self.runs}", json=request, timeout=httpx.Timeout(t, connect=10.0))

    async def status(self, run_id: str) -> dict:
        return await self._call("GET", f"/{self.runs}/{run_id}")

    async def aclose(self) -> None:
        await self.client.aclose()


class InvestigationClient(AgentClient):
    """amiri-investigation: POST /investigations."""


class MonitorClient(AgentClient):
    """amiri-monitor: POST /checks (agents/event-monitor-agent)."""

    url_setting = "MONITOR_URL"
    auth_setting = "MONITOR_AUTH"
    runs = "checks"


class RadarClient(AgentClient):
    """The Radar agent's run API (POST /radar-runs, GET /radar-runs/{run_id}; contract app/radar/contract.py)."""

    url_setting = "RADAR_URL"
    auth_setting = "RADAR_AUTH"
    runs = "radar-runs"
