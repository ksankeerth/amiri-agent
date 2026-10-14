# Model steps, evaluated

Run 2026-10-12 18:11 UTC · models gemini-3.5-flash-lite, gemini-3.1-flash-lite · `uv run python -m tests.eval.steps_eval` · cases: tests/fixtures/investigation-test-findings.json

- **Classify:** themes exactly right 7/12, lead theme right 11/12, country right 12/12
- **Screen:** must-consider pairs the model kept 22/36; another 1 never reach it (cut by the per-type cap, context only, or no metric in the mock data)

| Case | Expected themes | Model's themes | Country | Screen: kept | Not kept by the model | Decided by code |
|---|---|---|---|---|---|---|
| T1 | fx:weaker | fx:weaker | home | 3/3 |  |  |
| T2 | fx:weaker | fx:weaker | home | 0/0 |  |  |
| T3 |  | rates:down ✗ | other | 0/0 |  |  |
| T4 | commodities:up | commodities:up, fx:weaker ✗ | home | 0/0 |  |  |
| T5 | disaster:domestic, regulation:central_bank_relief | disaster:domestic, regulation:central_bank_relief | home | 5/10 | youth_savings.channel (angle rejected), elders_savings.channel (angle rejected), child_savings.channel (angle rejected), term_deposit.channel (angle rejected), business_property.rebuild_cost (not listed) | sme_loan.repayment_stress (no metric) |
| T6 | rates:down | rates:down | home | 3/5 | elders_savings.rate_competitiveness (product not chosen), endowment.investment (not listed) |  |
| T7 | rates:up, markets:bonds_down | rates:up, markets:bonds_up ✗ | home | 3/5 | endowment.investment (not listed), startup_loan.repayment_stress (product not chosen) |  |
| T8 | regulation:tax | regulation:tax, rates:up ✗ | home | 2/2 |  |  |
| T9 | macro:better | macro:better | home | 0/0 |  |  |
| T10 | prices:up, regulation:tariff | prices:up ✗ | home | 3/3 |  |  |
| T11 | trust:rival | trust:rival | home | 1/2 | term_deposit.flows (product not chosen) |  |
| T12 | remittance:down | remittance:down | home | 2/6 | youth_savings.segment (angle rejected), elders_savings.segment (angle rejected), child_savings.segment (angle rejected), term_deposit.segment (angle rejected) |  |
