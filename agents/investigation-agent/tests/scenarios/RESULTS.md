# Investigation scenarios, live

Run 2026-10-12 17:54 UTC · models gemini-3.5-flash-lite, gemini-3.1-flash-lite · 2 round(s) · `uv run python -m tests.scenarios.run`

**32/32 passed.**

| Scenario | About | Passed | Model calls | Failed checks |
|---|---|---|---|---|
| `fx_importers` | USD/LKR +1.45% in a trading day (series), and the news about it (monitor). | 2/2 | 4.0 |  |
| `fx_series_only` | The same move from the series alone: no model call to classify it. | 2/2 | 3.0 |  |
| `fx_small_move` | USD/LKR +0.85%: below the importer mechanisms' 1% minimum. | 2/2 | 0.0 |  |
| `foreign_fx_move` | USD/INR up 1.2%: a foreign currency with no flow home. | 2/2 | 0.0 |  |
| `rate_cut` | CBSL cuts the Overnight Policy Rate by 25bp. | 2/2 | 3.0 |  |
| `remittance_down` | September remittances down 6% year on year (CBSL monthly data). | 2/2 | 4.0 |  |
| `flood_bank` | Floods in Ratnapura and Kalutara with a CBSL moratorium: the bank's view. | 2/2 | 4.0 |  |
| `flood_insurer` | The same floods: the insurer's view. | 2/2 | 3.0 |  |
| `gold_up` | Gold up 4.1% in 5 days (series): good news for pawning collateral. | 2/2 | 0.0 |  |
| `foreign_rate_cut` | A foreign central bank's rate cut, carried by a Colombo news site. | 2/2 | 1.0 |  |
| `rival_failure` | CBSL cancels a finance company's licence: deposits may flow in. | 2/2 | 2.0 |  |
| `ph_typhoon` | A typhoon makes landfall in Eastern Visayas: farm borrowers there. | 2/2 | 6.0 |  |
| `ph_saudi_jobs` | Saudi Arabia cuts foreign-worker quotas: remittances from there fall. | 2/2 | 4.0 |  |
| `ph_peso_move` | USD/PHP up 1.8% in a day (series): customers buy dollars. | 2/2 | 2.0 |  |
| `id_jakarta_flood` | Floods in Jakarta: home and motor claims there. | 2/2 | 5.0 |  |
| `id_dengue` | A dengue outbreak: micro health claims, not property. | 2/2 | 3.0 |  |
