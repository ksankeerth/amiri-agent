"""Prints an investigation scenario's request as JSON, ready to POST to /investigations.

    uv run python scripts/scenario_request.py fx_importers > /tmp/inv.json
    uv run python scripts/scenario_request.py flood_insurer --run-id inv-demo-2

Scenarios are in tests/scenarios/catalog.py; coverage and the calendar come from
amiri-server (server_url).
"""

import argparse
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.scenarios.catalog import SCENARIOS

if __name__ == "__main__":
    names = [s.name for s in SCENARIOS]
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("scenario", choices=names)
    parser.add_argument("--run-id", help="default: inv-<scenario>-<random>")
    args = parser.parse_args()
    scenario = next(s for s in SCENARIOS if s.name == args.scenario)
    run_id = args.run_id or f"inv-{args.scenario}-{uuid.uuid4().hex[:6]}"
    print(json.dumps(scenario.request(run_id), indent=2))
