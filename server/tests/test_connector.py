"""The connector on imported data: the sample's example file is ready at L4; what a file can get wrong is caught by
the check meant for it; faults a reference API can have (version, formats, rate limits) are still caught when the
answers carry them; coverage speaks about this profile; approval and the validation switch follow the rules."""

import copy
import json

import httpx
import pytest

from app import auth
from app.connect import checker
from app.connect.client import InstitutionData
from app.spec import reference_openapi
from tests.datafile import ME, TODAY, C, connect, example, send
from tests.test_institutions_api import seed


async def run_check(client):
    r = await client.post(f"{C}:check", headers=ME)
    assert r.status_code == 201, r.text
    return r.json()


def check(report, cid):
    return next(c for c in report["checks"] if c["id"] == cid)


async def test_the_example_file_is_ready_at_l4(client, app):
    await seed(client, "bank-a")  # the installation's institution: the example is shaped by it
    await connect(client, app)
    rep = await run_check(client)
    assert rep["status"] == "ready", (rep["headline"], [c for c in rep["checks"] if c["status"] == "fail"],
                                      rep["formats"][:3], rep["missing_for_profile"])
    assert rep["accepted"] is True and rep["server_version"] == "1.0.0"
    assert rep["target"] == "the imported file institution-data.json (as of 2026-10-06)"
    steps = {s["step"]: s["status"] for s in rep["steps"]}
    assert steps["reach"] == "pass" and steps["reference_api"] == "pass" and steps["formats"] == "pass"
    ran = {c["id"]: c["status"] for c in rep["checks"]}
    assert all(ran[c] == "pass" for c in ("C01", "C02", "C03", "C04", "C05", "C06", "C07", "C09", "C11", "C12",
                                          "C13", "C14", "C17", "C18", "C19", "C20")), ran
    # L4: vintages pass; change concentration (L5) needs per-contributor data a file doesn't have
    assert ran["C16"] == "not_applicable" and "L4 or below" in check(rep, "C16")["note"]
    assert ran["C21"] == "not_applicable" and ran["C08"] == "not_run"
    cov = rep["coverage"]["products"]
    assert cov and all(p["status"] == "full" for p in cov) and not rep["missing_for_profile"]
    assert rep["summary"]["calls"] > 20 and all(c["status"] for c in rep["calls"])
    assert "rows" not in str(rep["calls"])  # the report keeps no data
    listed = (await client.get(f"{C}/checks")).json()["items"]
    assert listed[0]["check_id"] == rep["check_id"]
    assert (await client.get(f"{C}/checks/{rep['check_id']}")).json()["status"] == "ready"


async def test_the_insurer_example_is_ready_too(client, app):
    from tests.test_institutions_api import INSURER, new
    await new(client, {**INSURER, "institution_id": "bank-a"})  # an insurer installation: the sample insurer
    doc = await example(app)
    assert doc["catalog"]["profile"]["institution_type"] == "insurer"
    assert any(r.get("vintages") for s in doc["series"] for r in s["rows"])  # claims develop
    assert (await send(client, doc)).status_code == 200
    rep = await run_check(client)
    assert rep["status"] in ("ready", "ready_with_gaps"), [c for c in rep["checks"] if c["status"] == "fail"]
    assert check(rep, "C14")["status"] == "pass" and not [c for c in rep["checks"] if c["status"] == "fail"]


class Faulty(httpx.AsyncBaseTransport):
    """The imported data's in-process API with one fault a reference API can have, as the checker sees it."""

    def __init__(self, inner: httpx.AsyncBaseTransport, fault: str):
        self.inner, self.fault, self.n = inner, fault, 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.n += 1
        if self.fault == "rate_limit_no_retry_after" and self.n % 3 == 0:
            return httpx.Response(429, json={"code": "rate_limited", "detail": "slow down"})
        r = await self.inner.handle_async_request(request)
        body = await r.aread()
        headers = {k: v for k, v in r.headers.items() if k.lower() not in ("content-length", "metrics-spec-version")}
        version = {"no_version_header": None, "old_major_version": "0.9.0"}.get(self.fault, "1.0.0")
        if version:
            headers["Metrics-Spec-Version"] = version
        if self.fault in ("old_major_version", "wrong_formats") and body[:1] == b"{":
            doc = json.loads(body)
            if self.fault == "old_major_version" and "spec_version" in doc:
                doc["spec_version"] = "0.9.0"
            if self.fault == "wrong_formats":
                for row in doc.get("rows") or []:
                    row["value"] = None if row["value"] is None else str(row["value"])
                    if row.get("published_at"):
                        row["published_at"] = row["published_at"].replace("-", "/")
            body = json.dumps(doc).encode()
        return httpx.Response(r.status_code, headers=headers, content=body)


@pytest.mark.parametrize("fault, expect", [
    ("old_major_version", ("not_ready", "version")),
    ("no_version_header", ("ready_with_gaps", "C20")),
    ("wrong_formats", ("not_ready", "formats")),
    ("rate_limit_no_retry_after", ("ready_with_gaps", "C18")),
])
async def test_each_fault_is_caught(client, app, fault, expect):
    await connect(client, app)
    dc = app.state.data_connection
    good, target, openapi_url = await dc.client()
    data = InstitutionData(good.base_url, headers=good.headers, transport=Faulty(good.transport, fault))
    await good.aclose()
    try:
        rep = await checker.run(data, None, dc.clock.now(), target, openapi_url)
    finally:
        await data.aclose()
    status, where = expect
    assert rep["status"] == status, (fault, rep["headline"])
    if where == "version":
        assert any(s["step"] == "version" and s["status"] == "fail" for s in rep["steps"])
        assert rep["accepted"] is False and "0.9.0" in rep["headline"]
    elif where == "formats":
        errs = " ".join(e for f in rep["formats"] for e in f["errors"])
        assert ("published_at" in errs and "is not a 'date'" in errs) or "is not of type" in errs
        fix = next(st for st in rep["steps"] if st["step"] == "formats" and st["status"] == "fail")["fix"]
        assert "JSON numbers" in fix and "YYYY-MM-DD" in fix, fix
    else:
        assert check(rep, where)["status"] == "fail", (fault, check(rep, where))


async def test_a_missing_metric_shows_in_coverage(client, app):
    await seed(client, "bank-a")
    doc = await example(app)
    p = doc["catalog"]["products"][0]
    gone = next(m["key"] for m in p["metrics"] if m["key"] in ("deposit_inflow", "withdrawals"))
    p["metrics"] = [m for m in p["metrics"] if m["key"] != gone]
    doc["series"] = [s for s in doc["series"] if (s["product_id"], s["metric"]) != (p["product_id"], gone)]
    assert (await send(client, doc)).status_code == 200
    rep = await run_check(client)
    assert rep["status"] == "ready_with_gaps"
    gaps = [x for x in rep["coverage"]["products"] if x["missing"]]
    assert len(gaps) == 1 and gaps[0]["missing"] == [gone] and gone in rep["missing_for_profile"][0]
    step = next(st for st in rep["steps"] if st["step"] == "coverage")
    assert step["status"] == "warn" and "Serve each missing required metric" in step["fix"]


async def test_unsuppressed_small_cells_fail_c09(client, app):
    doc = await example(app, [{"id": "few_customers"}])
    small = [s for s in doc["series"] if s["rows"] and all(r.get("suppressed") for r in s["rows"])]
    assert small  # the smallest product's cells are suppressed in the file
    for s in small:
        for r in s["rows"]:
            r.update(suppressed=False, suppression_reason=None, value=1.0, volume=6)
    assert (await send(client, doc)).status_code == 200
    rep = await run_check(client)
    assert check(rep, "C09")["status"] == "fail" and "below the minimum" in check(rep, "C09")["findings"][0]


async def test_planted_scenarios_keep_it_conformant(client, app):
    await connect(client, app, [{"id": "currency_slide_importers"}, {"id": "floods"}, {"id": "late_revision"},
                                {"id": "dominant_obligor"}, {"id": "reporting_lag"}])
    rep = await run_check(client)
    fails = [c["id"] for c in rep["checks"] if c["status"] == "fail"]
    assert rep["formats"] == [] and fails in ([], ["C12"]), fails  # a long lag may only make publication late


async def test_approval_and_the_validation_switch(client, app, env):
    assert (await client.post(f"{C}:approve", headers=ME)).status_code == 409  # nothing to approve
    assert (await client.post(f"{C}:check", headers=ME)).json()["code"] == "not_configured"
    await connect(client, app)
    assert (await client.post(f"{C}:approve", headers=ME)).json()["code"] == "not_checked"
    await run_check(client)
    v = (await client.post(f"{C}:approve", headers=ME)).json()
    assert v["approved"]["by"] == "admin@x"
    r = await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "validation_off"  # METRICS_VALIDATION is off
    env.setenv("METRICS_VALIDATION", "on")
    v = (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()
    assert v["validation_enabled"] is True and await app.state.data_connection.validation_on()
    # approved data whose check now fails (here: answers that don't match the formats): the approval is withdrawn
    dc = app.state.data_connection
    real = dc.client

    async def broken():
        data, target, openapi_url = await real()
        return InstitutionData(data.base_url, headers=data.headers, transport=Faulty(data.transport, "wrong_formats")), \
            target, openapi_url
    dc.client = broken
    try:
        rep = await run_check(client)
    finally:
        dc.client = real
    assert rep["status"] == "not_ready" and "withdrawn" in rep
    v = (await client.get(C)).json()
    assert v["approved"] is None and v["validation_enabled"] is False
    await run_check(client)
    await client.post(f"{C}:approve", headers=ME)
    assert (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()["validation_enabled"]
    # a new import must be checked and approved again; validation goes off with it
    v = await connect(client, app)
    assert v["approved"] is None and v["validation_enabled"] is False and v["latest_check"]["current"] is False
    assert (await client.post(f"{C}:approve", headers=ME)).json()["code"] == "not_checked"


async def test_through_the_bot_check(client, app, env):
    """With the bot check on, the connector still reads the imported data in-process (it carries a session and the
    process's own token); from outside, /imported/ is gated, and without the token it isn't there."""
    await connect(client, app)
    env.setenv("AUTH_MODE", "prototype")
    env.setenv("AUTH_LOCAL_AGENTS", "false")
    env.setenv("SESSION_SECRET", "s" * 40)
    env.setenv("RECAPTCHA_SITE_KEY", "test")
    token, _ = auth.issue("person")
    client.cookies.set(auth.COOKIE, token)
    rep = await run_check(client)
    assert rep["steps"][0]["status"] == "pass", rep["steps"][0]
    assert (await client.get("/imported/metrics/v1/catalog")).status_code == 404  # a session, but not in-process
    client.cookies.clear()
    assert (await client.get("/imported/metrics/v1/catalog")).status_code == 401


def test_openapi_comparison_finds_what_differs():
    ref = reference_openapi()
    assert checker.compare_openapi(ref) == []
    doc = copy.deepcopy(ref)
    params = doc["paths"]["/metrics/v1/series"]["get"]["parameters"]
    doc["paths"]["/metrics/v1/series"]["get"]["parameters"] = [p for p in params if p.get("$ref") != "#/components/parameters/Start"]
    doc["components"]["schemas"]["SeriesRow"]["properties"]["value"] = {"type": "string"}
    del doc["paths"]["/metrics/v1/breaks"]
    diffs = checker.compare_openapi(doc)
    blocking = [d for d, b in diffs if b]
    assert any("start is missing" in d for d in blocking)
    assert any("value is string" in d for d in blocking)
    assert any("/metrics/v1/breaks isn't in the document" in d for d in blocking)


def test_today_is_the_test_clock():
    assert TODAY.isoformat() == "2026-10-07"
