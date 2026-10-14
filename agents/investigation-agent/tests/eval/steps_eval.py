"""Evaluates the agent's two model steps against labelled hard cases, with the real model.

    uv run python -m tests.eval.steps_eval            # writes tests/eval/RESULTS.md

The cases are tests/fixtures/investigation-test-findings.json: 12 findings, each with
the themes a correct reading gives and the product x angle pairs a correct investigation
must consider.

  classify  the model reads each finding: are its themes (theme and direction) the
            expected ones, and is the country right? Scored per case: exact set, lead theme.
  screen    with the expected reading given (so classify errors don't leak in), the model
            screens the listed candidates: is every must-consider pair kept?

The code half (listing, never listing the must-not pairs) is proven by tests/unit/test_tracks.py.
"""

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parents[2]
RESULTS = Path(__file__).parent / "RESULTS.md"
OUT = ROOT / "data" / "eval_steps.json"

# The mock catalogs' products, in Metrics Spec terms (category, product type).
SPEC = {
    "youth_savings": ("savings", "savings_account"), "elders_savings": ("savings", "savings_account"),
    "child_savings": ("savings", "savings_account"), "term_deposit": ("savings", "term_deposit"),
    "nrfc_pfca": ("savings", "fc_deposit"), "retirement_plan": ("wealth", "retirement_plan"),
    "pawning_loan": ("gold_loan", "gold_loan"), "personal_loan": ("retail_loan", "personal_loan"),
    "housing_loan": ("retail_loan", "housing_loan"), "vehicle_leasing": ("vehicle_finance", "vehicle_lease"),
    "credit_card": ("cards", "credit_card"), "corporate_loan": ("business_loan", "term_loan"),
    "sme_loan": ("business_loan", "working_capital"), "startup_loan": ("business_loan", "term_loan"),
    "term_life": ("life", "term_life"), "endowment": ("life", "savings_life"),
    "individual_health": ("health", "individual_health"), "family_health": ("health", "individual_health"),
    "motor": ("motor", "private_motor"), "travel": ("travel", "single_trip"),
    "migrant_worker_travel": ("travel", "migrant_worker"), "home_fire": ("property", "home"),
    "business_property": ("property", "commercial_property"),
}  # fmt: skip
INSTITUTIONS = {
    "bank": {"name": "Serendib Commercial Bank", "institution_type": "bank", "country": "LK", "country_name": "Sri Lanka",
             "currency": "LKR", "time_zone": "Asia/Colombo",
             "summary": "A Sri Lankan commercial bank: retail savings, pawning, consumer and business loans."},
    "insurer": {"name": "Serendib General Insurance", "institution_type": "insurer", "country": "LK",
                "country_name": "Sri Lanka", "currency": "LKR", "time_zone": "Asia/Colombo",
                "summary": "A Sri Lankan composite insurer: life, health, motor, travel and property."},
}  # fmt: skip


async def classify_case(llm, case, inst) -> dict:
    from app.steps import classify_prompt, classify_schema, read_classification
    from tests.unit.test_tracks import finding

    f = finding(case)
    answer, _ = await llm("classify", classify_prompt(f, inst), classify_schema(inst))
    r = read_classification(f, answer, inst)
    got = [f"{t.theme}:{t.direction}" for t in r.themes]
    want = case["expected"]["themes"]
    country = "other" if case["id"] == "T3" else "home"
    return {
        "id": case["id"],
        "want": want,
        "got": got,
        "exact": set(got) == set(want),
        "lead": got[:1] == want[:1],
        "country_ok": r.country == country,
        "country": r.country,
    }


async def screen_case(llm, case) -> dict:
    from app.contract import InvestigationRequest
    from app.investigate import Investigation
    from tests.scenarios.data import FixtureData
    from tests.unit.test_tracks import BANK, INSURER, finding

    expected = case["expected"]["themes"]

    async def steps(step, prompt, schema):
        if step == "classify":  # the expected reading, as a correct model gives it
            themes = [
                dict(zip(("theme", "direction"), t.split(":"), strict=True))
                for t in expected
            ]
            for t in themes:
                if (
                    t["theme"] == "disaster"
                    and "flood" in case["finding"]["title"].lower()
                ):
                    t["item"] = "flood"
            return {
                "themes": themes,
                "country": "other" if case["id"] == "T3" else "home",
                "channel": "none",
                "size_value": None,
                "size_unit": "none",
            }, "expected"
        return await llm(step, prompt, schema)

    kept, why = set(), {}
    for kind, products in (("bank", BANK), ("insurer", INSURER)):
        f = finding(case).model_dump(mode="json")
        req = InvestigationRequest.model_validate(
            {
                "run_id": f"eval-{case['id']}-{kind}",
                "institution_id": kind,
                "server_url": "http://eval",
                "institution": INSTITUTIONS[kind],
                "findings": [f],
                "validation": False,
                "products": [
                    {
                        "product_id": p,
                        "name": p.replace("_", " "),
                        "category": SPEC[p][0],
                        "product_type": SPEC[p][1],
                    }
                    for p in products
                ],
            }
        )
        result = await Investigation(req, steps, FixtureData(f"mock-{kind}")).run()
        kept |= {
            (p, s.angle)
            for s in result.screening
            if s.decision == "kept"
            for p in s.product_ids
        }
        # why a pair wasn't kept: code's reasons first, then the model's
        for c in result.context:
            why.setdefault((c.product_id, c.angle), "context")
        for s in result.screening:
            for p in products:
                if products[p] != s.product_type or (p, s.angle) in kept:
                    continue
                why.setdefault(
                    (p, s.angle),
                    "cap"
                    if s.decision == "cut_by_cap"
                    else "no metric"
                    if s.reason.startswith("None of these products")
                    else "angle rejected"
                    if s.decision == "rejected"
                    else "product not chosen",
                )
    types = {**BANK, **INSURER}
    wanted = []
    for e in case["expected"]["must_screen_in"]:
        if e["product"].startswith("type:"):
            wanted += [
                (p, e["angle"]) for p, t in types.items() if t == e["product"][5:]
            ]
        else:
            wanted.append((e["product"], e["angle"]))
    code = ("cap", "context", "no metric")
    no_data = [
        f"{p}.{a} ({why[(p, a)]})"
        for p, a in wanted
        if (p, a) not in kept and why.get((p, a)) in code
    ]
    missed = [
        f"{p}.{a} ({why.get((p, a), 'not listed')})"
        for p, a in wanted
        if (p, a) not in kept and why.get((p, a)) not in code
    ]
    return {
        "id": case["id"],
        "wanted": len(wanted) - len(no_data),
        "kept": len(wanted) - len(no_data) - len(missed),
        "missed": missed,
        "no_data": no_data,
    }


async def main() -> int:
    load_dotenv(ROOT / ".env")
    sys.path.insert(0, str(ROOT))
    from app import models
    from app.contract import Institution
    from app.steps import GeminiSteps
    from tests.unit.test_tracks import CASES

    llm = GeminiSteps()
    inst = Institution.model_validate(INSTITUTIONS["bank"])
    classify = [await classify_case(llm, c, inst) for c in CASES]
    screen = [await screen_case(llm, c) for c in CASES]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"classify": classify, "screen": screen}, indent=1))
    n = len(classify)
    want, got = sum(s["wanted"] for s in screen), sum(s["kept"] for s in screen)
    lines = [
        "# Model steps, evaluated",
        "",
        f"Run {datetime.now(UTC):%Y-%m-%d %H:%M} UTC · models {', '.join(models.model_chain())} · "
        "`uv run python -m tests.eval.steps_eval` · cases: tests/fixtures/investigation-test-findings.json",
        "",
        f"- **Classify:** themes exactly right {sum(c['exact'] for c in classify)}/{n}, lead theme right "
        f"{sum(c['lead'] for c in classify)}/{n}, country right {sum(c['country_ok'] for c in classify)}/{n}",
        f"- **Screen:** must-consider pairs the model kept {got}/{want}; another "
        f"{sum(len(s['no_data']) for s in screen)} never reach it (cut by the per-type cap, context only, "
        "or no metric in the mock data)",
        "",
        "| Case | Expected themes | Model's themes | Country | Screen: kept | Not kept by the model | Decided by code |",
        "|---|---|---|---|---|---|---|",
    ]
    for c, s in zip(classify, screen, strict=True):
        lines.append(
            f"| {c['id']} | {', '.join(c['want'])} | {', '.join(c['got']) or '—'}{'' if c['exact'] else ' ✗'} | "
            f"{c['country']}{'' if c['country_ok'] else ' ✗'} | {s['kept']}/{s['wanted']} | {', '.join(s['missed'])} | "
            f"{', '.join(s['no_data'])} |"
        )
    RESULTS.write_text("\n".join(lines) + "\n")
    print("\n".join(lines[4:6]))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
