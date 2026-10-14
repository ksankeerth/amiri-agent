"""Plays the scenario catalogue through a running
server, against whichever agent it is connected to (ASSISTANT_BACKEND).

    uv run amiri scenarios --server http://localhost:8000 [--only S01,S07] [--out results.json]

Each scenario gets its own institution (or none) and its own user, so they don't
interfere. Checked automatically: the track after each turn, whether a proposal was
made with the expected track, kind, sections and institution fields, and notes kept
for later tracks. Reply quality, UI behaviour and refusals inside the agent's tool
calls are listed as "manual" (for a human, or an LLM judge, to grade).
"""

import json
import re
import uuid
from pathlib import Path
from typing import Any

import httpx

from app import settings
from app.assistant.agent import parse_sse

CATALOGUE = settings.PROJECT / "tests" / "fixtures" / "setup-agent-scenarios.json"
SEED = settings.PROJECT / "app" / "seeds" / "serendib_bank.json"
STARTS = {
    "bank_min": {"name": "Scenario Bank", "institution_type": "bank", "subtype": "commercial", "home_country": "LK",
                 "base_currency": "LKR", "time_zone": "Asia/Colombo"},
    "insurer_min": {"name": "Scenario Insurer", "institution_type": "insurer", "subtype": "composite", "home_country": "LK",
                    "base_currency": "LKR", "time_zone": "Asia/Colombo"},
    "bank_min_ph": {"name": "Scenario Bank Philippines", "institution_type": "bank", "subtype": "savings", "home_country": "PH",
                    "base_currency": "PHP", "time_zone": "Asia/Manila"},
    "insurer_min_id": {"name": "Scenario Insurer Indonesia", "institution_type": "insurer", "subtype": "general",
                       "home_country": "ID", "base_currency": "IDR", "time_zone": "Asia/Jakarta"},
}


class Runner:
    def __init__(self, server: str, transport: httpx.AsyncBaseTransport | None = None):
        self.c = httpx.AsyncClient(base_url=server.rstrip("/"), transport=transport, timeout=httpx.Timeout(300.0, connect=5.0))

    async def _start(self, sc: dict, user: str) -> str | None:
        H = {"X-Amiri-Actor": user, "X-Amiri-Source": "setup"}
        start = sc.get("start", "none")
        iid = None
        tag = f"scen-{sc['id'].lower()}-{uuid.uuid4().hex[:4]}"
        if start == "bank":
            doc = json.loads(SEED.read_text())
            r = await self.c.post("/api/v1/institutions:import", json={"institution": {**doc["institution"], "institution_id": tag},
                                                                        "sections": doc["sections"]}, headers=H)
            r.raise_for_status()
            iid = tag
        elif start in STARTS:
            r = await self.c.post("/api/v1/institutions", json={**STARTS[start], "institution_id": tag}, headers=H)
            r.raise_for_status()
            iid = tag
        for f in (sc.get("setup") or {}).get("forms", []):
            await self.c.post(f"/api/v1/institutions/{iid}/{f['section']}", json=f["data"], headers={**H, "X-Amiri-Source": "form"})
        self.monitors: dict[tuple[str, str], str] = {}  # monitors made by the setup, by the profile item they watch
        for m in (sc.get("setup") or {}).get("monitors", []):
            r = await self.c.post("/api/v1/monitors:draft", json={**m, "institution_id": iid}, headers=H)
            r.raise_for_status()
            self.monitors[(m["section"], m["item_id"])] = r.json()["monitor_id"]
        return iid

    async def _turn(self, sid: str, user: str, text: str | None, track: str | None) -> list[tuple[str, dict]]:
        body = {"session_id": sid, "text": text, **({"track": track} if track else {})}
        out: list[tuple[str, dict]] = []
        async with self.c.stream("POST", "/api/v1/assistant/run_sse", json=body, headers={"X-Amiri-Actor": user}) as r:
            if r.status_code != 200:
                return [("http_error", {"status": r.status_code, "body": (await r.aread()).decode()[:300]})]
            async for ev, data in parse_sse(r.aiter_lines()):
                out.append((ev, data))
        return out

    async def run_one(self, sc: dict) -> dict:
        user = f"{sc['id'].lower()}-{uuid.uuid4().hex[:6]}@scenario.amiri.dev"
        res: dict[str, Any] = {"id": sc["id"], "title": sc["title"], "group": sc["group"], "turns": []}
        try:
            iid = await self._start(sc, user)
            s = (await self.c.post("/api/v1/assistant/sessions", json={"institution_id": iid}, headers={"X-Amiri-Actor": user})).json()
            sid = s["session_id"]
        except (httpx.HTTPError, KeyError) as e:
            hint = (" (each scenario makes its own institution: run the server with SINGLE_INSTITUTION=false)"
                    if isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 409 else "")
            res["error"] = f"setup failed: {e}{hint}"
            return res
        for i, t in enumerate(sc["turns"]):
            text, exp = t.get("user", ""), t.get("expect", {})
            checks: list[dict] = []
            if re.match(r"^\(applies(?: the proposal)?\)", text):
                pending = [p for p in (await self.c.get("/api/v1/assistant/thread", params={"institution_id": iid} if iid else {},
                                                        headers={"X-Amiri-Actor": user})).json()["proposals"] if p["status"] == "pending"]
                if pending:
                    r = await self.c.post(f"/api/v1/proposals/{pending[0]['proposal_id']}:confirm", headers={"X-Amiri-Actor": user})
                    ok = r.status_code == 200
                    checks.append({"check": "applied the pending proposal", "result": "pass" if ok else "fail"})
                    if ok and r.json()["kind"] == "create_institution":
                        iid = r.json()["result"]["institution_id"]
                else:
                    checks.append({"check": "applied the pending proposal", "result": "fail", "detail": "no pending proposal"})
                text = text.split(")", 1)[1].strip() if ")" in text else ""
            elif text.startswith("("):
                res["turns"].append({"turn": i + 1, "user": text, "checks": [{"check": "action", "result": "manual"}]})
                continue
            events = await self._turn(sid, user, text, t.get("picked_track")) if text else []
            if events and events[0][0] == "http_error":
                checks.append({"check": "turn accepted", "result": "fail", "detail": events[0][1]})
            thread = (await self.c.get("/api/v1/assistant/thread", params={"institution_id": iid} if iid else {},
                                       headers={"X-Amiri-Actor": user})).json()
            if exp.get("track"):
                ok = thread["current_track"] == exp["track"]
                checks.append({"check": f"track is {exp['track']}", "result": "pass" if ok else "fail", "detail": thread["current_track"]})
            if exp.get("notes"):
                got = {d["track"] for e, d in events if e == "track_notes" for d in d.get("notes", [])}
                for tr in exp["notes"]:
                    checks.append({"check": f"note kept for {tr}", "result": "pass" if tr in got else "fail"})
            if exp.get("proposal"):
                checks += self._proposal_checks(exp["proposal"], [d["proposal"] for e, d in events if e == "proposal"],
                                                self.monitors)
            for k in ("reply", "ui", "server", "refusal"):
                if exp.get(k):
                    checks.append({"check": f"{k}: {json.dumps(exp[k])[:200]}", "result": "manual"})
            res["turns"].append({"turn": i + 1, "user": text, "events": [e for e, _ in events], "checks": checks,
                                 "reply": " ".join(d.get("text", "") for e, d in events if e == "message")[:600]})
        return res

    @staticmethod
    def _proposal_checks(exp: dict, got: list[dict], monitors: dict | None = None) -> list[dict]:
        if not got:
            return [{"check": "made a proposal", "result": "fail"}]
        p = got[-1]
        out = [{"check": "made a proposal", "result": "pass"}]
        if exp.get("track"):
            out.append({"check": f"proposal track {exp['track']}", "result": "pass" if p["track"] == exp["track"] else "fail", "detail": p["track"]})
        if exp.get("kind"):
            out.append({"check": f"proposal kind {exp['kind']}", "result": "pass" if p["kind"] == exp["kind"] else "fail", "detail": p["kind"]})
        if exp.get("sections"):
            secs = {c["section"] for c in p["changes"]}
            out.append({"check": f"proposal touches {exp['sections']}", "result": "pass" if secs <= set(exp["sections"]) and secs else "fail",
                        "detail": sorted(secs)})
        for k, v in (exp.get("fields") or {}).items():
            got_v = (p.get("institution") or {}).get(k)
            out.append({"check": f"institution {k} = {v}", "result": "pass" if got_v == v else "fail", "detail": got_v})
        if exp.get("monitor_ops") is not None:  # kind monitors: which items get a new monitor, which monitors change
            ops = p.get("operations") or []
            have = sorted((o["op"], (o.get("origin_ref") or {}).get("section"), (o.get("origin_ref") or {}).get("item_id"),
                           o.get("monitor_id")) for o in ops)
            for w in exp["monitor_ops"]:
                ref = w.get("origin_ref") or {}
                if w["op"] == "create":
                    ok = any(o["op"] == "create" and o.get("origin_ref") == ref for o in ops) if ref else \
                        any(o["op"] == "create" for o in ops)
                else:
                    mid = (monitors or {}).get((ref.get("section"), ref.get("item_id")))
                    ok = any(o["op"] == "update" and o.get("monitor_id") == mid for o in ops)
                out.append({"check": f"monitors: {w['op']} {ref.get('section', '')}/{ref.get('item_id', '')}",
                            "result": "pass" if ok else "fail", "detail": have})
            if exp.get("monitor_count") is not None:
                out.append({"check": f"monitors: {exp['monitor_count']} in the proposal",
                            "result": "pass" if len(ops) == exp["monitor_count"] else "fail", "detail": len(ops)})
        for x in exp.get("must_include", []) + [f"not: {x}" for x in exp.get("must_not", [])]:
            out.append({"check": f"proposal {x}", "result": "manual"})
        return out


async def run(server: str, only: list[str] | None = None, transport: httpx.AsyncBaseTransport | None = None) -> list[dict]:
    cat = json.loads(Path(CATALOGUE).read_text())
    runner = Runner(server, transport)
    return [await runner.run_one(sc) for sc in cat["scenarios"] if not only or sc["id"] in only]


def summary(results: list[dict]) -> str:
    lines, counts = [], {"pass": 0, "fail": 0, "manual": 0}
    for r in results:
        cs = [c for t in r.get("turns", []) for c in t["checks"]]
        n = {k: sum(1 for c in cs if c["result"] == k) for k in counts}
        for k in counts:
            counts[k] += n[k]
        flag = "ERROR" if r.get("error") else "FAIL " if n["fail"] else "ok   "
        lines.append(f"{flag} {r['id']} {r['title'][:60]:<60} pass {n['pass']}  fail {n['fail']}  manual {n['manual']}"
                     + (f"  -- {r['error']}" if r.get("error") else ""))
    lines.append(f"\n{counts['pass']} automatic checks passed, {counts['fail']} failed; {counts['manual']} to grade by hand or an LLM judge.")
    return "\n".join(lines)
