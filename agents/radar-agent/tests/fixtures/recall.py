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


from app.queries import _ENTITIES as ENTITIES  # noqa: E402  (the SQL's own list)


def sql_clean(raw: str | None) -> str:
    """queries.SQL_REGION's title cleaning, step by step (the separators' entities decoded twice, whitespace
    collapsed, a shorter outlet name after the last separator or before a leading pipe dropped)."""
    t = raw or ""
    for _ in range(2):
        for old, new in ENTITIES:
            t = t.replace(old, new)
    t = re.sub(r"\s+", " ", t).strip()
    suffix = re.match(r"^(.*\S) [|\u2013\u2014-] ([^|\u2013\u2014]{2,40})$", t)
    if suffix and len(suffix.group(2)) < len(suffix.group(1)):
        t = suffix.group(1)
    prefix = re.match(r"^([^|]{2,30}) \| (.+)$", t)
    if prefix and len(prefix.group(1)) < len(prefix.group(2)):
        t = prefix.group(2)
    return t.strip().lower()



def relevant(v: dict, themes: str, t: str) -> bool:
    """queries._RELEVANT: a relevance theme (not with a politics theme) or a relevance word in the title."""
    def has(pattern, text):
        return bool(pattern) and bool(re.search(pattern, text))
    if not v["home_themes"] and not v["home_words"]:
        return True
    return (has(v["home_themes"], themes) and not has(v["politics_themes"], themes)) or has(v["home_words"], t)


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
        t = sql_clean(r.get("title")) if "home_adm1" in v else (r.get("title") or "").lower()
        has = lambda pattern, text: bool(pattern) and bool(re.search(pattern, text))  # noqa: E731
        themes = ";".join(f"{c},0" for c in r["themes"].split(";") if c)
        if "home_adm1" in v:  # a region pack's query (queries.SQL_REGION)
            adm1 = [b.split("#")[3] if len(b.split("#")) > 3 else "" for b in r["locations"].split(";") if b]
            o = (r.get("outlet") or "").lower()
            def on(ds, o=o):
                return any(o == d or o.endswith("." + d) for d in ds)
            r_home = (((has(v["home_names"], t) or sum(x in v["home_adm1"] for x in adm1) >= v["home_mentions"]
                        or on(v["relevant_outlets"]))
                       and relevant(v, r.get("themes") or "", t))
                      or any(o == d or o.endswith("." + d) for d in v["home_outlets"]))
        else:
            r_home = (has(v["home_names"], t) or home_n >= v["home_mentions"]
                      or (r.get("outlet") or "").lower().endswith(v["home_domain"]))
        r_foot = (has(v["foot_names"], t) or (share_n >= 2 and share_n >= v["share"] * len(locs))) and has(v["themes"], themes)
        r_place = has(v["place_names"], t)
        if "home_adm1" in v:  # a region pack: a place's name needs a relevance theme or word too
            r_place = r_place and relevant(v, r.get("themes") or "", t)
        orgs = " ".join(o for o in r["orgs"].split(";") if o).lower()
        r_actor = (home_n > 0 or foot_n > 0) and has(v["actor_names"], f"{orgs} {t}")
        if r_home or r_foot or r_place or r_actor:
            out.append({**r, "r_home": r_home, "r_footprint": r_foot, "r_place": r_place, "r_actor": r_actor})
    return sorted(out, key=lambda r: -int(r["DATE"]))[: v["row_limit"]]


def window(req_body: dict, since: datetime, until: datetime) -> RadarRunRequest:
    return RadarRunRequest.model_validate({**req_body, "window": {"since": since.isoformat(), "until": until.isoformat()}})


__all__ = ["recalled", "rows", "stamp", "window"]
