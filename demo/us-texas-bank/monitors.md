# Monitors for the synthetic Dallas bank

Three monitors to enter in the app (**Monitors › New monitor**, or ask the setup agent), once the profile is
imported and live. Each one is written for a product and the customer group it reaches. None of them watches
elections, campaigns or party politics, and every one says so in its *Ignore* lines.

Keep the alert level at 6. Write key dates and thresholds only when the team has a real one.

## 1. Dallas-Fort Worth data-center projects

| Field | Value |
|---|---|
| Name | Dallas-Fort Worth data-center projects |
| In one sentence | Data-center projects in Dallas-Fort Worth that are delayed, paused or cancelled, which reaches our construction borrowers' work and credit lines. |
| Watch | **Dallas-Fort Worth** (place; also: DFW, Dallas, Fort Worth, North Texas) · **data centers** (topic; also: data center, hyperscale campus, AI data center) |
| Tell me if | 1. A data-center project in Dallas-Fort Worth is delayed, paused or cancelled.<br>2. A developer or tenant cuts or defers data-center spending in North Texas.<br>3. Contractors on a North Texas data-center project report stopped work or unpaid invoices. |
| Ignore | New projects announced with no change to existing ones · Elections, campaigns and party politics |
| Places | US-TX, city:dallas, city:fort-worth |
| Owner · also notify | Commercial banking · Risk management |
| Check every | 6 hours (360 minutes) |
| How it reaches us (private) | Data-center and construction contractors (`dc-contractors`) draw harder on Business Credit Lines (`credit-lines`) when projects stall. |

## 2. ERCOT large-load curtailments

| Field | Value |
|---|---|
| Name | ERCOT large-load curtailments |
| In one sentence | ERCOT orders or rule changes that curtail power to large loads in Texas, such as data centers and plants. |
| Watch | **ERCOT** (organisation; also: Electric Reliability Council of Texas, Texas grid) · **Public Utility Commission of Texas** (organisation; also: PUCT) · **large loads** (topic; also: large-load interconnection, data-center load) |
| Tell me if | 1. ERCOT asks or orders large loads to cut their power use.<br>2. ERCOT or the Public Utility Commission of Texas changes the rules for connecting or curtailing large loads.<br>3. ERCOT declares a grid emergency. |
| Ignore | Routine weather forecasts and power-price commentary · Elections, campaigns and party politics |
| Places | US-TX, city:dallas, city:houston |
| Owner · also notify | Energy lending · Commercial banking |
| Check every | 1 hour (60 minutes) |
| How it reaches us (private) | Energy-intensive manufacturers (`manufacturers`) and data-center contractors (`dc-contractors`) lose output or work, and draw on Business Credit Lines (`credit-lines`). |

## 3. Permian Basin drilling cutbacks

| Field | Value |
|---|---|
| Name | Permian Basin drilling cutbacks |
| In one sentence | Producers or service firms in the Permian Basin cutting rigs, crews or budgets, which reaches our oil and gas borrowers. |
| Watch | **Permian Basin** (place; also: Permian, Midland, Odessa, West Texas) · **drilling rigs** (topic; also: rig count, frac crews) |
| Tell me if | 1. A Permian Basin producer cuts its rigs, crews or capital budget.<br>2. Oilfield service firms in West Texas announce layoffs or idle equipment.<br>3. The weekly Permian rig count falls. |
| Ignore | Quarterly results with no change to drilling plans · Elections, campaigns and party politics |
| Places | US-TX, city:midland |
| Owner · also notify | Energy lending · Risk management |
| Check every | 1 day (1440 minutes) |
| How it reaches us (private) | Oil and gas producers and services (`oil-gas`) miss instalments on Energy Loans (`energy-loans`) and draw down Business Deposits (`business-deposits`). |
