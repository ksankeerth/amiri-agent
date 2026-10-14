"""Writes openapi.yaml from the API's models (app/contract.py) and examples (app/examples.py).

    uv run python scripts/write_openapi.py

tests/unit/test_contract.py fails when openapi.yaml is out of date.
"""

import sys
from pathlib import Path

import yaml
from fastapi import FastAPI

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DESCRIPTION = """\
Runs one check for one monitor (contract 2.0).
The request carries the monitor's specification, the institution from its profile, the check's
window and its web search budget; in a simulation, the headlines to read instead (provided_news).

The agent searches the web (Gemini with Google Search grounding, with fallback across models), reads
each source page's own publication time and title (code), and reports news_match findings: stories
that meet one of the monitor's "tell me if" lines. Only pages dated inside the window (less a grace,
PAGE_DATE_GRACE_HOURS) and not in recent_urls can support a finding. Numbers, names and quotes are
checked against the evidence, and a reviewer model reads every finding.

Flow: POST /checks starts a run and returns 202 at once; GET /checks/{run_id} returns its status,
and the result once finished. The same run_id never starts a second run; runs are kept 24 hours.

Private data: spec.private and institution.notes only help judge relevance; a web search query
containing a private word is refused. Timestamps are RFC 3339 UTC; dates are YYYY-MM-DD.
"""


def build() -> dict:
    from app import check_api, examples

    app = FastAPI(
        title="Monitor agent - Check API", version="2.0.0", description=DESCRIPTION
    )
    app.include_router(check_api.router)
    spec = app.openapi()
    post = spec["paths"]["/checks"]["post"]
    post["requestBody"]["content"]["application/json"]["example"] = examples.REQUEST
    get = spec["paths"]["/checks/{run_id}"]["get"]
    get["responses"]["200"]["content"]["application/json"]["examples"] = {
        "completed": {"value": examples.COMPLETED},
        "running": {"value": examples.RUNNING},
        "failed": {"value": examples.FAILED},
    }
    return spec


def text() -> str:
    return yaml.safe_dump(build(), sort_keys=False, allow_unicode=True, width=110)


if __name__ == "__main__":
    (ROOT / "openapi.yaml").write_text(text())
    print("wrote openapi.yaml")
