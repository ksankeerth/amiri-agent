"""Runs one investigation locally (real Gemini, coverage from amiri-server) and prints the result.

    uv run python scripts/run_investigation.py scripts/requests/big_move_local.json
    uv run python scripts/run_investigation.py req.json --env ../event-monitor-agent/.env

Start amiri-server first (amiri-agent/server: uv run amiri serve); the request's server_url points at it.
Model credentials come from .env (or --env).
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("request", type=Path)
    parser.add_argument("--env", type=Path, default=PROJECT / ".env")
    args = parser.parse_args()
    load_dotenv(args.env)

    from app.contract import InvestigationRequest
    from app.investigation_runner import run_investigation

    req = InvestigationRequest.model_validate(json.loads(args.request.read_text()))
    result = asyncio.run(run_investigation(req))
    print(result.model_dump_json(indent=2, by_alias=True))
