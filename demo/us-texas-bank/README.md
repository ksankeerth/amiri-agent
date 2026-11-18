# Synthetic Dallas bank (US region pack)

An **invented** mid-size commercial bank in Dallas, Texas, built from the public product mix of Texas lenders.
Its name stays **TODO-NAME Bank** until the team picks a synthetic name and checks it against FDIC BankFind. It
names no real bank, not even as a rival. It has no amounts, counts or shares, because none are published for an
invented bank.

| File | What | Where in the app |
|---|---|---|
| `profile.json` | The whole profile: institution, Texas footprint, Dallas, Houston and Midland to watch, five customer groups, six products, US regulators, the Federal Reserve and ERCOT | **Institution › Import a whole profile**, or `POST /api/v1/institutions:import` with the file as it is |
| `series.json` | Five exchange-traded funds: copper, natural gas, oil, and two Treasury bond funds (no single stocks) | **Market series › Add a series**, one at a time |
| `monitors.md` | Three monitors: Dallas-Fort Worth data-center projects, ERCOT large-load curtailments, Permian Basin drilling | **Monitors › New monitor** |

The deployment needs `SUPPORTED_REGION=us`: the default (`japac`) refuses a US home country. It is not one of the
one-click demos (`server/app/demo.py`). A deployment holds one sample bank at a time, so this bank runs in its own
deployment.

The US region pack is chosen from the home country. See [Region harnesses](../../README.md#region-harnesses).
