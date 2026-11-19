# Austin Tech Bank (US region pack)

Austin Tech Bank: a synthetic mid-size Austin bank, built from the public product mix of US technology lenders and
Texas commercial banks. Book sizes are illustrative. Load once, on an empty platform.

It is **invented**: no real bank has this name, and the profile names no real bank, not even as a rival (rivals are
empty). Radar's named actors come from its regulators and two counterparties: ERCOT and the Fedwire Funds Service.

## What `bundle.json` holds

One file with everything a platform needs:

| Part | What |
|---|---|
| `institution`, `sections` | The profile, as `POST /api/v1/institutions:import` takes it. Footprint: the US home market, Texas and part of California. Watch places: Silicon Valley (San Jose), Austin, Dallas-Fort Worth, the Permian Basin (Midland). Six customer groups and twelve products. The US regulators from the rule table, plus FinCEN. |
| `series` | Four market series: Nasdaq-100, natural gas, oil and 7-10 year Treasury funds (no single stocks). |
| `monitors` | Seven live monitors: tech layoffs, Austin housing, bank-level evidence, data centers, Texas power, fund stress, startup funding. None watches elections or party politics. |
| `sample_data` | Switches the sample bank on, so Verification has figures to compare. |
| `after_load` | Activate, one Radar run, one check per live monitor. |

The source is `global-support/us-bank/` (outside the repository). `make_bundle.py` builds this file and validates it
with the server's own models. Change the source and rebuild; don't edit only this copy.

## How to load it

The deployment needs `SUPPORTED_REGION=japac,us` (or `us` alone). The default (`japac`) refuses a US home country.
A deployment holds one sample bank at a time, so the US bank runs in its own deployment, or replaces the Sri Lankan
one after a reset. The platform must be empty (Settings › Reset the prototype… › Empty).

Load it with [`demo/load_bundle.py`](../load_bundle.py) (Python 3.10+, standard library only), against a running
server:

```bash
python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json --plan          # what it would do; writes nothing
python3 demo/load_bundle.py --file demo/austin-tech-bank/bundle.json \
    --base-url http://localhost:8000 --skip-after-load                                 # load, no model calls
```

It refuses unless the platform is empty. Then it imports the profile under the installation's own id
(`INSTITUTION_ID`), activates it, adds the series (a symbol already watched is skipped), writes the monitors, and
switches the sample bank on. Live monitors are submitted by `--actor` (default John) and approved by
`--approver` (default the same person; the server allows that, so give a second name, for example
`--approver Maya`, to record one). Without `--skip-after-load` it also starts one Radar run and checks every live
monitor once. Those call Gemini, BigQuery and web search, so they cost money. Once the monitors are live, the
deployment's tick checks them on their own schedule too.

If a step fails, it stops and lists what it wrote; reset the prototype to "empty" and run it again.

By hand instead: import `institution` and `sections` (Institution › Import a whole profile), activate it, add the
series on Market series, enter the monitors (Monitors › New monitor), and switch the sample bank on (Data
connections).

The US region pack is chosen from the home country. See [Region harnesses](../../README.md#region-harnesses).
