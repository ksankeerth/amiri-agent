#!/usr/bin/env python3
"""Load a demo bundle (one JSON file: profile, market series, monitors, sample data) into a running Amiri Agent
server, through its own API. Standard library only.

    python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --plan
    python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --base-url http://localhost:8000

In order:
  1. refuse unless the platform is empty (no institution yet);
  2. import the profile (POST /api/v1/institutions:import) under the installation's own id (INSTITUTION_ID, as the
     built-in demos do), so the app serves it;
  3. activate it;
  4. add each market series (POST /api/v1/series); a symbol already watched is skipped and reported;
  5. write each monitor (POST /api/v1/monitors); a "live" one is submitted by --actor and approved by --approver;
  6. switch the sample bank or insurer on (PUT /api/v1/mock-institutions/{kind});
  7. unless --skip-after-load: one Radar run and one check of every live monitor. These call Gemini, BigQuery and
     web search, so they cost money.

Live monitors are also checked on their own schedule by the deployment's tick, as any approved monitor is.
On a failure it stops and prints what was done; reset the prototype to "empty" (Settings, Reset the prototype)
and run it again.

The server doesn't require a second person to approve a monitor, so --approver defaults to --actor. To record a
second person, give one, for example --approver "Maya" (a Risk Manager).
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any, Protocol

RESET_HINT = ('Reset the prototype to "empty" first (Settings, Reset the prototype, Empty; or POST '
              '/api/v1/prototype:reset with {"then": "empty"}), then run this again.')


class Api(Protocol):
    def request(self, method: str, path: str, body: Any = None, actor: str | None = None) -> tuple[int, Any]: ...


class Http:
    """The server's API over HTTP (urllib)."""

    def __init__(self, base_url: str, actor: str, timeout: float = 120):
        self.base, self.actor, self.timeout = base_url.rstrip("/"), actor, timeout

    def request(self, method: str, path: str, body: Any = None, actor: str | None = None) -> tuple[int, Any]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"X-Amiri-Actor": actor or self.actor, "Accept": "application/json",
                                              **({"Content-Type": "application/json"} if data is not None else {})})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.status, _json(r.read())
        except urllib.error.HTTPError as e:
            return e.code, _json(e.read())


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return raw.decode(errors="replace")[:500]


class NotEmpty(Exception):
    """An institution is already set up."""


class StepFailed(Exception):
    def __init__(self, step: str, status: int, body: Any):
        detail = body.get("detail") or body.get("title") if isinstance(body, dict) else body
        errors = body.get("errors") if isinstance(body, dict) else None
        super().__init__(f"{step}: HTTP {status}: {detail}" + (f" {json.dumps(errors)[:800]}" if errors else ""))
        self.step, self.status, self.body = step, status, body


def check_bundle(bundle: dict) -> None:
    if bundle.get("bundle_version") != "1.0":
        raise ValueError(f"bundle_version must be \"1.0\", not {bundle.get('bundle_version')!r}")
    for key in ("institution", "sections"):
        if not isinstance(bundle.get(key), dict):
            raise ValueError(f"the bundle has no {key}")
    kind = bundle["institution"].get("institution_type")
    if bundle.get("sample_data", {}).get("enabled") and kind not in ("bank", "insurer"):
        raise ValueError(f"sample data exists for a bank or an insurer, not {kind!r}")


class Loader:
    """Each step is a method; `done` lists what has been written so far."""

    def __init__(self, api: Api, bundle: dict, actor: str, approver: str | None = None, say=print):
        check_bundle(bundle)
        self.api, self.b, self.actor, self.approver, self.say = api, bundle, actor, approver or actor, say
        self.done: list[str] = []
        self.iid: str | None = None
        self.counts = {"series_added": 0, "series_skipped": 0, "monitors": 0, "monitors_live": 0}
        self.live: list[str] = []

    def _call(self, step: str, method: str, path: str, body: Any = None, ok=(200, 201, 202), actor: str | None = None):
        status, out = self.api.request(method, path, body, actor or self.actor)
        if status not in ok:
            raise StepFailed(step, status, out)
        return status, out

    # 1
    def check_empty(self) -> None:
        _, items = self._call("check the platform is empty", "GET", "/api/v1/institutions")
        if items:
            names = ", ".join(f"{i.get('name')} ({i.get('institution_id')})" for i in items)
            raise NotEmpty(f"An institution is already set up: {names}. {RESET_HINT}")
        _, inst = self._call("read the installation", "GET", "/api/v1/installation")
        self.iid = inst["institution_id"]
        self.say(f"[1] the platform is empty; the installation serves institution id {self.iid}")

    # 2
    def import_profile(self) -> None:
        institution = {**self.b["institution"], "institution_id": self.iid or self.b["institution"].get("institution_id")}
        _, out = self._call("import the profile", "POST", "/api/v1/institutions:import",
                            {"institution": institution, "sections": self.b["sections"]})
        self.iid = out["institution_id"]
        self.done.append(f"imported {out['name']} ({self.iid})")
        counts = ", ".join(f"{n} {k}" for k, n in out.get("counts", {}).items() if n)
        self.say(f"[2] imported {out['name']} as {self.iid}: {counts}")

    # 3
    def activate(self) -> None:
        if not self.b.get("after_load", {}).get("activate", True):
            self.say("[3] left in setup (after_load.activate is false)")
            return
        _, out = self._call("activate", "POST", f"/api/v1/institutions/{self.iid}:activate")
        self.done.append("activated")
        self.say(f"[3] activated: status {out.get('status')}")

    # 4
    def add_series(self) -> None:
        for s in self.b.get("series", []):
            status, out = self.api.request("POST", "/api/v1/series", s, self.actor)
            if status == 201:
                self.counts["series_added"] += 1
                self.done.append(f"series {s['symbol']}")
                self.say(f"[4] series {s['symbol']}: added")
            elif status == 409 and isinstance(out, dict) and out.get("code") == "series_exists":
                self.counts["series_skipped"] += 1
                self.say(f"[4] series {s['symbol']}: already watched, skipped")
            else:
                raise StepFailed(f"add series {s['symbol']}", status, out)

    # 5
    def add_monitors(self) -> None:
        for m in self.b.get("monitors", []):
            name = m["spec"]["about"]["name"]
            _, out = self._call(f"write monitor {name!r}", "POST", "/api/v1/monitors",
                                {"spec": m["spec"], "note": "Loaded from bundle"})
            mid = out["monitor_id"]
            self.counts["monitors"] += 1
            self.done.append(f"monitor {mid} (draft)")
            if m.get("status", "draft") == "live":
                self._call(f"submit monitor {name!r}", "POST", f"/api/v1/monitors/{mid}:submit")
                _, ap = self._call(f"approve monitor {name!r}", "POST", f"/api/v1/monitors/{mid}:approve",
                                   actor=self.approver)
                self.counts["monitors_live"] += 1
                self.live.append(mid)
                self.done[-1] = f"monitor {mid} (live)"
                self.say(f"[5] monitor {name!r}: submitted by {self.actor}, approved by {self.approver}: {ap.get('status')}")
            else:
                self.say(f"[5] monitor {name!r}: draft, for a person to approve")

    # 6
    def sample_data(self) -> None:
        sd = self.b.get("sample_data")
        if not sd:
            self.say("[6] sample data: not in the bundle")
            return
        kind = self.b["institution"]["institution_type"]
        _, out = self._call("switch sample data", "PUT", f"/api/v1/mock-institutions/{kind}",
                            {"enabled": bool(sd.get("enabled")), "conditions": sd.get("conditions", [])})
        self.done.append(f"sample {kind} {'on' if out.get('enabled') else 'off'}")
        self.say(f"[6] sample {kind}: {'on' if out.get('enabled') else 'off'}, shaped by "
                 f"{(out.get('shaped_by') or {}).get('name')}")

    # 7
    def after_load(self) -> None:
        a = self.b.get("after_load", {})
        if a.get("run_radar"):
            _, out = self._call("start a Radar run", "POST", "/api/v1/radar:run")
            self.done.append("Radar run started")
            self.say(f"[7] Radar run started: {out.get('run_id') or out}")
        if a.get("check_monitors"):
            for mid in self.live:
                _, out = self._call(f"check monitor {mid}", "POST", f"/api/v1/monitors/{mid}:run")
                self.done.append(f"check of {mid} started")
                self.say(f"[7] check of {mid} started: {out.get('run_id') or out}")

    def run(self, after_load: bool = True) -> dict:
        self.check_empty()
        self.import_profile()
        self.activate()
        self.add_series()
        self.add_monitors()
        self.sample_data()
        if after_load:
            self.after_load()
        else:
            self.say("[7] after-load actions skipped (--skip-after-load)")
        return self.summary()

    def summary(self) -> dict:
        return {"institution_id": self.iid, **self.counts,
                "sample_data": bool(self.b.get("sample_data", {}).get("enabled"))}


def _sample_plan(sd: dict | None) -> str:
    """What step 6 does: the bundle's sample_data is sent as it is (enabled false switches it off)."""
    if not sd:
        return "unchanged"
    return "switch on" if sd.get("enabled") else "switch off"


def plan(bundle: dict, actor: str, approver: str, after_load: bool) -> list[str]:
    check_bundle(bundle)
    i, s = bundle["institution"], bundle["sections"]
    live = sum(1 for m in bundle.get("monitors", []) if m.get("status") == "live")
    a = bundle.get("after_load", {})
    out = [
        "1. refuse unless the platform has no institution",
        f"2. import {i['name']} ({i['home_country']}, {i['institution_type']}) under the installation's id: "
        + ", ".join(f"{len(v)} {k}" for k, v in s.items() if v),
        "3. activate it" if a.get("activate", True) else "3. leave it in setup",
        f"4. add {len(bundle.get('series', []))} market series: "
        + ", ".join(x["symbol"] for x in bundle.get("series", [])) + " (a symbol already watched is skipped)",
        f"5. write {len(bundle.get('monitors', []))} monitors; {live} live: submitted by {actor}, approved by {approver}",
        f"6. sample {i['institution_type']}: " + _sample_plan(bundle.get("sample_data")),
    ]
    if after_load and (a.get("run_radar") or a.get("check_monitors")):
        out.append("7. " + " and ".join(x for x in (
            "one Radar run" if a.get("run_radar") else "",
            f"one check of each of the {live} live monitors" if a.get("check_monitors") else "") if x)
            + " (these cost money: Gemini, BigQuery, web search)")
    else:
        out.append("7. no after-load actions")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Load a demo bundle into a running Amiri Agent server.")
    p.add_argument("--file", required=True, help="the bundle (e.g. demo/austin-tech-bank/bundle.json)")
    p.add_argument("--base-url", default="http://localhost:8000", help="the server (default http://localhost:8000)")
    p.add_argument("--actor", default="John", help="who loads it: the X-Amiri-Actor header (default John)")
    p.add_argument("--approver", default=None, help="who approves the live monitors (default: --actor)")
    p.add_argument("--skip-after-load", action="store_true", help="no Radar run and no monitor checks")
    p.add_argument("--plan", action="store_true", help="print what it would do and exit")
    a = p.parse_args(argv)
    with open(a.file, encoding="utf-8") as f:
        bundle = json.load(f)
    approver = a.approver or a.actor
    if a.plan:
        print(f"Plan for {a.file} on {a.base_url}:")
        for line in plan(bundle, a.actor, approver, not a.skip_after_load):
            print("  " + line)
        return 0
    loader = Loader(Http(a.base_url, a.actor), bundle, a.actor, approver)
    try:
        summary = loader.run(after_load=not a.skip_after_load)
    except NotEmpty as e:
        print(f"Refused: {e}", file=sys.stderr)
        return 2
    except (StepFailed, OSError) as e:
        print(f"\nFailed: {e}", file=sys.stderr)
        print("Done before the failure:" if loader.done else "Nothing was written.", file=sys.stderr)
        for d in loader.done:
            print(f"  - {d}", file=sys.stderr)
        if loader.done:
            print(RESET_HINT, file=sys.stderr)
        return 1
    print("\nLoaded: " + ", ".join(f"{k} {v}" for k, v in summary.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
