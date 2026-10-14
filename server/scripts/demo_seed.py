"""Seeds a demo state through the server's own HTTP API (so it is the same path a person takes), against any running
server: local with fake agents, or deployed with the real ones.

    uv run python scripts/demo_seed.py --server http://localhost:8200

What it does, in the order a person would:
  1. the institution (Serendib Commercial Bank) imported and activated;
  2. monitors drafted from the profile, submitted by one Risk Manager and approved by another;
  3. a Scenario Studio scenario run live and recorded to the end, so Replay works with no agent and no quota;
  4. live monitor checks and an investigation (events and alerts for the owning teams);
  5. a Radar run;
  6. one alert acknowledged, so the Alerts page shows both states.

Each step prints what it found; a step that fails is reported and the rest carry on. Run it on an empty database.
It never deletes anything. Needs the series (Twelve Data) to exist already: add them in the app or copy them in.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ME, OTHER = "dilan@serendib.lk", "nadeesha@serendib.lk"
SEED = Path(__file__).resolve().parent.parent / "app" / "seeds" / "serendib_bank.json"
MONITORS = [("risk-exposures", "gulf"), ("risk-exposures", "red-sea"), ("regulators", "central-bank-of-sri-lanka")]
problems: list[str] = []


class Api:
    def __init__(self, base: str, token: str = ""):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method: str, path: str, body=None, actor: str = ME, timeout: int = 300):
        req = urllib.request.Request(
            self.base + path, method=method, data=None if body is None else json.dumps(body).encode(),
            headers={"content-type": "application/json", "X-Amiri-Actor": actor,
                     **({"Authorization": f"Bearer {self.token}"} if self.token else {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, {"detail": raw.decode()[:300]}


def step(title: str):
    print(f"\n== {title}")


def ok(status: int, what: str, out=None) -> bool:
    if status >= 400:
        detail = (out or {}).get("detail") if isinstance(out, dict) else out
        problems.append(f"{what}: HTTP {status} {detail}")
        print(f"   FAILED {what}: HTTP {status} {detail}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default="http://localhost:8200")
    ap.add_argument("--skip-studio", action="store_true", help="don't run and record the Studio scenario")
    ap.add_argument("--token", default="", help="a Google ID token of a service account in INTERNAL_CALLERS, for a server "
                    "with sign-in on (gcloud auth print-identity-token --impersonate-service-account=… --audiences=URL)")
    a = ap.parse_args()
    api = Api(a.server, a.token)

    step("1. The institution")
    s, inst = api.call("GET", "/api/v1/installation")
    if not inst.get("profile"):
        doc = json.loads(SEED.read_text())
        s, out = api.call("POST", "/api/v1/institutions:import", {"institution": doc["institution"], "sections": doc["sections"]})
        if ok(s, "import the profile", out):
            iid = out["institution_id"]
            s, out = api.call("POST", f"/api/v1/institutions/{iid}:activate")
            if ok(s, "activate it", out):
                print(f"   {iid}: {out['status']}")
    else:
        print(f"   {inst['institution_id']} already has a profile; left as it is")

    step("2. Monitors, from the profile")
    for section, item in MONITORS:
        s, m = api.call("POST", "/api/v1/monitors:draft", {"section": section, "item_id": item})  # saves a draft (or opens the one that exists)
        if not ok(s, f"draft from {item}", m):
            continue
        mid = m["monitor_id"]
        if m["status"] == "live":
            print(f"   {m['name']}: already live")
            continue
        if m["status"] == "draft":
            s, m = api.call("POST", f"/api/v1/monitors/{mid}:submit")
            ok(s, f"submit {mid}", m)
        s, m = api.call("POST", f"/api/v1/monitors/{mid}:approve", actor=OTHER)  # a second person approves
        if ok(s, f"approve {mid}", m):
            print(f"   {m['name']}: {m['status']}")

    if not a.skip_studio:
        step("3. Scenario Studio: run live and record, then check Replay")
        s, rows = api.call("GET", "/api/v1/studio/scenarios")
        done = [x for x in (rows["items"] if s == 200 else []) if x.get("recorded")]
        if done:
            print(f"   {done[0]['title']} is already recorded; left as it is")
            sc = None
        else:
            s, sc = api.call("POST", "/api/v1/studio/scenarios", {"template_id": "currency-depreciation", "intensity": "medium"})
            sc = sc if ok(s, "create the scenario", sc) else None
        if sc:
            for mode in ("record", "replay"):
                s, sim = api.call("POST", "/api/v1/studio/simulations", {"scenario_id": sc["scenario_id"], "mode": mode})
                if not ok(s, f"start {mode}", sim):
                    break
                t0, n = time.time(), 0
                while sim["status"] in ("running", "waiting") and n < 400:
                    s, nxt = api.call("POST", f"/api/v1/studio/simulations/{sim['sim_id']}:step", {"expected_step": sim["step"]})
                    if s == 409:  # busy or moved on: ask again
                        s, nxt = api.call("GET", f"/api/v1/studio/simulations/{sim['sim_id']}")
                    if not ok(s, f"{mode} step {sim['step']}", nxt):
                        break
                    sim, n = nxt, n + 1
                    if sim["status"] == "waiting":
                        time.sleep(1)
                alerts = len(sim.get("alerts", []))
                print(f"   {mode}: {sim['status']} after {n} steps in {time.time() - t0:.0f}s, {len(sim['events'])} events, {alerts} alerts it would raise")

    step("4. Live checks, investigation, alerts")
    for _ in range(3):  # the first tick starts the checks, the next collects them
        s, out = api.call("POST", "/internal/tick")
        ok(s, "tick", out)
        time.sleep(1)
    s, inv = api.call("POST", "/api/v1/investigations", {"world": "live"})  # investigate now: skip the wait for related findings
    if s not in (200, 201, 202, 409):
        ok(s, "investigate now", inv)
    for _ in range(3):
        api.call("POST", "/internal/tick")
        time.sleep(1)
    s, ev = api.call("GET", "/api/v1/events?world=live")
    s2, al = api.call("GET", "/api/v1/alerts:summary")
    print(f"   live events: {len(ev['items']) if s == 200 else '?'}; alerts to review: {al.get('to_review') if s2 == 200 else '?'}")

    step("5. Radar")
    s, st = api.call("GET", "/api/v1/radar:status")
    if s == 200 and st.get("connected"):
        s, run = api.call("POST", "/api/v1/radar:run")
        if ok(s, "radar run", run):
            for _ in range(30):
                s, r = api.call("GET", f"/api/v1/radar/runs/{run['run_id']}")
                if s == 200 and r["status"] != "running":
                    break
                time.sleep(1)
            print(f"   {r.get('status')}: {r.get('stories')} stories, {r.get('sent')} sent")
    else:
        print("   Radar isn't connected; skipped")

    step("6. Acknowledge one alert")
    s, al = api.call("GET", "/api/v1/alerts?status=new")
    if s == 200 and al["items"]:
        first = al["items"][-1]
        s, out = api.call("POST", f"/api/v1/alerts/{first['alert_id']}:ack", {"note": "Treasury desk is checking the forward book"})
        if ok(s, "acknowledge", out):
            print(f"   {first['owner']}: {first['title']}")
    else:
        print("   no alert to acknowledge")

    print("\nDone." if not problems else f"\nDone with {len(problems)} problem(s):\n  - " + "\n  - ".join(problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
