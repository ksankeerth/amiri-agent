"""Institution profile API: banks and insurers, every section, the rules between
them, batches, readiness, suggestions, history, import and the agents' context."""

import json

from app import settings

B = "/api/v1/institutions"
BANK = {"name": "Serendib Commercial Bank", "institution_type": "bank", "subtype": "commercial",
        "home_country": "LK", "base_currency": "LKR", "time_zone": "Asia/Colombo", "clearing_currencies": ["USD"]}
INSURER = {"name": "Lanka Shield Insurance", "institution_type": "insurer", "subtype": "composite",
           "home_country": "LK", "base_currency": "LKR", "time_zone": "Asia/Colombo"}
MIGRANTS = {"label": "Migrant-worker families", "kind": "individual", "places": ["LK-41", "IN-KL"],
            "income_sources": ["remittances"], "spec_mapping": [{"dimension": "segment", "value": "remittance_linked"}]}
SAVINGS = {"name": "Migrant Family Savings", "category": "savings", "product_type": "savings_account"}


async def new(client, body=BANK, **headers):
    r = await client.post(B, json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def add(client, iid, section, data, status=201, **params):
    r = await client.post(f"{B}/{iid}/{section}", json=data, params=params)
    assert r.status_code == status, r.text
    return r.json()


def codes(r):
    return [e["code"] for e in r.json().get("errors", [])]


# ---------------------------------------------------------------- the institution


async def test_create_bank_and_its_home_footprint(client):
    i = await new(client)
    assert i["institution_id"] == "serendib-commercial-bank" and i["status"] == "setup"
    assert i["version"] == 1 and i["profile_version"] == 1 and i["islamic"] is False
    assert i["counts"]["footprint"] == 1
    fp = (await client.get(f"{B}/{i['institution_id']}/footprint")).json()["items"]
    assert fp[0]["id"] == "lk" and fp[0]["code"] == "LK" and fp[0]["role"] == "home"
    lst = (await client.get(B)).json()
    assert [x["institution_id"] for x in lst] == ["serendib-commercial-bank"]


async def test_create_refusals(client):
    for bad, field in [({"home_country": "XX"}, "home_country"), ({"base_currency": "ABC"}, "base_currency"),
                       ({"time_zone": "Mars/Base"}, "time_zone"), ({"lei": "123"}, "lei"),
                       ({"institution_type": "broker"}, "institution_type")]:
        r = await client.post(B, json={**BANK, **bad})
        assert r.status_code == 422 and r.json()["errors"][0]["field"] == field, (bad, r.text)
    r = await client.post(B, json={**BANK, "subtype": "takaful"})
    assert r.status_code == 422 and "a bank is one of" in r.json()["errors"][0]["message"]
    r = await client.post(B, json={"name": "X"})
    assert r.status_code == 422
    await new(client)
    r = await client.post(B, json=BANK)
    assert r.status_code == 409 and r.json()["code"] == "institution_exists"
    await new(client, {**BANK, "institution_id": "serendib-2"})


async def test_patch_institution_versions_and_clearing(client):
    i = await new(client)
    iid = i["institution_id"]
    r = await client.patch(f"{B}/{iid}", json={"governance_body": "Board Risk Committee"}, headers={"If-Match": '"7"'})
    assert r.status_code == 409 and r.json()["current_version"] == 1
    r = await client.patch(f"{B}/{iid}", json={"governance_body": "Board Risk Committee", "islamic": True},
                           headers={"If-Match": '"1"'})
    assert r.status_code == 200 and r.json()["version"] == 2 and r.headers["ETag"] == '"2"'
    assert r.json()["profile_version"] == 2
    r = await client.patch(f"{B}/{iid}", json={"name": None})
    assert r.status_code == 422 and codes(r) == ["required"]
    r = await client.patch(f"{B}/{iid}", json={"governance_body": None})
    assert r.status_code == 200 and r.json()["governance_body"] is None
    r = await client.patch(f"{B}/{iid}", json={"subtype": "life"})
    assert r.status_code == 422


# ---------------------------------------------------------------- sections and their rules


async def test_segments_products_and_references(client):
    iid = (await new(client))["institution_id"]
    seg = await add(client, iid, "segments", MIGRANTS)
    sid = seg["item"]["id"]
    assert sid == "migrant-worker-families" and seg["item"]["version"] == 1
    assert [w["code"] for w in seg["warnings"]] == ["place_outside_footprint"]  # IN-KL isn't in the footprint yet
    r = await client.post(f"{B}/{iid}/segments", json={**MIGRANTS, "label": "MIGRANT-WORKER families"})
    assert r.status_code == 409 and r.json()["code"] == "duplicate"
    r = await client.post(f"{B}/{iid}/segments", json={"label": "X", "spec_mapping": [{"dimension": "segment", "value": "pirates"}]})
    assert r.status_code == 422 and "not a value of segment" in r.json()["errors"][0]["message"]
    r = await client.post(f"{B}/{iid}/segments", json={"label": "X", "spec_mapping": [{"dimension": "peril", "value": "flood"}]})
    assert r.status_code == 422

    p = await add(client, iid, "products", {**SAVINGS, "segments": [sid]})
    pid = p["item"]["id"]
    assert p["warnings"] == []
    r = await client.post(f"{B}/{iid}/products", json={**SAVINGS, "name": "X", "product_type": "term_life"})
    assert r.status_code == 422 and "not a product type of savings" in r.json()["errors"][0]["message"]
    r = await client.post(f"{B}/{iid}/products", json={"name": "Term cover", "category": "life", "product_type": "term_life"})
    assert r.status_code == 422 and codes(r) == ["category_not_for_type"]
    r = await client.post(f"{B}/{iid}/products", json={**SAVINGS, "name": "Y", "segments": ["nobody"]})
    assert r.status_code == 422 and codes(r) == ["unknown_reference"]

    d = (await client.get(f"{B}/{iid}/segments/{sid}")).json()
    assert d["used_by"] == [{"section": "products", "id": pid, "field": "segments"}]
    r = await client.delete(f"{B}/{iid}/segments/{sid}")
    assert r.status_code == 409 and r.json()["code"] == "in_use" and r.json()["referrers"][0]["id"] == pid
    r = await client.delete(f"{B}/{iid}/segments/{sid}", params={"force": "true"})
    assert r.status_code == 204
    prod = (await client.get(f"{B}/{iid}/products/{pid}")).json()
    assert prod["segments"] == [] and prod["version"] == 2
    assert [w["code"] for w in prod["warnings"]] == ["no_segments"]


async def test_item_versions_and_partial_patch(client):
    iid = (await new(client))["institution_id"]
    sid = (await add(client, iid, "segments", MIGRANTS))["item"]["id"]
    r = await client.patch(f"{B}/{iid}/segments/{sid}", json={"note": "Mostly Gulf"}, headers={"If-Match": '"5"'})
    assert r.status_code == 409 and r.json()["current_version"] == 1
    r = await client.patch(f"{B}/{iid}/segments/{sid}", json={"note": "Mostly Gulf"}, headers={"If-Match": '"1"'})
    assert r.status_code == 200 and r.json()["item"]["version"] == 2 and r.headers["ETag"] == '"2"'
    assert r.json()["item"]["label"] == MIGRANTS["label"]  # untouched fields kept
    r = await client.patch(f"{B}/{iid}/segments/{sid}", json={"note": "Mostly Gulf"})
    assert r.json()["item"]["version"] == 2  # no change, no new version
    r = await client.patch(f"{B}/{iid}/segments/{sid}", json={"label": None})
    assert r.status_code == 422
    r = await client.patch(f"{B}/{iid}/segments/{sid}", json={"colour": "red"})
    assert r.status_code == 422
    r = await client.patch(f"{B}/{iid}/segments/nope", json={"note": "x"})
    assert r.status_code == 404


async def test_footprint_rules(client):
    iid = (await new(client))["institution_id"]
    await add(client, iid, "footprint", {"code": "in-tn", "role": "branches", "branch_count": 12})
    r = await client.post(f"{B}/{iid}/footprint", json={"code": "IN-TN"})
    assert r.status_code == 409 and r.json()["code"] == "duplicate"
    r = await client.post(f"{B}/{iid}/footprint", json={"code": "IN-KL", "role": "home"})
    assert r.status_code == 422 and codes(r) == ["home_outside_home_country"]
    r = await client.post(f"{B}/{iid}/footprint", json={"code": "IN-ZZ"})
    assert r.status_code == 422
    r = await client.delete(f"{B}/{iid}/footprint/lk")
    assert r.status_code == 422 and codes(r) == ["home_required"]
    r = await client.patch(f"{B}/{iid}/footprint/in-tn", json={"code": "IN-KL"})
    assert r.status_code == 422 and codes(r) == ["immutable"]
    # a district of a footprint province is inside it
    await add(client, iid, "footprint", {"code": "LK-1", "role": "home", "scope": "part"})
    seg = await add(client, iid, "segments", {"label": "Colombo SMEs", "kind": "business", "places": ["LK-11", "IN-TN"]})
    assert [w["code"] for w in seg["warnings"]] == ["no_spec_mapping"]


async def test_change_home_country_in_one_batch(client):
    iid = (await new(client))["institution_id"]
    r = await client.patch(f"{B}/{iid}", json={"home_country": "IN"})
    assert r.status_code == 422 and codes(r) == ["home_footprint_first"]
    r = await client.post(f"{B}/{iid}:batch", json={"operations": [
        {"op": "create", "section": "footprint", "data": {"code": "IN", "role": "home"}},
        {"op": "update", "section": "footprint", "id": "lk", "data": {"role": "branches"}},
        {"op": "update", "section": "institution", "data": {"home_country": "IN", "base_currency": "INR", "time_zone": "Asia/Kolkata"}},
    ]})
    assert r.status_code == 200, r.text
    i = (await client.get(f"{B}/{iid}")).json()
    assert i["home_country"] == "IN" and i["base_currency"] == "INR"


async def test_insurer_profile_and_type_change(client):
    iid = (await new(client, INSURER))["institution_id"]
    await add(client, iid, "products", {"name": "Motor Comprehensive", "category": "motor", "product_type": "private_motor"})
    r = await client.post(f"{B}/{iid}/products", json={**SAVINGS})
    assert r.status_code == 422 and codes(r) == ["category_not_for_type"]
    await add(client, iid, "counterparties", {"name": "Global Re", "kind": "reinsurer", "importance": "critical", "places": ["CH"]})
    await add(client, iid, "regulators", {"name": "Insurance Regulatory Commission of Sri Lanka", "country": "LK",
                                          "area": "insurance", "relation": "home"})
    r = await client.patch(f"{B}/{iid}", json={"institution_type": "bank", "subtype": "commercial"})
    assert r.status_code == 422 and codes(r) == ["category_not_for_type"]  # its motor product doesn't suit a bank


async def test_flows_keep_their_source_honest(client):
    iid = (await new(client))["institution_id"]
    sug = (await client.get(f"{B}/{iid}/suggestions/flows")).json()
    lk = [s for s in sug["items"] if s["item"]["local"] == "LK"]
    assert lk and not any(s["item"]["local"] == "IN-KL" for s in sug["items"])  # Kerala isn't in the footprint
    sa = next(s["item"] for s in lk if s["item"]["counterpart"] == "SA")
    assert sa["source"]["kind"] == "dataset" and sa["source"]["sample"] is True and sa["status"] == "suggested"
    f = await add(client, iid, "flows", sa)
    fid = f["item"]["id"]
    assert fid == "remittances_in-lk-sa".replace("_", "-") or fid.startswith("remittances")
    r = await client.patch(f"{B}/{iid}/flows/{fid}", json={"value": {"amount": 1_500_000_000, "currency": "USD", "year": 2024}},
                           headers={"X-Amiri-Actor": "dilan@serendib.lk"})
    item = r.json()["item"]
    assert item["source"]["kind"] == "user" and item["source"]["original_amount"] == 1_200_000_000
    assert item["source"]["edited_by"] == "dilan@serendib.lk" and item["status"] == "confirmed"
    assert item["source"]["dataset"].startswith("Central Bank of Sri Lanka")
    r = await client.patch(f"{B}/{iid}/flows/{fid}", json={"value": {"amount": 1_200_000_000, "currency": "USD", "year": 2024}})
    assert r.json()["item"]["source"]["kind"] == "dataset" and r.json()["item"]["source"]["original_amount"] is None
    assert (await client.get(f"{B}/{iid}/suggestions/flows")).json()["items"][0]["added"] in (True, False)
    assert next(s for s in (await client.get(f"{B}/{iid}/suggestions/flows")).json()["items"]
                if s["item"]["counterpart"] == "SA")["added"] is True
    r = await client.post(f"{B}/{iid}/flows", json={"kind": "exports", "local": "LK", "counterpart": "LK"})
    assert r.status_code == 422 and codes(r) == ["same_country"]
    w = await add(client, iid, "flows", {"kind": "remittances_in", "local": "IN-KL", "counterpart": "AE"})
    assert [x["code"] for x in w["warnings"]] == ["local_outside_footprint"]


async def test_risk_exposures_and_watch_places(client):
    iid = (await new(client))["institution_id"]
    wp = await add(client, iid, "watch-places", {"name": "Strait of Hormuz", "kind": "chokepoint", "lat": 26.55, "lon": 56.45})
    r = await client.post(f"{B}/{iid}/watch-places", json={"name": "Somewhere", "lat": 10})
    assert r.status_code == 422
    c = await add(client, iid, "risk-exposures", {"title": "Hormuz closure", "kind": "conflict", "months": [12, 1, 1],
                                            "touches": {"watch_places": [wp["item"]["id"]]}})
    assert c["item"]["months"] == [1, 12]
    r = await client.post(f"{B}/{iid}/risk-exposures", json={"title": "Bad", "kind": "climate", "months": [13]})
    assert r.status_code == 422
    r = await client.delete(f"{B}/{iid}/watch-places/{wp['item']['id']}")
    assert r.status_code == 409


# ---------------------------------------------------------------- batches


async def test_batch_is_all_or_nothing_and_dry_run_saves_nothing(client):
    iid = (await new(client))["institution_id"]
    ops = [{"op": "create", "section": "segments", "id": "mig", "data": MIGRANTS},
           {"op": "create", "section": "products", "data": {**SAVINGS, "segments": ["mig"]}},
           {"op": "create", "section": "products", "data": {"name": "Bad", "category": "life", "product_type": "term_life"}}]
    r = await client.post(f"{B}/{iid}:batch", json={"operations": ops})
    assert r.status_code == 422 and r.json()["errors"][0]["operation"] == 2
    assert (await client.get(f"{B}/{iid}")).json()["counts"]["segments"] == 0

    r = await client.post(f"{B}/{iid}:batch", json={"operations": ops[:2], "dry_run": True})
    out = r.json()
    assert r.status_code == 200 and out["dry_run"] is True and out["profile_version"] == 1
    assert [(c["section"], c["op"]) for c in out["changes"]] == [("segments", "create"), ("products", "create")]
    assert (await client.get(f"{B}/{iid}")).json()["counts"]["segments"] == 0

    r = await client.post(f"{B}/{iid}:batch", json={"operations": ops[:2], "if_profile_version": 1},
                          headers={"X-Amiri-Source": "assistant", "X-Amiri-Actor": "assistant for dilan@serendib.lk"})
    assert r.status_code == 200 and r.json()["profile_version"] == 2
    r = await client.post(f"{B}/{iid}:batch", json={"operations": ops[:1], "if_profile_version": 1})
    assert r.status_code == 409 and r.json()["current_profile_version"] == 2
    r = await client.post(f"{B}/{iid}:batch", json={"operations": ops[:1]}, headers={"X-Amiri-Source": "robot"})
    assert r.status_code == 400
    h = (await client.get(f"{B}/{iid}/history")).json()["items"]
    assert {(x["source"], x["section"]) for x in h[:2]} == {("assistant", "segments"), ("assistant", "products")}


async def test_section_limit(client, monkeypatch):
    from app.institutions import schemas, service

    monkeypatch.setitem(schemas.SECTION_LIMITS, "rivals", 2)
    monkeypatch.setitem(service.SECTION_LIMITS, "rivals", 2)
    iid = (await new(client))["institution_id"]
    await add(client, iid, "rivals", {"name": "A"})
    await add(client, iid, "rivals", {"name": "B"})
    r = await client.post(f"{B}/{iid}/rivals", json={"name": "C"})
    assert r.status_code == 409 and r.json()["code"] == "section_limit"


# ---------------------------------------------------------------- lifecycle and readiness


async def test_readiness_activate_archive_delete(client):
    iid = (await new(client))["institution_id"]
    rd = (await client.get(f"{B}/{iid}/readiness")).json()
    assert rd["ready"] is False and rd["missing_required"] == 2
    assert {c["id"] for c in rd["checks"] if c["level"] == "required" and not c["ok"]} == {"segments", "products"}
    r = await client.post(f"{B}/{iid}:activate")
    assert r.status_code == 409 and r.json()["code"] == "not_ready" and len(r.json()["missing"]) == 2
    sid = (await add(client, iid, "segments", MIGRANTS))["item"]["id"]
    await add(client, iid, "products", {**SAVINGS, "segments": [sid]})
    rd = (await client.get(f"{B}/{iid}/readiness")).json()
    assert rd["ready"] is True
    reg = next(c for c in rd["checks"] if c["id"] == "regulators")
    assert not reg["ok"] and "suggested by the rule table" in reg["message"]
    r = await client.post(f"{B}/{iid}:activate")
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["activated_at"]
    assert (await client.delete(f"{B}/{iid}")).status_code == 409
    assert (await client.post(f"{B}/{iid}:archive")).json()["status"] == "archived"
    r = await client.post(f"{B}/{iid}/rivals", json={"name": "A"})
    assert r.status_code == 409 and r.json()["code"] == "institution_archived"
    assert (await client.post(f"{B}/{iid}:restore")).json()["status"] == "active"
    other = (await new(client, INSURER))["institution_id"]
    assert (await client.delete(f"{B}/{other}")).status_code == 204
    assert (await client.get(f"{B}/{other}")).status_code == 404


# ---------------------------------------------------------------- suggestions


async def test_regulator_suggestions_follow_the_rule_table(client):
    iid = (await new(client))["institution_id"]
    await add(client, iid, "footprint", {"code": "IN-KL"})
    s = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    by = {x["item"]["short"]: x["item"] for x in s}
    assert by["CBSL"]["relation"] == "home" and by["RBI"]["relation"] == "host" and by["OFAC"]["relation"] == "reach"
    assert {"FATF", "Basel", "UN"} <= set(by) and "IRCSL" not in by and "IAIS" not in by and "IFSB" not in by
    assert all(x["reviewed"] is False for x in s)
    await add(client, iid, "regulators", by["CBSL"])
    s = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    assert next(x for x in s if x["item"]["short"] == "CBSL")["added"] is True

    ins = (await new(client, {**INSURER, "islamic": True, "subtype": "takaful"}))["institution_id"]
    by = {x["item"]["short"] for x in (await client.get(f"{B}/{ins}/suggestions/regulators")).json()["items"]}
    assert {"IRCSL", "IAIS", "IFSB", "FATF"} <= by and "CBSL" not in by and "Basel" not in by and "OFAC" not in by


async def test_product_and_segment_suggestions_by_type(client):
    bank = (await new(client))["institution_id"]
    ins = (await new(client, INSURER))["institution_id"]
    bp = (await client.get(f"{B}/{bank}/suggestions/products")).json()["items"]
    ip = (await client.get(f"{B}/{ins}/suggestions/products")).json()["items"]
    assert {x["item"]["category"] for x in bp}.isdisjoint({x["item"]["category"] for x in ip})
    assert any(x["item"]["category"] == "life" for x in ip) and any(x["item"]["category"] == "savings" for x in bp)
    pick = next(x["item"] for x in ip if x["item"]["product_type"] == "crop_index")
    await add(client, ins, "products", pick)
    assert next(x for x in (await client.get(f"{B}/{ins}/suggestions/products")).json()["items"]
                if x["item"]["product_type"] == "crop_index")["added"] is True
    seg = (await client.get(f"{B}/{ins}/suggestions/segments")).json()["items"]
    assert any(x["item"]["label"] == "Vehicle owners" for x in seg)
    await add(client, ins, "segments", seg[0]["item"])
    assert (await client.get(f"{B}/{ins}/suggestions/segments")).json()["items"][0]["added"] is True
    r = await client.get(f"{B}/{ins}/suggestions/counterparties")  # no suggestions for that section
    assert r.status_code == 422


# ---------------------------------------------------------------- whole-profile views


async def seed(client, iid="serendib-bank"):
    doc = json.loads((settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())
    r = await client.post(f"{B}:import", json={"institution": {**doc["institution"], "institution_id": iid},
                                               "sections": doc["sections"]})
    assert r.status_code == 201, r.text
    return r.json()


async def test_import_profile_context_and_round_trip(client):
    i = await seed(client)
    assert i["counts"] == {"footprint": 4, "watch-places": 6, "segments": 4, "products": 10, "flows": 5,
                           "regulators": 6, "rivals": 4, "counterparties": 1, "risk-exposures": 3}
    p = await client.get(f"{B}/serendib-bank/profile")
    prof = p.json()
    assert p.headers["ETag"] == f'"{prof["institution"]["profile_version"]}"'
    assert prof["place_names"]["IN-KL"] == "Kerala" and prof["place_names"]["city:jaffna"] == "Jaffna"
    assert prof["readiness"]["ready"] is True

    ctx = (await client.get(f"{B}/serendib-bank/context")).json()
    assert ctx["institution_type"] == "bank" and ctx["country"] == "LK" and ctx["currency"] == "LKR"
    assert ctx["corridors"][0] == "AE"  # the largest remittance flow first
    scope = ctx["radar_scope"]
    assert {"LK", "IN-KL", "SA", "AE", "US"} <= set(scope["places"])
    assert "chk:hormuz" in scope["places"] and scope["named_places"] == []
    assert {"fx", "remittance", "commodities", "competitor", "regulation"} <= set(scope["themes"])
    assert {"CBSL", "Coastal Remit", "OFAC"} <= set(scope["actors"])
    assert ctx["flows"][0]["value"]["sample"] is True

    # export and import as a copy (e.g. a sandbox institution)
    copy = {**prof["institution"]}
    body = {"institution": {k: copy[k] for k in ("name", "institution_type", "home_country", "base_currency", "time_zone",
                                                  "clearing_currencies", "summary")} | {"institution_id": "serendib-copy"},
            "sections": prof["sections"]}
    r = await client.post(f"{B}:import", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["counts"] == i["counts"]
    p2 = (await client.get(f"{B}/serendib-copy/profile")).json()
    assert [x["id"] for x in p2["sections"]["products"]] == [x["id"] for x in prof["sections"]["products"]]


async def test_import_is_all_or_nothing(client):
    doc = json.loads((settings.PROJECT / "app" / "seeds" / "serendib_bank.json").read_text())
    doc.pop("_about")
    doc["sections"]["products"][0].update(category="life", product_type="term_life")
    r = await client.post(f"{B}:import", json=doc)
    assert r.status_code == 422 and codes(r) == ["category_not_for_type"]
    assert (await client.get(B)).json() == []


async def test_history_pages_and_filters(client):
    await seed(client)
    h = (await client.get(f"{B}/serendib-bank/history", params={"limit": 10})).json()
    assert len(h["items"]) == 10 and h["next_before"]
    h2 = (await client.get(f"{B}/serendib-bank/history", params={"limit": 10, "before": h["next_before"]})).json()
    assert h2["items"][0]["change_id"] < h["items"][-1]["change_id"]
    await client.patch(f"{B}/serendib-bank/rivals/coastal-remit", json={"overlap": "medium"}, headers={"X-Amiri-Actor": "nadeesha@serendib.lk"})
    h3 = (await client.get(f"{B}/serendib-bank/history", params={"section": "rivals", "item_id": "coastal-remit"})).json()["items"]
    assert h3[0]["op"] == "update" and h3[0]["before"] == {"overlap": "high"} and h3[0]["after"] == {"overlap": "medium"}
    assert h3[0]["actor"] == "nadeesha@serendib.lk" and h3[0]["source"] == "form"


async def test_not_found(client):
    assert (await client.get(f"{B}/nope")).status_code == 404
    assert (await client.get(f"{B}/nope/profile")).status_code == 404
    assert (await client.post(f"{B}/nope/segments", json=MIGRANTS)).status_code == 404
    iid = (await new(client))["institution_id"]
    assert (await client.get(f"{B}/{iid}/segments/nope")).status_code == 404
    assert (await client.delete(f"{B}/{iid}/segments/nope")).status_code == 404
    assert (await client.get(f"{B}/{iid}/unknown-section")).status_code == 404


# ---------------------------------------------------------------- reference data


async def test_reference_endpoints(client):
    c = (await client.get("/api/v1/reference/countries", params={"q": "lanka"})).json()["items"]
    assert c == [{"code": "LK", "name": "Sri Lanka", "official_name": "Democratic Socialist Republic of Sri Lanka", "numeric": "144"}]
    rg = (await client.get("/api/v1/reference/countries/LK/regions")).json()["items"]
    assert {"code": "LK-11", "name": "Colombo", "type": "District", "parent": "LK-1"} in rg
    assert (await client.get("/api/v1/reference/countries/XX/regions")).status_code == 404
    tax = (await client.get("/api/v1/reference/product-taxonomy", params={"institution_type": "insurer"})).json()
    assert {x["institution"] for x in tax["items"]} == {"insurer"} and tax["spec_version"] == "1.0.0"
    dims = {d["dimension"]: d for d in (await client.get("/api/v1/reference/segment-dimensions")).json()["items"]}
    assert "remittance_linked" in dims["segment"]["values"]
    sch = (await client.get("/api/v1/reference/profile-schema")).json()
    assert set(sch["sections"]) == {"footprint", "watch-places", "segments", "products", "flows", "regulators",
                                    "rivals", "counterparties", "risk-exposures"}
    assert "Asia/Colombo" in (await client.get("/api/v1/reference/time-zones")).json()["items"]
    assert (await client.get("/api/v1/reference/institution-types")).json()["items"][1]["institution_type"] == "insurer"


# ---------------------------------------------------------------- relational storage, gazetteer, risk finder


async def test_rows_land_in_their_tables_and_the_database_enforces_links(client, sql):
    await seed(client)
    rows = await sql("SELECT product_id, segment_id FROM core.product_segments WHERE product_id = 'pawning' ORDER BY position")
    assert [r["segment_id"] for r in rows] == ["farmers", "migrant-families"]
    ex = await sql("SELECT route_id FROM core.exposure_routes WHERE exposure_id = 'red-sea'")
    assert ex == [{"route_id": "colombo-suez-europe"}]
    reg = await sql("SELECT r.name, x.reviewed FROM core.regulators r JOIN ref.regulators x USING (regulator_id) "
                    "WHERE r.item_id = 'central-bank-of-sri-lanka'")
    assert reg == [{"name": "Central Bank of Sri Lanka", "reviewed": False}]
    import psycopg

    url = settings.raw("TEST_DATABASE_URL")
    async with await psycopg.AsyncConnection.connect(url, autocommit=True) as c:
        for bad in [
            "INSERT INTO core.product_segments (institution_id, product_id, segment_id) VALUES ('serendib-bank', 'pawning', 'nobody')",
            "DELETE FROM core.segments WHERE institution_id = 'serendib-bank' AND segment_id = 'farmers'",
            "UPDATE core.institutions SET institution_type = 'insurer', subtype = NULL WHERE institution_id = 'serendib-bank'",
            "INSERT INTO core.footprint (institution_id, footprint_id, place_code, role, scope, created_at, updated_at) "
            "VALUES ('serendib-bank', 'xx', 'XX-99', 'branches', 'all', now(), now())",
        ]:
            try:
                await c.execute(bad)
                raise AssertionError(f"the database accepted: {bad}")
            except psycopg.errors.IntegrityError:
                pass


async def test_gazetteer_places_and_iso_only_footprint(client):
    iid = (await new(client))["institution_id"]
    r = await client.post(f"{B}/{iid}/footprint", json={"code": "city:colombo"})
    assert r.status_code == 422
    seg = await add(client, iid, "segments", {"label": "Jaffna families", "places": ["CITY:Jaffna", "LK-41"]})
    assert seg["item"]["places"] == ["city:jaffna", "LK-41"]
    wp = await add(client, iid, "watch-places", {"name": "Hormuz", "code": "chk:hormuz", "kind": "chokepoint"})
    assert wp["item"]["code"] == "chk:hormuz"
    r = await client.post(f"{B}/{iid}/watch-places", json={"name": "Atlantis", "code": "chk:atlantis"})
    assert r.status_code == 422
    prof = (await client.get(f"{B}/{iid}/profile")).json()
    assert prof["places"]["city:jaffna"]["lat"] == 9.66 and prof["places"]["chk:hormuz"]["kind"] == "chokepoint"


async def test_reference_places_routes_hazards(client):
    hits = (await client.get("/api/v1/reference/places", params={"q": "cochin"})).json()["items"]
    assert {h["code"] for h in hits} >= {"city:kochi", "port:kochi"}
    p = (await client.get("/api/v1/reference/places/LK-11")).json()
    assert p["name"] == "Colombo" and p["parent"] == "LK-1" and p["lat"] == 6.87
    assert (await client.get("/api/v1/reference/places/nowhere")).status_code == 404
    chk = (await client.get("/api/v1/reference/places", params={"kind": "chokepoint"})).json()["items"]
    assert "chk:hormuz" in {c["code"] for c in chk}
    routes = (await client.get("/api/v1/reference/routes")).json()["items"]
    red = next(r for r in routes if r["route_id"] == "colombo-suez-europe")
    assert [p["code"] for p in red["places"]][2] == "chk:bab-el-mandeb" and len(red["points"]) > 5
    hz = (await client.get("/api/v1/reference/hazards")).json()["items"]
    assert any(h["hazard_id"] == "red-sea-attacks" for h in hz)


async def test_regulator_from_the_rule_table_by_id(client):
    iid = (await new(client))["institution_id"]
    r = await add(client, iid, "regulators", {"regulator_id": "sanctions-ofac", "relation": "reach"})
    item = r["item"]
    assert item["name"] == "US Treasury sanctions (OFAC)" and item["basis"] == "rule" and item["area"] == "sanctions"
    r = await client.post(f"{B}/{iid}/regulators", json={"regulator_id": "zz-nobody"})
    assert r.status_code == 422
    s = (await client.get(f"{B}/{iid}/suggestions/regulators")).json()["items"]
    ofac = next(x for x in s if x["item"]["regulator_id"] == "sanctions-ofac")
    assert ofac["added"] is True and ofac["why"] == "you clear payments in USD"


async def test_risk_finder(client):
    await seed(client)
    found = {x["hazard"]["hazard_id"]: x for x in (await client.get(f"{B}/serendib-bank/suggestions/risk-exposures")).json()["items"]}
    # already in the profile
    assert found["gulf-security"]["added"] is True and found["gulf-security"]["existing_id"] == "gulf"
    # Kerala floods: Kerala is in the footprint; migrant families live there; a remittance flow lands there
    kl = found["in-kl-monsoon-floods"]
    assert kl["added"] is False and kl["matched"]["footprint"] == ["IN-KL"]
    assert "migrant-families" in kl["item"]["touches"]["segments"] and "remit-kl-ae" in kl["item"]["touches"]["flows"]
    assert {"migrant-savings", "inward-remittances"} <= set(kl["item"]["touches"]["products"])
    assert kl["item"]["title"] == "Kerala monsoon floods meets remittances"
    # Hormuz: no place of ours is there, but the crude-oil imports take the Hormuz route
    hz = found["hormuz-disruption"]
    assert hz["item"]["touches"]["flows"] == ["crude-ae"] and hz["item"]["touches"]["routes"] == ["colombo-hormuz-gulf"]
    # nothing of ours near the Philippines
    assert "ph-typhoons" not in found
    r = await add(client, "serendib-bank", "risk-exposures", kl["item"])
    eid = r["item"]["id"]
    assert r["item"]["months"] == [6, 7, 8, 9] and r["item"]["source"] == "finder"
    await client.patch(f"{B}/serendib-bank/risk-exposures/{eid}", json={"status": "dismissed"})
    again = {x["hazard"]["hazard_id"]: x for x in (await client.get(f"{B}/serendib-bank/suggestions/risk-exposures")).json()["items"]}
    assert again["in-kl-monsoon-floods"]["added"] is True and again["in-kl-monsoon-floods"]["status"] == "dismissed"
    ctx = (await client.get(f"{B}/serendib-bank/context")).json()
    assert "in-kl-monsoon-floods" not in {x["hazard_id"] for x in ctx["risk_exposures"]}
    r = await client.post(f"{B}/serendib-bank/risk-exposures", json={"hazard_id": "in-kl-monsoon-floods", "title": "Again"})
    assert r.status_code == 409 and r.json()["code"] == "duplicate"  # one exposure per hazard


async def test_delete_a_full_institution_in_setup(client, sql):
    await seed(client)  # imported: still in setup, with links between items
    r = await client.delete(f"{B}/serendib-bank")
    assert r.status_code == 204
    assert (await sql("SELECT count(*) AS n FROM core.exposure_watch_places"))[0]["n"] == 0
    # deleting an item that is in use is still refused
    await seed(client)
    r = await client.delete(f"{B}/serendib-bank/segments/farmers")
    assert r.status_code == 409 and r.json()["code"] == "in_use"


async def test_japac_institutions_get_their_own_suggestions(client):
    """Regulators, flows and risks for a Philippine bank and an Indonesian insurer (reference data, 13 Oct)."""
    ph = (await new(client, {**BANK, "name": "Bayanihan Savings Bank", "subtype": "savings", "home_country": "PH",
                             "base_currency": "PHP", "time_zone": "Asia/Manila"}))["institution_id"]
    regs = {x["item"]["short"]: x["item"] for x in (await client.get(f"{B}/{ph}/suggestions/regulators")).json()["items"]}
    assert regs["BSP"]["relation"] == "home" and {"AMLC", "PDIC", "OFAC", "FATF"} <= set(regs) and "IC" not in regs
    flows = [x["item"] for x in (await client.get(f"{B}/{ph}/suggestions/flows")).json()["items"]]
    assert {f["counterpart"] for f in flows if f["kind"] == "remittances_in"} >= {"US", "SA", "AE", "SG", "JP"}
    assert all(f["figure_id"] and f["source"]["sample"] for f in flows)
    await add(client, ph, "footprint", {"code": "PH-00"})
    risks = {x["item"]["hazard_id"] for x in (await client.get(f"{B}/{ph}/suggestions/risk-exposures")).json()["items"]}
    assert {"ph-typhoons", "ph-metro-manila-floods"} <= risks

    idn = (await new(client, {**INSURER, "name": "Nusantara Proteksi", "subtype": "general", "home_country": "ID",
                              "base_currency": "IDR", "time_zone": "Asia/Jakarta"}))["institution_id"]
    regs = {x["item"]["short"] for x in (await client.get(f"{B}/{idn}/suggestions/regulators")).json()["items"]}
    assert {"OJK", "PPATK", "IAIS"} <= regs and "BI" not in regs and "LPS" not in regs and "Basel" not in regs


async def test_the_prototype_covers_japac_for_the_home_country_and_currency(client, env):
    env.setenv("SUPPORTED_REGION", "japac")
    r = await client.post("/api/v1/institutions", json={**BANK, "home_country": "GB", "base_currency": "GBP",
                                                        "time_zone": "Europe/London"})
    assert r.status_code == 422 and {e["field"] for e in r.json()["errors"] if e["code"] == "outside_region"} == \
        {"home_country", "base_currency"}
    homes = (await client.get("/api/v1/reference/countries", params={"scope": "home"})).json()
    assert homes["region"]["id"] == "japac" and "LK" in {c["code"] for c in homes["items"]}
    assert "GB" not in {c["code"] for c in homes["items"]}
    everywhere = (await client.get("/api/v1/reference/countries")).json()  # counterparts can be anywhere
    assert "GB" in {c["code"] for c in everywhere["items"]} and everywhere["region"] is None
    assert (await client.post("/api/v1/institutions", json=BANK)).status_code == 201  # Sri Lanka is in


async def test_a_rule_table_entry_by_id(client):
    r = (await client.get("/api/v1/reference/regulators/lk-cbsl")).json()
    assert r["name"] == "Central Bank of Sri Lanka" and r["short"] == "CBSL" and r["area"] == "banking"
    assert r["basis"] == "rule" and r["rule_ref"] == "lk-cbsl" and r["country"] == "LK" and r["controls"]
    fatf = (await client.get("/api/v1/reference/regulators/global-fatf")).json()
    assert fatf["relation"] == "standard" and fatf["country"] is None
    assert (await client.get("/api/v1/reference/regulators/nope")).status_code == 404
