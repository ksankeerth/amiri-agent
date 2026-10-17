"""Saves one real Radar query's rows as a test fixture, so scoring can be tuned offline.

    uv run python scripts/capture_fixture.py REQUEST.json SINCE UNTIL tests/fixtures/NAME.jsonl.gz [--dry-run]

REQUEST.json is a radar run request (as the server sends it); SINCE and UNTIL are RFC 3339 times
(at most two UTC days). The query goes through the agent's own cost guards (app/bq.py): a dry
run, the per-query cap, and the daily and monthly budgets. It bills real bytes, so run it only
when the fixture must change. The rows are trimmed to what the code reads: theme and
organisation offsets are dropped, locations keep type#name#country#ADM1.
"""

import argparse
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def trim(row: dict) -> dict:
    codes = lambda s: ";".join(dict.fromkeys(x.split(",")[0] for x in (s or "").split(";") if x))  # noqa: E731
    locs = ";".join("#".join(b.split("#")[:4]) for b in (row.get("locations") or "").split(";") if b)
    return {**row, "themes": codes(row.get("themes")), "orgs": codes(row.get("orgs")), "locations": locs}


def main() -> None:
    from app import settings
    from app.bq import BigQuery, cap
    from app.contract import RadarRunRequest
    from app.queries import plan

    ap = argparse.ArgumentParser()
    ap.add_argument("request")
    ap.add_argument("since")
    ap.add_argument("until")
    ap.add_argument("out")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    body = json.loads(Path(a.request).read_text())
    body["window"] = {"since": a.since, "until": a.until}
    req = RadarRunRequest.model_validate(body)
    q, _ = plan(req)
    bq = BigQuery()
    planned = bq.dry_run(q.sql, q.params)
    print(f"days {[d.isoformat() for d in q.days]}, clamped {q.clamped}: the query would read {planned / 1e9:.2f} GB")
    if a.dry_run:
        return
    ran = bq.run(q.sql, q.params, cap(req.limits.max_bytes_per_query))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt") as f:
        for r in ran.rows:
            f.write(json.dumps(trim(r), default=str) + "\n")
    print(f"{len(ran.rows)} rows (row limit {settings.integer('BQ_ROW_LIMIT')}), "
          f"{ran.bytes_billed / 1e9:.2f} GB billed -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
