"""InstitutionData: reads a Metrics Spec reference API. Used by the connector and the validator.

Every call is recorded (method, path, query, status, time, size), with a limit on calls and on answer
size. A URL someone typed is checked first: https only, and never an internal address (the metadata
server, private, loopback or link-local networks), with redirects refused."""

import ipaddress
import socket
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from app import settings

REFUSED_NETS = [ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
    "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
    "::1/128", "fc00::/7", "fe80::/10", "ff00::/8", "::ffff:0:0/96")]


class UnsafeURL(ValueError):
    pass


def check_url(url: str) -> None:
    """Refuses a URL the server shouldn't call. Plain http and internal addresses only with
    DATA_CONNECTION_ALLOW_LOCAL (local development)."""
    parts = urlsplit(url)
    local_ok = settings.flag("DATA_CONNECTION_ALLOW_LOCAL")
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise UnsafeURL("Give a full address starting with https://.")
    if parts.scheme == "http" and not local_ok:
        raise UnsafeURL("Use https://; plain http is only allowed for local development.")
    if parts.username or parts.password:
        raise UnsafeURL("Don't put a user name or password in the address; use the key field.")
    host = parts.hostname
    if host in ("metadata.google.internal", "metadata") and not local_ok:
        raise UnsafeURL("That address is internal to the cloud platform.")
    try:
        infos = socket.getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise UnsafeURL(f"The name {host} doesn't resolve ({e.strerror}).") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not local_ok and any(ip in n for n in REFUSED_NETS):
            raise UnsafeURL(f"{host} resolves to {ip}, an internal address; the connector doesn't call those.")


@dataclass
class Call:
    method: str
    path: str
    query: dict[str, Any]
    status: int | None
    ms: int
    bytes: int
    error: str | None = None
    version_header: str | None = None
    retry_after: str | None = None


@dataclass
class Answer:
    status: int | None
    body: Any                 # parsed JSON, or None
    text: str                 # the raw text, cut at the size limit
    headers: dict[str, str]
    error: str | None = None  # a transport failure: no status
    content_type: str = ""
    truncated: bool = False


class OutOfCalls(Exception):
    pass


@dataclass
class InstitutionData:
    base_url: str                         # ends with /metrics/v1
    headers: dict[str, str] = field(default_factory=dict)
    transport: httpx.AsyncBaseTransport | None = None
    calls: list[Call] = field(default_factory=list)
    max_calls: int | None = None

    def __post_init__(self):
        self.base_url = self.base_url.rstrip("/")
        self.max_calls = self.max_calls or settings.integer("DATA_CONNECTION_MAX_CALLS")
        t = settings.number("DATA_CONNECTION_TIMEOUT_SECONDS")
        self._client = httpx.AsyncClient(transport=self.transport, timeout=httpx.Timeout(t, connect=min(t, 10)),
                                         follow_redirects=False, headers=self.headers)

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def root(self) -> str:
        """The base without /metrics/v1 (where the OpenAPI document normally is)."""
        return self.base_url[: -len("/metrics/v1")] if self.base_url.endswith("/metrics/v1") else self.base_url

    async def get(self, path: str, params: dict[str, Any] | None = None, *, absolute: str | None = None,
                  headers: dict[str, str] | None = None) -> Answer:
        if len(self.calls) >= self.max_calls:
            raise OutOfCalls(f"stopped after {self.max_calls} calls (DATA_CONNECTION_MAX_CALLS)")
        url = absolute or f"{self.base_url}{path}"
        params = {k: v for k, v in (params or {}).items() if v is not None}
        limit = settings.integer("DATA_CONNECTION_MAX_BYTES")
        started = time.monotonic()
        try:
            async with self._client.stream("GET", url, params=params, headers=headers) as r:
                chunks, size, cut = [], 0, False
                async for chunk in r.aiter_bytes():
                    size += len(chunk)
                    if size > limit:
                        cut = True
                        break
                    chunks.append(chunk)
                raw = b"".join(chunks)
        except httpx.HTTPError as e:
            ms = int((time.monotonic() - started) * 1000)
            msg = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            self.calls.append(Call("GET", absolute or path, params, None, ms, 0, error=msg))
            return Answer(None, None, "", {}, error=msg)
        ms = int((time.monotonic() - started) * 1000)
        text = raw.decode("utf-8", errors="replace")
        body = None
        if not cut:
            try:
                import json
                body = json.loads(text) if text else None
            except ValueError:
                body = None
        hdrs = {k.lower(): v for k, v in r.headers.items()}
        self.calls.append(Call("GET", absolute or path, params, r.status_code, ms, size,
                               version_header=hdrs.get("metrics-spec-version"), retry_after=hdrs.get("retry-after")))
        return Answer(r.status_code, body, text[:2000], hdrs, content_type=hdrs.get("content-type", ""), truncated=cut)

    # the reference API's operations (the validator uses these)
    async def catalog(self) -> Answer:
        return await self.get("/catalog")

    async def series(self, **params: Any) -> Answer:
        return await self.get("/series", _flatten(params))

    async def change_concentration(self, **params: Any) -> Answer:
        return await self.get("/change-concentration", _flatten(params))

    async def breaks(self, **params: Any) -> Answer:
        return await self.get("/breaks", params)

    async def calendar(self, **params: Any) -> Answer:
        return await self.get("/calendar", params)


def _flatten(params: dict[str, Any]) -> dict[str, Any]:
    """filter={"segment": "importer"} becomes filter[segment]=importer (the spec's deepObject style)."""
    out = {k: v for k, v in params.items() if k != "filter"}
    for k, v in (params.get("filter") or {}).items():
        out[f"filter[{k}]"] = v
    return out
