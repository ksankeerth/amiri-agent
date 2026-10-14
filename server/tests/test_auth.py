"""Sign-in: with AUTH_MODE=prototype the API needs a session from the reCAPTCHA check; crawlers and
search engines are turned away whatever the mode."""

import httpx
import pytest

SECRET = "s" * 40


def captcha(ok: bool = True, host: str = "amiri.example.com"):
    def handler(request: httpx.Request) -> httpx.Response:
        body = request.content.decode()
        assert "secret=test-secret" in body and "response=" in body
        return httpx.Response(200, json={"success": ok, "hostname": host, **({} if ok else {"error-codes": ["invalid-input-response"]})})
    return httpx.MockTransport(handler)


@pytest.fixture
def gated(env, app):
    for k, v in {"AUTH_MODE": "prototype", "SESSION_SECRET": SECRET, "RECAPTCHA_SECRET": "test-secret",
                 "RECAPTCHA_SITE_KEY": "site-key", "AUTH_LOCAL_AGENTS": "false", "LOGIN_PER_MINUTE": "5"}.items():
        env.setenv(k, v)
    app.state.captcha_transport = captcha()
    from app import auth
    auth._attempts.clear()
    return app


async def test_the_api_needs_a_sign_in_and_the_check_gives_one(client, gated):
    assert (await client.get("/api/v1/overview")).json()["code"] == "signed_out"
    for p in ("/api/v1/series", "/docs", "/openapi.json", "/health/details"):
        assert (await client.get(p)).status_code == 401, p
    assert (await client.post("/internal/tick")).status_code == 401  # no longer open on a public URL
    assert (await client.get("/health")).status_code == 200  # liveness stays open
    cfg = (await client.get("/api/v1/auth/config")).json()
    assert cfg == {"mode": "prototype", "recaptcha_site_key": "site-key", "access_code": False, "google": False}
    assert (await client.get("/api/v1/auth/me")).json()["signed_in"] is False
    r = await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token"})
    assert r.status_code == 200 and "amiri_session" in r.cookies
    c = r.headers["set-cookie"].lower()
    assert "httponly" in c and "samesite=lax" in c
    assert (await client.get("/api/v1/series")).status_code == 200  # the cookie travels with the client
    assert (await client.get("/api/v1/auth/me")).json()["signed_in"] is True
    await client.post("/api/v1/auth/logout")
    client.cookies.clear()
    assert (await client.get("/api/v1/series")).status_code == 401


async def test_a_failed_check_a_forged_cookie_and_too_many_tries(client, gated, app, env):
    app.state.captcha_transport = captcha(ok=False)
    r = await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token"})
    assert r.status_code == 403 and r.json()["code"] == "captcha_failed"
    client.cookies.set("amiri_session", "eyJ2IjoxfQ.forged")
    assert (await client.get("/api/v1/series")).status_code == 401
    codes = [(await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token"})).status_code for _ in range(6)]
    assert codes[-1] == 429


async def test_the_host_and_the_access_code(client, gated, app, env):
    env.setenv("RECAPTCHA_HOSTNAMES", "amiri.app")
    r = await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token"})
    assert r.status_code == 403  # a token issued for another site
    env.setenv("RECAPTCHA_HOSTNAMES", "amiri.example.com")
    env.setenv("LOGIN_ACCESS_CODE", "reviewers-2026")
    assert (await client.get("/api/v1/auth/config")).json()["access_code"] is True
    assert (await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token", "code": "nope"})).json()["code"] == "wrong_code"
    assert (await client.post("/api/v1/auth/prototype", json={"token": "a-captcha-token", "code": "reviewers-2026"})).status_code == 200


async def test_crawlers_and_search_engines_are_turned_away(client, env):
    r = await client.get("/robots.txt")
    assert r.text == "User-agent: *\nDisallow: /\n"
    assert "noindex" in (await client.get("/health")).headers["x-robots-tag"]
    for ua in ("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)", "ClaudeBot/1.0", "CCBot/2.0"):
        assert (await client.get("/api/v1/auth/config", headers={"User-Agent": ua})).status_code == 403, ua
    assert (await client.get("/api/v1/auth/config", headers={"User-Agent": "Mozilla/5.0 Safari/605"})).status_code == 200
