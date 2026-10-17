"""The connector: a clean sample institution is ready; each fault the sample can act out is caught by
the check meant for it; coverage speaks about this profile; approval and the validation switch follow
the rules; addresses someone types are checked; the stored key is never shown."""

import copy

import pytest

from app import auth
from app.connect import checker
from app.spec import reference_openapi
from tests.test_institutions_api import seed

ME = {"X-Amiri-Actor": "admin@x"}
C = "/api/v1/data-connection"


async def sample(client, kind="bank", conditions=()):
    r = await client.put(f"/api/v1/mock-institutions/{kind}", json={"enabled": True, "conditions": list(conditions)},
                         headers=ME)
    assert r.status_code == 200, r.text
    r = await client.put(C, json={"source": "sample", "sample": kind}, headers=ME)
    assert r.status_code == 200, r.text


async def run_check(client):
    r = await client.post(f"{C}:check", headers=ME)
    assert r.status_code == 201, r.text
    return r.json()


def check(report, cid):
    return next(c for c in report["checks"] if c["id"] == cid)


async def test_a_clean_sample_is_ready(client):
    await seed(client, "bank-a")  # the installation's institution: the sample bank is shaped by it
    await sample(client)
    rep = await run_check(client)
    assert rep["status"] == "ready", (rep["headline"], [c for c in rep["checks"] if c["status"] == "fail"],
                                      rep["formats"][:3], rep["missing_for_profile"])
    assert rep["accepted"] is True and rep["server_version"] == "1.0.0"
    steps = {s["step"]: s["status"] for s in rep["steps"]}
    assert steps["reach"] == "pass" and steps["reference_api"] == "pass" and steps["formats"] == "pass"
    ran = {c["id"]: c["status"] for c in rep["checks"]}
    assert all(ran[c] == "pass" for c in ("C01", "C02", "C03", "C04", "C05", "C06", "C07", "C09", "C11", "C12",
                                          "C13", "C14", "C16", "C17", "C18", "C19", "C20")), ran
    assert ran["C21"] == "not_applicable" and ran["C08"] == "not_run"
    cov = rep["coverage"]["products"]
    assert cov and all(p["status"] == "full" for p in cov) and not rep["missing_for_profile"]
    assert rep["summary"]["calls"] > 20 and all(c["status"] for c in rep["calls"])
    assert "rows" not in str(rep["calls"])  # the report keeps no data
    listed = (await client.get(f"{C}/checks")).json()["items"]
    assert listed[0]["check_id"] == rep["check_id"]
    assert (await client.get(f"{C}/checks/{rep['check_id']}")).json()["status"] == "ready"


async def test_the_insurer_sample_is_ready_too(client):
    await sample(client, "insurer")
    rep = await run_check(client)
    assert rep["status"] == "ready", [c for c in rep["checks"] if c["status"] == "fail"]


@pytest.mark.parametrize("fault, expect", [
    ("old_major_version", ("not_ready", "version")),
    ("no_version_header", ("ready_with_gaps", "C20")),
    ("wrong_formats", ("not_ready", "formats")),
    ("rate_limit_no_retry_after", ("ready_with_gaps", "C18")),
])
async def test_each_fault_is_caught(client, fault, expect):
    await sample(client, "bank", [{"id": fault}])
    rep = await run_check(client)
    status, where = expect
    assert rep["status"] == status, (fault, rep["headline"])
    if where == "version":
        assert any(s["step"] == "version" and s["status"] == "fail" for s in rep["steps"])
        assert rep["accepted"] is False and "0.9.0" in rep["headline"]
    elif where == "formats":
        errs = " ".join(e for f in rep["formats"] for e in f["errors"])
        assert ("published_at" in errs and "is not a 'date'" in errs) or "is not of type" in errs
    else:
        assert check(rep, where)["status"] == "fail", (fault, check(rep, where))


async def test_missing_metric_shows_in_coverage(client):
    await seed(client, "bank-a")
    await sample(client, "bank", [{"id": "missing_metric"}])
    rep = await run_check(client)
    assert rep["status"] == "ready_with_gaps"
    gaps = [p for p in rep["coverage"]["products"] if p["missing"]]
    assert len(gaps) == 1 and len(gaps[0]["missing"]) == 1
    assert gaps[0]["missing"][0] in rep["missing_for_profile"][0]


async def test_suppression_off_fails_c09(client):
    await sample(client, "bank", [{"id": "few_customers"}, {"id": "suppression_off"}])
    rep = await run_check(client)
    assert check(rep, "C09")["status"] == "fail" and "below the minimum" in check(rep, "C09")["findings"][0]


async def test_data_conditions_keep_it_conformant(client):
    await sample(client, "bank", [{"id": "currency_slide_importers"}, {"id": "floods"}, {"id": "late_revision"},
                                  {"id": "dominant_obligor"}, {"id": "reporting_lag"}])
    rep = await run_check(client)
    fails = [c["id"] for c in rep["checks"] if c["status"] == "fail"]
    assert rep["formats"] == [] and fails in ([], ["C12"]), fails  # a long lag may only make publication late


async def test_approval_and_the_validation_switch(client, env):
    assert (await client.post(f"{C}:approve", headers=ME)).status_code == 409  # nothing to approve
    await sample(client)
    assert (await client.post(f"{C}:approve", headers=ME)).json()["code"] == "not_checked"
    await run_check(client)
    v = (await client.post(f"{C}:approve", headers=ME)).json()
    assert v["approved"]["by"] == "admin@x"
    r = await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "validation_off"  # METRICS_VALIDATION is off
    env.setenv("METRICS_VALIDATION", "on")
    v = (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()
    assert v["validation_enabled"] is True and await client._transport.app.state.data_connection.validation_on()
    # the approved API breaks: the next check withdraws the approval and switches validation off
    await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": [{"id": "wrong_formats"}]})
    rep = await run_check(client)
    assert rep["status"] == "not_ready" and "withdrawn" in rep
    v = (await client.get(C)).json()
    assert v["approved"] is None and v["validation_enabled"] is False
    await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": []})
    await run_check(client)
    await client.post(f"{C}:approve", headers=ME)
    assert (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()["validation_enabled"]
    # a changed connection must be checked and approved again; validation goes off with it
    v = (await client.put(C, json={"source": "sample", "sample": "insurer"}, headers=ME)).json()
    assert v["approved"] is None and v["validation_enabled"] is False
    await sample(client, "insurer", [{"id": "wrong_formats"}])
    await run_check(client)
    r = await client.post(f"{C}:approve", headers=ME)
    assert r.status_code == 409 and r.json()["code"] == "not_ready"


async def test_addresses_are_checked_and_the_key_is_never_shown(client, env, sql):
    bad = [("http://169.254.169.254/metrics/v1", "https"), ("https://127.0.0.1/metrics/v1", "internal"),
           ("https://data.example.org/api", "/metrics/v1"), ("https://user:pw@data.example.org/metrics/v1", "user name"),
           ("https://no-such-host.invalid/metrics/v1", "doesn't resolve")]
    for url, why in bad:
        r = await client.put(C, json={"source": "url", "base_url": url}, headers=ME)
        assert r.status_code == 422 and why in r.json()["detail"], (url, r.text)
    env.setenv("DATA_CONNECTION_ALLOW_LOCAL", "true")  # a local test server, as in development
    r = await client.put(C, json={"source": "url", "base_url": "http://127.0.0.1:9/metrics/v1",
                                  "auth_header": "Authorization", "auth_value": "Bearer s3cret-token"}, headers=ME)
    assert r.status_code == 422 and r.json()["code"] == "secret_key_missing"
    env.setenv("DATA_SECRET_KEY", "k" * 40)
    v = (await client.put(C, json={"source": "url", "base_url": "http://127.0.0.1:9/metrics/v1",
                                   "auth_header": "Authorization", "auth_value": "Bearer s3cret-token"}, headers=ME)).json()
    assert v["auth_set"] is True and "s3cret" not in str(v)
    stored = (await sql("SELECT auth_value FROM ops.data_connection"))[0]["auth_value"]
    assert b"s3cret" not in bytes(stored)
    rep = await run_check(client)  # nothing listens on port 9
    assert rep["status"] == "not_ready" and rep["steps"][0]["step"] == "reach" and rep["steps"][0]["status"] == "fail"
    v = (await client.put(C, json={"source": "url", "base_url": "http://127.0.0.1:9/metrics/v1",
                                   "auth_header": "Authorization"}, headers=ME)).json()
    assert v["auth_set"] is True  # the same header keeps the stored key


async def test_through_the_bot_check(client, env):
    """With the bot check on, the connector still reaches the sample in-process (it carries a session)."""
    env.setenv("AUTH_MODE", "prototype")
    env.setenv("AUTH_LOCAL_AGENTS", "false")
    env.setenv("SESSION_SECRET", "s" * 40)
    env.setenv("RECAPTCHA_SITE_KEY", "test")
    token, _ = auth.issue("person")
    client.cookies.set(auth.COOKIE, token)
    await sample(client)
    rep = await run_check(client)
    assert rep["steps"][0]["status"] == "pass", rep["steps"][0]
    client.cookies.clear()
    assert (await client.get("/mock/bank/metrics/v1/catalog")).status_code == 401


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
