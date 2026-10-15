"""Keeping bots out. The prototype has no login: AUTH_MODE=prototype (the public URL) asks a visitor to tick Google
reCAPTCHA's "I'm not a robot" box (v2 checkbox, checked here with the secret key); passing it sets a signed cookie
for SESSION_HOURS, then the box shows again. AUTH_MODE=off (local, tests): no check at all.

With the check on, every API, the docs, /health/details and /internal/tick need either that cookie or an agent's
Google ID token (a service account in INTERNAL_CALLERS, as /api/v1/internal/* already checks). The web app's own files
stay public so the check page can load; it holds no data. Always, whatever the mode: robots.txt says no, every response
says noindex, and known AI crawlers are turned away by their user agent.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from collections import defaultdict, deque

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware

from app import settings
from app.problems import Problem

log = logging.getLogger("amiri.auth")

COOKIE = "amiri_session"
router = APIRouter(prefix="/api/v1/auth", tags=["bot check"])
robots = APIRouter(include_in_schema=False)

# AI crawlers and agents that announce themselves (robots.txt asks them all to stay away; these are refused outright)
AI_AGENTS = re.compile(
    r"GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|"
    r"Perplexity-User|CCBot|Bytespider|Amazonbot|meta-externalagent|meta-externalfetcher|FacebookBot|"
    r"Applebot-Extended|cohere-ai|Diffbot|YouBot|Timpibot|ImagesiftBot|omgili|DuckAssistBot|MistralAI-User|"
    r"Google-CloudVertexBot|AI2Bot|PetalBot|Scrapy|python-requests|Go-http-client|HeadlessChrome",
    re.I)
PUBLIC_API = ("/api/v1/auth/",)
GATED_PREFIX = ("/api/", "/internal/", "/docs", "/redoc", "/openapi.json", "/health/")


# ---------------------------------------------------------------- the session cookie

def _key() -> bytes:
    k = settings.raw("SESSION_SECRET")
    if len(k) < 32:
        raise Problem(500, "misconfigured", "SESSION_SECRET must be set (at least 32 characters) when the bot check is on.")
    return k.encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def issue(kind: str) -> tuple[str, int]:
    exp = int(time.time()) + settings.integer("SESSION_HOURS") * 3600
    body = _b64(json.dumps({"v": 1, "sid": secrets.token_urlsafe(12), "kind": kind, "exp": exp}).encode())
    return f"{body}.{_b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest())}", exp


def session(request: Request) -> dict | None:
    raw = request.cookies.get(COOKIE)
    if not raw or "." not in raw:
        return None
    body, sig = raw.rsplit(".", 1)
    try:
        good = hmac.compare_digest(sig, _b64(hmac.new(_key(), body.encode(), hashlib.sha256).digest()))
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, Problem):
        return None
    return data if good and data.get("exp", 0) > time.time() else None


def gate_on() -> bool:
    return settings.raw("AUTH_MODE") != "off"


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")


def _local_agent(request: Request) -> bool:
    """An agent on this machine (a local run): loopback, not through a proxy. Never true on Cloud Run."""
    return (settings.flag("AUTH_LOCAL_AGENTS") and not request.headers.get("x-forwarded-for")
            and (request.client.host if request.client else "") in ("127.0.0.1", "::1"))


async def _agent_token(request: Request) -> bool:
    """A Google ID token for this server from a listed service account (the agents, Cloud Scheduler)."""
    auth = request.headers.get("authorization") or ""
    if settings.raw("INTERNAL_AUTH") != "id_token" or not auth.startswith("Bearer "):
        return False
    import google.auth.transport.requests
    import google.oauth2.id_token

    try:
        claims = await asyncio.to_thread(google.oauth2.id_token.verify_oauth2_token, auth[7:],
                                         google.auth.transport.requests.Request(), settings.raw("SERVER_PUBLIC_URL"))
    except ValueError:
        return False
    return claims.get("email") in settings.names("INTERNAL_CALLERS")


# ---------------------------------------------------------------- the middleware

def _problem(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse({"type": "about:blank", "title": code.replace("_", " "), "status": status, "code": code,
                         "detail": detail}, status_code=status, media_type="application/problem+json")


class Gate(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if settings.flag("BLOCK_AI_CRAWLERS") and AI_AGENTS.search(request.headers.get("user-agent") or "") \
                and path not in ("/health", "/robots.txt") and not request.headers.get("authorization"):
            return PlainTextResponse("Automated access isn't allowed here.", status_code=403,
                                     headers={"X-Robots-Tag": "noindex, nofollow, noarchive"})
        gated = gate_on() and path.startswith(GATED_PREFIX) and not path.startswith(PUBLIC_API)
        if gated and not (session(request) or _local_agent(request) or await _agent_token(request)):
            resp = _problem(401, "signed_out", "Tick the box to show you're a person, then Amiri Agent opens.")
        else:
            resp = await call_next(request)
        resp.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        return resp


@robots.get("/robots.txt")
async def robots_txt():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")


# ---------------------------------------------------------------- the bot check

_attempts: dict[str, deque] = defaultdict(deque)
_checks = {"day": "", "n": 0}  # reCAPTCHA checks made today by this instance


def _check_budget_spent() -> bool:
    """Every check costs one reCAPTCHA verification, and the free allowance is
    10,000 a month for the whole organisation. A cap per day (per instance) keeps a flood of junk tokens from
    using it all and locking everyone out."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    if _checks["day"] != today:
        _checks.update(day=today, n=0)
    _checks["n"] += 1
    cap = settings.integer("LOGIN_CHECKS_PER_DAY")
    if _checks["n"] == cap + 1:  # once a day, when it first happens
        log.warning("bot check: today's reCAPTCHA checks (%s, LOGIN_CHECKS_PER_DAY) are used up; checks are refused until "
                    "midnight UTC", cap)
    return _checks["n"] > cap


def _rate_limited(ip: str) -> bool:
    now, q = time.monotonic(), _attempts[ip]
    while q and now - q[0] > 60:
        q.popleft()
    q.append(now)
    return len(q) > settings.integer("LOGIN_PER_MINUTE")


class PrototypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=10, max_length=4096, description="The reCAPTCHA response from the page's widget.")


@router.get("/config", summary="Whether a bot check is on (and its site key), and whether the server is asleep (public)")
async def config(request: Request):
    from app import sleep

    awake = await sleep.wake(request.app, request.app.state.database_url)
    return {"mode": settings.raw("AUTH_MODE"), "recaptcha_site_key": settings.raw("RECAPTCHA_SITE_KEY") or None,
            "asleep": not awake}


@router.get("/me", summary="Whether this browser has passed the bot check (public)")
async def me(request: Request):
    if not gate_on():
        return {"mode": "off", "signed_in": True, "kind": "open"}
    s = session(request)
    return {"mode": settings.raw("AUTH_MODE"), "signed_in": bool(s), "kind": s["kind"] if s else None,
            "expires_at": s["exp"] if s else None}


@router.post("/prototype", summary="The bot check: verify the reCAPTCHA token, then set the cookie")
async def prototype(request: Request, body: PrototypeIn, response: Response):
    if settings.raw("AUTH_MODE") != "prototype":
        raise Problem(404, "not_found", "The bot check isn't on here.")
    if _rate_limited(_client_ip(request)):
        raise Problem(429, "too_many", "Too many tries; wait a minute.", retry_after=60)
    secret = settings.raw("RECAPTCHA_SECRET")
    if not secret:
        log.error("bot check: RECAPTCHA_SECRET isn't set, so nobody can get in")
        raise Problem(503, "misconfigured", "reCAPTCHA isn't set up on this server (RECAPTCHA_SECRET).")
    if _check_budget_spent():
        raise Problem(429, "busy", "Too many checks today; try again tomorrow.", retry_after=3600)
    transport = getattr(request.app.state, "captcha_transport", None)
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as c:
            r = await c.post(settings.raw("RECAPTCHA_VERIFY_URL"),
                             data={"secret": secret, "response": body.token, "remoteip": _client_ip(request)})
        v = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("bot check: Google's reCAPTCHA didn't answer (%s)", type(e).__name__)
        raise Problem(502, "captcha_unreachable", "Google's reCAPTCHA check didn't answer; try again.") from e
    hosts = settings.names("RECAPTCHA_HOSTNAMES")
    # Over its free allowance Google answers success:true with an error code, so any error code is a failure.
    if not v.get("success") or v.get("error-codes") or (hosts and v.get("hostname") not in hosts):
        # the hostname tells a key without this domain apart from a failed check (no IP: nothing personal in logs)
        log.info("bot check refused: reCAPTCHA success=%s errors=%s hostname=%s (allowed: %s)", v.get("success"),
                 v.get("error-codes", []), v.get("hostname"), ", ".join(hosts) or "any")
        raise Problem(403, "captcha_failed", "The check didn't pass. Tick the box again.",
                      reasons=v.get("error-codes", []))
    token, exp = issue("prototype")
    log.info("bot check passed")
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(COOKIE, token, max_age=exp - int(time.time()), httponly=True, secure=secure, samesite="lax",
                        path="/")
    return {"signed_in": True, "kind": "prototype", "expires_at": exp}


@router.post("/logout", summary="Forget the passed check (clears the cookie)")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"signed_in": False}
