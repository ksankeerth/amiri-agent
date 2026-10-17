"""The Overview page's one call: what is happening to the institution,
what needs the person, and whether Amiri Agent is working. Reads only; code, no model. Live world only."""

import asyncio
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Request

from app import reference, settings
from app.investigation.tone import tone
from app.problems import Problem
from app.text import plain_error, plural

router = APIRouter(prefix="/api/v1", tags=["overview"])
TICK_LATE_MINUTES = 35  # two missed 15-minute ticks
MAX_ATTENTION = 8
LEVEL = {"crit": 0, "warn": 1, "info": 2}


def _when(t, tz: str = "UTC") -> str:
    """A time in the institution's own time zone, as the page shows every other time."""
    from zoneinfo import ZoneInfo

    return t.astimezone(ZoneInfo(tz)).strftime("%d %b %H:%M") if t else "never"


async def build(app, institution_id: str, audience: str = "user") -> dict:
    s = app.state
    now = s.series.clock.now()
    try:
        inst = await s.institutions.get(institution_id)
    except Problem:
        inst = None
    first_run = inst is None or inst["status"] != "active"
    readiness = await s.institutions.readiness_for(institution_id) if inst else None
    ctx = await s.institutions.context(institution_id) if inst else None
    products = {p["id"]: p["name"] for p in (ctx or {}).get("products", [])}

    async with s.pool.connection() as conn:
        cur = await conn.execute(
            """SELECT e.event_id, e.title, e.themes, e.places, e.anchor, e.finding_ids, e.created_at,
                      (SELECT count(*) FROM cases.event_developments d WHERE d.event_id = e.event_id) AS developments,
                      greatest((SELECT max(f.created_at) FROM signals.findings f WHERE f.finding_id = ANY(e.finding_ids)),
                               (SELECT max(d.joined_at) FROM cases.event_developments d WHERE d.event_id = e.event_id))
                        AS last_finding_at
               FROM cases.events e WHERE e.world = 'live' AND e.status = 'open' AND e.institution_id = %s
               ORDER BY last_finding_at DESC NULLS LAST, e.anchor DESC LIMIT 12""", (institution_id,))
        events = []
        for e in await cur.fetchall():
            hc = await conn.execute("SELECT product_id, chain_label, expected FROM cases.hypotheses WHERE event_id = %s "
                                    "ORDER BY hypothesis_id", (e["event_id"],))
            hyps = await hc.fetchall()
            events.append({
                "event_id": e["event_id"], "title": e["title"], "themes": e["themes"], "places": e["places"],
                "anchor": e["anchor"], "tone": tone(hyps), "effects": len(hyps), "developments": e["developments"],
                "last_finding_at": e["last_finding_at"] or e["created_at"],
                "top_effects": [{"product": products.get(h["product_id"], h["product_id"]), "label": h["chain_label"],
                                 "metric": (h["expected"] or {}).get("metric"),
                                 "direction": (h["expected"] or {}).get("direction")} for h in hyps[:3]]})
        cur = await conn.execute(
            """SELECT count(*) AS n FROM cases.hypotheses h JOIN cases.events e USING (event_id)
               WHERE e.world = 'live' AND e.status = 'open' AND e.institution_id = %s""", (institution_id,))
        effects = (await cur.fetchone())["n"]
        cur = await conn.execute(
            """SELECT source, count(*) AS n FROM signals.findings WHERE world = 'live' AND institution_id = %s
               AND created_at > %s GROUP BY source""", (institution_id, now - timedelta(hours=24)))
        f24 = {r["source"]: r["n"] for r in await cur.fetchall()}
        cur = await conn.execute(
            """SELECT finding_id, source, title, created_at, status, outcome FROM signals.findings
               WHERE world = 'live' AND institution_id = %s ORDER BY created_at DESC LIMIT 6""", (institution_id,))
        findings = [{**{k: f[k] for k in ("finding_id", "source", "title", "created_at", "status")},
                     "event_id": (f["outcome"] or {}).get("event_id"),
                     "reason": (f["outcome"] or {}).get("reason")} for f in await cur.fetchall()]
        cur = await conn.execute("SELECT started_at, duration_ms FROM signals.ticks ORDER BY started_at DESC LIMIT 1")
        tick = await cur.fetchone()

    monitors = await s.monitors.all(institution_id, None) if inst else []
    inv = await s.investigations.status()
    series = await s.series.list_all()
    proposals = await s.assistant.list_proposals(None, institution_id, "pending") if inst else []
    try:
        assistant = (await asyncio.wait_for(s.assistant.status(), 2.0))["connected"]
    except (TimeoutError, Exception):  # a down agent must not slow or break the page
        assistant = False
    studio = await s.studio.current()
    radar = await s.radar.status()
    al = await s.alerts.summary() if inst else {"to_review": 0, "by_level": {}}
    radar_stories = (await s.radar.stories(None, None, None, 3)) if inst else []

    live = [m for m in monitors if m["status"] == "live"]
    waiting = [m for m in monitors if m["status"] == "submitted" or (m["pending"] or {}).get("status") == "submitted"]
    late = tick is None or now - tick["started_at"] > timedelta(minutes=TICK_LATE_MINUTES)

    # "Needs you"
    att: list[dict] = []
    tz = (inst or {}).get("time_zone") or "UTC"

    def need(kind, level, title, detail=None, link=None, at=None, audience="user"):
        # audience "admin": about Amiri Agent's own plumbing, for the Platform Admin (the web app hides it from Risk Managers)
        att.append({"kind": kind, "level": level, "title": title, "detail": detail, "link": link, "at": at,
                    "audience": audience})

    if al["to_review"]:
        warn = al["by_level"].get("warning", 0) + al["by_level"].get("adverse", 0) + al["by_level"].get("developing", 0)
        need("alerts", "warn" if warn else "info", f"{plural(al['to_review'], 'alert')} to review",
             f"{plural(warn, 'early warning')} for your products' risk",
             link="/alerts")
    if not first_run and late:
        need("tick", "crit", f"Amiri Agent hasn't refreshed since {_when(tick['started_at'], tz) if tick else 'it started'}",
             "Prices, monitor checks and investigations are behind until the scheduler runs again.", audience="admin")
    if inv["findings_waiting"] and not inv["connected"]:
        need("investigation", "warn", f"{plural(inv['findings_waiting'], 'finding')} can't be investigated yet: the investigation agent isn't connected",
             link="/events", audience="admin")
    if not radar["connected"]:
        need("radar_agent", "warn", "Radar isn't connected, so the news isn't being scanned",
             "Ask the Platform Admin to connect the Radar agent.", link="/radar", audience="admin")
    elif (radar["last_run"] or {}).get("status") == "failed":
        need("radar_failed", "warn", "Radar's last run failed", plain_error(radar["last_run"]["error"]), link="/radar")
    if radar["budget_spent"]:
        need("radar_budget", "info", "Radar has used today's news-reading budget; it runs again after midnight UTC", link="/radar",
             audience="admin")
    if live and not s.monitors.client.connected():
        need("monitor_agent", "warn", "Monitors aren't being checked: the monitor agent isn't connected", link="/monitors",
             audience="admin")
    failed = [m for m in live if (m["last_check"] or {}).get("status") == "error"]
    why: dict[str, str] = {}
    if failed:
        async with s.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT DISTINCT ON (monitor_id) monitor_id, error FROM signals.monitor_runs
                   WHERE monitor_id = ANY(%s) AND status = 'failed' ORDER BY monitor_id, created_at DESC""",
                ([m["monitor_id"] for m in failed],))
            why = {r["monitor_id"]: r["error"] for r in await cur.fetchall()}
    for m in failed:
        need("monitor_failed", "warn", f"{m['name']}: the last check couldn't read the news",
             plain_error(why.get(m["monitor_id"])) + " Amiri Agent will try again within the hour; nothing is lost.",
             link=f"/monitors/{m['monitor_id']}", at=m["last_check"]["at"])
    for x in series:
        if x["state"] == "stale" or x["fetch"].get("last_status") == "error":
            need("series", "warn", f"{x['name']}: {x['state_reason'] or 'prices are not updating'}",
                 link=f"/series/{x['series_id']}")
    if readiness:
        missing = [c for c in readiness["checks"] if c["level"] == "required" and not c["ok"]]
        if missing:
            need("profile", "warn", "The profile is missing: " + "; ".join(c["message"] for c in missing[:3]),
                 link="/institution")
    if waiting:
        need("approval", "info", f"{plural(len(waiting), 'monitor')} {'waits' if len(waiting) == 1 else 'wait'} for approval", ", ".join(m["name"] for m in waiting[:3]),
             link="/monitors")
    if proposals:
        need("proposal", "info", f"{plural(len(proposals), 'change')} proposed in the setup chat {'waits' if len(proposals) == 1 else 'wait'} for you",
             proposals[0]["summary"], link="/institution")
    if inv["findings_waiting"] and inv["connected"]:
        need("batch", "info", f"{plural(inv['findings_waiting'], 'finding')} {'goes' if inv['findings_waiting'] == 1 else 'go'} to the investigation"
             + (f" at {_when(inv['next_batch_at'], tz)}" if inv["next_batch_at"] else ""), link="/events")
    for m in monitors:
        if m["review_due"] and m["status"] in ("live", "paused"):
            need("review", "info", f"{m['name']} is due for review", link=f"/monitors/{m['monitor_id']}")
    if readiness:
        rec = [c for c in readiness["checks"] if c["level"] == "recommended" and not c["ok"]]
        if rec:
            need("recommended", "info", f"{plural(len(rec), 'recommendation')} for the profile",
                 " · ".join((c["fix"] or c["message"]).rstrip(".") for c in rec[:3]), link="/institution")
    admin_notes = sum(1 for a in att if a["audience"] == "admin")
    if audience != "all":  # a Risk Manager sees what they can act on; Amiri Agent's own plumbing is the Platform Admin's
        att = [a for a in att if a["audience"] == "user"]
    att.sort(key=lambda a: LEVEL[a["level"]])

    places = sorted({p for e in events for p in e["places"]})
    return {
        "as_of": now,
        "institution": ({k: inst[k] for k in ("institution_id", "name", "institution_type", "home_country",
                                              "base_currency", "time_zone", "status")} | {
            "readiness": {k: readiness[k] for k in ("ready", "missing_required", "open_recommendations")}}) if inst else None,
        "first_run": first_run,
        "counts": {"open_events": len(events), "effects_to_watch": effects,
                   "findings_24h": {"timeseries": f24.get("timeseries", 0), "monitor": f24.get("monitor", 0),
                                    "radar": f24.get("radar", 0)},
                   "monitors_live": len(live), "monitors_waiting_approval": len(waiting),
                   "series_watched": sum(1 for x in series if x["enabled"]), "alerts_to_review": al["to_review"]},
        "attention": att[:MAX_ATTENTION], "attention_more": max(0, len(att) - MAX_ATTENTION),
        "admin_notes": admin_notes if audience != "all" else 0,
        "events": events, "findings": findings,
        "markets": [{"series_id": x["series_id"], "name": x["name"], "state": x["state"], "state_reason": x["state_reason"],
                     "close": (x["latest"] or {}).get("close"), "change_1d_pct": (x["latest"] or {}).get("change_1d_pct"),
                     "spark": [p["close"] for p in x["spark"]]} for x in series if x["enabled"]],
        "services": {"investigation": {"connected": inv["connected"]},
                     "monitor": {"connected": s.monitors.client.connected(), "live": len(live)},
                     "assistant": {"connected": assistant},
                     "radar": {"connected": radar["connected"]},
                     "tick": {"last_at": tick["started_at"] if tick else None,
                              "minutes_ago": int((now - tick["started_at"]).total_seconds() // 60) if tick else None,
                              "ok": not late}},
        "radar": {"stories": [{k: r[k] for k in ("story_id", "title", "places", "score", "relevance", "publishers", "status",
                                               "last_seen_at", "event_id", "why")} for r in radar_stories],
                  "last_run_at": (radar["last_run"] or {}).get("finished_at"), "next_run_at": radar["next_run_at"],
                  "every_minutes": radar["every_minutes"], "run_at": radar["run_at"], "run_now_limit": radar["run_now"]["limit"]},
        "studio": {k: studio[k] for k in ("sim_id", "title", "step", "steps", "status")} if studio else None,
        "map": {"places": {c: reference.place_info(c) for c in places if reference.is_place(c)}},
    }


@router.get("/overview", summary="The Overview page: events, what needs you, markets, and Amiri Agent's own state")
async def overview(request: Request, institution_id: str | None = None,
                   audience: Literal["user", "all"] = "user"):
    """`audience=all` also lists Amiri Agent's own plumbing notes (the Platform Admin's); the default is what a Risk Manager can act on."""
    return await build(request.app, institution_id or settings.raw("INSTITUTION_ID"), audience)
