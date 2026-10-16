"""What the server tells the investigation agent about places, the footprint and a monitor's exposures (code only)."""

from app.institutions.rules import Item, State
from app.investigation import request as build


def ctx(footprint):
    return {"country": "LK", "footprint": [{"code": c, "role": r} for c, r in footprint]}


def test_footprint_keeps_the_role_and_the_regions():
    out = build.footprint(ctx([("LK", "home"), ("IN-TN", "branches"), ("IN-KL", "branches"),
                               ("AE", "representative_office")]))
    assert {"country": "IN", "currency": "INR", "role": "branches", "regions": ["IN-TN", "IN-KL"]} in out
    # a representative office is sent as such: the agent treats the country as abroad
    assert {"country": "AE", "currency": "AED", "role": "representative_office", "regions": []} in out


def test_a_booking_role_wins_over_a_representative_office_and_a_country_code_means_all_of_it():
    out = build.footprint(ctx([("AE-DU", "representative_office"), ("AE", "subsidiary")]))
    assert out == [{"country": "AE", "currency": "AED", "role": "subsidiary", "regions": []}]


def test_a_chokepoint_has_no_country_but_the_lanes_through_it_reach_ports():
    hormuz = build.place_info("chk:hormuz")
    assert hormuz["country"] is None
    assert hormuz["lane_countries"] == ["AE", "LK"] and hormuz["lanes"] == ["Colombo – Hormuz – Gulf"]  # noqa: RUF001
    assert "LK" in build.place_info("chk:bab-el-mandeb")["lane_countries"]  # Colombo – Suez – Europe  # noqa: RUF003
    assert build.place_info("IN-TN")["country"] == "IN"  # an ISO region is unchanged


def state() -> State:
    s = State(inst={"fields": {"institution_type": "bank"}})
    s.section("products")["import-lcs"] = Item({"name": "Import letters of credit"})
    s.section("segments")["sme-importers"] = Item({"label": "SME importers"})
    s.section("flows")["import-crude-ae"] = Item({"kind": "imports", "local": "LK", "counterpart": "AE"})
    s.section("risk-exposures")["hormuz"] = Item({"status": "active"})
    s.section("risk-exposures")["old"] = Item({"status": "retired"})
    return s


def test_exposure_keeps_only_what_the_profile_has():
    spec = {"private": {"exposure": [
        {"id": "flow:import-crude-ae", "how_it_reaches_us": "Crude passes Hormuz; a stop raises the import bill."},
        {"id": "product:import-lcs", "how_it_reaches_us": "Fuel letters of credit grow or stall."},
        {"id": "segment:sme-importers"},
        {"id": "risk:hormuz", "how_it_reaches_us": "The risk this monitor was built from."},
        {"id": "risk:old", "how_it_reaches_us": "retired"},
        {"id": "product:made-up", "how_it_reaches_us": "not in the profile"},
        {"id": "nonsense"},
    ]}}
    e = build.exposure(spec, state())
    assert e == {"products": ["import-lcs"], "segments": ["sme-importers"],
                 "flows": [{"kind": "imports", "counterpart": "AE"}], "risks": ["hormuz"],
                 "notes": ["Crude passes Hormuz; a stop raises the import bill.", "Fuel letters of credit grow or stall.",
                           "The risk this monitor was built from."]}


def test_no_exposure_when_nothing_named_is_in_the_profile():
    assert build.exposure({"private": {"exposure": [{"id": "product:made-up"}]}}, state()) is None
    assert build.exposure({}, state()) is None
