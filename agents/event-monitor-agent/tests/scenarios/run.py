"""Runs the monitor scenarios with the live model and scores each result.

    uv run python -m tests.scenarios.run                # every scenario once
    uv run python -m tests.scenarios.run --only quota_cut,id_flood --repeat 3
    uv run python -m tests.scenarios.run --env ../investigation-agent/.env   # another .env's credentials

Web search and pages are stubbed with each scenario's sources (repeatable; no Google Search
grounding quota needed): the model is live and must search, judge and cite. Credentials
come from .env. Every run is appended to data/scenario_runs.jsonl; the summary goes to
tests/scenarios/RESULTS.md.
"""

import argparse
import asyncio
import json
import sys
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parents[2]
RUNS_FILE = ROOT / "data" / "scenario_runs.jsonl"
RESULTS = Path(__file__).parent / "RESULTS.md"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help="comma-separated scenario names")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--env", type=Path, default=ROOT / ".env", help="the .env with the model credentials")
    args = parser.parse_args()
    load_dotenv(args.env)

    import app.agent  # noqa: F401  (the real models and reviewer)
    from app import models, pages, web_search
    from app.check_runner import run_check
    from app.contract import CheckRequest
    from tests.scenarios.catalog import SCENARIOS, evaluate

    chosen = [s for s in SCENARIOS if not args.only or s.name in args.only.split(",")]
    RUNS_FILE.parent.mkdir(parents=True, exist_ok=True)
    history: dict[str, list[bool]] = defaultdict(list)
    fails: dict[str, set[str]] = defaultdict(set)
    for round_no in range(1, args.repeat + 1):
        print(f"--- round {round_no} ---")
        for s in chosen:
            sources = [{"url": x.url, "title": "grounding link"} for x in s.sources]
            page_map = s.pages()

            async def search(query, since, until, sources=sources, answer=s.answer):
                return {"answer": answer, "sources": sources}

            async def read(url, page_map=page_map):
                return page_map.get(url) or pages.Page(
                    url, None, None, error="HTTP 404"
                )

            web_search.set_searcher(search)
            pages.set_reader(read)
            started = time.monotonic()
            req = CheckRequest.model_validate(
                {**s.request, "run_id": f"scen-{s.name}-{round_no}"}
            )
            try:
                result = asyncio.run(run_check(req)).model_dump(mode="json")
                checks, error = evaluate(s, result), None
            except Exception as e:
                result, checks, error = None, [], f"{type(e).__name__}: {e}"
            passed = error is None and all(c["ok"] for c in checks)
            history[s.name].append(passed)
            print(f"{'PASS' if passed else 'FAIL'}  {s.name:<15} {time.monotonic() - started:5.1f}s  "
                  f"{result['usage']['model_calls'] if result else 0:>2} model calls")  # fmt: skip
            for c in checks:
                if not c["ok"]:
                    print(f"      failed: {c['check']}  ({c.get('detail', '')})")
                    fails[s.name].add(c["check"])
            if error:
                print(f"      error: {error}")
                fails[s.name].add(error)
            with RUNS_FILE.open("a") as f:
                f.write(json.dumps({"at": datetime.now(UTC).isoformat(timespec="seconds"), "contract": "2.0",
                                    "scenario": s.name, "round": round_no, "passed": passed, "error": error,
                                    "checks": checks, "result": result}) + "\n")  # fmt: skip
    total = [p for runs in history.values() for p in runs]
    lines = [
        "# Monitor check scenarios, live",
        "",
        f"Run {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · agent {', '.join(models.model_chain())} · reviewer "
        f"{', '.join(models.reviewer_chain())} · {args.repeat} round(s) · web search and pages stubbed "
        "with each scenario's sources · `uv run python -m tests.scenarios.run`",
        "",
        f"**{sum(total)}/{len(total)} passed.**",
        "",
        "| Scenario | About | Passed | Failed checks |",
        "|---|---|---|---|",
    ]
    about = {s.name: s.about for s in chosen}
    for name, runs in history.items():
        lines.append(
            f"| `{name}` | {about[name]} | {sum(runs)}/{len(runs)} | {'; '.join(sorted(fails[name]))} |"
        )
    lines += [
        "",
        "Earlier results (contract 1.x, feed store, 9 Oct 2026) are in git history: this contract replaced",
        "feeds and signals with web search only.",
    ]
    RESULTS.write_text("\n".join(lines) + "\n")
    print(f"\n{sum(total)}/{len(total)} passed; summary in {RESULTS.relative_to(ROOT)}")
    return 0 if all(total) else 1


if __name__ == "__main__":
    sys.exit(main())
