"""The monitor that reads a written scenario's headlines: built from the institution's live monitors (code only)."""

from app.monitors.schemas import MonitorSpec
from app.studio import template

CTX = {"institution_id": "bank-x", "name": "A Bank", "country": "LK", "currency": "LKR", "time_zone": "Asia/Colombo",
       "products": [{"id": "fixed-deposits", "name": "Fixed deposits", "category": "savings"}], "segments": [],
       "regulators": [], "flows": []}


def spec(name: str, lines: list[str], watch: list[str], exposure: list[str], places: list[str]) -> dict:
    return {"about": {"name": name, "owner": "Treasury", "check_frequency": 1440, "kind": "events"},
            "public": {"watch": [{"name": w, "type": "topic"} for w in watch], "in_one_sentence": f"{name}, in one line.",
                       "tell_me_if": lines, "ignore": [f"{name} noise"], "places": places, "languages": ["en"]},
            "private": {"exposure": [{"id": e, "how_it_reaches_us": f"{e} reason"} for e in exposure]},
            "alert_level": 7}


HORMUZ = spec("Hormuz", ["Ships are attacked near Hormuz", "Brent moves 5% on Gulf news", "Cargo to Colombo is stranded"],
              ["Strait of Hormuz", "Iran"], ["flow:import-crude-ae", "product:import-lcs"], ["chk:hormuz", "IR"])
RUSSIA = spec("Russia", ["A Russian refinery is hit", "Russia changes its diesel ban"],
              ["Ryazan refinery", "Iran"], ["flow:export-ru-tea", "product:import-lcs"], ["RU"])


def build(ctx):
    return template.build("blank", ctx, "medium", [], {"headlines": [
        {"id": "c-1", "title": "Iran closes the Strait of Hormuz", "day": 1, "time": "09:00"}]})["monitor"]["spec"]


def test_a_written_scenario_is_read_the_way_the_live_monitors_read_real_news():
    m = build({**CTX, "live_monitors": [HORMUZ, RUSSIA]})
    MonitorSpec.model_validate(m)  # a valid monitor
    lines = m["public"]["tell_me_if"]
    # the home line first, then each monitor's lines in turn, so every monitor is represented
    assert lines[0].startswith("Something happens in or around Sri Lanka")
    assert lines[1:] == ["Ships are attacked near Hormuz", "A Russian refinery is hit", "Brent moves 5% on Gulf news",
                         "Russia changes its diesel ban", "Cargo to Colombo is stranded"]
    assert [w["name"] for w in m["public"]["watch"]] == ["Strait of Hormuz", "Ryazan refinery", "Iran"]
    assert m["public"]["places"] == ["LK", "chk:hormuz", "RU", "IR"]
    assert [e["id"] for e in m["private"]["exposure"]] == ["flow:import-crude-ae", "flow:export-ru-tea",
                                                           "product:import-lcs"]
    assert m["alert_level"] == 7


def test_the_merge_stays_within_one_monitor_s_limits():
    codes = ["IN", "AE", "SA", "KW", "QA", "OM", "BH", "IR", "IQ", "RU", "UA", "US", "GB", "DE", "FR", "CN", "JP",
             "SG", "MY", "TH", "ID", "PH", "VN", "BD", "PK", "NP", "MV", "EG", "TR", "IT"]
    many = [spec(f"M{i}", [f"line {i}-{j}" for j in range(5)], [f"w{i}-{j}" for j in range(4)],
                 [f"product:p{i}-{j}" for j in range(5)], codes[i * 3:i * 3 + 3]) for i in range(10)]
    m = build({**CTX, "live_monitors": many})
    MonitorSpec.model_validate(m)
    assert len(m["public"]["tell_me_if"]) == 8 and len(m["public"]["watch"]) == 12
    assert len(m["private"]["exposure"]) == 20 and len(m["public"]["places"]) == 20


def test_without_live_monitors_the_generic_monitor_names_no_exposures():
    m = build(CTX)
    assert m["about"]["name"] == "This scenario's news"
    assert m["public"]["tell_me_if"][0].startswith("Something happens in or around Sri Lanka")
    assert m["private"]["exposure"] == []  # exposures are a person's words; none are made up
