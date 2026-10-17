"""The sample institutions: every response matches the Metrics Spec reference OpenAPI, errors are the
spec's, the data behaves (grid, publication, vintages, suppression, paging), and each condition does
what it says, faults included."""

from datetime import date, timedelta

import jsonschema
import pytest
import yaml

from app import auth
from app.spec import REFERENCE_OPENAPI as OPENAPI
from tests.test_institutions_api import BANK, add, new

DOC = yaml.safe_load(OPENAPI.read_text())
ME = {"X-Amiri-Actor": "admin@x"}


def errors(schema: str, body) -> list[str]:
    v = jsonschema.Draft202012Validator({"$ref": f"#/components/schemas/{schema}", "components": DOC["components"]},
                                        format_checker=jsonschema.FormatChecker())
    return [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in v.iter_errors(body)]


async def enable(client, kind="bank", conditions=(), enabled=True):
    r = await client.put(f"/api/v1/mock-institutions/{kind}", json={"enabled": enabled, "conditions": list(conditions)},
                         headers=ME)
    assert r.status_code == 200, r.text
    return r.json()


def api(kind="bank"):
    return f"/mock/{kind}/metrics/v1"


def window(grain: str, end: date, n: int = 6) -> tuple[date, date]:
    """n whole periods ending before `end`, on the grid."""
    if grain == "weekly":
        until = end - timedelta(days=end.weekday())
        return until - timedelta(days=7 * n), until
    if grain in ("monthly", "quarterly"):
        step = 3 if grain == "quarterly" else 1
        y, m = end.year, end.month
        if grain == "quarterly":
            m = (m - 1) // 3 * 3 + 1
        until = date(y, m, 1)
        yy, mm = divmod(y * 12 + m - 1 - step * n, 12)
        return date(yy, mm + 1, 1), until
    return end - timedelta(days=n * 2), end


TODAY = date(2026, 10, 7)  # the test clock, in Colombo


async def test_switches_and_the_profile_that_shapes_them(client):
    r = (await client.get("/api/v1/mock-institutions")).json()
    assert r["allowed"] is True and [s["kind"] for s in r["items"]] == ["bank", "insurer"]
    bank = r["items"][0]
    assert bank["enabled"] is False and bank["shaped_by"]["source"] == "bundled"
    assert {p["id"] for p in bank["presets"]} >= {"currency_slide_importers", "old_major_version"}
    assert (await client.get(f"{api()}/catalog")).status_code == 404  # off
    bad = await client.put("/api/v1/mock-institutions/bank", json={"enabled": True, "conditions": [{"id": "nope"}]})
    assert bad.status_code == 422 and "nope" in bad.text
    flood_on_insurer_only = [{"id": "dominant_obligor"}]
    assert (await client.put("/api/v1/mock-institutions/insurer",
                             json={"enabled": True, "conditions": flood_on_insurer_only})).status_code == 422
    st = await enable(client)
    assert st["enabled"] is True and st["updated_by"] == "admin@x"
    assert "/mock/" in auth.GATED_PREFIX  # behind the bot check like every API


@pytest.mark.parametrize("kind", ["bank", "insurer"])
async def test_every_response_matches_the_reference_openapi(client, kind):
    await enable(client, kind)
    r = await client.get(f"{api(kind)}/catalog")
    assert r.status_code == 200 and r.headers["Metrics-Spec-Version"] == "1.0.0"
    cat = r.json()
    assert errors("Catalog", cat) == []
    assert cat["profile"]["institution_type"] == kind and len(cat["products"]) >= 5
    served = 0
    for p in cat["products"]:
        for m in p["metrics"]:
            start, until = window(m["grain"], TODAY)
            r = await client.get(f"{api(kind)}/series", params={"product_id": p["product_id"], "metric": m["key"],
                                                                 "start": start.isoformat(), "until": until.isoformat()})
            assert r.status_code == 200, (p["product_id"], m["key"], r.text)
            body = r.json()
            assert errors("SeriesResponse", body) == [], (p["product_id"], m["key"])
            for row in body["rows"]:
                assert row["until"] <= TODAY.isoformat()  # never an open period
            served += 1
    assert served >= 15
    br = (await client.get(f"{api(kind)}/breaks")).json()
    assert errors("BreaksResponse", br) == []
    cal = (await client.get(f"{api(kind)}/calendar", params={"start": "2026-01-01", "until": "2026-02-01"})).json()
    assert errors("CalendarResponse", cal) == [] and len(cal["days"]) == 31
    oa = (await client.get(f"/mock/{kind}/openapi.json")).json()
    assert oa["info"]["version"] == "1.0.0" and oa["servers"][0]["url"].endswith(f"/mock/{kind}")


async def _first(client, kind, grain=None, key=None):
    cat = (await client.get(f"{api(kind)}/catalog")).json()
    for p in cat["products"]:
        for m in p["metrics"]:
            if (key is None or m["key"] == key) and (grain is None or m["grain"] == grain):
                return p, m
    raise AssertionError(f"no {key or grain} metric")


async def test_errors_are_the_specs(client):
    await enable(client)
    p, m = await _first(client, "bank", grain="weekly")
    base = {"product_id": p["product_id"], "metric": m["key"]}

    async def get(**params):
        return await client.get(f"{api()}/series", params={**base, **params})

    cases = [
        (await get(start="2026-09-02", until="2026-09-28"), 400, "off_grid"),          # a Wednesday
        (await get(start="2026-08-31", until="2026-09-28", last_days="7"), 400, "relative_window"),
        (await get(start="2016-08-29", until="2026-09-28"), 400, "range_too_large"),
        (await get(start="2026-08-31", until="2026-09-28", known_through="2026-12-01"), 400, "known_through_in_future"),
        (await get(start="2026-08-31", until="2026-09-28", segment_as_of="2026-09-02"), 400, "segment_date_not_on_grid"),
        (await client.get(f"{api()}/series", params={**base, "product_id": "nope", "start": "2026-08-31",
                                                      "until": "2026-09-28"}), 404, "unknown_product"),
        (await client.get(f"{api()}/series", params={**base, "metric": "nope", "start": "2026-08-31",
                                                      "until": "2026-09-28"}), 404, "unknown_metric"),
        (await get(start="2026-08-31", until="2026-09-28", **{"filter[nope]": "x"}), 422, "unknown_breakdown"),
        (await get(start="2026-08-31", until="2026-09-28", **{f"filter[d{i}]": "x" for i in range(4)}), 400,
         "too_many_filters"),
        (await client.get(f"{api()}/series", params={**base, "start": "2026-08-31", "until": "2026-09-28"},
                          headers={"Metrics-Spec-Version": "2.0.0"}), 400, "unsupported_version"),
    ]
    if m["breakdowns"]:
        dim = next(iter(m["breakdowns"]))
        cases.append((await get(start="2026-08-31", until="2026-09-28", **{f"filter[{dim}]": "nope"}), 422,
                      "value_not_allowed"))
    for r, status, code in cases:
        assert r.status_code == status, (code, r.text)
        body = r.json()
        assert body["code"] == code and r.headers["content-type"].startswith("application/problem+json")
        assert errors("Problem", body) == [] and r.headers["Metrics-Spec-Version"] == "1.0.0"


async def test_publication_paging_and_filters(client):
    await enable(client)
    p, m = await _first(client, "bank", grain="daily")
    base = {"product_id": p["product_id"], "metric": m["key"], "start": "2026-08-01", "until": TODAY.isoformat()}
    full = (await client.get(f"{api()}/series", params=base)).json()
    rows = full["rows"]
    assert rows and all(date.fromisoformat(r["from"]).weekday() < 5 or m["day_basis"] == "calendar" for r in rows)
    pages, token = [], None
    while True:
        r = (await client.get(f"{api()}/series", params={**base, "page_size": 7,
                                                         **({"page_token": token} if token else {})})).json()
        pages += r["rows"]
        token = r["next_page_token"]
        if not token:
            break
    assert [x["from"] for x in pages] == [x["from"] for x in rows]
    if m["breakdowns"]:
        dim, values = next(iter(m["breakdowns"].items()))
        parts = [(await client.get(f"{api()}/series", params={**base, f"filter[{dim}]": v})).json()["rows"] for v in values]
        day = rows[-1]["from"]
        total = sum(next((x["value"] or 0) for x in part if x["from"] == day) for part in parts if part)
        if m["unit"] in ("currency", "count") and not any(x["suppressed"] for part in parts for x in part):
            assert abs(total - rows[-1]["value"]) < max(1.0, 1e-6 * rows[-1]["value"])  # additivity (C07)


async def test_claims_develop_and_same_age_reads(client):
    await enable(client, "insurer")
    cat = (await client.get(f"{api('insurer')}/catalog")).json()
    p = next(x for x in cat["products"] if any(m["key"] == "claims_per_1000" and m["grain"] == "weekly"
                                                for m in x["metrics"]))
    base = {"product_id": p["product_id"], "metric": "claims_per_1000", "start": "2026-08-31", "until": "2026-10-05"}
    latest = (await client.get(f"{api('insurer')}/series", params=base)).json()["rows"]
    early = (await client.get(f"{api('insurer')}/series", params={**base, "known_through": "2026-09-27"})).json()["rows"]
    both = {r["from"]: r for r in latest}
    young = [r for r in early if r["from"] >= "2026-09-07"]
    assert young and all(r["value"] < both[r["from"]]["value"] for r in young)  # still coming in then
    assert all(r["vintage"] == "known_through" for r in early)
    same = (await client.get(f"{api('insurer')}/series", params={**base, "same_age_days": 30})).json()
    assert {r["vintage"] for r in same["rows"]} <= {"same_age", "missing"}


async def test_data_conditions(client, sql):
    params = None
    cat = (await client.get(f"{api()}/catalog")).json() if (await enable(client, "bank")) else None
    lc = next(((p, m) for p in cat["products"] for m in p["metrics"] if m["key"] == "lc_openings"), None)
    if lc:
        p, m = lc
        params = {"product_id": p["product_id"], "metric": "lc_openings", "start": "2026-08-17", "until": "2026-10-05"}
        if "importer" in m["breakdowns"].get("segment", []):
            params["filter[segment]"] = "importer"
        plain = (await client.get(f"{api()}/series", params=params)).json()["rows"]
    await enable(client, "bank", [{"id": "currency_slide_importers", "start": "2026-09-14", "size": 20},
                                  {"id": "floods", "start": "2026-08-17"},
                                  {"id": "few_customers"}, {"id": "dominant_obligor", "start": "2026-09-14"}])
    cat = (await client.get(f"{api()}/catalog")).json()
    if params:
        hit = (await client.get(f"{api()}/series", params=params)).json()["rows"]
        for a, b in zip(plain, hit, strict=True):
            ratio = b["value"] / a["value"] if a["value"] else 1.0
            assert abs(ratio - (0.8 if a["from"] >= "2026-09-14" else 1.0)) < 0.06, (a["from"], ratio)
    br = (await client.get(f"{api()}/breaks")).json()["breaks"]
    assert br and br[0]["kind"] == "relief" and br[0]["type"] == "episode"
    smallest = min(cat["products"], key=lambda x: x["book_size"]["value"])
    m = smallest["metrics"][0]
    start, until = window(m["grain"], TODAY)
    rows = (await client.get(f"{api()}/series", params={"product_id": smallest["product_id"], "metric": m["key"],
                                                        "start": start.isoformat(), "until": until.isoformat()})).json()["rows"]
    assert rows and all(r["suppressed"] and r["value"] is None and r["suppression_reason"] == "small_count" for r in rows)
    fu = next(((p, m) for p in cat["products"] for m in p["metrics"]
               if m["key"] == "facility_utilization" and p["category"] == "business_loan"), None)
    if fu:
        p, _ = fu
        r = (await client.get(f"{api()}/change-concentration", params={
            "product_id": p["product_id"], "metric": "facility_utilization", "a_start": "2026-08-31",
            "a_until": "2026-09-14", "b_start": "2026-09-21", "b_until": "2026-10-05"})).json()
        assert errors("ChangeConcentration", r) == [] and r["top_share_band"] == "from_0.8"
        bad = await client.get(f"{api()}/change-concentration", params={
            "product_id": p["product_id"], "metric": "facility_utilization", "a_start": "2026-08-31",
            "a_until": "2026-09-21", "b_start": "2026-09-14", "b_until": "2026-10-05"})
        assert bad.status_code == 400 and bad.json()["code"] == "windows_invalid"


async def test_late_revision_and_reporting_lag(client):
    await enable(client, "bank", [{"id": "late_revision", "start": "2026-09-01", "size": 0.6}])
    cat = (await client.get(f"{api()}/catalog")).json()
    p, m = next((p, m) for p in cat["products"] for m in p["metrics"] if m["key"] == "roll_rate_to_30")
    base = {"product_id": p["product_id"], "metric": m["key"], "start": "2026-05-01", "until": "2026-09-01"}
    first = {r["from"]: r for r in (await client.get(f"{api()}/series", params={**base, "known_through": "2026-08-31"})).json()["rows"]}
    now = {r["from"]: r for r in (await client.get(f"{api()}/series", params=base)).json()["rows"]}
    july = "2026-07-01"
    assert july in first and july in now
    assert first[july]["value"] > now[july]["value"] + 0.5 and now[july]["revised"] is True
    before = (await client.get(f"{api()}/series", params={**base, "start": "2026-09-01", "until": "2026-10-01"})).json()
    await enable(client, "bank", [{"id": "reporting_lag"}])
    after = (await client.get(f"{api()}/series", params={**base, "start": "2026-09-01", "until": "2026-10-01"})).json()
    assert len(after["unpublished"]) >= len(before["unpublished"]) and not after["rows"]


async def test_faults_show_up_where_the_checker_looks(client):
    await enable(client, "bank", [{"id": "old_major_version"}])
    r = await client.get(f"{api()}/catalog")
    assert r.headers["Metrics-Spec-Version"] == "0.9.0" and r.json()["spec_version"] == "0.9.0"
    await enable(client, "bank", [{"id": "no_version_header"}])
    assert "Metrics-Spec-Version" not in (await client.get(f"{api()}/catalog")).headers
    full = (await enable(client, "bank")) and (await client.get(f"{api()}/catalog")).json()
    await enable(client, "bank", [{"id": "missing_metric"}])
    cut = (await client.get(f"{api()}/catalog")).json()
    before = {(p["product_id"], m["key"]) for p in full["products"] for m in p["metrics"]}
    after = {(p["product_id"], m["key"]) for p in cut["products"] for m in p["metrics"]}
    assert len(before - after) == 1
    (pid, gone), = before - after
    grain = next(m["grain"] for p in full["products"] for m in p["metrics"] if (p["product_id"], m["key"]) == (pid, gone))
    start, until = window(grain, TODAY)
    miss = await client.get(f"{api()}/series", params={"product_id": pid, "metric": gone,
                                                        "start": start.isoformat(), "until": until.isoformat()})
    assert miss.status_code == 404 and miss.json()["code"] == "unknown_metric"
    await enable(client, "bank", [{"id": "wrong_formats"}])
    p, m = full["products"][0], full["products"][0]["metrics"][-1]
    start, until = window(m["grain"], TODAY)
    body = (await client.get(f"{api()}/series", params={"product_id": p["product_id"], "metric": m["key"],
                                                        "start": start.isoformat(), "until": until.isoformat()})).json()
    assert any("published_at" in e or "value" in e for e in errors("SeriesResponse", body))
    await enable(client, "bank", [{"id": "few_customers"}, {"id": "suppression_off"}])
    smallest = min(full["products"], key=lambda x: x["book_size"]["value"])
    m = smallest["metrics"][0]
    start, until = window(m["grain"], TODAY)
    rows = (await client.get(f"{api()}/series", params={"product_id": smallest["product_id"], "metric": m["key"],
                                                        "start": start.isoformat(), "until": until.isoformat()})).json()["rows"]
    assert rows and not any(r["suppressed"] for r in rows) and all((r["volume"] or 0) < 10 for r in rows)
    await enable(client, "bank", [{"id": "rate_limit_no_retry_after"}])
    statuses = [(await client.get(f"{api()}/catalog")) for _ in range(6)]
    limited = [r for r in statuses if r.status_code == 429]
    assert len(limited) == 2 and all("Retry-After" not in r.headers for r in limited)


async def test_shaped_by_the_installations_own_institution(client):
    inst = await new(client, {**BANK, "institution_id": "bank-a", "name": "Harbour Bank"})
    iid = inst["institution_id"]
    await add(client, iid, "products", {"name": "Harbour Savings", "category": "savings", "product_type": "savings_account",
                                        "book_size": {"amount": 5e9, "currency": "LKR"}})
    view = await enable(client, "bank")
    assert view["shaped_by"] == {"name": "Harbour Bank", "source": "installation"}
    cat = (await client.get(f"{api()}/catalog")).json()
    assert [p["name"] for p in cat["products"]] == ["Harbour Savings"]
    assert cat["profile"]["legal_entity_name"] == "Harbour Bank"
    ins = await enable(client, "insurer")
    assert ins["shaped_by"]["source"] == "bundled"  # the installation is a bank
