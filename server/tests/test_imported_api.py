"""The imported data served as the Metrics Spec reference API (in-process): every answer matches the reference
OpenAPI, errors are the spec's, the data behaves (grid, publication, paging, filters, vintages, suppression), the
planted scenarios show, and it is shaped by the installation's own institution."""

from datetime import date, timedelta

import jsonschema
import pytest
import yaml

from app.connect.imported import IN_PROCESS_HEADER, IN_PROCESS_TOKEN
from app.spec import REFERENCE_OPENAPI as OPENAPI
from tests.datafile import TODAY, connect
from tests.test_institutions_api import BANK, INSURER, add, new

DOC = yaml.safe_load(OPENAPI.read_text())
API = "/imported/metrics/v1"
IN = {IN_PROCESS_HEADER: IN_PROCESS_TOKEN}


def errors(schema: str, body) -> list[str]:
    v = jsonschema.Draft202012Validator({"$ref": f"#/components/schemas/{schema}", "components": DOC["components"]},
                                        format_checker=jsonschema.FormatChecker())
    return [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in v.iter_errors(body)]


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


async def get(client, path: str, **params):
    return await client.get(f"{API}{path}", params=params, headers=IN)


async def first(client, grain=None, key=None):
    cat = (await get(client, "/catalog")).json()
    for p in cat["products"]:
        for m in p["metrics"]:
            if (key is None or m["key"] == key) and (grain is None or m["grain"] == grain):
                return p, m
    raise AssertionError(f"no {key or grain} metric")


async def test_only_in_process_and_only_once_imported(client, app):
    assert (await get(client, "/catalog")).status_code == 404  # nothing imported yet
    await connect(client, app, products=["pawning"])
    assert (await get(client, "/catalog")).status_code == 200
    assert (await client.get(f"{API}/catalog")).status_code == 404  # no token: not in-process
    assert (await client.get(f"{API}/catalog", headers={IN_PROCESS_HEADER: "guess"})).status_code == 404


@pytest.mark.parametrize("kind", ["bank", "insurer"])
async def test_every_answer_matches_the_reference_openapi(client, app, kind):
    if kind == "insurer":
        await new(client, {**INSURER, "institution_id": "bank-a"})
    await connect(client, app)
    r = await get(client, "/catalog")
    assert r.status_code == 200 and r.headers["Metrics-Spec-Version"] == "1.0.0"
    cat = r.json()
    assert errors("Catalog", cat) == []
    assert cat["profile"]["institution_type"] == kind and len(cat["products"]) >= 5
    served = 0
    for p in cat["products"]:
        for m in p["metrics"]:
            start, until = window(m["grain"], TODAY)
            r = await get(client, "/series", product_id=p["product_id"], metric=m["key"], start=start.isoformat(),
                          until=until.isoformat())
            assert r.status_code == 200, (p["product_id"], m["key"], r.text)
            body = r.json()
            assert errors("SeriesResponse", body) == [], (p["product_id"], m["key"])
            assert all(row["until"] <= TODAY.isoformat() for row in body["rows"])  # never an open period
            served += 1
    assert served >= 15
    assert errors("BreaksResponse", (await get(client, "/breaks")).json()) == []
    cal = (await get(client, "/calendar", start="2026-01-01", until="2026-02-01")).json()
    assert errors("CalendarResponse", cal) == [] and len(cal["days"]) == 31
    oa = (await client.get("/imported/openapi.json", headers=IN)).json()
    assert oa["info"]["version"] == "1.0.0" and oa["servers"][0]["url"] == "/imported"


async def test_errors_are_the_specs(client, app):
    await connect(client, app, products=["migrant-savings"])
    p, m = await first(client, grain="weekly")
    base = {"product_id": p["product_id"], "metric": m["key"]}
    w = {"start": "2026-08-31", "until": "2026-09-28"}
    dims = list(m["breakdowns"])
    cases = [
        (await get(client, "/series", **base, start="2026-09-02", until="2026-09-28"), 400, "off_grid"),
        (await get(client, "/series", **base, **w, last_days="7"), 400, "relative_window"),
        (await get(client, "/series", **base, start="2016-08-29", until="2026-09-28"), 400, "range_too_large"),
        (await get(client, "/series", **base, **w, known_through="2026-12-01"), 400, "known_through_in_future"),
        (await get(client, "/series", **base, **w, segment_as_of="2026-09-02"), 400, "segment_date_not_on_grid"),
        (await get(client, "/series", **{**base, "product_id": "nope"}, **w), 404, "unknown_product"),
        (await get(client, "/series", **{**base, "metric": "nope"}, **w), 404, "unknown_metric"),
        (await get(client, "/series", **base, **w, **{"filter[nope]": "x"}), 422, "unknown_breakdown"),
        (await get(client, "/series", **base, **w, **{f"filter[d{i}]": "x" for i in range(4)}), 400, "too_many_filters"),
        (await get(client, "/series", **base, **w, **{f"filter[{dims[0]}]": "nope"}), 422, "value_not_allowed"),
        (await get(client, "/series", **base, **w, **{f"filter[{d}]": m["breakdowns"][d][0] for d in dims[:2]}), 422,
         "filter_set_not_allowed"),
        (await get(client, "/change-concentration", **base, a_start="2026-08-31", a_until="2026-09-14",
                   b_start="2026-09-14", b_until="2026-09-28"), 501, "not_implemented"),
        (await client.get(f"{API}/series", params={**base, **w}, headers={**IN, "Metrics-Spec-Version": "2.0.0"}), 400,
         "unsupported_version"),
    ]
    assert len(dims) == 2
    for r, status, code in cases:
        assert r.status_code == status, (code, r.text)
        body = r.json()
        assert body["code"] == code and r.headers["content-type"].startswith("application/problem+json")
        assert errors("Problem", body) == [] and r.headers["Metrics-Spec-Version"] == "1.0.0"


async def test_publication_paging_and_filters(client, app):
    await connect(client, app, products=["migrant-savings"])
    p, m = await first(client, grain="daily")
    base = {"product_id": p["product_id"], "metric": m["key"], "start": "2026-08-01", "until": TODAY.isoformat()}
    rows = (await get(client, "/series", **base)).json()["rows"]
    assert rows and all(date.fromisoformat(r["from"]).weekday() < 5 or m["day_basis"] == "calendar" for r in rows)
    pages, token = [], None
    while True:
        r = (await get(client, "/series", **base, page_size=7, **({"page_token": token} if token else {}))).json()
        pages += r["rows"]
        token = r["next_page_token"]
        if not token:
            break
    assert [x["from"] for x in pages] == [x["from"] for x in rows]
    dim, values = next(iter(m["breakdowns"].items()))
    parts = [(await get(client, "/series", **base, **{f"filter[{dim}]": v})).json()["rows"] for v in values]
    day = rows[-1]["from"]
    total = sum(next((x["value"] or 0) for x in part if x["from"] == day) for part in parts if part)
    assert abs(total - rows[-1]["value"]) < max(1.0, 1e-6 * rows[-1]["value"])  # additivity (C07)
    # periods after the file's last row are closed but not published to Amiri Agent
    late = (await get(client, "/series", **{**base, "start": "2026-10-01"}, known_through="2026-10-06")).json()
    assert late["rows"][-1]["from"] == "2026-10-05" and late["unpublished"] == ["2026-10-06"]  # the file ends on 6 Oct
    assert (await get(client, "/series", **base)).json()["known_through"] is None


async def test_claims_develop_and_same_age_reads(client, app):
    await new(client, {**INSURER, "institution_id": "bank-a"})
    await connect(client, app)
    cat = (await get(client, "/catalog")).json()
    p = next(x for x in cat["products"] if any(m["key"] == "claims_per_1000" and m["grain"] == "weekly"
                                                for m in x["metrics"]))
    base = {"product_id": p["product_id"], "metric": "claims_per_1000", "start": "2026-08-31", "until": "2026-10-05"}
    latest = (await get(client, "/series", **base)).json()["rows"]
    early = (await get(client, "/series", **base, known_through="2026-09-27")).json()["rows"]
    both = {r["from"]: r for r in latest}
    young = [r for r in early if r["from"] >= "2026-09-07"]
    assert young and all(r["value"] < both[r["from"]]["value"] for r in young)  # still coming in then
    assert all(r["vintage"] == "known_through" for r in early) and any(r["revised"] for r in latest)
    same = (await get(client, "/series", **base, same_age_days=30)).json()
    assert {r["vintage"] for r in same["rows"]} <= {"same_age", "missing"}


async def test_planted_scenarios_show(client, app):
    params = {"product_id": "trade-finance", "metric": "lc_openings", "start": "2026-08-17", "until": "2026-10-05"}
    await connect(client, app, products=["trade-finance"])
    plain = (await get(client, "/series", **params)).json()["rows"]
    await connect(client, app, [{"id": "currency_slide_importers", "start": "2026-09-14", "size": 20},
                                {"id": "floods", "start": "2026-08-17"}], products=["trade-finance"])
    hit = (await get(client, "/series", **params)).json()["rows"]
    for a, b in zip(plain, hit, strict=True):
        ratio = b["value"] / a["value"] if a["value"] else 1.0
        assert abs(ratio - (0.8 if a["from"] >= "2026-09-14" else 1.0)) < 0.06, (a["from"], ratio)
    br = (await get(client, "/breaks")).json()["breaks"]
    assert br and br[0]["kind"] == "relief" and br[0]["type"] == "episode"
    await connect(client, app, [{"id": "few_customers"}], products=["trade-finance", "pawning"])
    cat = (await get(client, "/catalog")).json()
    smallest = min(cat["products"], key=lambda x: x["book_size"]["value"])
    m = smallest["metrics"][0]
    start, until = window(m["grain"], TODAY)
    rows = (await get(client, "/series", product_id=smallest["product_id"], metric=m["key"], start=start.isoformat(),
                      until=until.isoformat())).json()["rows"]
    assert rows and all(r["suppressed"] and r["value"] is None and r["suppression_reason"] == "small_count" for r in rows)


async def test_late_revision_and_reporting_lag(client, app):
    await connect(client, app, [{"id": "late_revision", "start": "2026-09-01", "size": 0.6}], products=["personal-loans"])
    base = {"product_id": "personal-loans", "metric": "roll_rate_to_30", "start": "2026-05-01", "until": "2026-09-01"}
    first_ = {r["from"]: r for r in (await get(client, "/series", **base, known_through="2026-08-31")).json()["rows"]}
    now = {r["from"]: r for r in (await get(client, "/series", **base)).json()["rows"]}
    july = "2026-07-01"
    assert first_[july]["value"] > now[july]["value"] + 0.5 and now[july]["revised"] is True
    assert first_[july]["revised"] is False
    sept = {**base, "start": "2026-09-01", "until": "2026-10-01"}
    before = (await get(client, "/series", **sept)).json()
    await connect(client, app, [{"id": "reporting_lag"}], products=["personal-loans"])
    after = (await get(client, "/series", **sept)).json()
    assert len(after["unpublished"]) >= len(before["unpublished"]) and not after["rows"]


async def test_shaped_by_the_installations_own_institution(client, app):
    inst = await new(client, {**BANK, "institution_id": "bank-a", "name": "Harbour Bank"})
    await add(client, inst["institution_id"], "products", {"name": "Harbour Savings", "category": "savings",
                                                           "product_type": "savings_account",
                                                           "book_size": {"amount": 5e9, "currency": "LKR"}})
    v = await connect(client, app)
    assert v["imported"]["summary"]["institution"] == "Harbour Bank" and v["imported"]["summary"]["products"] == 1
    cat = (await get(client, "/catalog")).json()
    assert [p["name"] for p in cat["products"]] == ["Harbour Savings"]
