"""Runs the investigation scenarios live: the real model (AGENT_MODELS, credentials from
.env), with each scenario's data coverage and calendar from fixtures (tests/scenarios/data.py),
so no server is needed. A failure means the model chose differently from a correct reading.

    uv run python -m tests.scenarios.run                    # every scenario once
    uv run python -m tests.scenarios.run --only ph_typhoon,id_dengue
    uv run python -m tests.scenarios.run --repeat 3

Each run is appended to data/investigation_scenarios.jsonl; the summary is written to
tests/scenarios/RESULTS.md.
"""

import argparse
import asyncio
import json
import sys
import time
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parents[2]
RUNS_FILE = ROOT / "data" / "investigation_scenarios.jsonl"
RESULTS = Path(__file__).parent / "RESULTS.md"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help="comma-separated scenario names")
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")

    from app import models
    from app.contract import InvestigationRequest
    from app.investigate import Investigation
    from app.steps import GeminiSteps
    from tests.scenarios.catalog import SCENARIOS, evaluate
    from tests.scenarios.data import FixtureData

    chosen = [s for s in SCENARIOS if not args.only or s.name in args.only.split(",")]
    RUNS_FILE.parent.mkdir(parents=True, exist_ok=True)
    history: dict[str, list[bool]] = defaultdict(list)
    fails: dict[str, list[str]] = defaultdict(list)
    calls: dict[str, list[int]] = defaultdict(list)
    llm = GeminiSteps()
    for round_no in range(1, args.repeat + 1):
        print(f"--- round {round_no} ---")
        for s in chosen:
            req = InvestigationRequest.model_validate(
                s.request(f"inv-{s.name}-{uuid.uuid4().hex[:6]}")
            )
            started = time.monotonic()
            try:
                result = asyncio.run(
                    Investigation(req, llm, FixtureData(s.coverage)).run()
                )
                result = result.model_dump(mode="json", by_alias=True)
                checks, error = evaluate(s, result), None
            except Exception as e:
                result, checks, error = None, [], f"{type(e).__name__}: {e}"
            passed = error is None and all(c["ok"] for c in checks)
            history[s.name].append(passed)
            n = result["usage"]["model_calls"] if result else 0
            calls[s.name].append(n)
            print(f"{'PASS' if passed else 'FAIL'}  {s.name:<18} {time.monotonic() - started:5.1f}s  "
                  f"{n:>2} model calls  {len(result['tasks']) if result else 0:>2} tasks")  # fmt: skip
            if error:
                print(f"      error: {error}")
                fails[s.name].append(error)
            for c in checks:
                if not c["ok"]:
                    print(f"      failed: {c['check']}  ({c.get('detail', '')})")
                    fails[s.name].append(c["check"])
            with RUNS_FILE.open("a") as f:
                f.write(json.dumps({"at": datetime.now(UTC).isoformat(timespec="seconds"),
                                    "scenario": s.name, "round": round_no, "passed": passed,
                                    "error": error, "checks": checks, "result": result}) + "\n")  # fmt: skip
    total = [p for runs in history.values() for p in runs]
    lines = [
        "# Investigation scenarios, live",
        "",
        f"Run {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · models {', '.join(models.model_chain())} · "
        f"{args.repeat} round(s) · `uv run python -m tests.scenarios.run`",
        "",
        f"**{sum(total)}/{len(total)} passed.**",
        "",
        "| Scenario | About | Passed | Model calls | Failed checks |",
        "|---|---|---|---|---|",
    ]
    about = {s.name: s.about for s in chosen}
    for name, runs in history.items():
        lines.append(
            f"| `{name}` | {about[name]} | {sum(runs)}/{len(runs)} | {round(sum(calls[name]) / len(runs), 1)} | "
            f"{'; '.join(sorted(set(fails[name]))) or ''} |"
        )
    RESULTS.write_text("\n".join(lines) + "\n")
    print(f"\n{sum(total)}/{len(total)} passed; summary in {RESULTS.relative_to(ROOT)}")
    return 0 if all(total) else 1


if __name__ == "__main__":
    sys.exit(main())
