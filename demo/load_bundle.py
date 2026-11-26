#!/usr/bin/env python3
"""Load a demo bundle (one JSON file: profile, market series, monitors, sample data) into a running Amiri Agent
server, through its own API. Standard library only.

    python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --plan
    python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --base-url http://localhost:8000
    python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --reset --yes     # start again, then load

What it does depends on what the platform holds:
  - no institution yet: import the bundle's profile, then load the rest;
  - the bundle's own institution (same name, and the installation's id): keep it as it is and load the rest onto it.
    Run it twice and nothing is added twice: a monitor (by name) or a series (by symbol) already there is skipped,
    and example data already imported for this institution is left alone;
  - a different institution: stop, and say how to start again from the bundle's profile file (profile.json beside
    the bundle: Settings, Start again from a JSON file). With --reset the script does that for you
    (POST /api/v1/prototype:reset with the bundle's profile): it wipes the institution and everything made for it
    (monitors, findings, the imported data; market series and prices stay), so it prints what it will wipe and needs
    --yes (or, at a terminal, you type RESET).

In order:
  1. look at the platform (as above);
  2. import the profile (POST /api/v1/institutions:import) under the installation's own id (INSTITUTION_ID, as the
     built-in demos do), so the app serves it; or keep the institution that is there; or, with --reset, reset;
  3. activate it (a reset has already done so);
  4. add each market series (POST /api/v1/series); a symbol already watched is skipped and reported;
  5. write each monitor (POST /api/v1/monitors); one with the same name that is not retired is skipped; a "live"
     one is submitted by --actor and approved by --approver;
  6. import the institution's data: the example file (GET /api/v1/data-connection:example, the sample bank or
     insurer shaped by this profile, with the bundle's sample_data conditions planted), sent as it is to
     POST /api/v1/data-connection:import; it still needs Check and Approve on Data connections. Skipped if this
     institution's data is already imported;
  7. unless --skip-after-load: one Radar run and one check of every live monitor this run wrote. These call Gemini,
     BigQuery and web search, so they cost money. A run that added nothing starts nothing.

Live monitors are also checked on their own schedule by the deployment's tick, as any approved monitor is.
On a failure it stops and prints what was done; run it again: what is loaded is kept and the rest is added.

The server doesn't require a second person to approve a monitor, so --approver defaults to --actor. To record a
second person, give one, for example --approver "Maya" (a Risk Manager).
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Protocol

PROFILE_FILE = "profile.json"  # beside the bundle: the same profile, in the shape Settings › Start again takes


def reset_hint(profile_path: str) -> str:
    return (f"Start again from a JSON file (Settings) with this bundle's profile: {profile_path}, then run this again. "
            "Or let the script do it: add --reset --yes (it wipes the institution and everything made for it).")


def profile_of(bundle: dict) -> dict:
    """The bundle's profile in the import shape: {institution, sections}, as POST /prototype:reset takes it and as
    Settings downloads it."""
    return {"institution": bundle["institution"], "sections": bundle["sections"]}


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
    """A different institution is set up (and --reset was not given)."""


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

    def __init__(self, api: Api, bundle: dict, actor: str, approver: str | None = None, say=print,
                 profile_path: str = f"{PROFILE_FILE} beside the bundle", reset: bool = False):
        check_bundle(bundle)
        self.api, self.b, self.actor, self.approver, self.say = api, bundle, actor, approver or actor, say
        self.profile_path, self.reset = profile_path, reset
        self.done: list[str] = []
        self.iid: str | None = None
        self.found: list[dict] = []         # the institutions the platform holds when we looked
        self.existing: dict | None = None   # the bundle's own institution, if it is there
        self.how = "created"                # created | kept | reset
        self.counts = {"series_added": 0, "series_skipped": 0, "monitors": 0, "monitors_live": 0,
                       "sample_data": bool(bundle.get("sample_data", {}).get("enabled")), "monitors_skipped": 0}
        self.live: list[str] = []           # live monitors this run wrote (the after-load step checks these)
        self.wrote = False                  # did this run add anything the Radar run would look at

    def _call(self, step: str, method: str, path: str, body: Any = None, ok=(200, 201, 202), actor: str | None = None):
        status, out = self.api.request(method, path, body, actor or self.actor)
        if status not in ok:
            raise StepFailed(step, status, out)
        return status, out

    # 1
    def inspect(self) -> None:
        """Read only: what the platform holds, and whether it is this bundle's institution."""
        _, self.found = self._call("look at the platform", "GET", "/api/v1/institutions")
        _, inst = self._call("read the installation", "GET", "/api/v1/installation")
        self.iid = inst["institution_id"]
        name = self.b["institution"]["name"].strip().casefold()
        self.existing = next((i for i in self.found
                              if i.get("name", "").strip().casefold() == name and i.get("institution_id") == self.iid), None)

    def wipe_text(self) -> str:
        """What --reset wipes, in words (for the confirmation)."""
        held = ", ".join(f"{i.get('name')} ({i.get('institution_id')}, {i.get('items', 0)} profile items)" for i in self.found)
        return (f"{'It holds ' + held + '. ' if held else 'The platform holds no institution. '}"
                "A reset wipes the institution and everything made for it: monitors and their checks, findings, "
                "Radar runs, scenarios, the imported data and its approval, cases and the assistant's threads. "
                "It keeps market series and prices and the reference data. Then it loads this bundle's profile, "
                f"{self.b['institution']['name']}.")

    def check_platform(self) -> None:
        self.inspect()
        if self.reset:
            self.say(f"[1] --reset: {self.wipe_text()}")
        elif not self.found:
            self.say(f"[1] the platform is empty; the installation serves institution id {self.iid}")
        elif self.existing:
            self.say(f"[1] {self.existing['name']} ({self.iid}) is already set up: it is kept, and the rest is loaded onto it")
        else:
            names = ", ".join(f"{i.get('name')} ({i.get('institution_id')})" for i in self.found)
            raise NotEmpty(f"A different institution is set up: {names}. {reset_hint(self.profile_path)}")

    # 2
    def import_profile(self) -> None:
        if self.reset:
            _, out = self._call("start again from the bundle's profile", "POST", "/api/v1/prototype:reset",
                                {"confirm": "RESET", "profile": profile_of(self.b)})
            self.iid, self.how, self.wrote = out["institution_id"], "reset", True
            self.done.append(f"reset: wiped, then loaded {out['name']} ({self.iid}) and activated it")
            self.say(f"[2] reset done: {out['name']} loaded as {self.iid} and active (kept: {', '.join(out.get('kept', []))})")
            return
        if self.existing:
            self.how = "kept"
            self.say(f"[2] profile: {self.existing['name']} is already there ({self.existing.get('items', 0)} items), kept as it is")
            return
        institution = {**self.b["institution"], "institution_id": self.iid or self.b["institution"].get("institution_id")}
        _, out = self._call("import the profile", "POST", "/api/v1/institutions:import",
                            {"institution": institution, "sections": self.b["sections"]})
        self.iid, self.wrote = out["institution_id"], True
        self.done.append(f"imported {out['name']} ({self.iid})")
        counts = ", ".join(f"{n} {k}" for k, n in out.get("counts", {}).items() if n)
        self.say(f"[2] imported {out['name']} as {self.iid}: {counts}")

    # 3
    def activate(self) -> None:
        if self.how == "reset":
            self.say("[3] activated by the reset")
            return
        if not self.b.get("after_load", {}).get("activate", True):
            self.say("[3] left in setup (after_load.activate is false)")
            return
        if self.existing and self.existing.get("status") == "active":
            self.say("[3] already active")
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
                self.wrote = True
                self.done.append(f"series {s['symbol']}")
                self.say(f"[4] series {s['symbol']}: added")
            elif status == 409 and isinstance(out, dict) and out.get("code") == "series_exists":
                self.counts["series_skipped"] += 1
                self.say(f"[4] series {s['symbol']}: already watched, skipped")
            else:
                raise StepFailed(f"add series {s['symbol']}", status, out)

    # 5
    def add_monitors(self) -> None:
        _, items = self._call("list the monitors", "GET", "/api/v1/monitors")
        have = {m.get("name", "").strip().casefold() for m in (items or {}).get("items", []) if m.get("status") != "retired"}
        for m in self.b.get("monitors", []):
            name = m["spec"]["about"]["name"]
            if name.strip().casefold() in have:
                self.counts["monitors_skipped"] += 1
                self.say(f"[5] monitor {name!r}: already there, skipped")
                continue
            _, out = self._call(f"write monitor {name!r}", "POST", "/api/v1/monitors",
                                {"spec": m["spec"], "note": "Loaded from bundle"})
            mid = out["monitor_id"]
            have.add(name.strip().casefold())
            self.counts["monitors"] += 1
            self.wrote = True
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
        if not sd or not sd.get("enabled"):
            self.say("[6] sample data: " + ("not in the bundle" if not sd else "not imported (enabled is false)"))
            return
        _, dc = self._call("look at the data connection", "GET", "/api/v1/data-connection")
        have = (((dc or {}).get("imported") or {}).get("summary") or {}).get("institution")
        if have and str(have).strip().casefold() == self.b["institution"]["name"].strip().casefold():
            self.say(f"[6] example data: {have}'s data is already imported, left as it is")
            return
        ids = [c["id"] for c in sd.get("conditions", []) if isinstance(c, dict) and c.get("id")]
        scenario = urllib.parse.quote(",".join(ids) or "none")
        _, doc = self._call("download the example data file", "GET", f"/api/v1/data-connection:example?scenario={scenario}")
        _, out = self._call("import the example data file", "POST",
                            "/api/v1/data-connection:import?file_name=example-data.json", doc)
        s = (out.get("imported") or {}).get("summary") or {}
        self.done.append("example data imported")
        self.wrote = True
        self.say(f"[6] example data imported: {s.get('institution')}, {s.get('products')} products, "
                 f"{s.get('from')} to {s.get('until')}; check and approve it on Data connections")

    # 7
    def after_load(self) -> None:
        a = self.b.get("after_load", {})
        if not self.wrote and not self.live:
            self.say("[7] nothing new was loaded: no Radar run and no checks")
            return
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
        self.check_platform()
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
        c = self.counts
        return {"institution_id": self.iid, "series_added": c["series_added"], "series_skipped": c["series_skipped"],
                "monitors": c["monitors"], "monitors_live": c["monitors_live"], "sample_data": c["sample_data"],
                "monitors_skipped": c["monitors_skipped"], "institution": self.how}


def _sample_plan(sd: dict | None) -> str:
    """What step 6 does: with sample_data enabled, the example file is imported."""
    if not sd or not sd.get("enabled"):
        return "unchanged"
    ids = [c.get("id") for c in sd.get("conditions", []) if isinstance(c, dict)]
    return "import the example file" + (f" ({', '.join(ids)} planted)" if ids else " (nothing planted)")


def plan(bundle: dict, actor: str, approver: str, after_load: bool, reset: bool = False) -> list[str]:
    check_bundle(bundle)
    i, s = bundle["institution"], bundle["sections"]
    live = sum(1 for m in bundle.get("monitors", []) if m.get("status") == "live")
    a = bundle.get("after_load", {})
    items = ", ".join(f"{len(v)} {k}" for k, v in s.items() if v)
    out = [
        "1. start again: wipe the institution and everything made for it (series and prices stay), after you confirm"
        if reset else
        f"1. look at the platform: empty, or {i['name']} already set up, goes on; a different institution is refused "
        "(add --reset to start again from this bundle's profile)",
        f"2. {'load' if reset else 'import'} {i['name']} ({i['home_country']}, {i['institution_type']}) "
        f"under the installation's id{'' if reset else ' (kept as it is if already there)'}: {items}",
        "3. activate it" if a.get("activate", True) else "3. leave it in setup",
        f"4. add {len(bundle.get('series', []))} market series: "
        + ", ".join(x["symbol"] for x in bundle.get("series", [])) + " (a symbol already watched is skipped)",
        f"5. write {len(bundle.get('monitors', []))} monitors; {live} live: submitted by {actor}, approved by {approver} "
        "(one with the same name is skipped)",
        f"6. the institution's data (sample {i['institution_type']}): " + _sample_plan(bundle.get("sample_data")),
    ]
    if after_load and (a.get("run_radar") or a.get("check_monitors")):
        out.append("7. " + " and ".join(x for x in (
            "one Radar run" if a.get("run_radar") else "",
            f"one check of each live monitor written (up to {live})" if a.get("check_monitors") else "") if x)
            + " (these cost money: Gemini, BigQuery, web search); a run that adds nothing starts nothing")
    else:
        out.append("7. no after-load actions")
    return out


def confirm_reset(text: str, yes: bool, stdin=None, ask=input) -> bool:
    """--reset wipes data, so it needs --yes, or RESET typed at a terminal."""
    print(text)
    if yes:
        return True
    stdin = stdin or sys.stdin
    if not (hasattr(stdin, "isatty") and stdin.isatty()):
        print("Refused: --reset wipes data and needs --yes (there is no terminal to ask).", file=sys.stderr)
        return False
    if ask("Type RESET to continue: ").strip() != "RESET":
        print("Refused: RESET was not typed. Nothing was changed.", file=sys.stderr)
        return False
    return True


def main(argv: list[str] | None = None, api: Api | None = None) -> int:
    p = argparse.ArgumentParser(description="Load a demo bundle into a running Amiri Agent server.")
    p.add_argument("--file", required=True, help="the bundle (e.g. demo/austin-tech-bank/bundle.json)")
    p.add_argument("--base-url", default="http://localhost:8000", help="the server (default http://localhost:8000)")
    p.add_argument("--actor", default="John", help="who loads it: the X-Amiri-Actor header (default John)")
    p.add_argument("--approver", default=None, help="who approves the live monitors (default: --actor)")
    p.add_argument("--skip-after-load", action="store_true", help="no Radar run and no monitor checks")
    p.add_argument("--plan", action="store_true", help="print what it would do and exit")
    p.add_argument("--reset", action="store_true",
                   help="start again from the bundle's profile (wipes the institution and all made for it), then load")
    p.add_argument("--yes", action="store_true", help="with --reset: don't ask for RESET to be typed")
    a = p.parse_args(argv)
    with open(a.file, encoding="utf-8") as f:
        bundle = json.load(f)
    approver = a.approver or a.actor
    if a.plan:
        print(f"Plan for {a.file} on {a.base_url}:")
        for line in plan(bundle, a.actor, approver, not a.skip_after_load, a.reset):
            print("  " + line)
        return 0
    loader = Loader(api or Http(a.base_url, a.actor), bundle, a.actor, approver,
                    profile_path=os.path.join(os.path.dirname(a.file), PROFILE_FILE), reset=a.reset)
    try:
        if a.reset:
            loader.inspect()
            if not confirm_reset(f"--reset on {a.base_url}: {loader.wipe_text()}", a.yes):
                return 2
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
            print("Run it again: what is loaded is kept, and the rest is added.", file=sys.stderr)
        return 1
    print("\nLoaded: " + ", ".join(f"{k} {v}" for k, v in summary.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
