"""The monitor agent's check request (agents/event-monitor-agent/openapi.yaml, contract 2.0),
built by code from the monitor's version and the profile."""

from datetime import datetime

from app import reference, settings
from app.institutions.rules import State


def institution(state: State) -> dict:
    f, S = state.inst["fields"], state.section
    return {
        "name": f["name"], "institution_type": f["institution_type"], "country": f["home_country"],
        "country_name": reference.place_name(f["home_country"]), "currency": f["base_currency"],
        "time_zone": f["time_zone"], "summary": f.get("summary") or "",
        "segments": [{"id": k, "label": it.data["label"], "note": it.data.get("note")} for k, it in S("segments").items()],
        "products": [{"id": k, "name": it.data["name"], "category": it.data["category"],
                      "product_type": it.data["product_type"]} for k, it in S("products").items()
                     if it.data["status"] != "closed"],
        "flows": [{"id": k, "kind": it.data["kind"], "local": it.data["local"], "counterpart": it.data["counterpart"]}
                  for k, it in S("flows").items()],
        "corridors": list(dict.fromkeys(it.data["counterpart"] for it in S("flows").values()
                                        if it.data["kind"] == "remittances_in")),
        "rivals": [{"id": k, "name": it.data["name"], "aliases": list(it.data.get("aliases") or [])}
                   for k, it in S("rivals").items()],
        "regulators": [{"id": k, "name": it.data["name"], "aliases": [a for a in [it.data.get("short")] if a]}
                       for k, it in S("regulators").items()],
        "counterparties": [{"id": k, "name": it.data["name"], "aliases": list(it.data.get("aliases") or [])}
                           for k, it in S("counterparties").items()],
        "risks": [{"id": k, "name": it.data["title"], "aliases": []} for k, it in S("risk-exposures").items()
                  if it.data["status"] == "active"],
    }


def build(run_id: str, monitor_id: str, version: int, spec: dict, state: State, since: datetime, until: datetime,
          recent_urls: list[str]) -> dict:
    return {
        "run_id": run_id,
        "monitor": {"monitor_id": monitor_id, "version": version, "spec": spec},
        "institution": institution(state),
        "window": {"since": since.isoformat(), "until": until.isoformat()},
        "web_search": {"max_queries": settings.integer("MONITOR_WEB_QUERIES_PER_CHECK")},
        "recent_urls": recent_urls,
    }
