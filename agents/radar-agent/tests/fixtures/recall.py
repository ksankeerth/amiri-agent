"""Real GDELT rows saved by scripts/capture_fixture.py, replayed offline.

A fixture was captured with the query as it was then; `recalled` applies the query's rules as they
are now (app/queries.py's SQL, in Python, from the same parameters), so a narrower query can be
tuned without querying BigQuery again. Re2 and Python's re agree on the patterns the query uses.
"""

import gzip
import json
import re
from datetime import datetime
from pathlib import Path

from app.contract import RadarRunRequest
from app.queries import plan, stamp

HERE = Path(__file__).parent


def rows(name: str) -> list[dict]:
    with gzip.open(HERE / name, "rt") as f:
        return [json.loads(line) for line in f]


def recalled(all_rows: list[dict], req: RadarRunRequest) -> list[dict]:
    q, _ = plan(req)
    v = {k: value for k, (_, value) in q.params.items()}
    out = []
    for r in all_rows:
        if not v["since"] <= int(r["DATE"]) < v["until"]:
            continue
        locs = [b.split("#")[2] if len(b.split("#")) > 2 else "" for b in r["locations"].split(";") if b]
        home_n = sum(x in v["home_fips"] for x in locs)
        foot_n = sum(x in v["foot_fips"] for x in locs)
        share_n = sum(x in v["share_fips"] for x in locs)
        t = (r.get("title") or "").lower()
        has = lambda pattern, text: bool(pattern) and bool(re.search(pattern, text))  # noqa: E731
        themes = ";".join(f"{c},0" for c in r["themes"].split(";") if c)
        r_home = (has(v["home_names"], t) or home_n >= v["home_mentions"]
                  or (r.get("outlet") or "").lower().endswith(v["home_domain"]))
        r_foot = (has(v["foot_names"], t) or (share_n >= 2 and share_n >= v["share"] * len(locs))) and has(v["themes"], themes)
        r_place = has(v["place_names"], t)
        orgs = " ".join(o for o in r["orgs"].split(";") if o).lower()
        r_actor = (home_n > 0 or foot_n > 0) and has(v["actor_names"], f"{orgs} {t}")
        if r_home or r_foot or r_place or r_actor:
            out.append({**r, "r_home": r_home, "r_footprint": r_foot, "r_place": r_place, "r_actor": r_actor})
    return sorted(out, key=lambda r: -int(r["DATE"]))[: v["row_limit"]]


def window(req_body: dict, since: datetime, until: datetime) -> RadarRunRequest:
    return RadarRunRequest.model_validate({**req_body, "window": {"since": since.isoformat(), "until": until.isoformat()}})


__all__ = ["recalled", "rows", "stamp", "window"]
