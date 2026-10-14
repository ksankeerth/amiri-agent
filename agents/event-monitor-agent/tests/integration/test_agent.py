# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""A real check with the real model, on the seeded scenario.

Needs model credentials (see .env) and data/feeds.db
(uv run python scripts/seed_feed_db.py).
"""

import asyncio
from pathlib import Path

import yaml

from app.check_runner import run_check
from app.contract import CheckRequest

ROOT = Path(__file__).parents[2]


def example_request(**changes) -> CheckRequest:
    spec = yaml.safe_load((ROOT / "openapi.yaml").read_text())
    body = spec["paths"]["/checks"]["post"]["requestBody"]["content"][
        "application/json"
    ]["example"]
    return CheckRequest.model_validate({**body, **changes})


def test_check_explains_the_seeded_spike() -> None:
    result = asyncio.run(run_check(example_request(web_search=None)))

    assert result.stop_reason == "finished", result.summary
    cited = {(n.feed_id, n.item_id) for f in result.findings for n in f.evidence.news}
    signals = {s.signal_id for f in result.findings for s in f.evidence.signals}
    assert ("dailymirror_business", "dm-2026-10-08-0412") in cited, (
        result.model_dump_json(indent=1)
    )
    assert "sig-71b41f5621e91ca1" in signals
    assert all(c.complete for c in result.coverage), result.coverage
    assert not any(t.tool == "web_search" for t in result.tool_trace)
    # A 0.88% move does not meet "USD/LKR moves more than 1% in a day" (line 2).
    assert all(2 not in f.tell_me_if_lines for f in result.findings), result.findings
