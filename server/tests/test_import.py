"""Importing the institution's data: the example file round trip (download, import, check, approve, and validation
reading the file's own values), strict errors that say where and what, the size cap, the demo lock, replacing a
file, and a connection from before (a sample or an address) reading as not configured."""

import json
from datetime import date

import pytest

from app import settings
from app.connect import importfmt
from app.validation.reader import RunReader
from tests.datafile import ME, TODAY, C, connect, example, send
from tests.test_institutions_api import seed


async def test_the_example_file_round_trip(client, app, env):
    await seed(client, "bank-a")
    r = await client.get(f"{C}:example")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    assert r.headers["content-disposition"] == 'attachment; filename="serendib-commercial-bank-data-2026-10-06.json"'
    doc = r.json()
    assert doc["format"] == "amiri-institution-data/1" and doc["as_of"] == "2026-10-06"
    assert "shaped by Serendib Commercial Bank (your profile)" in doc["about"] and "Remittances fall" in doc["about"]
    v = (await send(client, r.content, "serendib.json")).json()
    imp = v["imported"]
    assert v["configured"] is True and v["source"] == "imported" and v["approved"] is None
    assert imp["file_name"] == "serendib.json" and imp["by"] == "admin@x" and imp["bytes"] == len(r.content)
    s = imp["summary"]
    assert (s["products"], s["metrics"], s["series"]) == (10, 53, 376) and s["capability_level"] == "L4"
    assert s["from"] == "2023-07-01" and s["until"] == "2026-10-06" and s["as_of"] == "2026-10-06"
    rep = (await client.post(f"{C}:check", headers=ME)).json()
    assert rep["status"] == "ready", rep["headline"]
    levels = {c["id"]: c["status"] for c in rep["checks"]}
    assert levels["C14"] == "pass" and levels["C16"] == "not_applicable"  # L4: vintages, no change concentration
    assert (await client.post(f"{C}:approve", headers=ME)).json()["approved"]["check_id"] == rep["check_id"]
    env.setenv("METRICS_VALIDATION", "on")
    assert (await client.put("/api/v1/validation", json={"enabled": True}, headers=ME)).json()["validation_enabled"]
    # the validator reads the file's own numbers, through the same client the check used
    dc = app.state.data_connection
    data, target, _ = await dc.client()
    reader = RunReader(data, target)
    try:
        cat = await reader.catalog()
        assert cat["vintages_kept"] is True and cat["calendar_id"] == "lk-banks"
        got = await reader.history("fetch", None, "inward-remittances", "inward_remittances", date(2024, 1, 1),
                                   date(2026, 10, 1), {}, date(2026, 10, 6), same_age_days=5)
        days = await reader.calendar(date(2026, 9, 1), date(2026, 10, 1))
    finally:
        await data.aclose()
    want = next(x for x in doc["series"] if x["product_id"] == "inward-remittances" and x["metric"] == "inward_remittances"
                and not x["filter"])
    rows = {x["from"]: x for x in want["rows"]}
    assert len(got["rows"]) > 600  # paged and split to the API's limits
    for row in got["rows"]:
        assert row["value"] == rows[row["from"]]["value"] and row["vintage"] == "same_age"
    assert len(days) == 30 and any(d["holidays"] for d in days.values())


ERRORS = [
    (lambda d: d.update(format="amiri-institution-data/2"), "format", "must be amiri-institution-data/1"),
    (lambda d: d.pop("calendar"), "calendar", "is missing"),
    (lambda d: d.update(as_of="2026-10-07"), "as_of", "must be before today (2026-10-07)"),
    (lambda d: d["catalog"]["profile"].update(time_zone="+05:30"), "catalog.profile.time_zone", "IANA"),
    (lambda d: d["catalog"]["products"][0]["metrics"][0].update(grain="hourly"), "catalog.products[0].metrics[0].grain",
     "is not one of"),
    (lambda d: d["series"][3]["rows"][12].update(value="12.5"), "series[3].rows[12].value", "must be a number"),
    (lambda d: d["series"][3]["rows"][12].update(until="2023-08-09"), "series[3].rows[12]", "isn't one daily period"),
    (lambda d: d["series"][3]["rows"][12].update(vintage="latest"), "series[3].rows[12].vintage",
     "the server works it out"),
    (lambda d: d["series"][0].update(product_id="nope"), "series[0]", "nope/"),
    (lambda d: d["series"].pop(1), "series", "is missing: a filter on"),
    (lambda d: d["series"].append(d["series"][0]), "series[", "is given twice"),
    (lambda d: d["breaks"].append({"kind": "flood"}), "breaks[0]", "is a required property"),
]


@pytest.mark.parametrize("change, field, message", ERRORS)
async def test_errors_say_where_and_what(client, app, change, field, message):
    doc = await example(app, products=["migrant-savings"])
    change(doc)
    r = await send(client, doc)
    assert r.status_code == 422, r.text[:300]
    body = r.json()
    assert body["code"] == "invalid_import" and body["errors"], body
    hit = [e for e in body["errors"] if e["field"].startswith(field) and message in e["message"]]
    assert hit, body["errors"][:5]
    assert body["detail"].startswith("The file can't be imported: ")
    assert (await client.get(C)).json()["configured"] is False  # nothing was stored


async def test_not_json_and_not_an_object(client):
    r = await send(client, b'{"format": ')
    assert r.status_code == 422 and r.json()["code"] == "invalid_json" and "line 1" in r.json()["detail"]
    r = await send(client, b"[]")
    assert r.status_code == 422 and r.json()["errors"][0] == {"field": "(the file)", "message": "must be a JSON object"}


async def test_the_size_cap(client, app, env):
    doc = await example(app, products=["migrant-savings"])
    raw = json.dumps(doc).encode()
    half = round(len(raw) / 1024 / 1024 / 2, 3)
    env.setenv("DATA_IMPORT_MAX_MB", str(half))
    r = await send(client, raw)
    assert r.status_code == 413 and r.json()["code"] == "too_large" and "DATA_IMPORT_MAX_MB" in r.json()["detail"]
    assert (await client.get(C)).json()["max_import_mb"] == half
    env.setenv("DATA_IMPORT_MAX_MB", "25")
    assert settings.number("DATA_IMPORT_MAX_MB") == 25 and (await send(client, raw)).status_code == 200


async def test_the_demo_lock_blocks_import_but_not_the_example_or_the_check(client, app, env):
    await connect(client, app, products=["migrant-savings"])
    env.setenv("DEMO_LOCK", "true")
    r = await send(client, await example(app, products=["migrant-savings"]))
    assert r.status_code == 403 and r.json()["code"] == "demo_locked"
    assert (await client.get(f"{C}:example", params={"scenario": "none"})).status_code == 200
    assert (await client.post(f"{C}:check", headers=ME)).status_code == 201


async def test_a_new_file_replaces_the_old_one(client, app, sql):
    v1 = await connect(client, app, products=["migrant-savings"])
    await client.post(f"{C}:check", headers=ME)
    await client.post(f"{C}:approve", headers=ME)
    v2 = await connect(client, app, products=["pawning"])
    assert v2["approved"] is None and v2["imported"]["summary"]["products"] == 1
    assert v2["latest_check"]["current"] is False and v1["imported"]["summary"]["products"] == 1
    keys = {r["product_id"] for r in await sql("SELECT product_id FROM ops.imported_series")}
    assert keys == {"pawning"}
    assert (await sql("SELECT version FROM ops.data_connection"))[0]["version"] == 2


async def test_the_example_scenarios(client):
    r = await client.get(f"{C}:example", params={"scenario": "none"})
    assert r.json()["about"].endswith("Nothing planted.") and "bundled demo profile" in r.json()["about"]
    r = await client.get(f"{C}:example", params={"scenario": "floods,late_revision"})
    assert "Floods, then relief" in r.json()["about"] and r.json()["breaks"][0]["kind"] == "relief"
    r = await client.get(f"{C}:example", params={"scenario": "old_major_version"})
    assert r.status_code == 422 and "isn't a scenario" in r.json()["detail"]


async def test_a_sample_or_address_connection_from_before_reads_as_not_configured(client, sql):
    """The 0026 migration, run again over the 0023 tables with the old kinds of connection in them."""
    migrations = settings.PROJECT / "app" / "migrations"
    await sql("DROP TABLE ops.data_connection, ops.data_checks")
    await sql((migrations / "0023_data_connection.sql").read_text())
    await sql("""INSERT INTO ops.data_connection (id, source, sample, base_url, auth_header, auth_value, approved_check_id,
                   validation_enabled) VALUES (1, 'url', NULL, 'https://data.bank.example/metrics/v1', 'Authorization',
                   '\\x00', 'chk-old', true)""")
    await sql("""INSERT INTO ops.data_checks (check_id, connection_version, started_at, status, target, report)
                 VALUES ('chk-old', 1, now(), 'ready', 'https://data.bank.example/metrics/v1', '{}')""")
    await sql((migrations / "0026_imported_data.sql").read_text())
    v = (await client.get(C)).json()
    assert v["configured"] is False and v["validation_enabled"] is False and v["latest_check"] is None
    cols = {r["column_name"] for r in await sql(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'ops' AND table_name = 'data_connection'")}
    assert not cols & {"sample", "base_url", "openapi_url", "auth_header", "auth_value"}
    with pytest.raises(Exception, match="data_connection_source_check"):
        await sql("INSERT INTO ops.data_connection (id, source) VALUES (1, 'sample')")


def test_the_format_reads_the_example_and_fills_filter_sets():
    from app.mockinst.export import build_file, bundled
    doc = build_file(bundled("bank"), "bank", TODAY, [], products=["pawning"])
    for p in doc["catalog"]["products"]:
        for m in p["metrics"]:
            m["filter_sets"] = None  # left to the server
    got = importfmt.read(doc, TODAY)
    m = got["catalog"]["products"][0]["metrics"][0]
    assert m["filter_sets"] == [[]] + [[d] for d in sorted(m["breakdowns"])]
    assert got["summary"]["series"] == len(doc["series"])
