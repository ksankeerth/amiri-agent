# Austin Tech Bank (US region pack)

Austin Tech Bank: a synthetic mid-size Austin bank, built from the public product mix of US technology lenders and
Texas commercial banks. Book sizes are illustrative. Load once, on an empty platform.

It is **invented**: no real bank has this name, and the profile names no real bank, not even as a rival (rivals are
empty). Radar's named actors come from its regulators and two counterparties: ERCOT and the Fedwire Funds Service.

## What `bundle.json` holds

One file with everything a platform needs:

| Part | What |
|---|---|
| `institution`, `sections` | The profile, as `POST /api/v1/institutions:import` takes it. Footprint: the US home market, Texas and part of California. Watch places: Silicon Valley (San Jose), Austin, Dallas-Fort Worth, the Permian Basin (Midland). Six customer groups and eleven products. The US regulators from the rule table, plus FinCEN. |
| `series` | Four market series: Nasdaq-100, natural gas, oil and 7-10 year Treasury funds (no single stocks). |
| `monitors` | Seven live monitors: tech layoffs, Austin housing, bank-level evidence, data centers, Texas power, fund stress, startup funding. None watches elections or party politics. |
| `sample_data` | Switches the sample bank on, so Verification has figures to compare. |
| `after_load` | Activate, one Radar run, one check per live monitor. |

The source is `global-support/us-bank/` (outside the repository). `make_bundle.py` builds this file and validates it
with the server's own models. Change the source and rebuild; don't edit only this copy.

## How to load it

The deployment needs `SUPPORTED_REGION=us`. The default (`japac`) refuses a US home country. A deployment holds one
sample bank at a time, so the US bank runs in its own deployment. The platform must be empty (Settings › Reset the
prototype… › Empty).

To load it: import `institution` and `sections` (Institution › Import a whole profile), activate it, add the
series on Market series, enter the monitors (Monitors › New monitor), and switch the sample bank on (Data
connections). Leave the after-load actions (a Radar run, one check per monitor) for when you mean to spend on
Gemini, BigQuery and web search.

The US region pack is chosen from the home country. See [Region harnesses](../../README.md#region-harnesses).
