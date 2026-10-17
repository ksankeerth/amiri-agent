"""Alerts: what a live event means for one team's products.

`sync` is called, on the investigation's own connection, wherever an event is stored or grows
(a run's events, an extend run, a development, a Radar continuation); `resolve_events` where events
close. Code only: an event's hypotheses are grouped by the owning team of their product (the
profile's `products.owner`; a monitor's owner and `also_notify` when its finding is in the event;
unowned → Risk management). Alerts are about risk only: an alert is an **early warning** listing the
team's expected moves that are adverse for the metric (the Metrics Spec's adverse directions);
favourable and neutral effects raise none and stay on the event. A change to a known alert escalates
it (back to review).

Once validation checks an effect against the institution's own data, the effect carries its check and the
alert's level follows the checks: **adverse** when the data confirms an adverse move, **developing** when it
starts to show one, an early warning otherwise. A rise reopens the alert, even after the event closed
(verdicts come weeks later); a check that leaves the level as it is goes into the history only.
"""

import uuid
from datetime import datetime, timedelta

from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app import settings
from app.clock import Clock
from app.investigation.tone import adverse
from app.problems import Problem
from app.validation.explain import latest, metric_names

UNOWNED = "Risk management"
RANK = {"warning": 0, "developing": 1, "adverse": 2}
CHECKED = ("confirms", "contradicts", "no_effect")  # verdicts that rest on the data


def _check(c: dict | None) -> dict | None:
    """What an effect keeps of its latest check."""
    if not c:
        return None
    return {k: c[k] for k in ("verdict", "verdict_text", "final", "line", "what", "alert", "as_of")}


def _level(effects: list[dict]) -> str:
    alerts = {(x.get("check") or {}).get("alert") for x in effects}
    return "adverse" if "adverse" in alerts else "developing" if "developing" in alerts else "warning"


def _effect(h: dict, product: dict | None) -> dict | None:
    e = h["expected"] or {}
    metric, direction = e.get("metric"), e.get("direction")
    adv = adverse().get(metric)
    if not metric or not direction or adv is None:
        return None
    return {"hypothesis_id": h["hypothesis_id"], "product_id": h["product_id"],
            "product": (product or {}).get("name") or h["product_id"], "metric": metric,
            "metric_name": metric_names().get(metric, metric.replace("_", " ")), "direction": direction,
            "size": e.get("size"), "timing": e.get("timing"), "adverse": direction in adv,
            "chain_label": h["chain_label"], "statement": h["statement"]}


def _title(effects: list[dict]) -> str:
    e = effects[0]
    first = f"{e['product']}: {e['metric_name'].lower()} expected to {e['direction']}"
    others = {x["product"] for x in effects[1:]} - {e["product"]}
    return first + (f" (and {len(effects) - 1} more effect{'s' if len(effects) > 2 else ''}"
                    + (f" on {', '.join(sorted(others))}" if others else "") + ")" if len(effects) > 1 else "")


async def plan(conn, ev: dict) -> list[dict]:
    """The alerts an event calls for, one per owning team (nothing is written): code, no model. Used by `sync`, and by
    the Scenario Studio to show which alerts a what-if would raise."""
    cur = await conn.execute("SELECT * FROM cases.hypotheses WHERE event_id = %s ORDER BY hypothesis_id", (ev["event_id"],))
    hyps = await cur.fetchall()
    cur = await conn.execute("SELECT product_id, name, owner FROM core.products WHERE institution_id = %s",
                             (ev["institution_id"],))
    products = {p["product_id"]: p for p in await cur.fetchall()}
    cur = await conn.execute(
        """SELECT d.finding_id FROM cases.event_developments d WHERE d.event_id = %s""", (ev["event_id"],))
    findings = list(dict.fromkeys([*ev["finding_ids"], *(r["finding_id"] for r in await cur.fetchall())]))
    effects = [x for h in hyps if (x := _effect(h, products.get(h["product_id"]))) and x["adverse"]]
    if not effects:
        return []
    checks = {c["hypothesis_id"]: c["check"] for c in (await latest(conn, ev["event_id"])).values()}
    for x in effects:
        x["check"] = _check(checks.get(x["hypothesis_id"]))
    teams: dict[str, list[dict]] = {}
    for x in effects:
        teams.setdefault((products.get(x["product_id"]) or {}).get("owner") or UNOWNED, []).append(x)
    # a monitor whose finding is in the event: its owner and also_notify see the whole event
    cur = await conn.execute(
        """SELECT DISTINCT f.source_ref ->> 'monitor_id' AS monitor_id, v.spec -> 'about' AS about
           FROM signals.findings f JOIN core.monitors m ON m.monitor_id = f.source_ref ->> 'monitor_id'
           JOIN core.monitor_versions v ON v.monitor_id = m.monitor_id AND v.version = coalesce(m.live_version, m.latest_version)
           WHERE f.finding_id = ANY(%s) AND f.source = 'monitor'""", (findings,))
    via: dict[str, str] = {}
    for r in await cur.fetchall():
        for team in [r["about"].get("owner"), *(r["about"].get("also_notify") or [])]:
            if team and team not in teams:
                teams[team] = effects
                via[team] = r["monitor_id"]
    out = []
    for team, xs in teams.items():
        out.append({"owner": team, "level": _level(xs),
                    "title": _title(xs), "effects": xs, "product_ids": sorted({x["product_id"] for x in xs}),
                    "hypothesis_ids": sorted(x["hypothesis_id"] for x in xs), "finding_ids": findings,
                    "via_monitor": via.get(team)})
    return out


def _checks_changed(old: list[dict], new: list[dict]) -> list[dict]:
    """The effects whose check is new or different."""
    was = {x["hypothesis_id"]: (x.get("check") or {}) for x in old}
    return [x for x in new if x.get("check") and
            {k: x["check"][k] for k in ("verdict", "final", "alert")} !=
            {k: was.get(x["hypothesis_id"], {}).get(k) for k in ("verdict", "final", "alert")}]


async def sync(conn, event_id: str, now: datetime, why: str = "", checked: bool = False) -> int:
    """Raises or escalates the event's alerts; returns how many were raised or escalated. `checked`: called
    after validation, which also reaches a closed event's alerts."""
    cur = await conn.execute("SELECT * FROM cases.events WHERE event_id = %s", (event_id,))
    ev = await cur.fetchone()
    if not ev or ev["world"] != "live" or (ev["status"] != "open" and not checked):
        return 0
    changed = 0
    for a in await plan(conn, ev):
        team, xs, level, title = a["owner"], a["effects"], a["level"], a["title"]
        hyp_ids, findings = a["hypothesis_ids"], a["finding_ids"]
        cur = await conn.execute("SELECT * FROM core.alerts WHERE event_id = %s AND owner = %s FOR UPDATE", (event_id, team))
        old = await cur.fetchone()
        if not old and ev["status"] != "open" and level == "warning":
            continue
        if not old:
            await conn.execute(
                """INSERT INTO core.alerts (alert_id, institution_id, event_id, owner, level, title, effects, product_ids,
                     hypothesis_ids, finding_ids, via_monitor, status, history, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'new', %s, %s, %s)""",
                (f"al-{uuid.uuid4().hex[:10]}", ev["institution_id"], event_id, team, level, title, Jsonb(xs),
                 a["product_ids"], hyp_ids, findings, a["via_monitor"],
                 Jsonb([{"at": now.isoformat(), "change": "raised", "by": "Amiri Agent",
                         "text": f"From the event \u201c{ev['title']}\u201d."}]), now, now))
            changed += 1
            continue
        new_effects = [x for x in hyp_ids if x not in old["hypothesis_ids"]]
        new_findings = [f for f in findings if f not in old["finding_ids"]]
        moved = _checks_changed(old["effects"], xs)
        if not new_effects and not new_findings and old["level"] == level:
            if moved:  # checked, the level as it was: the history says so, the alert stays where it is
                await conn.execute(
                    "UPDATE core.alerts SET effects = %s, history = history || %s, updated_at = %s WHERE alert_id = %s",
                    (Jsonb(xs), Jsonb([{"at": now.isoformat(), "change": "checked", "by": "Amiri Agent",
                                        "text": "; ".join(x["check"]["line"] for x in moved)}]), now, old["alert_id"]))
            continue
        rose, fell = RANK[level] > RANK[old["level"]], RANK[level] < RANK[old["level"]]
        if rose or fell:
            await conn.execute(
                """UPDATE core.alerts SET level = %s, title = %s, effects = %s, product_ids = %s, hypothesis_ids = %s,
                     finding_ids = %s, status = CASE WHEN %s THEN 'new' ELSE status END, history = history || %s,
                     updated_at = %s WHERE alert_id = %s""",
                (level, title, Jsonb(xs), a["product_ids"], hyp_ids, findings, rose,
                 Jsonb([{"at": now.isoformat(), "by": "Amiri Agent",
                         "change": ("confirmed" if level == "adverse" else "escalated") if rose else "withdrawn",
                         "text": "; ".join(x["check"]["line"] for x in (moved or xs) if x.get("check"))
                                 or f"now {level}"}]), now, old["alert_id"]))
            changed += 1
            continue
        what = "; ".join(filter(None, [
            f"{len(new_effects)} more effect{'s' if len(new_effects) > 1 else ''}" if new_effects else "",
            f"{len(new_findings)} more finding{'s' if len(new_findings) > 1 else ''}" if new_findings else "",
            f"now {level.replace('_', ' ')}" if old["level"] != level else "", why]))
        await conn.execute(
            """UPDATE core.alerts SET level = %s, title = %s, effects = %s, product_ids = %s, hypothesis_ids = %s,
                 finding_ids = %s, status = CASE WHEN status = 'resolved' THEN status ELSE 'new' END,
                 history = history || %s, updated_at = %s WHERE alert_id = %s""",
            (level, title, Jsonb(xs), a["product_ids"], hyp_ids, findings,
             Jsonb([{"at": now.isoformat(), "change": "escalated", "by": "Amiri Agent", "text": what}]), now, old["alert_id"]))
        changed += 1
    return changed


async def resolve_events(conn, event_ids: list[str], now: datetime) -> None:
    if not event_ids:
        return
    await conn.execute(
        """UPDATE core.alerts SET status = 'resolved', resolved_by = 'Amiri Agent', resolved_at = %s,
             resolved_note = 'The event closed: no new findings for its open period.', updated_at = %s,
             history = history || %s WHERE event_id = ANY(%s) AND status <> 'resolved'""",
        (now, now, Jsonb([{"at": now.isoformat(), "change": "resolved", "by": "Amiri Agent", "text": "The event closed."}]),
         event_ids))


class Alerts:
    def __init__(self, pool: AsyncConnectionPool, clock: Clock):
        self.pool, self.clock = pool, clock

    def _iid(self) -> str:
        return settings.raw("INSTITUTION_ID")

    async def all(self, status: str | None, owner: str | None, level: str | None, limit: int,
                  alert_id: str | None = None, event_id: str | None = None) -> list[dict]:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT a.*, e.title AS event_title, e.status AS event_status, e.anchor AS event_anchor, e.places,
                          (SELECT f.title FROM signals.findings f WHERE f.finding_id = ANY(a.finding_ids)
                           ORDER BY f.score DESC LIMIT 1) AS top_finding,
                          (SELECT array_agg(DISTINCT f.source) FROM signals.findings f WHERE f.finding_id = ANY(a.finding_ids))
                            AS sources
                   FROM core.alerts a JOIN cases.events e USING (event_id)
                   WHERE a.institution_id = %s AND (%s::text IS NULL OR a.alert_id = %s) AND (%s::text IS NULL OR a.status = %s)
                   AND (%s::text IS NULL OR a.owner = %s) AND (%s::text IS NULL OR a.level = %s)
                   AND (%s::text IS NULL OR a.event_id = %s)
                   ORDER BY a.updated_at DESC LIMIT %s""",
                (self._iid(), alert_id, alert_id, status, status, owner, owner, level, level, event_id, event_id, limit))
            rows = await cur.fetchall()
        for r in rows:  # what the alert rests on: the investigation's expectations, or the data too
            verdicts = [x["check"]["verdict"] for x in r["effects"] if x.get("check")]
            r["checked"] = {v: verdicts.count(v) for v in dict.fromkeys(verdicts)}
            r["basis"] = "data" if any(v in CHECKED for v in verdicts) else "expected"
        return rows

    async def get(self, alert_id: str) -> dict:
        rows = await self.all(None, None, None, 1, alert_id)
        if not rows:
            raise Problem(404, "not_found", f"No alert {alert_id}.")
        return rows[0]

    async def summary(self) -> dict:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                """SELECT status, level, owner, count(*) AS n FROM core.alerts WHERE institution_id = %s
                   GROUP BY status, level, owner""", (self._iid(),))
            rows = await cur.fetchall()
            cur = await conn.execute(
                """SELECT count(*) AS n FROM core.alerts WHERE institution_id = %s AND status = 'acknowledged'
                   AND acknowledged_at > %s""", (self._iid(), self.clock.now() - timedelta(days=7)))
            week = (await cur.fetchone())["n"]
        new = [r for r in rows if r["status"] == "new"]
        teams: dict[str, int] = {}
        for r in new:
            teams[r["owner"]] = teams.get(r["owner"], 0) + r["n"]
        return {"to_review": sum(r["n"] for r in new),
                "by_level": {lv: sum(r["n"] for r in new if r["level"] == lv) for lv in ("warning", "developing", "adverse")},
                "acknowledged_week": week,
                "teams": [{"owner": k, "to_review": v} for k, v in sorted(teams.items(), key=lambda x: -x[1])],
                "all_teams": sorted({r["owner"] for r in rows})}

    async def act(self, alert_id: str, action: str, actor: str, note: str | None) -> dict:
        now = self.clock.now()
        sets = {"ack": ("acknowledged", "acknowledged_by = %s, acknowledged_at = %s, ack_note = %s"),
                "resolve": ("resolved", "resolved_by = %s, resolved_at = %s, resolved_note = %s"),
                "reopen": ("new", "resolved_by = NULL, resolved_at = NULL, resolved_note = %s, acknowledged_by = %s, "
                                  "acknowledged_at = %s")}
        status, cols = sets[action]
        async with self.pool.connection() as conn, conn.transaction():
            cur = await conn.execute("SELECT status FROM core.alerts WHERE alert_id = %s FOR UPDATE", (alert_id,))
            a = await cur.fetchone()
            if not a:
                raise Problem(404, "not_found", f"No alert {alert_id}.")
            allowed = {"ack": ("new",), "resolve": ("new", "acknowledged"), "reopen": ("acknowledged", "resolved")}[action]
            if a["status"] not in allowed:
                raise Problem(409, "invalid_transition", f"This alert is {a['status']}.", alert_status=a["status"])
            params = (actor, now, note) if action != "reopen" else (None, None, None)
            words = {"ack": "acknowledged", "resolve": "resolved", "reopen": "reopened"}[action]
            await conn.execute(
                f"UPDATE core.alerts SET status = %s, {cols}, updated_at = %s, history = history || %s WHERE alert_id = %s",
                (status, *params, now, Jsonb([{"at": now.isoformat(), "change": words, "by": actor, "text": note or ""}]),
                 alert_id))
        return await self.get(alert_id)
