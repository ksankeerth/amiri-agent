"""Runs one check locally and prints the result as JSON.

    uv run python scripts/run_check.py                 # openapi.yaml's example request
    uv run python scripts/run_check.py request.json    # your own request

Model credentials come from .env (see .env.example). If MODEL_MIN_INTERVAL_SECONDS
is set (development only, e.g. 13 for 5 requests per minute), model requests are
spaced that far apart by devtools/pacing.py; otherwise nothing waits.
"""

import asyncio
import json
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
load_dotenv(PROJECT / ".env")

from app.check_runner import run_check  # noqa: E402
from app.contract import CheckRequest  # noqa: E402
from devtools import pacing  # noqa: E402


def load_request(path: str | None) -> CheckRequest:
    if path:
        return CheckRequest.model_validate(json.loads(Path(path).read_text()))
    spec = yaml.safe_load((PROJECT / "openapi.yaml").read_text())
    body = spec["paths"]["/checks"]["post"]["requestBody"]["content"][
        "application/json"
    ]["example"]
    return CheckRequest.model_validate(body)


if __name__ == "__main__":
    pacing.install()
    result = asyncio.run(
        run_check(load_request(sys.argv[1] if len(sys.argv) > 1 else None))
    )
    print(result.model_dump_json(indent=2))
