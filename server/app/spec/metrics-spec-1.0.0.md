# Metrics Spec 1.0.0: aggregated metrics for banks and insurers

**Version** 1.0.0 · **Status** release for implementation feedback · **Published** 11 Oct 2026 · **Revised** 17 Oct 2026 (editorial) · **Publisher** Amiri Agent

**Files:**
- `metrics-spec-1.0.0.pdf`: this guide
- `metrics-spec-1.0.0.yaml`: the same content, machine-readable
- `metrics-spec-1.0.0-openapi.yaml`: the reference API

This spec tells a bank or an insurer **which aggregated numbers to expose, per product category**. For each number it gives:
- what goes in it and what stays out;
- which date each record is booked on, and how to convert currency;
- how to serve it over HTTP.

It works in any country. It names no regulator, calendar, currency or geography as a requirement.

The checks that use the data look for real changes over time, so every number has to be:
- **comparable over time**;
- **safe to share in aggregate**;
- **precise enough that two institutions compute the same value from the same records**.

**Contents.**
1. Purpose, audience and versioning
2. General data rules
3. Capability levels
4. Product taxonomy
5. Metrics per category
6. Validation parameters
7. Standard dimensions
8. Breaks and events
9. Conformance checks and errors
10. Open points and assumptions
11. Event themes each category helps check
12. Counts
13. Common misreadings

---

## 1. Purpose, audience and versioning

### 1.1 What the data is for

A monitoring system watches market and news events: currency moves, rate changes, disasters, regulation, competitor news. From each event it forms hypotheses about how an institution's products could be hit, for example "SME importers will open fewer letters of credit". It then checks each hypothesis against the institution's own aggregated data. The checks are code (statistical tests over time windows), and they answer three questions:
- Is the change real?
- How big is it compared with normal seasonality?
- Is it still developing?

The checks run **inside the institution** (on its premises or in its own cloud). Only verdicts, and the aggregates behind them, leave it.

### 1.2 Who this is for

| Reader | Uses |
|---|---|
| Data and IT teams at banks and insurers | §2 rules, §5 definitions, §7 dimensions, §8 breaks, §9 checks, the reference API (`metrics-spec-1.0.0-openapi.yaml`) |
| Product, risk and finance owners | §4 taxonomy, the "question" of each metric in §5, §3 levels |
| The onboarding connector | the machine-readable spec (`metrics-spec-1.0.0.yaml`) and the reference API: it checks that the institution's API implements the reference API, test-calls the endpoints and reports coverage and fixes |
| The checking system | §6 validation parameters (owned by the checks, not served by institutions) |

### 1.3 How institutions use it

- You keep your own systems, and put an API in front of them that implements the **reference API** (`metrics-spec-1.0.0-openapi.yaml`): its paths, parameters, fields, metric keys and dimension values. This is the only way to connect; there is no per-institution mapping.
- At onboarding, the connector reads your OpenAPI document, checks that it is the reference API (same MAJOR version), test-calls it with the conformance checks (§9) and reports coverage and fixes. A person on your side approves the connection.
- **A coarser grain is accepted at reduced capability.** A daily metric served weekly still counts as served, but the checks that need day-level timing (`recent_vs_prior`) are off for it, and the coverage report says so.
- Start with the **starter set** (R8): about a dozen metrics that most institutions can serve in days. Then add the required metrics of each category you offer.

### 1.4 Versioning

The spec uses semantic versioning, `MAJOR.MINOR.PATCH`.

| Change | Bump |
|---|---|
| Removing a metric, a dimension or a dimension value; changing a definition so that the same records give a different number; changing a metric's kind, unit, currency rule or grain; making an optional API field or parameter required; renaming without an alias | **MAJOR** |
| Adding a category, metric, dimension, dimension value, optional field or alias; moving a metric between `optional` and `recommended`; promoting a metric to `required` (takes effect 12 months after publication) | **MINOR** |
| Wording, examples and typos that change no number | **PATCH** |

**Deprecation and aliases.**
- A metric is never deleted silently. It is first marked `deprecated_in: <version>` with `replaced_by`, and it stays valid for at least 12 months and until the next MAJOR.
- Renamed keys, dimension keys and dimension values keep their old names as **structured aliases** for the whole MAJOR line. Each alias says `old → new`. It may add a filter: if a later version folded a metric `x` into `y` with `source=z`, the alias `x` would mean `y` filtered to `source=z`. It may also be a **context alias** that points to a different metric shown as context. Version 1.0 has no aliases yet.
- An alias's filter is added to the request's filter. A request that sets the same dimension to a different value gets `alias_filter_conflict`.
- `GET /catalog` lists the aliases and deprecations the server honours.

**Validation parameters are versioned separately** (`validation_params_version`). They belong to the checking system, which recalibrates them from placebo runs. Changing them never changes the spec version and never asks anything of an institution.

**Declaring what you implement.** Every conforming API returns the institution profile below in `GET /metrics/v1/catalog`. Every response also carries the header `Metrics-Spec-Version: 1.0.0`. The checks accept any version with the same MAJOR.

| Profile field | Required | What to give | Examples |
|---|---|---|---|
| `institution_type` | yes | `bank` or `insurer`; **one profile per reporting entity and country** | a group with a bank and a takaful subsidiary registers two profiles |
| `spec_version` | yes | the version implemented | `1.0.0` |
| `time_zone` | yes | an IANA name; every date in every response is a local date in this zone | `Asia/Riyadh`, `Europe/Berlin`, `America/Sao_Paulo`, `Africa/Lagos` |
| `business_calendars` | yes | one **primary** calendar, plus one for every region whose holidays or weekend differ; each gives weekend days (ISO weekday numbers), the region_l1 values it covers, and its source (served at `GET /calendar?calendar_id=`, or a named public calendar) | India: a primary calendar plus state calendars for state bank holidays; Malaysia: Kedah, Kelantan and Terengganu on a Friday-Saturday weekend |
| `base_currency` | yes | ISO 4217 code of the reporting currency | `SAR`, `EUR`, `BRL`, `LKR` |
| `base_currency_history` | if any | earlier base currencies, with the redenomination date and legal factor | Sierra Leone: `SLL` until 2022-07-01, factor 1,000 |
| `pivot_currency` | yes | ISO 4217 code used to total original-currency metrics across currencies (default `USD`) | `USD`; `EUR` for a euro-area bank |
| `fx_reference_sources` | yes | per use (default, trade, remittance, card...): the source, rate type (mid) and fixing time of the daily rates used for conversion | a central bank's daily reference rate; ECB euro reference rates; in a multiple-rate regime, the official rate for trade and the declared market rate for remittances |
| `inflation_regime` | yes | `normal`, or `high` (hyperinflationary under IAS 29, or annual CPI inflation above 25%) | Argentina, Türkiye: `high` |
| `region_basis` | banks | `home_branch` (default) or `customer_domicile`; **branchless institutions must use `customer_domicile`** | |
| `region_levels` | yes | how region_l1 and region_l2 are coded (ISO 3166-2, or mapped national codes) | |
| `sector_classification` | yes | ISIC Rev.4, or the classification mapped to it | NACE Rev.2, NAICS 2022 |
| `accounting_framework` | yes | IFRS 9 / IFRS 17, AAOIFI, US GAAP (CECL) or local GAAP, plus `dpd_materiality` (default none), `dpd_reset_on_restructure` (normally false) and a note on how local arrears buckets map to days past due | |
| `suppression` | yes | minimum contributors (default 10) and dominance limits (default one above 50%, two above 85%); a stricter local rule if any | |
| `renewal_grace_days`, `free_look_days` | insurers | grace period before renewals are measured, and free-look period (default 30 days each) | |
| `capability_level` | yes | L1-L5 (§3): the lowest level across your required metrics; metrics may declare their own | |
| `vintages_kept`, `vintage_history_from` | yes | whether you serve vintages (L4), and from which date they are true or reconstructed | |
| `segment_snapshot` | no | how `segment_as_of` is honoured: dated attribute history, weekly snapshots, or static | |
| `shariah_compliant` | no | true for an Islamic bank or a takaful operator (products also carry the flag) | |

### 1.5 Terms used in this guide

| Term | Meaning |
|---|---|
| the checks | The statistical tests that judge an institution's data (§1.1, §6). They run inside the institution. The **checking system** runs them and owns the validation parameters. |
| the connector | The onboarding tool. It reads the institution's OpenAPI document, test-calls the API with the conformance checks (§9) and reports coverage and fixes. |
| task | One hypothesis handed to the checks: a metric of a product, the direction the event should move it, and the expected size (`small`, `medium` or `large`). |
| anchor | The date a task is judged from, normally the date of the event behind it. |
| watch | The periods after the anchor that the checks judge. |
| span, baseline | A span is a run of whole grid periods. The baseline is the set of earlier spans, aligned on the calendar (§2, R2), that the watch is compared with. |
| verdict | The checks' answer on a task: whether the change is real, how big it is against normal seasonality, and whether it is still developing (§1.1). A verdict is provisional or final; §3 (L4) says when it becomes final. |
| stable age | The number of days after a period's last day when its value stops being revised (§6). |
| vintage | A period's value as it was known on a given date (R3, L4). |
| contributor | A distinct customer, obligor, policyholder or merchant behind an aggregate (R1). |
| placebo run | The checks run on past dates where no event is known, to measure how often they would raise a false alarm. The checking system recalibrates the validation parameters with them (§6). |

---

## 2. General data rules

These rules apply to every metric. Each comes with an example that complies and a counter-example that doesn't.

### R1. Aggregates only

Serve totals, counts and ratios over groups of customers. Never serve:
- personal data;
- account, card or policy numbers;
- names, or identifiers of single customers, employers or obligors;
- a single customer's amounts.

**You suppress small or dominated aggregates yourself.** A suppressed row returns value, numerator, denominator, exposure and volume as `null`, with `suppressed: true` and a `suppression_reason`. The full rule:

| Rule | What it says |
|---|---|
| contributors | Suppression counts distinct contributors (customers, obligors, policyholders, merchants), not accounts or transactions. A cell needs at least min_contributors contributors (default 10). |
| dominance | A cell is suppressed when one contributor holds more than 50% of the measured component, or the two largest together hold more than 85% (the (1, 50%) and (2, 85%) dominance rules). A stricter local rule wins. |
| measured component | **flow, count, stock:** the value<br>**net flow:** each gross side (credits and debits) separately<br>**ratio:** the denominator, and the numerator when it is above zero; if only the numerator is dominated, value and numerator are suppressed and the row says suppression_reason: numerator_dominance<br>**rate:** the numerator (events) and the exposure<br>**level (index, median):** medians are served only with at least 20 contributors, as the mean of the 4 central values, rounded to 2 significant figures; indices only from at least 20 priced items |
| filters | A request filters on at most 3 dimensions. The catalog may restrict the combinations it serves (filter_sets). Complementary suppression is computed over every combination the institution serves: no suppressed cell may be derivable from published cells by addition or subtraction. |
| vintages | A revision is released only when the change from the last released vintage, taken as its own aggregate, passes the contributor and dominance rules; until then the earlier value stays served with revision_held: true. Held revisions are released, accumulated, once they pass or when the period reaches its stable age. |
| segment dates | segment_as_of must be a Monday (an ISO-week start). A segment_as_of is refused for a cell (suppression_reason: segment_difference) when the number of customers whose membership differs from the previous Monday's is between 1 and min_contributors - 1. |
| change concentration | Windows a and b are disjoint, each a whole number of grid periods, of equal length, with b after a. The response gives only a band of the top share; no change value. Both windows need at least min_contributors contributors. |
| free text | Break descriptions, notes and declarations never name customers, employers or obligors. |
| audit | Every query is logged. The institution reviews repeated near-identical queries (differencing patterns). |

**Why these rules:**
- **(2, 85%) dominance.** With two contributors at 45% each, the (1, 50%) rule alone lets each one subtract its own amount and learn the other's.
- **Disjoint, equal windows and bands in change-concentration.** Without them, nested windows turn the endpoint's answer into a single day's value. A share multiplied by a change multiplied by a denominator is one obligor's drawdown.
- **The revision and segment-date guards.** They close the two remaining ways of differencing: comparing vintages, and comparing segment dates.

> **Example.** A Brazilian bank serves `facility_utilization` for `size_band=corporate, sector=C` in a week: 41 obligors, the largest at 9% and the two largest at 16% of limits, value 61.2%, numerator BRL 3.1bn, denominator BRL 5.065bn.
>
> **Counter-example.** The same bank serves a cell of 11 obligors where two hold 48% and 40% of limits. The (1, 50%) rule passes it, but each of the two could compute the other's drawing. The (2, 85%) rule suppresses it.

### R2. Absolute time only

Every period is a pair of explicit **local dates in the profile's time zone**: `from` inclusive and `until` exclusive. Periods sit on a fixed grid:
- **business days**, as defined by the calendar that applies;
- **calendar days**, for always-on channels such as card spend and digital transactions;
- **ISO weeks**, Monday 00:00 to the next Monday 00:00;
- **calendar months**;
- **quarters**, for context metrics only.

Never accept or return:
- relative windows such as "last 7 days", "1 hour ago" or "month to date as of now";
- a period that is still open.

A request whose dates are off the metric's grid is rejected with `off_grid` (§9, C04).

**Working weeks other than Monday-Friday.** The grid never depends on the working week:
- **Weeks are ISO weeks everywhere.** Every ISO week holds exactly one of each weekday. So where the working week is Sunday to Thursday (Saudi Arabia, Egypt, Bangladesh), each ISO week still holds the same five working days: Monday to Thursday, plus the Sunday that ends it.
- **Business days come from calendars.** Declare weekend days and holidays, including moving ones (Eid, Diwali, Lunar New Year, Easter, Poya days).
- **Weekend changes are rule changes.** If a weekend changes (the UAE moved to Saturday-Sunday on 1 January 2022), declare a `rule_change` break.

**Calendars per region.** One institution may need several calendars:
- India declares bank holidays per state.
- In Malaysia, Kedah, Kelantan and Terengganu work Sunday to Thursday while most states work Monday to Friday.

So the profile has a **primary calendar** plus one per region that differs. The rules:
- **Booking.** A record's value date that is not a business day **in its own region's calendar** moves to that calendar's next business day.
- **Multi-region totals.** Rows of a request that spans several calendars (a national total) are on the primary calendar's business days. A flow from a region whose business day is not one in the primary calendar moves to the primary calendar's next business day.

**Seasons and salary cycles.** Holiday flags align single days. Many behaviours run for weeks: Ramadan, Lunar New Year, the Diwali season, harvests, school-fee months. Salary cycles may follow a non-Gregorian month (Nepal's Bikram Sambat, Iran's Solar Hijri, Ethiopia's calendar). Calendars therefore carry standard flags, which the checks use for alignment (§6):

| Flag | Meaning |
|---|---|
| `weekend` | a weekend day of this calendar |
| `public_holiday` | a holiday in this calendar (holidays[] names it) |
| `regional_holiday` | a holiday only in some regions; those regions' own calendars carry it as a public_holiday |
| `moving_holiday` | a holiday whose date moves year to year (lunar or lunisolar calendars, Easter) |
| `partial` | a business day with shortened hours |
| `after_holiday` | the first business day after one or more non-business days |
| `salary_day` | a day when the main payroll credits land (e.g. the 25th, the 27th, the last business day, or a local-calendar month start) |
| `pension_day` | a day when public pensions are credited |
| `month_end` | the last business day of the month |
| `quarter_end` | the last business day of the quarter |
| `season:<name>` | a day inside a multi-day season that changes behaviour: season:ramadan, season:lunar_new_year, season:diwali, season:harvest_<crop>, season:school_fees, season:pilgrimage |
| `campaign:<name>` | a day inside a recurring campaign (one-off campaigns are declared as breaks) |
| `dst_change` | a day of 23 or 25 hours (daylight-saving change) |

**Daylight saving.** The time zone is an IANA name, so local dates follow daylight-saving changes. Days of 23 or 25 hours are flagged `dst_change`.

**Which date a flow is booked on** is part of each definition (R4). Nothing is excluded: holiday flows move to the next business day, and the checks compare aligned spans (same business days, same holiday and season make-up, same position in the month).

> **Example.** A German bank's daily `deposit_inflow` row `from: 2026-12-28, until: 2026-12-29` (a business day) includes credits valued on Saturday 26 December (a public holiday and a weekend day) and Sunday 27 December. No row exists for 25-27 December.
>
> **Counter-example.** An Indian bank uses only a national calendar. During Onam, Kerala branches are closed while the calendar says business day, and the state's deposit inflow seems to collapse for two days.

### R3. Every value carries enough to be checked

Every row returned by `GET /series` carries:

| Field | Meaning |
|---|---|
| `from`, `until` | the period, as local dates (R2) |
| `value`, and the series' `unit` and `currency` | the number, its unit, and its currency as an ISO 4217 code (null when the unit isn't money) |
| `numerator`, `denominator` | for ratios: both, from the same records as the value |
| `numerator`, `exposure` | for rates: the events and the units at risk |
| `volume` | the records behind the value. Each metric defines it once (accounts, loans, obligors, policies, transactions), and that definition never changes with the filter |
| `suppressed`, `suppression_reason` | R1 |
| `published_at` | the **local date** this period's value was first produced (L3). `null` for back-filled rows |
| `backfilled` | true for periods produced at onboarding rather than when they closed. The checks treat them as published at their maximum lag; C12 ignores them |
| `data_as_of`, `vintage`, `revised`, `revision_held` | which version of the value this is (L4), and whether a newer revision is being held back by the revision guard (R1) |

**Vintages can be reconstructed.** You don't need to have stored every past publication. For flows and counts, the value "as known through date D" is the sum of entries **posted** by D whose value date is in the period. For stocks and ratios, it comes from the end-of-day snapshots taken by D. State the first date with true or reconstructed vintages as `vintage_history_from`.

> **Example.** An Indian insurer's `claims_per_1000` for motor, week of 2026-11-16, region IN-MH: value 1.8399, numerator 2,113 claims, exposure 1,148,402 insured vehicles, volume 1,148,402, published 2026-11-30, vintage `same_age`.
>
> **Counter-example.** "Claims rose 12%". With no numerator, exposure or volume, nobody can tell whether 12% is 3 claims or 3,000.

### R4. Definitions precise enough that two institutions compute the same number

Each metric in §5 lists what is **in** and what is **out**, its **booking date**, and its **volume**. The following rules hold for every metric unless its row says otherwise.

| Topic | Rule |
|---|---|
| Reversals and corrections | Netted against the **original** transaction's booking date. They revise that period, and you serve the revision as a new vintage, subject to the revision guard (R1). |
| Internal and joint-account transfers | Transfers between accounts a customer holds alone **or jointly** at this institution are own-account transfers, and are out of customer flows. Transfers between **different customers** of this institution count as a debit for one and a credit for the other. Postings to the institution's own, internal, suspense and nostro accounts are always out. |
| Multi-currency accounts | Split by currency. Each foreign-currency part is treated as a foreign-currency product, and the base-currency part as a base-currency one. |
| Auto-renewals and rollovers | Never new business. A term deposit renewed automatically is not a placement; a gold loan renewed at maturity is not a new pledge; a renewed insurance policy is not a new policy. |
| Top-ups | Not new contracts. They are counted separately where they matter (`topups` in gold loans; the renewal top-up above the maturing amount in `td_placements`). |
| Staff | Products offered **only** to staff (staff loans, staff savings schemes) are out. Staff members' ordinary accounts are in, like any customer's. |
| Booking date | For flows: the **value date**, as a local date. Business-day metrics move non-business-day value dates to the region calendar's next business day. Calendar-day metrics keep the transaction's local date; for cards this is the **authorisation** date, not settlement. For stocks: the position at the end of the period's last business day. Each metric names its date (due date, issue date, reported date, trip end date...). |
| Collection rates | **Due-date cohorts.** Instalments and premiums due in the period count as collected if received **by the end of the 3rd business day after the due date**, in the record's calendar. Weekend and holiday due dates get the same time to clear as weekday ones. Each metric's lag includes these days. |
| Currency | A foreign-currency transaction is converted to the base currency **at its own transaction date's reference rate** (from the source declared for that use), never at the period-end rate. A metric **about** foreign currency has the currency rule `original`: served and judged in the currency the customer **paid or was paid in**, and totalled across currencies in the pivot currency at each transaction's own date. For remittances, that is the **sender's instructed currency** from the payment message. Only where a corridor's messages lack it is it the settlement currency, declared per corridor in the catalog. |
| Redenomination and high inflation | A redenominated base currency is restated over the whole history at the legal factor, and declared as a `currency_redenomination` break. Where `inflation_regime: high`, you still serve nominal amounts; the checks judge base-currency amounts in real terms using a CPI reference series (§6). |
| Region | Banks: the account's **home branch** (default) or the **customer's domicile** (declared once in the profile, required where there are no branches). Customer-level metrics (`digital_transactions`, `cash_withdrawals`) use the customer's region, not a device's or agent's location. Branch mergers are `classification_change` breaks. Insurers: the **risk location**, which is each insured location, the vehicle's registered or garaging address, or the insured person's address. |
| Insurance counts | Exposure and claims count **risks** (insured locations, vehicles, lives), not policies. A claim is **one per risk per loss event**: a hailstorm damaging 50 fleet vehicles is 50 claims, and a 40-site policy is 40 locations, each in its own region. Policy counts (`new_policies`) count policies, with the risks they cover as the `risks` extra. A group scheme, fleet or portfolio above 5% of exposure joining or leaving is a `large_scheme_change` break. |
| Frozen attributes: the cohort rule | Customer and account attributes (`segment`, `size_band`, `sector`, `sector_l2`, `employer_sector`, `age_band`, regions) are evaluated **as of `segment_as_of`** when a request gives one, which must be a Monday. Customers who **left before** that date keep the attribute of their **last day**. Customers who **joined after** it take their attribute at onboarding. Limits and other frozen account terms are held at their level on the **earlier of the period's start and the segment date**. So history before the segment date is the ordinary series, and the watch period holds them fixed. Without `segment_as_of`, each period uses the attributes at its own start. |
| Unknown attribute | Records missing an attribute go to the value `unknown`, never dropped, so breakdowns add up to the total (C07). |
| Islamic measurement | Financing balances exclude **unearned (deferred) profit**. Instalments include profit, and ijara rentals count as instalments. Late-payment amounts given to charity are not collections. `offered_rate` is the **announced expected** profit rate, not the rate later distributed. Takaful contributions are **gross of the wakala fee**. |

> **Example (currency).** A Kenyan bank's USD savings product receives USD 1,000 on 3 March and USD 1,000 on 28 March. With `currency_basis=original`, `deposit_inflow` for March is USD 2,000. With `currency_basis=base`, each credit is converted to KES at its own day's reference rate.
>
> **Counter-example.** A UK sender pays GBP 1,000 to a Pakistani bank through a money transfer operator that settles in USD. Serving `inward_remittances` in USD makes a GBP/USD move look like a change in remittances. Serve GBP, the sender's currency.

> **Example (cohort rule).** A Sri Lankan bank checks `installment_collection_rate` for `segment=remittance_linked` with `segment_as_of=2026-09-28`. A borrower whose remittances stopped in October stays in the segment. A borrower who repaid in full in March 2026 is counted with the segment they had on their last day, so year-ago spans aren't survivor-only.
>
> **Counter-example.** Applying today's segment to three years of history. Everyone who stopped receiving remittances drops out of the year-ago base, and a real fall disappears.

### R5. Regions and sectors use standards

- **Regions.** `region_l1` is the first-level subdivision in ISO 3166-2 (LK-1, IN-MH, AE-DU, DE-BY, BR-SP, MX-CMX). `region_l2` is the second level where ISO 3166-2 has one (Sri Lanka's districts, e.g. LK-11). Otherwise it is institution-defined, mapped at onboarding to the national statistics office's area codes, with each value naming its parent. ISO code changes are `classification_change` breaks. Cross-border dimensions use ISO 3166-1 (`corridor`) or UN M49 sub-regions (`destination_region`).
- **Sectors.** Use ISIC Rev.4 **sections** (`sector`, A-U) and **divisions** (`sector_l2`, 01-99), so a shock to one industry can be separated. Garments (14) and food manufacturing (10) are both section C. NACE Rev.2 matches ISIC at these levels; NAICS and national lists are mapped through published concordances. Merchant category codes (ISO 18245) are mapped to ISIC sections through a table you publish with your catalog.

> **Example.** `sector=C, sector_l2=14` (wearing apparel) and `region_l1=SA-01` (Riyadh).
>
> **Counter-example.** `sector=Textiles & Garments` (a label from a local list) or `region=Western`. These are local labels another institution can't match.

### R6. Neutral accounting and regulatory terms

The spec uses IFRS 9 and IFRS 17 concepts. Map your local equivalents once, in the profile's `accounting_framework`.

| Spec term | Meaning | Local equivalents (examples) |
|---|---|---|
| days past due (dpd) | days since the oldest unpaid contractual instalment fell due, ignoring arrears below the declared materiality threshold (default none). **dpd keeps counting through a restructure** and resets only when the arrears are paid. | US GAAP / CECL delinquency days; India's SMA-0/1/2 buckets (1-30, 31-60, 61-90 days); local "arrears" buckets, mapped by their day bounds |
| more than 30 dpd (`_30` keys) | 31 days or more: IFRS 9's rebuttable presumption ("more than 30 days past due") of a significant increase in credit risk (stage 2). Performing = 0-30 dpd. | 30-plus-days-delinquent counted from day 31; India's SMA-1 and worse |
| write-off | the gross carrying amount derecognised because recovery is not reasonably expected | charge-off (US) |
| restructure | a modification because of the borrower's financial difficulty | EBA forbearance; US "modifications to borrowers experiencing financial difficulty"; rescheduling |
| moratorium / relief | a scheme-wide deferral of payments (regulatory or institution-wide) | payment holidays, COVID-19 deferrals, disaster relief schemes, farm-loan waivers |
| gross written premium | premiums written in the period. A non-IFRS 17 measure, still reported to supervisors in most markets. Book size uses the trailing 12-month total | GWP; takaful gross contributions |
| Islamic banking | profit for interest, financing for loan, the same dpd counts, receivables net of unearned profit (R4) | AAOIFI financial accounting standards; murabaha, ijara, musharakah, tawarruq, wadiah, mudarabah |
| Takaful | contribution for premium (gross of the wakala fee); certificate or participant for policy | family takaful (life), general takaful |

The spec never names a regulator as a requirement. Where a local rule is stricter, or forces something the spec forbids (a dpd reset on restructure), declare it in the profile and as a `rule_change` break. The checks then know.

> **Example.** An Indian bank serves `roll_rate_to_30` from SMA-1 and worse (31+ days); a Gulf bank serves 31+ from its delinquency system. They agree.
>
> **Counter-example.** Serving `dpd_30_plus` as "stage 2 loans". Stage 2 also contains loans that are current but riskier, so the number means something else.

### R7. Computable from systems institutions really run

Every metric comes from a system a bank or insurer already runs, without capturing new data. The table shows where.

| Category | Source systems |
|---|---|
| Deposits, payments, remittances, FX | core banking (transactions with codes, value and posting dates, balances), channel logs, ATM and payment switch, remittance platform, treasury/FX dealing system |
| Lending, gold loans, vehicle finance, agricultural lending | loan or lease system (schedules, receipts, dpd snapshots), collections system, origination system, pawning system |
| Cards | card management system (statements, authorisations, settlements, fraud cases), acquiring switch |
| Trade finance | trade-finance system (LCs, collections), SWIFT / payment purpose codes |
| Investments, retirement, bancassurance | plan administration, fund distribution records, bancassurance sales records |
| Insurance | policy administration (inceptions, renewals, in-force risks), premium collection, claims system (notifications, loss events, payments), reinsurance system |

> **Example.** `customer_closures` is closures with a customer-request reason code, per 1,000 open accounts. Both come straight from the account master.
>
> **Counter-example.** "Customer sentiment score from call notes". That needs new capture and judgement, and two institutions would never compute the same number.

### R8. A starter set, then a small required set per category

Go live in two steps:
- **The starter set** (★ in §5), about a dozen metrics. Each is either already in supervisory or management reports, or one query over transaction or snapshot tables. Most institutions can serve it at L2 **in days**.
- **The required metrics** of each category you offer (1-4 per category; `insurer_company` has none). A universal bank offering every bank category has 34, and several need new aggregation (due-date collection rates, card statements, frozen limits). Expect **weeks**, not days.

Everything else is recommended or optional. Vintages (L4) and change concentration (L5) can come later.

| Institution | Category | Metric | Why it's in the starter set |
|---|---|---|---|
| bank | `savings` | `deposit_inflow` | one query over transaction or snapshot tables |
| bank | `savings` | `withdrawals` | one query over transaction or snapshot tables |
| bank | `savings` | `balance` | already in supervisory or management reports |
| bank | `retail_loan` | `roll_rate_to_30` | one query over transaction or snapshot tables |
| bank | `retail_loan` | `outstanding` | already in supervisory or management reports |
| bank | `cards` | `card_spend` | already in supervisory or management reports |
| bank | `trade_finance` | `lc_openings` | already in supervisory or management reports |
| bank | `payments` | `digital_transactions` | already in supervisory or management reports |
| bank | `remittances` | `inward_remittances` | already in supervisory or management reports |
| insurer | `life` | `new_policies` | already in supervisory or management reports |
| insurer | `life` | `gwp` | already in supervisory or management reports |
| insurer | `health` | `claims_per_1000` | one query over transaction or snapshot tables |
| insurer | `motor` | `claims_per_1000` | one query over transaction or snapshot tables |
| insurer | `property` | `claims_per_1000` | one query over transaction or snapshot tables |

---

## 3. Capability levels

Levels are cumulative. Each metric is served at some level. The profile states the lowest level across your required metrics, and a metric may declare its own.

| Level | Name | You serve | It unlocks | Without it, the checks lose |
|---|---|---|---|---|
| L1 | Values | One value per closed grid period, with unit and currency; suppression applied (R1); the profile declared (time zone, calendars, base currency, spec version). | Charts and levels shown as context next to an event brief. | Nothing can be shown from your data. |
| L2 | Checkable values | L1, plus numerator and denominator for ratios, exposure for rates, and volume on every unsuppressed row; breakdowns as listed for the metric; segment_as_of honoured (R4 cohort rule). | Verdicts. Minimum-volume and small-denominator protections, rates that don't drift with book growth, filtered (segment, region) checks. | The checks can't tell whether a move rests on enough records, so they give no verdict on the metric. You get context only. |
| L3 | Timed and deep | L2, plus published_at on every live row (back-filled rows say backfilled: true instead), the history the metric's test needs (history_months: 39 for seasonal, recent-vs-prior and trend tests, 27 for level tests), and breaks declared. | Seasonal tests with a full 24-month distribution; verdicts as soon as a period is published; honest handling of migrations and relief periods. | The checks assume each period is published only at its maximum lag, so verdicts arrive later. With short history, seasonal tests fall back to a weaker statistical test or give no verdict. Without breaks, a migration or a relief period can be read as customer behaviour. |
| L4 | Vintages | L3, plus values as known through a date (known_through) and at a given age after the period ended (same_age_days); each row labels its vintage and whether it was revised. Past vintages may be reconstructed from posting timestamps (R3); the catalog states vintage_history_from. | Comparisons at the same age (young claims or late-posted repayments don't bias the verdict), final verdicts as soon as the watch is published, and revision checks that supersede a verdict when numbers change. | No revision checks. Verdicts stay provisional until the newest watch period has passed the metric's stable age, so a final answer can take 7 to 120 days longer. |
| L5 | Change concentration | L4, plus GET /change-concentration: for two disjoint, equal-length windows, a band for the largest single contributor's share of the change, never its value or identity. | Dominance checks on the move itself: a verdict is never built on one obligor's drawdown or one merchant's collapse. | For metrics marked concentration_sensitive the checks give no verdict, because one customer could be driving the move; for others they proceed and note that dominance was not checked. |

**In plain words:**
- **L1** lets the event brief show your numbers.
- **L2** is the first level at which a check can say yes or no.
- **L3** gives the tests their full history, and stops a system migration from being read as customer behaviour.
- **L4** gives faster final answers that stay right when numbers are revised.
- **L5** stops a single large customer from making a portfolio trend appear.

**History each test needs.** `seasonal_ratio`, `recent_vs_prior` and `trend` read about 39 months: 24 months of rolling spans, plus a year-ago span and a growth window, or the same windows two years back. `level_change` reads 27 months. Each metric's `history_months` follows its test.

**Coverage of a category.** Per category, the connector reports one of:

| Status | Meaning |
|---|---|
| `none` | nothing is served |
| `partial` | some required metrics are missing, or fail an L1 or L2 conformance check |
| `required (level tests only)` | every required metric is served at L2+ and passes every L1 and L2 check, but history is below 39 months: `level_change` metrics give verdicts, seasonal and trend metrics don't yet |
| `required` | as above, with each metric's full `history_months` (or since the product's launch) |
| `recommended` | `required`, plus every recommended metric |
| `full` | everything, at L4 or above |

---

## 4. Product taxonomy

There are three levels:
- A **category** groups products that share metrics.
- A **product type** is a kind of product within it.
- **Typical products** are what institutions actually sell.

Your catalog lists your own products (with your names), each mapped to one category and one product type. A metric with `applies_to` is served only for those product types.

Metrics marked `scope: category` (`large_depositor_net_flow`, the digital-channel and cash metrics, the company-level insurer metrics) are about customers or the whole entity, not one product. They are served under a **category-level product group** that the catalog lists with `scope: category`.

Islamic and takaful variants are variants of product types, not separate categories: the same metrics apply, with the wording and measurement rules of R4 and R6.


**Banks**

| Category | Product types → typical products | Islamic / takaful variants |
|---|---|---|
| `savings`: Deposits and accounts | `current_account`: current and checking accounts, including business current accounts<br>`savings_account`: passbook and online savings; youth, child, senior and migrant-worker savings<br>`term_deposit`: fixed and time deposits, retail certificates of deposit<br>`fc_deposit`: resident and non-resident foreign-currency accounts (e.g. NRFC and PFCA in Sri Lanka, FCNR(B) in India, domiciliary accounts in Nigeria and Ghana, USD accounts in Latin America) | `current_account`: qard or wadiah current accounts<br>`savings_account`: wadiah or mudarabah savings accounts<br>`term_deposit`: mudarabah or wakala term investment accounts, commodity murabaha deposits<br>`fc_deposit`: foreign-currency wadiah or mudarabah accounts |
| `wealth`: Investment and retirement products sold to customers | `retirement_plan`: bank-administered provident, pension and retirement savings plans<br>`investment_funds`: mutual funds, unit trusts and UCITS funds distributed to customers<br>`structured_products`: structured deposits and notes<br>`securities_sold`: government bills and bonds, retail bonds sold to customers | `retirement_plan`: Shariah-compliant retirement plans<br>`investment_funds`: Shariah funds<br>`structured_products`: Shariah-compliant structured products (e.g. wa'd-based)<br>`securities_sold`: sukuk |
| `gold_loan`: Gold-secured loans | `gold_loan`: pawning and gold loans by banks (Sri Lanka, India, Bangladesh, Türkiye), jewellery-secured loans | `gold_loan`: rahn-based gold financing, qard hasan secured by gold |
| `retail_loan`: Retail lending | `personal_loan`: unsecured personal instalment loans<br>`housing_loan`: mortgages and home-equity loans<br>`education_loan`: student and education loans<br>`other_secured_consumer`: loans against deposits, securities or insurance policies<br>`personal_overdraft`: personal overdrafts and unsecured credit lines (credit cards excluded) | `personal_loan`: tawarruq or commodity-murabaha personal finance<br>`housing_loan`: murabaha, ijarah or diminishing-musharakah home finance<br>`education_loan`: qard or murabaha education finance<br>`other_secured_consumer`: financing secured on investment accounts<br>`personal_overdraft`: tawarruq-based credit lines |
| `vehicle_finance`: Vehicle finance | `vehicle_lease`: finance leases and hire purchase of vehicles<br>`auto_loan`: loans secured on the vehicle | `vehicle_lease`: ijarah muntahia bittamleek<br>`auto_loan`: murabaha vehicle finance |
| `cards`: Cards | `credit_card`: revolving credit cards<br>`charge_card`: cards repaid in full each cycle<br>`debit_card`: cards on current or savings accounts<br>`prepaid_card`: prepaid and gift cards issued by the bank | `credit_card`: ujrah- or tawarruq-based credit cards |
| `business_loan`: Business lending | `working_capital`: overdrafts, revolving credit lines, short-term loans<br>`term_loan`: term, equipment, project and commercial real-estate loans<br>`program_lending`: government-guaranteed and refinance-scheme loans (e.g. SME credit-guarantee schemes) | `working_capital`: murabaha, salam or istisna working-capital finance<br>`term_loan`: ijarah, diminishing musharakah, murabaha |
| `agri_loan`: Agricultural lending | `crop_loan`: seasonal crop-production loans and farmer credit cards (e.g. India's Kisan Credit Card), repaid after harvest<br>`agri_term_loan`: farm equipment, irrigation, livestock and plantation loans<br>`agri_value_chain`: warehouse-receipt and value-chain finance to farmers and aggregators | `crop_loan`: salam and murabaha crop finance<br>`agri_term_loan`: ijarah and diminishing musharakah for equipment<br>`agri_value_chain`: salam with parallel salam |
| `trade_finance`: Trade finance | `import_lc`: documentary credits issued for importers<br>`import_collections`: documentary collections (D/P, D/A) and open-account import payments handled<br>`export_finance`: export LC advising and confirmation, export bills, pre- and post-shipment finance | `import_lc`: LCs under murabaha or wakala<br>`export_finance`: salam or istisna export finance |
| `payments`: Payments and digital channels | `digital_banking`: mobile and internet banking<br>`self_service`: ATMs, cash-deposit machines and kiosks<br>`agent_banking`: banking agents and correspondents<br>`domestic_payments`: instant payments, RTGS, ACH, cheques, bill payments<br>`merchant_acquiring`: card and QR acquiring for merchants | — |
| `remittances`: Remittances | `inward_remittance`: inward international personal transfers paid to accounts, in cash or to wallets<br>`outward_remittance`: outward international personal transfers sent by customers | — |
| `fx`: Foreign exchange for customers | `spot_fx`: customer conversions between accounts, cash exchange, FX payments debited to base-currency accounts | `spot_fx`: spot exchange (sarf) settled same day |
| `distribution`: Insurance distribution (bancassurance) | `bancassurance`: life, health, general and credit-protection insurance sold through the bank for partner insurers | `bancassurance`: takaful sold through Islamic banks (bancatakaful) |

**Insurers**

| Category | Product types → typical products | Islamic / takaful variants |
|---|---|---|
| `life`: Life insurance and family takaful | `term_life`: level and decreasing term<br>`savings_life`: endowment, whole life, education plans<br>`unit_linked`: unit-linked and investment-linked policies<br>`annuity`: immediate and deferred annuities<br>`credit_life`: credit life and mortgage protection, individual and group<br>`group_life`: employer group life | `term_life`: family takaful (protection)<br>`savings_life`: family takaful (savings)<br>`unit_linked`: investment-linked family takaful<br>`credit_life`: credit-related family takaful<br>`group_life`: group family takaful |
| `health`: Health and personal accident | `individual_health`: individual and family hospital and medical cover<br>`group_health`: employer group medical<br>`personal_accident`: personal accident and accident & health | `individual_health`: health takaful<br>`group_health`: group health takaful |
| `motor`: Motor | `private_motor`: private cars<br>`commercial_motor`: vans, trucks, buses and fleets<br>`two_three_wheeler`: motorcycles and three-wheelers | `private_motor`: motor takaful<br>`commercial_motor`: commercial motor takaful |
| `travel`: Travel | `single_trip`: single-trip cover<br>`annual_multi_trip`: annual multi-trip cover<br>`migrant_worker`: mandatory or voluntary cover for workers going abroad<br>`pilgrimage`: Hajj and Umrah cover | `single_trip`: travel takaful |
| `property`: Property | `home`: homeowners, household contents, residential fire<br>`commercial_property`: fire, business interruption, SME packages<br>`engineering`: contractors' all risks, machinery breakdown | `home`: property takaful<br>`commercial_property`: commercial property takaful |
| `marine`: Marine | `marine_cargo`: single-voyage cargo and open covers<br>`marine_hull`: hull and machinery | `marine_cargo`: marine cargo takaful |
| `liability`: Liability | `general_liability`: public and products liability<br>`professional_liability`: professional indemnity, D&O, medical malpractice<br>`employers_liability`: employers' liability and workers' compensation | `general_liability`: liability takaful |
| `agriculture`: Agriculture | `crop_indemnity`: multi-peril crop insurance<br>`crop_index`: weather-index and area-yield index (parametric) cover<br>`livestock`: livestock and aquaculture | `crop_indemnity`: crop takaful |
| `micro_insurance`: Micro insurance | `micro_life`: micro life and funeral cover<br>`micro_health`: hospital cash and micro health<br>`micro_property`: micro property, crop and livestock<br>`mobile_insurance`: cover sold and paid through mobile networks or wallets | `micro_life`: micro family takaful |
| `insurer_company`: Insurer company level | `company`: all lines of the insurer together | `company`: takaful operator and participants' funds |

**Out of scope in this version:**
- institutions: finance companies, microfinance institutions, brokers, asset managers, payment-only firms;
- products: a treasury and ALM view (repricing gaps, securities marked to market), bank guarantees as a tested product (claims are too rare to test), custody and corporate cash management.

---

## 5. Metrics per category

**How to read the tables.**
- **Kind:** flow, stock, count, ratio, rate or level.
- **Currency rule:** `base`, `product`, `original` or `none`.
- **Grain** and **max lag:** max lag is in calendar days after the period's last day. Where it depends on a declared period (grace), the rule is shown.
- **History:** set by the metric's test (§3).
- **Volume:** the records behind the value, one definition per metric.
- **Adverse:** the direction that is bad for the institution. Some metrics allow two.
- **Tier:** required, recommended or optional. ★ marks the starter set.
- **Themes:** the event themes the metric helps check.

After each category's summary table, each metric gives its question, its numerator and denominator (or exposure), what is in and out, its booking date and its breakdowns. Themes are explained in §11 and listed under `vocabularies.themes` in `metrics-spec-1.0.0.yaml`.

The rules of §2 apply to every metric and are not repeated. A ratio's value is numerator ÷ denominator × 100; a rate's is numerator ÷ exposure × 1,000 for the period, not annualised.


### 5.1 `savings`: Deposits and accounts (bank)

**Required:** `deposit_inflow`, `withdrawals`, `balance`.  
**In the starter set:** `deposit_inflow`, `withdrawals`, `balance`.  
**Already reported in some form (cheap):** `balance`, `inward_remittance_credits`, `offered_rate`.  
**Need new aggregation:** `deposit_inflow`, `withdrawals`, `large_depositor_net_flow`, `td_placements`, `td_non_renewal_outflow`, `new_accounts`, `customer_closures`.  
Balances by product, currency and region are reported to supervisors almost everywhere (deposit returns, deposit-insurance returns); remittance inflows go to central banks for the balance of payments. Daily flows, segments, non-renewal and closures need new aggregation, but from transaction codes the core already holds.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `deposit_inflow` | Deposit inflow | flow · currency | product | daily (business days) · 1d | 39 | accounts with at least one included credit in the period | fall | required ★ | rates, trust, competitor, remittance, macro, sector, disaster, commodities |
| `withdrawals` | Withdrawals | flow · currency | product | daily (business days) · 1d | 39 | accounts with at least one included debit in the period | rise | required ★ | prices, trust, rates, competitor, regulation, disaster, macro, commodities |
| `balance` | Deposit balance | stock · currency | product | daily (business days) · 1d | 27 | accounts with a non-zero balance at the period's end | fall | required ★ | fx, regulation, trust, remittance |
| `inward_remittance_credits` | Inward remittance credits | flow · currency | original | daily (business days) · 5d | 39 | remittance credits (transactions) | fall | recommended | remittance, fx, regulation, disaster, macro |
| `large_depositor_net_flow` | Large-depositor net flow | flow · currency | base | daily (business days) · 1d | 39 | customers in the group | fall | recommended | trust, competitor, rates |
| `td_placements` | Term-deposit placements | flow · currency | product | daily (business days) · 1d | 39 | deposits placed | fall | recommended | rates, regulation, competitor, trust |
| `td_non_renewal_outflow` | Term-deposit non-renewal outflow | flow · currency | product | weekly · 2d | 39 | deposits maturing or broken in the period | rise | recommended | rates, competitor, regulation, trust |
| `new_accounts` | New accounts | count · count | none | weekly · 2d | 39 | accounts opened (the value itself) | fall | recommended | macro, prices, competitor, trust |
| `customer_closures` | Customer-initiated closures | rate · per_1000 | none | weekly · 2d | 39 | accounts open at the period's start (the exposure) | rise | recommended | trust, competitor, rates |
| `offered_rate` | Offered rate | level · percent_pa | none | weekly · 2d | 24 | products priced (1 per product and tenor band) | — | recommended | rates, competitor |

**`deposit_inflow`**: Is money coming into these accounts faster or slower than normal for this time of year?
- Flow: gross; values are positive
- In: cash deposits; incoming transfers from other institutions and from other customers of this institution; salary and pension credits; inward remittances credited to the account; cheques credited on clearing
- Out: interest or profit credited; transfers between two accounts of the same customer at this institution; loan or financing disbursements; term-deposit maturities credited back; postings to the institution's own, internal, suspense and nostro accounts; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in); refunds of fees
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `segment`, `employer_sector`, `age_band`, `region_l1`, `region_l2`, `channel`, `currency`
- Applies to `current_account`, `savings_account`, `fc_deposit`
- Note: Reversals and corrections are netted against the original transaction's booking date, so they revise that period (served as a new vintage). Joint accounts: transfers between accounts the same customer holds alone or jointly are own-account transfers. For a foreign-currency product the value is in its original currency; a multi-currency account is split by currency, each part treated as a foreign-currency product unless it is the base currency. segment=government carries the commodity channel for commodity-exporting economies.

**`withdrawals`**: Are customers taking money out faster than normal?
- Flow: gross; values are positive
- In: cash withdrawals (branch, ATM, agent); outgoing transfers to other institutions or other customers; card purchases and cash advances debited to the account; cheques paid; standing orders and bill payments
- Out: fees, charges and taxes debited by the institution; transfers between two accounts of the same customer at this institution (including repayments of the customer's own loans here); postings to the institution's own, internal, suspense and nostro accounts; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `segment`, `employer_sector`, `age_band`, `region_l1`, `region_l2`, `channel`, `currency`
- Applies to `current_account`, `savings_account`, `fc_deposit`
- Note: Reversals and corrections are netted against the original transaction's booking date, so they revise that period (served as a new vintage). Joint accounts: transfers between accounts the same customer holds alone or jointly are own-account transfers.

**`balance`**: How large is the book, and is a foreign-currency balance draining?
- In: customer balances in the product, including term deposits not yet matured
- Out: accrued interest or profit not yet credited; postings to the institution's own, internal, suspense and nostro accounts; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: position at the end of the period's last business day
- Breakdowns: `segment`, `region_l1`, `currency`, `tenor_band`
- Note: Also the book size used to rank products. For a foreign-currency product it is in its original currency.

**`inward_remittance_credits`**: Are remittances into these accounts falling, judged in the currency they were sent in?
- Flow: gross; values are positive
- In: incoming cross-border personal transfers credited to accounts of the product, through correspondent banks, money transfer operators or remittance hubs
- Out: payments with a trade, business or investment purpose code; returned or cancelled remittances (netted to the original date); postings to the institution's own, internal, suspense and nostro accounts
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `corridor`, `segment`, `currency`, `region_l1`
- Applies to `current_account`, `savings_account`, `fc_deposit`
- Note: Original currency = the currency the sender paid in (the instructed amount in the payment message), not the settlement currency; where the message lacks it, the settlement currency, declared in the catalog per corridor. Judged monthly. Related to the remittances category's inward_remittances, which covers every payout method; this one is scoped to one deposit product.

**`large_depositor_net_flow`**: Are the biggest depositors moving money out?
- Flow: net = credits − debits, by the deposit_inflow and withdrawals rules across all deposit products; positive means a net inflow
- In: the largest depositor customers who together hold 20% of total customer deposits, at least 30 customers, ranked on the first day of the month at or before the segment date; flows on all their deposit products, term deposits included
- Out: transfers between two accounts of the same customer at this institution; postings to the institution's own, internal, suspense and nostro accounts; interest or profit credited
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: none
- Served under the category-level product group
- Note: Served under the category-level product group. Membership changes only monthly, so two segment dates in one month give the same group. Dominance is tested on each gross side (R1). Judged as a % of the group's baseline gross inflow.

**`td_placements`**: Are customers placing more or less new money in term deposits (for example before a tax or rate change)?
- Flow: gross; values are positive
- In: new term deposits placed, whether funded from outside or from the customer's own current or savings account; on a renewal, only the amount above the maturing principal and interest
- Out: automatic renewals and rollovers of maturing deposits; interest capitalised; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `tenor_band`, `segment`, `region_l1`, `currency`
- Applies to `term_deposit`
- Note: Used with phases: anticipation (announcement to effective date) and effect.

**`td_non_renewal_outflow`**: Are maturing term deposits leaving instead of being renewed, or being broken early?
- Flow: gross; values are positive
- In: the part of each deposit maturing in the period that is not renewed; premature withdrawals (outflow_type=premature)
- Out: automatic renewals; re-placement by the same customer into a term deposit within 7 calendar days of maturity, up to the matured amount (counts as renewal); products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: maturity date (or break date), local date; the 7-day re-placement rule revises a week for up to 7 days
- Breakdowns: `tenor_band`, `segment`, `outflow_type`, `currency`
- Applies to `term_deposit`

**`new_accounts`**: Are customers opening fewer accounts than normal for the season?
- In: accounts opened by or for customers, any channel
- Out: accounts opened for internal purposes; product switches of an existing account; sub-accounts created automatically; accounts opened and closed the same day
- Booking date: opening date, local
- Breakdowns: `segment`, `channel`, `age_band`, `region_l1`
- Note: Recurring campaigns (e.g. World Savings Day) are calendar flags; one-off campaigns are declared as episodes.

**`customer_closures`**: Are customers closing accounts faster than normal?
- Numerator: accounts closed at the customer's request in the period
- Exposure: accounts open at the period's start
- In: closures requested by the customer or their legal representative
- Out: closures by the institution (dormancy, KYC, fraud, death); term-deposit maturities
- Booking date: closure date, local
- Breakdowns: `segment`, `region_l1`
- Applies to `current_account`, `savings_account`, `fc_deposit`

**`offered_rate`**: What rate are we offering, so the checks can compare it with rivals' public rates?
- In: the advertised standard rate (or the announced expected profit rate for profit-sharing accounts, not the rate later distributed) for the product's reference tenor, declared once in the catalog, at the period's end
- Out: negotiated rates; averages of rates actually paid; special-scheme rates (e.g. senior-citizen schemes), unless the product is that scheme
- Booking date: rate in force at the end of the period's last day
- Breakdowns: `tenor_band`, `currency`
- Applies to `savings_account`, `term_deposit`, `fc_deposit`
- Note: Rivals' rates are public data: the checking system collects them as reference data and computes the gap itself.

**Derived by the checks (not served):**
- `net_deposits` = deposit_inflow − withdrawals: judged as a % of the baseline's gross deposit_inflow, never as a % of itself; method recent_vs_prior or seasonal_ratio; adverse fall.


### 5.2 `wealth`: Investment and retirement products sold to customers (bank)

**Required:** `contributions`, `investment_subscriptions`, `investment_redemptions`, `fund_value`.  
**Already reported in some form (cheap):** `fund_value`.  
**Need new aggregation:** `contributions`, `contribution_rate`, `early_withdrawals`, `investment_subscriptions`, `investment_redemptions`, `fund_return_20d`, `fund_relative_return_20d`.  
Fund values and contributions are in pension and securities regulators' returns. Subscriptions and redemptions are in distributors' sales records; early withdrawals and contribution rates need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `contributions` | Retirement contributions | flow · currency | base | monthly · 10d | 39 | members with at least one contribution in the month | fall | required | prices, sector, macro |
| `contribution_rate` | Contribution rate | ratio · percent | none | monthly · 10d | 39 | active members (the denominator) | fall | recommended | prices, sector, macro |
| `early_withdrawals` | Early withdrawals | rate · per_1000 | none | monthly · 10d | 39 | members at the period's start (the exposure) | rise | recommended | prices, macro, trust, regulation |
| `investment_subscriptions` | Investment subscriptions | flow · currency | product | weekly · 2d | 39 | customers subscribing in the period | fall | required | markets, rates, trust, competitor |
| `investment_redemptions` | Investment redemptions | flow · currency | product | weekly · 2d | 39 | customers redeeming in the period | rise | required | markets, rates, trust |
| `fund_value` | Fund value / customer holdings | stock · currency | product | daily (business days) · 1d | 24 | customer holdings (members or holders) at the period's end | — | required | — |
| `fund_return_20d` | 20-day fund return | level · percent | none | daily (business days) · 1d | 27 | funds (1 per fund) | fall | optional | markets, rates |
| `fund_relative_return_20d` | 20-day return vs benchmark | level · pp | none | daily (business days) · 1d | 24 | funds (1 per fund) | — | optional | markets |

**`contributions`**: Are members paying in less than normal?
- Flow: gross; values are positive
- In: employer and member contributions; voluntary top-ups
- Out: transfers in from other plans; investment income; contributions reversed (netted to the original date)
- Booking date: value date of the contribution, local
- Breakdowns: `employer_sector`, `region_l1`
- Applies to `retirement_plan`

**`contribution_rate`**: Are fewer members contributing?
- Numerator: active members with at least one contribution in the month
- Denominator: active members: members with at least one contribution in the 12 months before the month's start who are still in the plan
- Out: members who retired or left during the month
- Booking date: value date of the contribution, local
- Breakdowns: `employer_sector`
- Applies to `retirement_plan`

**`early_withdrawals`**: Are members withdrawing savings before retirement, from hardship or emigration?
- Numerator: early withdrawals paid (full or partial) before normal retirement age
- Exposure: members at the period's start
- In: hardship, emigration, housing, medical and education withdrawals
- Out: payments at normal retirement age, death or disability; transfers to other plans
- Booking date: payment date, local
- Breakdowns: `withdrawal_reason`
- Applies to `retirement_plan`; extras: `value_base`

**`investment_subscriptions`**: Are customers buying fewer investment products?
- Flow: gross; values are positive
- In: purchases and subscriptions by customers, at trade date
- Out: switches between funds of the same family (both legs); reinvested dividends; the institution's own treasury purchases; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: trade date, local
- Breakdowns: `asset_class`, `segment`, `channel`
- Applies to `investment_funds`, `structured_products`, `securities_sold`

**`investment_redemptions`**: Are customers selling out of investment products early?
- Flow: gross; values are positive
- In: redemptions, early encashments and sales back to the institution
- Out: scheduled maturities and coupon payments; switches within a fund family; products offered only to staff, such as staff loans and staff savings schemes (staff members' ordinary accounts stay in)
- Booking date: trade date, local
- Breakdowns: `asset_class`, `segment`, `channel`
- Applies to `investment_funds`, `structured_products`, `securities_sold`

**`fund_value`**: How large is the book?
- In: market value of members' plan balances, or of customer holdings of the product in the institution's records, at the latest published price
- Out: the institution's own holdings
- Booking date: position at the end of the period's last business day
- Breakdowns: `asset_class`

**`fund_return_20d`**: Has the fund lost value in the last 20 business days to a date?
- In: total return net of fees over the 20 business days ending on the row's date, from published prices
- Booking date: the row's date; the 20-day window is fixed to that date, never to 'now'
- Breakdowns: `asset_class`
- Applies to `retirement_plan`, `investment_funds`

**`fund_relative_return_20d`**: Is the fund doing worse than its benchmark?
- In: fund_return_20d minus the declared benchmark's return over the same 20 business days
- Booking date: the row's date
- Breakdowns: `asset_class`
- Applies to `retirement_plan`, `investment_funds`


### 5.3 `gold_loan`: Gold-secured loans (bank)

**Required:** `new_pledges`, `redemptions`, `outstanding`.  
**Already reported in some form (cheap):** `outstanding`, `offered_rate`.  
**Need new aggregation:** `new_pledges`, `renewals`, `topups`, `redemptions`, `loans_above_ltv_limit`, `overdue_pawns`, `auctions`.  
Outstanding balances are reported to supervisors; most banks also report gold-loan LTV breaches internally. Pledge, redemption and auction counts come straight from the pawning system.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `new_pledges` | New pledges | count · count | none | daily (business days) · 1d | 39 | loans granted (the value itself) | rise, fall | required | commodities, prices, macro, remittance, disaster, competitor |
| `renewals` | Renewals | count · count | none | daily (business days) · 1d | 24 | loans renewed | — | optional | commodities |
| `topups` | Top-ups | count · count | none | daily (business days) · 1d | 24 | loans topped up | — | optional | commodities |
| `redemptions` | Redemptions | count · count | none | daily (business days) · 1d | 39 | loans redeemed (the value itself) | fall | required | prices, macro, commodities |
| `loans_above_ltv_limit` | Loans above the LTV limit | ratio · percent | base | daily (business days) · 1d | 27 | loans outstanding (the denominator's loans) | rise | recommended | commodities, fx |
| `overdue_pawns` | Overdue gold loans | ratio · percent | base | weekly · 2d | 27 | loans outstanding | rise | recommended | prices, macro, commodities |
| `auctions` | Auctions | rate · per_1000 | none | weekly · 2d | 39 | loans outstanding at the period's start (the exposure) | rise | recommended | commodities, prices, macro |
| `outstanding` | Outstanding | stock · currency | base | daily (business days) · 1d | 24 | loans outstanding | — | required | — |
| `offered_rate` | Offered rate | level · percent_pa | none | weekly · 2d | 24 | products priced | — | recommended | competitor, rates |

**`new_pledges`**: Are more households (or fewer) pledging gold for cash?
- In: new gold loans granted
- Out: renewals at maturity; top-ups on existing tickets; transfers between branches
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `region_l1`, `region_l2`
- Extras: `grams_fine`, `value_base`
- Note: Rise = household stress; fall = lost on price (competitor). grams_fine is fine-gold grams pledged.

**`renewals`**: How many loans were rolled over at maturity?
- In: tickets renewed or extended on the same collateral
- Out: top-ups
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `region_l1`
- Note: Context: follows last year's maturity cycle.

**`topups`**: How many borrowers drew more on existing pledges?
- In: additional amounts lent on existing tickets
- Out: renewals
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `region_l1`
- Note: Context: rises when the gold price rises.

**`redemptions`**: Are fewer borrowers redeeming their gold?
- In: loans fully repaid and collateral returned
- Out: renewals (old ticket closed into a new one); auctions
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `region_l1`, `region_l2`

**`loans_above_ltv_limit`**: How much of the book is now under-collateralised after a gold-price fall?
- Numerator: outstanding of loans whose loan-to-value is above the institution's policy limit
- Denominator: outstanding of all gold loans
- In: LTV = outstanding ÷ (fine grams × the declared reference gold price per gram on that day)
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`
- Note: The reference gold price and fineness basis (e.g. 22K in South Asia, 21K in the Gulf) are declared in the catalog.

**`overdue_pawns`**: Are more loans past maturity without being renewed or redeemed?
- Numerator: outstanding of loans past maturity, not renewed or redeemed
- Denominator: outstanding of all gold loans
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`

**`auctions`**: Are more pledges going to auction?
- Numerator: loans whose collateral was sold at auction in the period
- Exposure: loans outstanding at the period's start
- Out: auctions cancelled before sale
- Booking date: auction date, local
- Breakdowns: `region_l1`

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: loans written off
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`

**`offered_rate`**: What rate are we offering, so the checks can compare it with rivals' public rates?
- In: the advertised standard rate for the product's declared reference tenor at the period's end
- Out: negotiated rates; averages of rates actually charged
- Booking date: rate in force at the end of the period's last day
- Breakdowns: `tenor_band`


### 5.4 `retail_loan`: Retail lending (bank)

**Required:** `installment_collection_rate`, `roll_rate_to_30`, `outstanding`.  
**In the starter set:** `roll_rate_to_30`, `outstanding`.  
**Already reported in some form (cheap):** `dpd_30_plus`, `writeoffs_and_restructures`, `outstanding`.  
**Need new aggregation:** `installment_collection_rate`, `roll_rate_to_30`, `restructure_requests`, `moratorium_enrolled`, `applications`, `approval_rate`, `prepayments`, `facility_utilization`.  
Outstanding, dpd buckets, IFRS 9 stages, write-offs and restructures are reported to supervisors almost everywhere. Weekly collection rates, roll rates and request counts need new aggregation from the collections and loan systems.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `installment_collection_rate` | Instalment collection rate | ratio · percent | base | weekly · 7d | 27 | loans with an instalment due in the period | fall | required | rates, prices, sector, remittance, macro, disaster |
| `roll_rate_to_30` | Roll rate to 30+ dpd | ratio · percent | base | monthly · 15d | 39 | loans in the denominator | rise | required ★ | rates, prices, sector, remittance, macro, fx |
| `dpd_30_plus` | 30+ days past due | ratio · percent | base | monthly · 15d | 36 | loans outstanding | — | recommended | rates, macro |
| `writeoffs_and_restructures` | Write-offs and restructures | flow · currency | base | monthly · 15d | 24 | loans written off or restructured | — | optional | macro, regulation |
| `restructure_requests` | Restructure requests | rate · per_1000 | none | weekly · 14d | 39 | loans outstanding at the period's start (the exposure) | rise | recommended | disaster, macro, rates, sector |
| `moratorium_enrolled` | Moratorium enrolment | ratio · percent | base | weekly · 14d | 24 | loans outstanding | — | recommended | disaster, regulation |
| `applications` | Loan applications | count · count | none | weekly · 1d | 39 | applications (the value itself) | fall | recommended | rates, macro, competitor |
| `approval_rate` | Approval rate | ratio · percent | none | weekly · 1d | 27 | applications decided (the denominator) | fall | optional | regulation, macro |
| `prepayments` | Prepayments | flow · currency | base | weekly · 1d | 39 | loans prepaying in the period | rise | recommended | rates, competitor |
| `outstanding` | Outstanding | stock · currency | base | monthly · 15d | 24 | loans outstanding | — | required ★ | — |
| `facility_utilization` | Credit-line utilisation | ratio · percent | base | weekly · 2d | 27 | customers with lines in the denominator | rise | recommended | prices, rates, macro, sector |

**`installment_collection_rate`**: Are borrowers paying this period's instalments on time (the earliest sign of stress)?
- Numerator: amounts received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period (partial payments count by amount; a payment is applied to the period's instalment before older arrears)
- Denominator: scheduled instalments (principal plus interest or profit; ijara rentals) due in the period on loans not written off
- Out: payments of earlier arrears beyond what the instalment needs; prepayments of future instalments; instalments deferred by a moratorium (excluded from both sides); late-payment charges, including amounts paid to charity under Islamic late-payment undertakings
- Booking date: instalment due date (a due-date cohort); payments by value date, local; foreign-currency instalments converted at the due date's reference rate
- Breakdowns: `segment`, `employer_sector`, `rate_type`, `region_l1`, `region_l2`
- Applies to `personal_loan`, `housing_loan`, `education_loan`, `other_secured_consumer`

**`roll_rate_to_30`**: Is more of the performing book falling 30 days behind each month?
- Numerator: last month-end balance of those loans that are more than 30 dpd at this month's end
- Denominator: balance at last month-end of loans then 0-30 dpd
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: loans written off or sold during the month (removed from both sides)
- Booking date: month-end snapshots
- Breakdowns: `segment`, `employer_sector`, `rate_type`, `region_l1`, `region_l2`
- Extras: `numerator_loans`, `denominator_loans`

**`dpd_30_plus`**: What share of the book is 30 or more days past due?
- Numerator: balance more than 30 dpd at month end
- Denominator: total outstanding balance at month end
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break; more than 30 dpd is IFRS 9's rebuttable presumption of a significant increase in credit risk (stage 2)
- Out: loans written off
- Booking date: month-end snapshot
- Breakdowns: `segment`, `employer_sector`, `rate_type`, `region_l1`, `region_l2`
- Note: Context: book growth and write-offs move it.

**`writeoffs_and_restructures`**: How much was written off or restructured this month (explains dpd moves)?
- Flow: gross; values are positive
- In: balances written off (action=writeoff); balances modified because of the borrower's financial difficulty (action=restructure): IFRS 9 modifications, EBA forbearance, US 'modifications to borrowers experiencing financial difficulty'
- Out: commercial renegotiations without financial difficulty; moratorium enrolments under a blanket scheme
- Booking date: effective date of the write-off or modification
- Breakdowns: `action`, `region_l1`

**`restructure_requests`**: Are more borrowers asking to reschedule?
- Numerator: requests from borrowers to reschedule, restructure or defer, by request date, granted or not
- Exposure: loans outstanding at the period's start
- Out: institution-initiated restructures; automatic enrolment in a blanket moratorium (see moratorium_enrolled)
- Booking date: request date, local
- Breakdowns: `restructure_reason`, `region_l1`, `region_l2`

**`moratorium_enrolled`**: How much of the book is under a payment moratorium or relief deferral?
- Numerator: outstanding of loans under a moratorium or relief deferral at the period's end
- Denominator: total outstanding at the period's end
- In: regulatory and institution-wide relief schemes
- Out: individual restructures
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`, `region_l2`
- Note: The mask metric: a rise of more than 2pp over the 4 periods before the anchor masks the credit-quality family.

**`applications`**: Is demand for credit rising or falling?
- In: complete applications entered in the origination system
- Out: duplicates for the same customer and product within 30 days; pre-approved offers not taken up
- Booking date: application date, local
- Breakdowns: `channel`, `employer_sector`, `segment`

**`approval_rate`**: Is the institution approving a smaller share of applications?
- Numerator: applications approved in the period
- Denominator: applications approved or declined in the period (withdrawn excluded)
- Out: withdrawn applications
- Booking date: decision date, local
- Breakdowns: `channel`

**`prepayments`**: Are borrowers paying off early, perhaps to refinance with a rival?
- Flow: gross; values are positive
- In: full early settlements and partial prepayments of principal
- Out: refinancing into another loan at this institution; scheduled instalments
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `rate_type`
- Extras: `count`

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: loans written off
- Booking date: month-end snapshot
- Breakdowns: `rate_type`, `region_l1`

**`facility_utilization`**: Are households drawing more of their overdrafts and credit lines?
- Numerator: drawn balances at the period's end on the lines in the denominator
- Denominator: approved limits of personal overdrafts and credit lines, held at their level on the earlier of the period's start and the segment date
- Out: credit cards (see cards); lines opened after the segment date (for periods after it)
- Booking date: position at the end of the period's last business day
- Breakdowns: `segment`, `employer_sector`, `region_l1`
- Applies to `personal_overdraft`


### 5.5 `vehicle_finance`: Vehicle finance (bank)

**Required:** `installment_collection_rate`, `new_leases`, `outstanding`.  
**Already reported in some form (cheap):** `outstanding`.  
**Need new aggregation:** `installment_collection_rate`, `roll_rate_to_30`, `repossessions`, `new_leases`, `moratorium_enrolled`.  
Outstanding and dpd are reported to supervisors; new contracts are in the leasing system. Collection rates need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `installment_collection_rate` | Instalment collection rate | ratio · percent | base | weekly · 7d | 27 | contracts with an instalment due in the period | fall | required | prices, rates, macro, disaster |
| `roll_rate_to_30` | Roll rate to 30+ dpd | ratio · percent | base | monthly · 15d | 39 | contracts in the denominator | rise | recommended | prices, rates, macro |
| `repossessions` | Repossessions | rate · per_1000 | none | monthly · 15d | 24 | contracts outstanding at the period's start | — | optional | macro |
| `new_leases` | New vehicle-finance contracts | count · count | none | weekly · 1d | 39 | contracts activated (the value itself) | fall | required | regulation, fx, rates, prices, macro |
| `moratorium_enrolled` | Moratorium enrolment | ratio · percent | base | weekly · 14d | 24 | contracts outstanding | — | optional | disaster, regulation |
| `outstanding` | Outstanding | stock · currency | base | monthly · 15d | 24 | contracts outstanding | — | required | — |

**`installment_collection_rate`**: Are borrowers paying this period's instalments on time?
- Numerator: amounts received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period
- Denominator: scheduled instalments (lease rentals) due in the period on contracts not written off
- Out: payments of earlier arrears; prepayments; deferred instalments; late-payment charges
- Booking date: instalment due date (a due-date cohort); payments by value date
- Breakdowns: `vehicle_type`, `new_used`, `region_l1`, `region_l2`

**`roll_rate_to_30`**: Is more of the performing book falling 30 days behind?
- Numerator: last month-end balance of those contracts that are more than 30 dpd at this month's end
- Denominator: balance at last month-end of contracts then 0-30 dpd
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: contracts written off or sold during the month
- Booking date: month-end snapshots
- Breakdowns: `vehicle_type`

**`repossessions`**: How many vehicles were repossessed (explains dpd)?
- Numerator: vehicles repossessed in the month
- Exposure: contracts outstanding at the month's start
- Out: voluntary returns at contract end
- Booking date: repossession date
- Breakdowns: `vehicle_type`

**`new_leases`**: Are fewer vehicles being financed?
- In: new leases, hire-purchase contracts and vehicle loans activated (first disbursement or delivery)
- Out: refinancing of existing contracts; contract transfers
- Booking date: activation date, local
- Breakdowns: `vehicle_type`, `new_used`, `region_l1`
- Note: The key keeps the word 'leases' but covers vehicle loans and hire purchase too.

**`moratorium_enrolled`**: How much of the book is under a moratorium?
- Numerator: outstanding under a moratorium or relief deferral
- Denominator: total outstanding
- Out: individual restructures
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`, `region_l2`
- Note: Optional; without it a declared relief episode masks the credit-quality family.

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit (net investment in the lease for leases)
- Out: contracts written off
- Booking date: month-end snapshot
- Breakdowns: `vehicle_type`


### 5.6 `cards`: Cards (bank)

**Required:** `card_spend`, `card_payment_rate`, `outstanding`.  
**In the starter set:** `card_spend`.  
**Already reported in some form (cheap):** `card_spend`, `writeoffs_and_restructures`, `outstanding`.  
**Need new aggregation:** `card_spend_cross_border`, `card_payment_rate`, `revolving_share`, `roll_rate_to_30`, `card_fraud_rate`, `moratorium_enrolled`.  
Card counts, spend and receivables are reported to central banks' payment statistics in most countries. Payment and revolving rates need new aggregation from the card system's statement data.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `card_spend` | Domestic card spend | flow · currency | base | daily (calendar days) · 2d | 39 | cards with at least one purchase in the period | fall | required ★ | prices, macro, disaster, sector, rates |
| `card_spend_cross_border` | Cross-border card spend | flow · currency | original | daily (calendar days) · 2d | 39 | cards with at least one cross-border purchase in the period | fall | recommended | fx, prices, regulation, disaster, macro |
| `card_payment_rate` | Card payment rate | ratio · percent | base | weekly · 4d | 27 | statements due in the period | fall | required | prices, rates, macro |
| `revolving_share` | Revolving share | ratio · percent | base | monthly · 10d | 39 | statements due in the month | rise | recommended | prices, rates, macro |
| `roll_rate_to_30` | Roll rate to 30+ dpd | ratio · percent | base | monthly · 15d | 39 | accounts in the denominator | rise | recommended | prices, rates, macro |
| `card_fraud_rate` | Card fraud rate | ratio · percent | base | weekly · 30d | 27 | cards with spend in the period (the denominator's cards) | rise | optional | trust, competitor |
| `writeoffs_and_restructures` | Write-offs and restructures | flow · currency | base | monthly · 15d | 24 | accounts written off or restructured | — | optional | macro |
| `moratorium_enrolled` | Moratorium enrolment | ratio · percent | base | weekly · 14d | 24 | accounts outstanding | — | optional | disaster, regulation |
| `outstanding` | Card receivables | stock · currency | base | monthly · 10d | 24 | accounts with a balance | — | required | — |

**`card_spend`**: Are cardholders spending less at home?
- Flow: gross purchases; values are positive
- In: purchases at merchants in the profile's country (point of sale, contactless, domestic e-commerce, card-based QR) that settled
- Out: purchases abroad or at foreign e-commerce merchants (see card_spend_cross_border); cash withdrawals and cash advances; refunds and chargebacks (purchases are gross); authorisations that never settled; fees, interest, balance transfers, quasi-cash (MCC 4829, 6050, 6051, 6540) and card-to-card transfers
- Booking date: authorisation date, as a local date in the profile's time zone (not the settlement date); every calendar day is a period
- Breakdowns: `merchant_sector`, `region_l1`

**`card_spend_cross_border`**: Are cardholders spending less abroad, judged in the currencies they spend in?
- Flow: gross purchases; values are positive
- In: purchases at merchants abroad and at foreign e-commerce merchants that settled, in the transaction currency
- Out: the same exclusions as card_spend; dynamic-currency-conversion mark-ups
- Booking date: authorisation date, local
- Breakdowns: `merchant_sector`, `currency`, `corridor`
- Note: Original currency, so a devaluation of the base currency doesn't raise it by arithmetic (the move would be pure arithmetic).

**`card_payment_rate`**: Are cardholders paying less of their statements?
- Numerator: payments received from the statement date to the due date, or to the next business day when the due date is not a business day, capped at each statement's balance, for statements due in the period
- Denominator: closing balances of statements whose due date falls in the period
- Out: instalment-plan balances not yet billed
- Booking date: statement due date (a due-date cohort)
- Breakdowns: `segment`
- Applies to `credit_card`, `charge_card`

**`revolving_share`**: Are more cardholders carrying balances past the due date?
- Numerator: statement balances minus payments received by the due date, for statements due in the month
- Denominator: statement balances of statements due in the month
- Out: instalment-plan balances (0% or fixed-rate plans); balances in a promotional 0% period
- Booking date: statement due date
- Breakdowns: `segment`
- Applies to `credit_card`

**`roll_rate_to_30`**: Is more of the performing card book falling 30 days behind?
- Numerator: last month-end balance of those accounts that are more than 30 dpd at this month's end
- Denominator: balance at last month-end of accounts then 0-30 dpd
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: accounts written off during the month
- Booking date: month-end snapshots
- Breakdowns: `segment`
- Applies to `credit_card`, `charge_card`

**`card_fraud_rate`**: Is card fraud rising (a data breach at us, a rival or a merchant)?
- Numerator: value of purchases made in the period that are later reported as fraudulent by the cardholder or detected by the institution
- Denominator: value of all purchases made in the period (domestic and cross-border, in base currency)
- In: fraud by transaction date, whenever reported
- Out: chargebacks for merchant disputes that are not fraud
- Booking date: transaction (authorisation) date; fraud reports revise the period
- Breakdowns: `spend_location`

**`writeoffs_and_restructures`**: How much was written off or restructured (explains dpd)?
- Flow: gross; values are positive
- In: balances written off (cards usually at 180 dpd); balances restructured because of financial difficulty
- Booking date: effective date
- Breakdowns: `action`
- Applies to `credit_card`, `charge_card`

**`moratorium_enrolled`**: How much of the card book is under a payment holiday?
- Numerator: receivables under a payment holiday or relief deferral
- Denominator: total receivables
- Booking date: position at the end of the period's last business day
- Breakdowns: `region_l1`
- Applies to `credit_card`, `charge_card`
- Note: Optional; without it a declared relief episode masks the credit-quality family.

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: accounts written off
- Booking date: month-end snapshot
- Breakdowns: none
- Applies to `credit_card`, `charge_card`


### 5.7 `business_loan`: Business lending (bank)

**Required:** `facility_utilization`, `installment_collection_rate`, `outstanding`.  
**Already reported in some form (cheap):** `dpd_30_plus`, `exposure`, `outstanding`.  
**Need new aggregation:** `facility_utilization`, `installment_collection_rate`, `roll_rate_to_30`, `returned_cheque_rate`, `restructure_requests`, `moratorium_enrolled`, `applications`.  
Outstanding, exposures by sector and dpd/stages are in supervisory credit returns and large-exposure reports. Weekly utilisation, collection rates and the frozen-limit rule need new aggregation. Volume is obligors for every ratio.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `facility_utilization` | Facility utilisation | ratio · percent | base | weekly · 1d | 27 | obligors with lines in the denominator | rise | required | fx, rates, prices, macro, sector |
| `installment_collection_rate` | Instalment collection rate | ratio · percent | base | weekly · 7d | 27 | obligors with an instalment due | fall | required | fx, rates, prices, sector, macro, disaster |
| `roll_rate_to_30` | Roll rate to 30+ dpd | ratio · percent | base | monthly · 15d | 39 | obligors in the denominator | rise | recommended | fx, sector, macro, rates |
| `dpd_30_plus` | 30+ days past due | ratio · percent | base | monthly · 15d | 36 | obligors | — | recommended | macro, sector |
| `returned_cheque_rate` | Returned cheque and direct-debit rate | ratio · percent | none | weekly · 2d | 27 | obligors (business account holders) with items presented | rise | optional | sector, macro, fx |
| `restructure_requests` | Restructure requests | rate · per_1000 | none | weekly · 14d | 39 | obligors at the period's start (the exposure) | rise | recommended | disaster, sector, macro |
| `moratorium_enrolled` | Moratorium enrolment | ratio · percent | base | weekly · 14d | 24 | obligors | — | recommended | disaster, regulation |
| `applications` | Business credit applications | count · count | none | weekly · 1d | 39 | applications (the value itself) | fall | optional | rates, macro, sector |
| `exposure` | Exposure | stock · currency | base | monthly · 15d | 24 | obligors | — | optional | sector |
| `outstanding` | Outstanding | stock · currency | base | monthly · 15d | 24 | obligors | — | required | — |

**`facility_utilization`**: Are businesses drawing more of their working-capital lines (cash-flow strain)?
- Numerator: drawn balances at the period's end on the lines in the denominator
- Denominator: approved limits of working-capital lines, held at their level on the earlier of the period's start and the segment date (so history before the segment date is the ordinary series and the watch holds limits fixed)
- In: committed revolving lines, and overdrafts whether committed or not (where SME stress shows first); for murabaha working-capital programmes: the approved programme limit and the outstanding receivables net of unearned profit
- Out: trade-finance lines (see trade_finance); lines opened after the segment date, for periods after it
- Booking date: position at the end of the period's last business day
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`, `region_l1`
- Applies to `working_capital`

**`installment_collection_rate`**: Are businesses paying this period's instalments on time?
- Numerator: amounts received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period
- Denominator: scheduled instalments due in the period on loans not written off
- Out: payments of arrears; prepayments; deferred instalments; late-payment charges
- Booking date: instalment due date (a due-date cohort); payments by value date
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`, `region_l1`, `region_l2`
- Applies to `term_loan`, `program_lending`

**`roll_rate_to_30`**: Is more of the performing business book falling 30 days behind?
- Numerator: last month-end balance of those loans that are more than 30 dpd at this month's end
- Denominator: balance at last month-end of loans then 0-30 dpd
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: loans written off or sold during the month
- Booking date: month-end snapshots
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`
- Extras: `numerator_obligors`, `denominator_obligors`
- Note: With few defaulters the numerator is often dominated, so the row is suppressed (numerator_dominance): honest for corporate books, where credit stress is checked through facility_utilization and installment_collection_rate.

**`dpd_30_plus`**: What share of the business book is 30+ days past due?
- Numerator: balance more than 30 dpd at month end
- Denominator: total outstanding at month end
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: loans written off
- Booking date: month-end snapshot
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`

**`returned_cheque_rate`**: Are more business payments bouncing for lack of funds?
- Numerator: cheques and direct debits drawn on business current accounts returned unpaid for insufficient funds
- Denominator: cheques and direct debits drawn on those accounts presented for payment
- Out: returns for technical reasons (signature, date, stop payment, mandate errors)
- Booking date: presentment date
- Breakdowns: `size_band`, `sector`, `sector_l2`, `instrument`, `region_l1`, `region_l2`

**`restructure_requests`**: Are more businesses asking to reschedule?
- Numerator: restructure, reschedule or deferral requests by request date
- Exposure: obligors with loans outstanding at the period's start
- Out: institution-initiated restructures; automatic blanket-moratorium enrolment
- Booking date: request date
- Breakdowns: `size_band`, `sector`, `sector_l2`, `restructure_reason`, `region_l1`, `region_l2`

**`moratorium_enrolled`**: How much of the business book is under a moratorium?
- Numerator: outstanding under a moratorium or relief deferral
- Denominator: total outstanding
- Out: individual restructures
- Booking date: position at the end of the period's last business day
- Breakdowns: `size_band`, `sector`, `region_l1`, `region_l2`

**`applications`**: Is business demand for credit changing?
- In: complete new-credit applications
- Out: renewals and limit reviews of existing facilities; duplicates within 30 days
- Booking date: application date
- Breakdowns: `size_band`, `sector`

**`exposure`**: How concentrated is the book in a shocked sector?
- In: outstanding plus undrawn committed limits
- Booking date: month-end snapshot
- Breakdowns: `size_band`, `sector`
- Note: Context: sector shares only.

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: loans written off
- Booking date: month-end snapshot
- Breakdowns: `size_band`


### 5.8 `agri_loan`: Agricultural lending (bank)

**Required:** `disbursements`, `roll_rate_to_30`, `outstanding`.  
**Already reported in some form (cheap):** `disbursements`, `roll_rate_to_30`, `outstanding`.  
**Need new aggregation:** `installment_collection_rate`, `restructure_requests`, `moratorium_enrolled`.  
Agricultural lending is reported to supervisors in priority-sector or sectoral credit returns in most South Asian and African markets; disbursement and outstanding figures are cheap. Due-date collection rates need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `disbursements` | Agricultural disbursements | flow · currency | base | weekly · 2d | 39 | borrowers receiving a disbursement | fall | required | commodities, regulation, disaster, prices, rates |
| `installment_collection_rate` | Instalment collection rate | ratio · percent | base | monthly · 10d | 27 | loans with an instalment due in the period | fall | recommended | commodities, disaster, regulation, prices |
| `roll_rate_to_30` | Roll rate past 30 dpd | ratio · percent | base | monthly · 15d | 39 | loans in the denominator | rise | required | commodities, disaster, regulation, prices |
| `restructure_requests` | Restructure requests | rate · per_1000 | none | weekly · 14d | 39 | loans outstanding at the period's start (the exposure) | rise | recommended | disaster, commodities |
| `moratorium_enrolled` | Moratorium enrolment | ratio · percent | base | weekly · 14d | 24 | loans outstanding | — | recommended | disaster, regulation |
| `outstanding` | Outstanding | stock · currency | base | monthly · 15d | 24 | loans outstanding | — | required | — |

**`disbursements`**: Are farmers borrowing less for the season (prices, a drought, a policy change)?
- Flow: gross; values are positive
- In: new loans and drawdowns on seasonal limits paid out to farmers and agricultural businesses
- Out: renewals of a limit without new funds; restructures and rollovers; interest capitalised
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `crop_group`, `size_band`, `region_l1`, `region_l2`
- Extras: `count`

**`installment_collection_rate`**: Are farmers repaying what falls due after harvest?
- Numerator: amounts received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period
- Denominator: scheduled instalments (including bullet repayments) due in the period on loans not written off
- Out: payments of earlier arrears; prepayments; deferred instalments
- Booking date: instalment due date (a due-date cohort)
- Breakdowns: `crop_group`, `size_band`, `region_l1`, `region_l2`
- Note: Monthly, because harvest-season due dates bunch; a loan-waiver announcement (regulation) typically stops repayments before it takes effect.

**`roll_rate_to_30`**: Is more of the performing farm book falling more than 30 days behind?
- Numerator: last month-end balance of those loans that are more than 30 dpd at this month's end
- Denominator: balance at last month-end of loans then 0-30 dpd
- In: days past due: days since the oldest unpaid contractual instalment fell due, above the profile's declared materiality threshold (default none). 'Past 30 dpd' means more than 30 days (31+), matching IFRS 9's presumption and India's SMA-1 (31-60). dpd keeps counting through a restructure and resets only when the arrears are paid; a local rule that resets dpd on restructure is declared in the profile (dpd_reset_on_restructure) and as a rule_change break
- Out: loans written off or sold during the month
- Booking date: month-end snapshots
- Breakdowns: `crop_group`, `size_band`, `region_l1`, `region_l2`

**`restructure_requests`**: Are more farmers asking to reschedule after a bad season?
- Numerator: requests to reschedule, restructure or defer, by request date
- Exposure: loans outstanding at the period's start
- Out: institution-initiated restructures; blanket relief enrolment
- Booking date: request date
- Breakdowns: `restructure_reason`, `crop_group`, `region_l1`, `region_l2`

**`moratorium_enrolled`**: How much of the farm book is under relief?
- Numerator: outstanding under a moratorium, relief deferral or loan-waiver scheme
- Denominator: total outstanding
- Out: individual restructures
- Booking date: position at the end of the period's last business day
- Breakdowns: `crop_group`, `region_l1`, `region_l2`

**`outstanding`**: How large is the book?
- In: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: loans written off
- Booking date: month-end snapshot
- Breakdowns: `crop_group`, `region_l1`


### 5.9 `trade_finance`: Trade finance (bank)

**Required:** `lc_openings`, `import_bills`, `outstanding`.  
**In the starter set:** `lc_openings`.  
**Already reported in some form (cheap):** `lc_openings`, `import_bills`, `export_receipts`, `outstanding`.  
**Need new aggregation:** —.  
LC openings, import payments and export receipts are reported in many central banks' foreign-exchange and trade returns. Guarantee claims are in large-exposure and contingent-liability reports.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `lc_openings` | Letters of credit opened | count · count | none | weekly · 1d | 39 | applicants (obligors) opening LCs | fall | required ★ | fx, regulation, commodities, macro, sector |
| `import_bills` | Import payments outside LCs | count · count | none | weekly · 1d | 39 | importers (obligors) paying | fall | required | fx, regulation, commodities, macro, sector |
| `export_receipts` | Export receipts | flow · currency | original | weekly · 1d | 39 | exporters receiving | fall | recommended | fx, sector, commodities, disaster, regulation |
| `outstanding` | Trade-finance outstanding | stock · currency | base | monthly · 15d | 24 | obligors | — | required | — |

**`lc_openings`**: Are importers opening fewer letters of credit?
- In: import letters of credit issued in the period, including back-to-back LCs; one per underlying import contract, so tranches of one contract issued as separate LCs count once
- Out: amendments, extensions and re-issues; standby LCs (guarantees)
- Booking date: issue date in the trade-finance system (not the SWIFT send date), local
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`, `lc_type`, `currency`
- Applies to `import_lc`; extras: `median_amount_pivot`
- Note: median_amount_pivot is served only under the median rule of R1 (at least 20 LCs, mean of the 4 central values, 2 significant figures).

**`import_bills`**: Are importers paying for fewer shipments on collection, open-account or advance terms?
- In: import payments under documentary collections, open account and advance payment, identified by purpose code or customs reference
- Out: settlements under LCs; non-trade payments
- Booking date: payment value date
- Breakdowns: `size_band`, `sector`, `sector_l2`, `segment`, `terms`, `currency`
- Applies to `import_collections`

**`export_receipts`**: Are exporters receiving less (or more) for their shipments, in the currency they invoice in?
- Flow: gross; values are positive
- In: export proceeds received for business customers under LCs, collections and open account
- Out: advance receipts for services; intra-group non-trade transfers
- Booking date: value date
- Breakdowns: `size_band`, `sector`, `sector_l2`, `currency`, `corridor`
- Applies to `export_finance`

**`outstanding`**: How large is the funded trade book?
- In: import loans, trust receipts, bills discounted, pre- and post-shipment finance: gross carrying amount (principal plus accrued, unpaid interest or profit), before impairment allowances; for murabaha and other sale-based financing, the receivable net of unearned (deferred) profit
- Out: contingent exposures (LCs, guarantees)
- Booking date: month-end snapshot
- Breakdowns: `size_band`


### 5.10 `payments`: Payments and digital channels (bank)

**Required:** `digital_transactions`, `failed_transactions_own`.  
**In the starter set:** `digital_transactions`.  
**Already reported in some form (cheap):** `digital_transactions`, `active_digital_users`, `cash_withdrawals`, `merchant_acquiring_volume`.  
**Need new aggregation:** `failed_transactions_own`.  
Transaction counts and values by channel are reported to central banks' payment-system statistics in most countries; outage and failure reporting to supervisors is increasingly common. Active users and own-failure rates need new aggregation from channel logs.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `digital_transactions` | Digital and self-service transactions | count · count | none | daily (calendar days) · 1d | 39 | customers with at least one completed transaction | fall | required ★ | disaster, trust, competitor |
| `failed_transactions_own` | Own-system failure rate | ratio · percent | none | daily (calendar days) · 1d | 27 | transactions attempted (the denominator) | rise | required | trust, disaster |
| `active_digital_users` | Active digital users | count · count | none | monthly · 5d | 39 | the value itself | fall | recommended | trust, competitor |
| `cash_withdrawals` | Cash withdrawals | flow · currency | base | daily (calendar days) · 1d | 39 | customers withdrawing cash | rise | recommended | trust, disaster, macro |
| `merchant_acquiring_volume` | Merchant acquiring volume | flow · currency | base | daily (calendar days) · 2d | 39 | merchants with at least one acquired transaction | fall | recommended | macro, prices, disaster, sector, competitor |

**`digital_transactions`**: Are customers transacting less through digital channels (for example in a disaster area)?
- In: completed customer-initiated financial transactions on mobile, internet, ATM, agent and API channels: transfers, payments, bill payments, top-ups, cash withdrawals and deposits
- Out: logins and enquiries; failed or reversed transactions; standing orders executed automatically
- Booking date: transaction date (local date when the transaction completed) in the profile's time zone; every calendar day is a period
- Breakdowns: `channel`, `region_l1`, `region_l2`
- Served under the category-level product group
- Note: Each executed instruction counts once (a bulk file counts its payments). Region is the customer's region (R4), not the device's or agent's location.

**`failed_transactions_own`**: Are our own systems failing more transactions (an outage or a trust problem)?
- Numerator: attempts that failed because of the institution's own systems (technical declines, timeouts, internal errors)
- Denominator: transactions attempted on digital and self-service channels
- Out: customer-caused failures (insufficient funds, wrong PIN, limits); failures in external networks, switches or other institutions (returned as the external_failures extra, context)
- Booking date: transaction date (local date when the transaction completed) in the profile's time zone; every calendar day is a period
- Breakdowns: `channel`
- Served under the category-level product group; extras: `external_failures`

**`active_digital_users`**: Are fewer customers using our app and internet banking (lost to a rival or after an incident)?
- In: distinct customers with at least one completed financial transaction on mobile or internet banking in the month
- Out: log-in-only users; test and staff accounts
- Booking date: transaction dates, local
- Breakdowns: `channel`, `segment`, `age_band`, `region_l1`
- Served under the category-level product group

**`cash_withdrawals`**: Are customers pulling cash (a trust scare, a disaster, a payment outage)?
- Flow: gross; values are positive
- In: cash paid out to the institution's customers at its branches, ATMs and agents, and to them at other institutions' ATMs
- Out: cash paid to other institutions' customers at its ATMs; cash advances on credit cards
- Booking date: transaction date (local date when the transaction completed) in the profile's time zone; every calendar day is a period; region is the customer's region
- Breakdowns: `channel`, `region_l1`, `region_l2`
- Served under the category-level product group

**`merchant_acquiring_volume`**: Are our merchants selling less (local spending, tourism)?
- Flow: gross sales; values are positive
- In: card and QR purchases acquired for the institution's merchants
- Out: refunds and chargebacks; cash-back amounts
- Booking date: transaction date (local date when the transaction completed) in the profile's time zone; every calendar day is a period
- Breakdowns: `merchant_sector`, `card_origin`, `region_l1`
- Applies to `merchant_acquiring`


### 5.11 `remittances`: Remittances (bank)

**Required:** `inward_remittances`.  
**In the starter set:** `inward_remittances`.  
**Already reported in some form (cheap):** `inward_remittances`, `outward_remittances`.  
**Need new aggregation:** —.  
Inward and outward remittances by corridor are reported to central banks for the balance of payments almost everywhere; cheap to expose.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `inward_remittances` | Inward remittances | flow · currency | original | daily (business days) · 2d | 39 | remittances paid (transactions) | fall | required ★ | remittance, fx, regulation, disaster, competitor, macro |
| `outward_remittances` | Outward remittances | flow · currency | original | daily (business days) · 2d | 39 | remittances sent (transactions) | fall, rise | recommended | fx, regulation, competitor, macro, trust |

**`inward_remittances`**: Is our remittance business receiving less from a corridor, in the currency sent?
- Flow: gross; values are positive
- In: inward personal remittances paid out by any method, in the currency the sender paid in (the instructed amount in the payment message; settlement currency only where a corridor's messages lack it, declared in the catalog)
- Out: trade, business and investment payments (by purpose code); transfers between institutions; cancelled or returned remittances (netted to the original date)
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day (payout date)
- Breakdowns: `corridor`, `currency`, `payout_method`, `region_l1`
- Applies to `inward_remittance`
- Note: Judged monthly. Covers non-account holders (cash pick-up); inward_remittance_credits in savings is the account-credit part for one deposit product.

**`outward_remittances`**: Are customers sending less abroad (fees lost) or much more (capital flight)?
- Flow: gross; values are positive
- In: outward personal remittances sent, in the currency sent
- Out: trade and investment payments; cancelled transfers
- Booking date: value date, as a local date in the profile's time zone; a value date on a non-business day is reported on the next business day
- Breakdowns: `corridor`, `currency`, `channel`
- Applies to `outward_remittance`


### 5.12 `fx`: Foreign exchange for customers (bank)

**Required:** `customer_fx_purchases`, `customer_fx_sales`.  
**Already reported in some form (cheap):** `customer_fx_purchases`, `customer_fx_sales`.  
**Need new aggregation:** —.  
Customer FX purchases and sales are reported to central banks in FX-position and FX-transaction returns in most markets with any FX management; forwards appear in derivatives reporting.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `customer_fx_purchases` | Customer FX purchases | flow · currency | original | daily (business days) · 1d | 39 | customers buying | rise, fall | required | fx, regulation, trust, macro, commodities |
| `customer_fx_sales` | Customer FX sales | flow · currency | original | daily (business days) · 1d | 39 | customers selling | rise, fall | required | fx, regulation, remittance, trust |

**`customer_fx_purchases`**: Are customers buying more foreign currency (pressure on our FX position) or less (lost business)?
- Flow: gross; values are positive
- In: by transaction code: FX deal tickets with customers and account-to-account conversions where the customer buys foreign currency against the base currency, including outward FX payments debited to base-currency accounts
- Out: anything settled through a card scheme or a remittance network, whatever the booking; interbank and own-account trading; cross-currency deals without a base-currency leg
- Booking date: value date
- Breakdowns: `currency`, `segment`, `size_band`
- Applies to `spot_fx`

**`customer_fx_sales`**: Are customers converting more foreign currency into the base currency (e.g. under a conversion rule)?
- Flow: gross; values are positive
- In: by transaction code: FX deal tickets and account conversions where the customer sells foreign currency for the base currency, from foreign-currency deposits, export proceeds, remittances credited in foreign currency, and cash
- Out: anything settled through a card scheme or a remittance network; interbank and own-account trading
- Booking date: value date
- Breakdowns: `currency`, `segment`, `source`
- Applies to `spot_fx`


### 5.13 `distribution`: Insurance distribution (bancassurance) (bank)

**Required:** `bancassurance_new_premium`.  
**Already reported in some form (cheap):** —.  
**Need new aggregation:** `bancassurance_new_premium`.  
Commission income is in financial reports and some conduct returns; policy-level sales data sits in the bank's distribution records or the partner insurer's reports.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `bancassurance_new_premium` | Bancassurance new premium | flow · currency | base | weekly · 7d | 39 | policies sold | fall | required | competitor, regulation, macro, rates |

**`bancassurance_new_premium`**: Are we selling less insurance for our partners (after a partner switch, a rule change or a squeeze on households)?
- Flow: gross APE; values are positive
- In: annual premium equivalent: regular premiums annualised plus 10% of single premiums of policies issued through the bank's channels, by issue date
- Out: renewals; policies cancelled in the free-look period (netted to the issue date)
- Booking date: policy issue date
- Breakdowns: `insurance_line`, `channel`, `region_l1`


### 5.14 `life`: Life insurance and family takaful (insurer)

**Required:** `premium_collection_rate`, `new_policies`, `gwp`.  
**In the starter set:** `new_policies`, `gwp`.  
**Already reported in some form (cheap):** `new_policies`, `new_premium`, `gwp`.  
**Need new aggregation:** `premium_collection_rate`, `lapse_rate`, `surrenders`, `death_claims`, `new_money_yield_vs_guarantee`.  
GWP, new business and in-force counts are in supervisory returns; lapse and surrender rates appear in actuarial reports. Weekly collection rates and same-age death-claim counts need new aggregation from policy administration and claims systems.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `premium_collection_rate` | Premium collection rate | ratio · percent | base | weekly · 12d | 27 | policies with a premium due in the period | fall | required | prices, macro, rates, disaster, remittance |
| `new_policies` | New policies | count · count | none | weekly · 7d | 39 | policies issued (the value itself) | fall | required ★ | prices, macro, competitor, regulation, rates |
| `new_premium` | New business premium | flow · currency | base | weekly · 7d | 39 | policies issued | fall | recommended | prices, macro, competitor |
| `lapse_rate` | Lapse rate | rate · per_1000 | none | monthly · 45d | 39 | policies in force at the period's start (the exposure) | rise | recommended | prices, macro, rates |
| `surrenders` | Surrenders | rate · per_1000 | none | weekly · 7d | 39 | policies in force at the period's start (the exposure) | rise | recommended | rates, markets, macro, trust |
| `death_claims` | Death claims | rate · per_1000 | none | weekly · 60d | 39 | lives insured at the period's start (the exposure) | rise | recommended | disaster |
| `new_money_yield_vs_guarantee` | New-money yield vs guarantee | level · pp | none | monthly · 15d | 24 | portfolios (1) | — | optional | rates, markets |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required ★ | — |

**`premium_collection_rate`**: Are policyholders paying fewer premiums when due (1-2 months before lapses show)?
- Numerator: premiums (contributions) received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period; payroll check-off receipts count when the employer's remittance arrives
- Denominator: regular-premium instalments due in the period
- Out: single premiums; premiums waived under a waiver benefit; paid-up policies
- Booking date: instalment due date (a due-date cohort); receipts by value date
- Breakdowns: `sales_channel`, `collection_method`, `region_l1`

**`new_policies`**: Are we selling fewer new policies?
- In: new policies issued (incepted), net of free-look cancellations netted to the issue date
- Out: renewals of yearly-renewable group schemes; reinstatements; alterations and internal replacements
- Booking date: issue date
- Breakdowns: `sales_channel`, `age_band`, `region_l1`
- Extras: `risks`

**`new_premium`**: Is the value of new business falling?
- Flow: gross APE; values are positive
- In: annual premium equivalent: regular premiums annualised plus 10% of single premiums of new policies, net of free-look cancellations
- Out: renewal premiums
- Booking date: issue date
- Breakdowns: `sales_channel`

**`lapse_rate`**: Are more policies lapsing for non-payment?
- Numerator: policies whose lapse date (the end of grace) falls in the month and that were not reinstated within 90 days of it (or by data_as_of, if sooner)
- Exposure: regular-premium policies in force at the month's start
- Out: surrenders; policies made paid-up; unit-linked discontinuances counted separately by local rule (map them to lapses)
- Booking date: lapse date
- Breakdowns: `policy_duration_band`, `sales_channel`
- Note: Reinstatements after 90 days don't revise the month, so the value is final at the stable age whatever the local revival window.

**`surrenders`**: Are policyholders cashing in savings policies (rates up elsewhere, or need for cash)?
- Numerator: full surrenders effective in the period
- Exposure: policies with a surrender value in force at the period's start
- Out: partial withdrawals; maturities
- Booking date: surrender effective date
- Breakdowns: `sales_channel`
- Applies to `savings_life`, `unit_linked`, `annuity`; extras: `value_base`

**`death_claims`**: Are more death claims coming in (an epidemic, a disaster)?
- Numerator: death claims reported in the period
- Exposure: lives insured at the period's start
- In: claims by the date the claim was first notified to the insurer, in any form; compared at the same age (vintages) so late notifications don't bias recent periods
- Out: duplicate notifications
- Booking date: reported date
- Breakdowns: `cause_group`, `age_band`, `region_l1`

**`new_money_yield_vs_guarantee`**: Is the yield on new investments falling below what in-force policies guarantee?
- In: average yield on fixed-income investments bought in the month minus the in-force-weighted guaranteed crediting rate
- Booking date: month
- Breakdowns: none
- Applies to `savings_life`, `annuity`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: first-year, single and renewal premiums written in the month; for takaful, gross contributions including the wakala fee
- Out: reinsurance accepted
- Booking date: written date
- Breakdowns: `sales_channel`
- Note: A non-IFRS 17 measure still reported to supervisors in most markets; IFRS 17 insurance revenue differs. Book size in the catalog is the trailing 12-month total, not one month.


### 5.15 `health`: Health and personal accident (insurer)

**Required:** `claims_per_1000`, `new_policies`, `gwp`.  
**In the starter set:** `claims_per_1000`.  
**Already reported in some form (cheap):** `new_policies`, `gwp`.  
**Need new aggregation:** `claims_per_1000`, `procedure_cost_index`, `median_claim_cost`, `renewal_rate`.  
GWP, claims paid and claim counts are in supervisory statistical returns. Same-age frequency, renewal after grace and procedure cost indices need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `claims_per_1000` | Claims per 1,000 insured | rate · per_1000 | none | weekly · 14d | 39 | insured persons at the period's start (the exposure) | rise | required ★ | disaster, prices |
| `procedure_cost_index` | Procedure cost index | level · index | base | monthly · 15d | 27 | basket items priced | rise | recommended | fx, prices |
| `median_claim_cost` | Median claim cost | level · currency | base | monthly · 30d | 24 | claims settled | — | recommended | prices, fx |
| `renewal_rate` | Renewal rate | ratio · percent | none | weekly · 37d (renewal_grace_days + 7) | 27 | policies due for renewal (the denominator) | fall | recommended | prices, macro, competitor |
| `new_policies` | New policies | count · count | none | weekly · 7d | 39 | policies issued | fall | required | prices, macro, competitor, regulation |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`claims_per_1000`**: Are more claims coming in (an epidemic, a flood)?
- Numerator: claims reported in the period: one per insured life per episode of care (linked bills and pre-authorisations count once)
- Exposure: insured persons (lives) at the period's start
- In: cashless claims at the first pre-authorisation that becomes a claim; reimbursement claims at submission; the date the claim was first notified to the insurer, in any form; compared at the same age (vintages) so late notifications don't bias recent periods
- Out: duplicate notifications; pre-authorisations never used
- Booking date: reported date
- Breakdowns: `claim_type`, `settlement_mode`, `plan`, `region_l1`, `region_l2`
- Note: Reimbursement claims can arrive up to about 45 days late; same-age vintages handle them.

**`procedure_cost_index`**: Is the cost of common treatments and drugs rising?
- In: a fixed basket of the most frequent procedures and drugs (at least 20 items, at least 50% of base-year claims cost), priced from claims settled in the month; weights fixed for a year and chain-linked annually; base = 100
- Out: items not settled in the month (carried at last price)
- Booking date: settlement date
- Breakdowns: `claim_type`
- Note: The basket is declared in the catalog; comparisons are within the institution over time.

**`median_claim_cost`**: What does a typical claim cost now (context)?
- In: median of amounts paid on claims settled in the month; p75; settled_share = share of the month's reported claims already settled
- Out: rejected claims
- Booking date: settlement date
- Breakdowns: `claim_type`, `plan`
- Extras: `p75`, `settled_share`

**`renewal_rate`**: Are fewer policyholders renewing?
- Numerator: policies renewed by the end of the grace period
- Denominator: policies whose renewal date falls in the period
- In: measured after the profile's declared renewal grace period (default 30 days)
- Out: policies the insurer declined to renew
- Booking date: renewal date
- Breakdowns: `plan`, `sales_channel`
- Note: max_lag_days = grace + 7; a longer declared grace lengthens it.

**`new_policies`**: Are we selling fewer new policies?
- In: new policies issued, net of free-look cancellations
- Out: renewals; members added to existing group schemes
- Booking date: issue date
- Breakdowns: `plan`, `sales_channel`, `region_l1`
- Extras: `risks`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums (contributions) written in the month
- Out: reinsurance accepted
- Booking date: written date
- Breakdowns: `plan`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.16 `motor`: Motor (insurer)

**Required:** `claims_per_1000`, `new_policies`, `gwp`.  
**In the starter set:** `claims_per_1000`.  
**Already reported in some form (cheap):** `new_policies`, `gwp`.  
**Need new aggregation:** `claims_per_1000`, `parts_cost_index`, `median_claim_cost`, `renewal_rate`.  
GWP, policy counts and claim counts are in supervisory returns and often in motor-pool or industry statistics. Parts cost indices and same-age frequency need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `claims_per_1000` | Claims per 1,000 vehicles | rate · per_1000 | none | weekly · 14d | 39 | insured vehicles at the period's start (the exposure) | rise | required ★ | disaster, prices |
| `parts_cost_index` | Parts cost index | level · index | base | monthly · 15d | 27 | basket items priced | rise | recommended | fx, prices, regulation |
| `median_claim_cost` | Median claim cost | level · currency | base | monthly · 30d | 24 | claims settled | — | recommended | prices, fx |
| `new_policies` | New policies | count · count | none | weekly · 7d | 39 | policies issued | fall | required | regulation, fx, macro, competitor |
| `renewal_rate` | Renewal rate | ratio · percent | none | weekly · 37d (renewal_grace_days + 7) | 27 | policies due for renewal | fall | recommended | competitor, prices, macro |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`claims_per_1000`**: Are more motor claims coming in (a flood, more traffic)?
- Numerator: claims reported in the period: one per insured vehicle per loss event (a hailstorm damaging 50 fleet vehicles is 50 claims; one collision is one claim per insured vehicle involved)
- Exposure: insured vehicles in force at the period's start (fleets count every vehicle)
- In: claims by the date the claim was first notified to the insurer, in any form; compared at the same age (vintages) so late notifications don't bias recent periods; reported date is the first notice of loss to the insurer or its agent, not a broker's later batch; region is the vehicle's registered or garaging address
- Out: duplicate notifications
- Booking date: reported date
- Breakdowns: `claim_type`, `peril`, `vehicle_type`, `cover`, `region_l1`, `region_l2`

**`parts_cost_index`**: Are imported parts getting dearer?
- In: a fixed basket of common replacement parts per vehicle class, priced at settled invoices in the month; base = 100; weights fixed for a year
- Out: labour
- Booking date: settlement date
- Breakdowns: `vehicle_type`

**`median_claim_cost`**: What does a typical own-damage claim cost now (context)?
- In: own-damage claims settled in the month
- Out: total losses; rejected claims
- Booking date: settlement date
- Breakdowns: `vehicle_type`
- Extras: `p75`, `settled_share`

**`new_policies`**: Are we insuring fewer new vehicles (import rules, prices)?
- In: policies issued for vehicles not insured with the insurer in the previous 30 days
- Out: renewals; mid-term changes
- Booking date: issue date
- Breakdowns: `vehicle_type`, `cover`, `new_used`, `sales_channel`
- Extras: `risks`

**`renewal_rate`**: Are fewer vehicle owners renewing with us?
- Numerator: policies renewed by the end of the grace period
- Denominator: policies whose renewal date falls in the period
- In: measured after the profile's declared renewal grace period (default 30 days)
- Out: policies the insurer declined to renew; vehicles sold or scrapped (where recorded)
- Booking date: renewal date
- Breakdowns: `vehicle_type`, `cover`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month
- Out: reinsurance accepted
- Booking date: written date
- Breakdowns: `cover`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.17 `travel`: Travel (insurer)

**Required:** `new_policies`, `gwp`.  
**Already reported in some form (cheap):** `new_policies`, `gwp`.  
**Need new aggregation:** `claims_per_1000`, `median_claim_cost`.  
GWP and policy counts are in supervisory returns; claims by trip end date and destination need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `new_policies` | New policies | count · count | none | weekly · 2d | 39 | policies issued | fall | required | fx, disaster, regulation, remittance, macro |
| `claims_per_1000` | Claims per 1,000 trips | rate · per_1000 | none | monthly · 45d | 39 | policies whose trip ended in the period (the exposure) | rise | recommended | disaster |
| `median_claim_cost` | Median claim cost (original currency) | level · currency | original | monthly · 45d | 24 | claims settled | — | recommended | fx, prices |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`new_policies`**: Are fewer people buying travel cover (a weaker currency, trouble at a destination)?
- In: policies issued (sold)
- Out: policies cancelled before departure (netted to the issue date)
- Booking date: issue date
- Breakdowns: `traveller_type`, `destination_region`, `sales_channel`

**`claims_per_1000`**: Are more travellers claiming after trouble abroad?
- Numerator: claims reported on policies whose trip ended in the period
- Exposure: policies whose trip ended in the period
- Out: duplicate notifications
- Booking date: trip end date (claims are filed after the trip)
- Breakdowns: `destination_region`, `claim_type`

**`median_claim_cost`**: What does a typical claim abroad cost, in the currency it is paid in (context)?
- In: median paid amount of claims settled in the month, in the claim currency (pivot currency when unfiltered)
- Out: rejected claims
- Booking date: settlement date
- Breakdowns: `claim_type`, `currency`
- Extras: `p75`, `settled_share`
- Note: A weaker base currency raises the base-currency cost by arithmetic only; that is why the rule is original.

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month
- Booking date: written date
- Breakdowns: `traveller_type`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.18 `property`: Property (insurer)

**Required:** `claims_per_1000`, `gwp`.  
**In the starter set:** `claims_per_1000`.  
**Already reported in some form (cheap):** `sum_insured`, `new_policies`, `gwp`.  
**Need new aggregation:** `claims_per_1000`, `median_claim_cost`.  
GWP, sums insured and catastrophe accumulations by area are reported to supervisors and reinsurers; same-age claim frequency needs new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `claims_per_1000` | Claims per 1,000 insured locations | rate · per_1000 | none | weekly · 14d | 39 | insured locations at the period's start (the exposure) | rise | required ★ | disaster |
| `median_claim_cost` | Median claim cost | level · currency | base | monthly · 30d | 24 | claims settled | — | recommended | prices, fx, disaster |
| `sum_insured` | Sum insured | stock · currency | base | monthly · 15d | 24 | policies in force | — | recommended | disaster |
| `new_policies` | New policies | count · count | none | weekly · 7d | 39 | policies issued | fall | optional | macro, competitor, regulation |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`claims_per_1000`**: Did a disaster drive up claims where we insure?
- Numerator: claims reported in the period: one per insured location per loss event
- Exposure: insured locations in force at the period's start (a multi-site policy counts each site, in its own region)
- In: claims by the date the claim was first notified to the insurer, in any form; compared at the same age (vintages) so late notifications don't bias recent periods; region is the insured location (which is also the loss location)
- Out: duplicate notifications
- Booking date: reported date
- Breakdowns: `peril`, `region_l1`, `region_l2`

**`median_claim_cost`**: What does a typical claim cost (context for rebuild costs)?
- In: claims settled in the month
- Out: rejected claims
- Booking date: settlement date
- Breakdowns: `peril`
- Extras: `p75`, `settled_share`

**`sum_insured`**: How much do we insure in the affected area?
- In: sums insured of policies in force at month end, split by insured location
- Out: reinsurance recoveries
- Booking date: month-end snapshot
- Breakdowns: `region_l1`, `region_l2`

**`new_policies`**: Are we writing fewer new property policies?
- In: new policies issued
- Out: renewals
- Booking date: issue date
- Breakdowns: `sales_channel`, `region_l1`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month
- Booking date: written date
- Breakdowns: `region_l1`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.19 `marine`: Marine (insurer)

**Required:** `insured_shipments`, `gwp`.  
**Already reported in some form (cheap):** `gwp`.  
**Need new aggregation:** `insured_shipments`.  
GWP is reported; declarations under open covers are in the underwriting system. Shipment counts need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `insured_shipments` | Insured shipments | count · count | none | monthly · 30d | 39 | insured clients declaring | fall | required | fx, commodities, regulation, sector, macro, disaster |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`insured_shipments`**: Are our cargo clients shipping less (tariffs, a weaker currency, a port closure)?
- In: shipments insured: single-voyage policies and declarations under open covers
- Out: cancelled declarations
- Booking date: sailing or dispatch date
- Breakdowns: `trade_direction`, `commodity_group`, `corridor`
- Applies to `marine_cargo`; extras: `sum_insured_base`
- Note: Declarations under open covers often arrive a month late; vintages and stable age 60 handle them.

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month, including declaration premiums
- Booking date: written date
- Breakdowns: none
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.20 `liability`: Liability (insurer)

**Required:** `new_policies`, `gwp`.  
**Already reported in some form (cheap):** `gwp`.  
**Need new aggregation:** `new_policies`, `renewal_rate`.  
GWP and policy counts are reported; claims are long-tailed and reported by underwriting year in actuarial returns.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `new_policies` | New policies | count · count | none | monthly · 15d | 39 | policies issued | fall | required | regulation, macro, sector, competitor |
| `renewal_rate` | Renewal rate | ratio · percent | none | monthly · 45d (renewal_grace_days + 15) | 27 | policies due for renewal | fall | recommended | competitor, macro |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`new_policies`**: Are businesses buying less liability cover?
- In: new policies issued
- Out: renewals
- Booking date: issue date
- Breakdowns: `liability_line`, `sector`, `sales_channel`

**`renewal_rate`**: Are fewer clients renewing?
- Numerator: policies renewed by the end of the grace period
- Denominator: policies whose renewal date falls in the month
- In: measured after the profile's declared renewal grace period (default 30 days)
- Out: policies the insurer declined to renew
- Booking date: renewal date
- Breakdowns: `liability_line`, `sector`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month
- Booking date: written date
- Breakdowns: `liability_line`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.21 `agriculture`: Agriculture (insurer)

**Required:** `new_policies`, `sum_insured`, `gwp`.  
**Already reported in some form (cheap):** `new_policies`, `sum_insured`, `gwp`.  
**Need new aggregation:** `claims_per_1000`.  
Public schemes report enrolments, sums insured and claims to the scheme administrator and supervisor; cheap to expose where a scheme exists.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `new_policies` | New policies (enrolments) | count · count | none | monthly · 15d | 39 | policies (farmer enrolments) | fall | required | commodities, regulation, disaster, macro |
| `sum_insured` | Sum insured | stock · currency | base | monthly · 15d | 24 | policies in force | — | required | disaster, commodities |
| `claims_per_1000` | Claims per 1,000 policies | rate · per_1000 | none | monthly · 30d | 39 | policies in force at the period's start (the exposure) | rise | recommended | disaster, commodities |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`new_policies`**: Are fewer farmers insuring this season?
- In: policies or scheme enrolments incepted in the month
- Out: cancelled enrolments (netted to inception)
- Booking date: inception date
- Breakdowns: `crop_group`, `scheme`, `region_l1`, `region_l2`

**`sum_insured`**: How much crop and livestock value do we cover where a disaster hit?
- In: sums insured of policies in force at month end
- Booking date: month-end snapshot
- Breakdowns: `crop_group`, `region_l1`, `region_l2`

**`claims_per_1000`**: Did drought, flood or pests trigger more claims or index payouts?
- Numerator: claims reported, or index payouts triggered (at the trigger date)
- Exposure: policies in force at the month's start
- Out: duplicate notifications
- Booking date: reported or trigger date
- Breakdowns: `peril`, `crop_group`, `region_l1`, `region_l2`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month, including the subsidised part
- Booking date: written date
- Breakdowns: `scheme`
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.22 `micro_insurance`: Micro insurance (insurer)

**Required:** `new_policies`, `premium_collection_rate`, `gwp`.  
**Already reported in some form (cheap):** `new_policies`, `gwp`.  
**Need new aggregation:** `premium_collection_rate`, `lapse_rate`, `claims_per_1000`.  
Micro-insurance returns are required where a local micro-insurance rule exists; otherwise the products appear inside life or general returns. Collection rates by method need new aggregation.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `new_policies` | New policies | count · count | none | weekly · 7d | 39 | policies issued | fall | required | prices, macro, regulation, competitor |
| `premium_collection_rate` | Premium collection rate | ratio · percent | base | weekly · 12d | 27 | policies with a premium due | fall | required | prices, macro, disaster, remittance |
| `lapse_rate` | Lapse rate | rate · per_1000 | none | monthly · 45d | 39 | policies in force at the period's start | rise | recommended | prices, macro |
| `claims_per_1000` | Claims per 1,000 insured | rate · per_1000 | none | monthly · 30d | 39 | insured persons or policies at the period's start | rise | recommended | disaster |
| `gwp` | Gross written premium | flow · currency | base | monthly · 15d | 24 | policies with premium written | — | required | — |

**`new_policies`**: Are fewer low-income households taking cover?
- In: policies issued that meet the local micro-insurance definition, or the declared sum-insured ceiling where none exists
- Out: renewals
- Booking date: issue date
- Breakdowns: `sales_channel`, `region_l1`

**`premium_collection_rate`**: Are households missing small premium payments (an early stress signal)?
- Numerator: premiums received by the end of the 3rd business day after each instalment's due date (in the record's own calendar), so weekend and holiday due dates get the same time to clear as weekday ones, against instalments due in the period
- Denominator: regular-premium instalments due in the period
- In: airtime and wallet deductions that succeeded
- Out: single premiums
- Booking date: instalment due date (a due-date cohort)
- Breakdowns: `collection_method`, `region_l1`

**`lapse_rate`**: Are more micro policies lapsing?
- Numerator: policies whose lapse date falls in the month and that were not reinstated within 90 days of it (or by data_as_of, if sooner)
- Exposure: regular-premium policies in force at the month's start
- Booking date: lapse date
- Breakdowns: `collection_method`

**`claims_per_1000`**: Are more claims coming in (an epidemic, a disaster)?
- Numerator: claims reported in the month
- Exposure: insured persons (or policies) at the month's start
- Out: duplicate notifications
- Booking date: reported date
- Breakdowns: `region_l1`

**`gwp`**: How large is the book?
- Flow: gross; values are positive
- In: premiums written in the month
- Booking date: written date
- Breakdowns: none
- Note: Book size in the catalog is the trailing 12-month total, not one month.


### 5.23 `insurer_company`: Insurer company level (insurer)

**Required:** none (context only).  
**Already reported in some form (cheap):** `solvency_ratio`, `reinsurance_cost`.  
**Need new aggregation:** —.  
Published solvency figures and reinsurance costs are in public disclosures and financial statements.

| Key | Name | Kind · unit | Currency rule | Grain · max lag | History (months) | Volume | Adverse | Tier | Themes |
|---|---|---|---|---|---|---|---|---|---|
| `solvency_ratio` | Solvency ratio (published) | ratio · percent | base | quarterly · 45d | 24 | entities (1) | — | optional | rates, markets |
| `reinsurance_cost` | Reinsurance cost | flow · currency | original | quarterly · 45d | 24 | treaties and facultative placements | — | optional | fx, disaster |

**`solvency_ratio`**: Where does published capital stand (context for investment shocks)?
- Numerator: eligible own funds or available capital
- Denominator: required capital under the local regime
- In: the latest publicly disclosed figure only (e.g. a Solvency II SCR ratio, a risk-based capital ratio)
- Out: unpublished regulatory figures
- Booking date: disclosure reference date
- Breakdowns: none
- Served under the category-level product group

**`reinsurance_cost`**: How much do we pay for reinsurance, in the currencies it is priced in?
- Flow: gross; values are positive
- In: reinsurance premiums ceded in the quarter
- Out: commissions received
- Booking date: written date
- Breakdowns: `currency`
- Served under the category-level product group


---

## 6. Validation parameters

These parameters are **owned by the checking system**, not served by institutions. They are versioned as `validation_params_version` 1.0.0. They appear here so an institution can see how its numbers will be judged.

| Field | Meaning |
|---|---|
| `method` | default test: `recent_vs_prior` (day-level timing), `seasonal_ratio` (weekly and monthly timing, flows and counts), `level_change` (ratios and levels at the same position in the month or cycle), `trend` (monthly ratios that drift). `context`, `book_size` and `mask` metrics are never tested. |
| `judge_grain` | when a daily metric is judged on a coarser grain (remittances are judged monthly) |
| `stable_age_days` | days after a period's last day when its value stops being revised. Without vintages, no final verdict is given before it. With vintages, a final verdict is re-checked at this age. For new policies it is the free-look period + 7. |
| `min_volume` | the smallest volume a verdict is built on (below it, no verdict) |
| `min_denominator` | the smallest denominator a ratio is judged on, in its own units |
| `min_base` | the smallest year-ago count a seasonal ratio may divide by (below it, no verdict) |
| `counts` | numerator and denominator are counts, so the change must also pass a 95% Wilson interval |
| `mask_family`, `masked_by` | Credit-quality metrics are masked when any trigger metric served for the product rises beyond its limit over the 4 periods before the anchor: `moratorium_enrolled` by more than 2pp, or `restructure_requests` by more than 3 per 1,000. Where none is served, a declared relief episode masks them. Premium-collection and lapse metrics are masked by a declared premium-relief episode. |
| `adverse_allowed` | the adverse directions a task may name |
| `concentration_sensitive` | without L5 (change concentration), the checks give no verdict on this metric, because one customer could be driving the move |
| `thresholds` | a threshold set per expected size (`small`, `medium`, `large`), magnitudes signed by the task's direction. Tasks name it as `<metric>.<size>`. **One value for every size** until placebo runs on the institution's own history support splitting them. |

**Rules the checks apply to every metric:**

| Rule | What the checks do |
|---|---|
| Season coverage | A baseline span whose share of days under any `season:<name>` flag differs from the watch's by more than 20 points is dropped. Example: a March with 30 Ramadan days vs one with 19. |
| Real terms | Where `inflation_regime: high`, base-currency amounts are deflated by the CPI reference series before any test. Ratios, counts and original-currency amounts are not. |
| Exposure shift | A rate whose exposure changes by more than 10% between the anchor's period and any watch period, without a declared `large_scheme_change` break, gives no verdict. With the break declared, spans before it are dropped. |
| Change concentration | The `top_share_band` from L5 counts as dominated when its lower bound is at or above the task's dominance limit (default 0.5). |
| Back-filled rows | Treated as published at the metric's maximum lag; they never block a final verdict. |
| Held revisions | A row with `revision_held: true` is final only once the period passes its stable age. |

All values are starting points. The checking system recalibrates them with placebo runs on each institution's own history before any alert reaches a banker or underwriter.

| Category | Key | Method | Stable age (d) | Min volume | Min denominator | Min base | Mask | Thresholds (small = medium = large) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `savings` | `deposit_inflow` | recent_vs_prior | 7 | 30 | — | — | — | robust_z 3, pct_change 15 | — |
| `savings` | `withdrawals` | recent_vs_prior | 7 | 30 | — | — | — | robust_z 3, pct_change 15 | — |
| `savings` | `balance` | level_change | 7 | 30 | — | — | — | pct_change 3 | — |
| `savings` | `inward_remittance_credits` | seasonal_ratio (judged monthly) | 7 | 100 | — | 100 | — | percentile 5, pct_change 4 | — |
| `savings` | `large_depositor_net_flow` | recent_vs_prior | 7 | 30 | — | — | — | robust_z 3, pct_of_gross_inflow 10 | concentration-sensitive |
| `savings` | `td_placements` | seasonal_ratio | 7 | 50 | — | 50 | — | percentile 5, pct_change 10 | — |
| `savings` | `td_non_renewal_outflow` | seasonal_ratio | 7 | 50 | — | 50 | — | percentile 5, pct_change 10 | — |
| `savings` | `new_accounts` | seasonal_ratio | 7 | 20 | — | 20 | — | percentile 5, pct_change 10 | — |
| `savings` | `customer_closures` | seasonal_ratio | 7 | 1000 | — | 20 | — | percentile 5, pct_change 20 | — |
| `savings` | `offered_rate` | context | — | — | — | — | — | — | — |
| `wealth` | `contributions` | seasonal_ratio | 30 | 200 | — | 20 | — | percentile 5, pct_change 5 | — |
| `wealth` | `contribution_rate` | trend | 30 | 200 | 100 | — | — | forecast_gap_pp 1.0 | counts (Wilson) |
| `wealth` | `early_withdrawals` | seasonal_ratio | 30 | 500 | — | 20 | — | percentile 5, pct_change 10 | — |
| `wealth` | `investment_subscriptions` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 10 | concentration-sensitive |
| `wealth` | `investment_redemptions` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 10 | concentration-sensitive |
| `wealth` | `fund_value` | book_size | — | — | — | — | — | — | — |
| `wealth` | `fund_return_20d` | level_change | 7 | 1 | — | — | — | pp_change 2.0 | — |
| `wealth` | `fund_relative_return_20d` | context | — | — | — | — | — | — | — |
| `gold_loan` | `new_pledges` | seasonal_ratio | 7 | 30 | — | 30 | — | percentile 5, pct_change 5 | adverse rise or fall |
| `gold_loan` | `renewals` | context | — | — | — | — | — | — | — |
| `gold_loan` | `topups` | context | — | — | — | — | — | — | — |
| `gold_loan` | `redemptions` | seasonal_ratio | 7 | 30 | — | 30 | — | percentile 5, pct_change 5 | — |
| `gold_loan` | `loans_above_ltv_limit` | level_change | 7 | 200 | — | — | — | pp_change 2.0 | — |
| `gold_loan` | `overdue_pawns` | level_change | 14 | 200 | — | — | relief break (credit_moratorium) | pp_change 1.0 | — |
| `gold_loan` | `auctions` | seasonal_ratio | 30 | 200 | — | 20 | relief break (credit_moratorium) | percentile 5, pct_change 20 | — |
| `gold_loan` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `gold_loan` | `offered_rate` | context | — | — | — | — | — | — | — |
| `retail_loan` | `installment_collection_rate` | level_change | 30 | 200 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | pp_change 0.5 | — |
| `retail_loan` | `roll_rate_to_30` | trend | 45 | 50 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | forecast_gap_pp 0.15 | — |
| `retail_loan` | `dpd_30_plus` | context | 45 | — | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | — | — |
| `retail_loan` | `writeoffs_and_restructures` | context | — | — | — | — | — | — | — |
| `retail_loan` | `restructure_requests` | seasonal_ratio | 30 | 200 | — | 10 | — | percentile 5, pct_change 30 | — |
| `retail_loan` | `moratorium_enrolled` | mask | 14 | 200 | — | — | — | — | — |
| `retail_loan` | `applications` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 8 | — |
| `retail_loan` | `approval_rate` | level_change | 14 | 50 | 50 | — | — | pp_change 2.0 | counts (Wilson) |
| `retail_loan` | `prepayments` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 10 | — |
| `retail_loan` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `retail_loan` | `facility_utilization` | level_change | 7 | 200 | — | — | — | pp_change 0.6 | — |
| `vehicle_finance` | `installment_collection_rate` | level_change | 30 | 200 | — | — | `moratorium_enrolled` rise > 2.0 pp, else relief break (credit_moratorium) | pp_change 0.5 | — |
| `vehicle_finance` | `roll_rate_to_30` | trend | 45 | 50 | — | — | `moratorium_enrolled` rise > 2.0 pp, else relief break (credit_moratorium) | forecast_gap_pp 0.15 | — |
| `vehicle_finance` | `repossessions` | context | — | — | — | — | — | — | — |
| `vehicle_finance` | `new_leases` | seasonal_ratio | 7 | 20 | — | 20 | — | percentile 5, pct_change 8 | — |
| `vehicle_finance` | `moratorium_enrolled` | mask | 14 | 200 | — | — | — | — | — |
| `vehicle_finance` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `cards` | `card_spend` | seasonal_ratio | 7 | 500 | — | 100 | — | percentile 5, pct_change 5 | — |
| `cards` | `card_spend_cross_border` | seasonal_ratio | 7 | 200 | — | 100 | — | percentile 5, pct_change 5 | — |
| `cards` | `card_payment_rate` | level_change | 7 | 200 | — | — | `moratorium_enrolled` rise > 2.0 pp, else relief break (credit_moratorium) | pp_change 1.0 | — |
| `cards` | `revolving_share` | trend | 30 | 200 | — | — | `moratorium_enrolled` rise > 2.0 pp, else relief break (credit_moratorium) | forecast_gap_pp 0.5 | — |
| `cards` | `roll_rate_to_30` | trend | 45 | 50 | — | — | `moratorium_enrolled` rise > 2.0 pp, else relief break (credit_moratorium) | forecast_gap_pp 0.15 | — |
| `cards` | `card_fraud_rate` | level_change | 90 | 500 | — | — | — | pp_change 0.02 | — |
| `cards` | `writeoffs_and_restructures` | context | — | — | — | — | — | — | — |
| `cards` | `moratorium_enrolled` | mask | 14 | 200 | — | — | — | — | — |
| `cards` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `business_loan` | `facility_utilization` | level_change | 7 | 30 | — | — | — | pp_change 0.6 | concentration-sensitive |
| `business_loan` | `installment_collection_rate` | level_change | 30 | 30 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | pp_change 0.5 | concentration-sensitive |
| `business_loan` | `roll_rate_to_30` | trend | 45 | 50 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | forecast_gap_pp 0.15 | concentration-sensitive |
| `business_loan` | `dpd_30_plus` | context | 45 | — | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | — | — |
| `business_loan` | `returned_cheque_rate` | level_change | 14 | 30 | 50 | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | pp_change 1.5 | counts (Wilson) |
| `business_loan` | `restructure_requests` | seasonal_ratio | 30 | 200 | — | 10 | — | percentile 5, pct_change 30 | — |
| `business_loan` | `moratorium_enrolled` | mask | 14 | 200 | — | — | — | — | — |
| `business_loan` | `applications` | seasonal_ratio | 7 | 30 | — | 20 | — | percentile 5, pct_change 8 | — |
| `business_loan` | `exposure` | context | — | — | — | — | — | — | — |
| `business_loan` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `agri_loan` | `disbursements` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 10 | — |
| `agri_loan` | `installment_collection_rate` | level_change | 30 | 200 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | pp_change 1.0 | — |
| `agri_loan` | `roll_rate_to_30` | trend | 45 | 50 | — | — | `moratorium_enrolled` rise > 2.0 pp or `restructure_requests` rise > 3.0 per 1,000, else relief break (credit_moratorium) | forecast_gap_pp 0.15 | — |
| `agri_loan` | `restructure_requests` | seasonal_ratio | 30 | 200 | — | 10 | — | percentile 5, pct_change 30 | — |
| `agri_loan` | `moratorium_enrolled` | mask | 14 | 200 | — | — | — | — | — |
| `agri_loan` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `trade_finance` | `lc_openings` | seasonal_ratio | 7 | 10 | — | 20 | — | percentile 5, pct_change 5 | concentration-sensitive |
| `trade_finance` | `import_bills` | seasonal_ratio | 7 | 10 | — | 20 | — | percentile 5, pct_change 4 | concentration-sensitive |
| `trade_finance` | `export_receipts` | seasonal_ratio | 7 | 10 | — | 20 | — | percentile 5, pct_change 5 | concentration-sensitive |
| `trade_finance` | `outstanding` | book_size | — | — | — | — | — | — | — |
| `payments` | `digital_transactions` | recent_vs_prior | 7 | 500 | — | — | — | robust_z 3, pct_change 10 | — |
| `payments` | `failed_transactions_own` | level_change | 7 | 1000 | 1000 | — | — | pp_change 1.0 | counts (Wilson) |
| `payments` | `active_digital_users` | seasonal_ratio | 14 | 1000 | — | 100 | — | percentile 5, pct_change 3 | — |
| `payments` | `cash_withdrawals` | recent_vs_prior | 7 | 500 | — | — | — | robust_z 3, pct_change 10 | — |
| `payments` | `merchant_acquiring_volume` | seasonal_ratio | 7 | 200 | — | 100 | — | percentile 5, pct_change 5 | concentration-sensitive |
| `remittances` | `inward_remittances` | seasonal_ratio (judged monthly) | 7 | 100 | — | 100 | — | percentile 5, pct_change 4 | — |
| `remittances` | `outward_remittances` | seasonal_ratio (judged weekly) | 7 | 100 | — | 100 | — | percentile 5, pct_change 5 | adverse fall or rise |
| `fx` | `customer_fx_purchases` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 5 | concentration-sensitive; adverse rise or fall |
| `fx` | `customer_fx_sales` | seasonal_ratio | 7 | 50 | — | 20 | — | percentile 5, pct_change 5 | concentration-sensitive; adverse rise or fall |
| `distribution` | `bancassurance_new_premium` | seasonal_ratio | 37 | 50 | — | 20 | — | percentile 5, pct_change 8 | — |
| `life` | `premium_collection_rate` | level_change | 30 | 200 | — | — | relief break (premium_grace_extension) | pp_change 1.0 | — |
| `life` | `new_policies` | seasonal_ratio | 37 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `life` | `new_premium` | seasonal_ratio | 14 | 20 | — | 20 | — | percentile 5, pct_change 8 | — |
| `life` | `lapse_rate` | trend | 90 | 1000 | — | — | relief break (premium_grace_extension) | forecast_gap_pp 1.0 | — |
| `life` | `surrenders` | seasonal_ratio | 14 | 1000 | — | 20 | — | percentile 5, pct_change 15 | — |
| `life` | `death_claims` | seasonal_ratio | 90 | 5000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `life` | `new_money_yield_vs_guarantee` | context | — | — | — | — | — | — | — |
| `life` | `gwp` | book_size | — | — | — | — | — | — | — |
| `health` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `health` | `procedure_cost_index` | level_change | 30 | 20 | — | — | — | pct_change 3 | — |
| `health` | `median_claim_cost` | context | — | — | — | — | — | — | — |
| `health` | `renewal_rate` | level_change | 14 | 200 | — | — | — | pp_change 2.0 | — |
| `health` | `new_policies` | seasonal_ratio | 37 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `health` | `gwp` | book_size | — | — | — | — | — | — | — |
| `motor` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `motor` | `parts_cost_index` | level_change | 30 | 20 | — | — | — | pct_change 3 | — |
| `motor` | `median_claim_cost` | context | — | — | — | — | — | — | — |
| `motor` | `new_policies` | seasonal_ratio | 14 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `motor` | `renewal_rate` | level_change | 14 | 200 | — | — | — | pp_change 2.0 | — |
| `motor` | `gwp` | book_size | — | — | — | — | — | — | — |
| `travel` | `new_policies` | seasonal_ratio | 14 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `travel` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `travel` | `median_claim_cost` | context | — | — | — | — | — | — | — |
| `travel` | `gwp` | book_size | — | — | — | — | — | — | — |
| `property` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `property` | `median_claim_cost` | context | — | — | — | — | — | — | — |
| `property` | `sum_insured` | context | — | — | — | — | — | — | — |
| `property` | `new_policies` | seasonal_ratio | 14 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `property` | `gwp` | book_size | — | — | — | — | — | — | — |
| `marine` | `insured_shipments` | seasonal_ratio | 60 | 20 | — | 20 | — | percentile 5, pct_change 8 | concentration-sensitive |
| `marine` | `gwp` | book_size | — | — | — | — | — | — | — |
| `liability` | `new_policies` | seasonal_ratio | 30 | 20 | — | 20 | — | percentile 5, pct_change 10 | — |
| `liability` | `renewal_rate` | level_change | 30 | 100 | — | — | — | pp_change 2.0 | — |
| `liability` | `gwp` | book_size | — | — | — | — | — | — | — |
| `agriculture` | `new_policies` | seasonal_ratio | 30 | 50 | — | 20 | — | percentile 5, pct_change 10 | — |
| `agriculture` | `sum_insured` | context | — | — | — | — | — | — | — |
| `agriculture` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `agriculture` | `gwp` | book_size | — | — | — | — | — | — | — |
| `micro_insurance` | `new_policies` | seasonal_ratio | 37 | 20 | — | 20 | — | percentile 5, pct_change 5 | — |
| `micro_insurance` | `premium_collection_rate` | level_change | 30 | 200 | — | — | relief break (premium_grace_extension) | pp_change 1.0 | — |
| `micro_insurance` | `lapse_rate` | trend | 90 | 1000 | — | — | relief break (premium_grace_extension) | forecast_gap_pp 1.0 | — |
| `micro_insurance` | `claims_per_1000` | seasonal_ratio | 90 | 1000 | — | 10 | — | percentile 5, pct_change 25 | — |
| `micro_insurance` | `gwp` | book_size | — | — | — | — | — | — | — |
| `insurer_company` | `solvency_ratio` | context | — | — | — | — | — | — | — |
| `insurer_company` | `reinsurance_cost` | context | — | — | — | — | — | — | — |

---

## 7. Standard dimensions

Breakdowns use these keys and values only.
- **Institution-defined values** (marked so) are listed in your catalog with a label, mapped at onboarding, and never changed without a `classification_change` break.
- Every dimension also accepts the value `unknown`, for records that lack the attribute.
- Dimensions marked **frozen** are customer or account attributes, evaluated at `segment_as_of` under the cohort rule (R4).
- A request filters on **at most 3 dimensions** (R1).

| Key | Values (each list also takes `unknown`) | Source | Frozen at segment_as_of | Meaning |
|---|---|---|---|---|
| `region_l1` | ISO 3166-2 first-level subdivision codes of the profile's country | ISO 3166-2 | yes | First-level region (state, province, emirate, region). Banks: the account's home branch, or the customer's domicile if the profile declares `region_basis: customer_domicile` (required for institutions without branches). Customer-level metrics such as digital_transactions use the customer's region on the same basis. Insurers: the risk location (each insured location, the vehicle's registered address, the insured person's address). Each value names the business calendar that applies to it. Examples: LK-1, IN-MH, AE-DU, SA-01, DE-BY, BR-SP, MX-CMX. |
| `region_l2` | ISO 3166-2 second-level codes where the standard has them (e.g. LK-11), otherwise institution_defined and mapped at onboarding to the national statistics office's code | ISO 3166-2, or the national statistics office's area codes | yes | Second-level region (district, county, department, municipality). Every value names its region_l1 parent. Same basis as region_l1. |
| `corridor` | ISO 3166-1 alpha-2 codes | ISO 3166-1 | no | The other country in a cross-border flow: the sending country for inward remittances, the receiving country for outward ones, the foreign origin or destination for trade and cargo. Taken from the payment or shipment record, not the customer. |
| `destination_region` | UN M49 sub-region codes (e.g. 145 Western Asia, 035 South-eastern Asia, 154 Northern Europe) | UN M49 standard country or area codes | no | Where a trip goes (travel insurance). The first destination outside the home country named on the policy. |
| `currency` | ISO 4217 alphabetic codes | ISO 4217 | no | The original currency of the transaction, account or contract. |
| `segment` | `remittance_linked`, `pensioner`, `student`, `salaried`, `other_individual`, `importer`, `exporter`, `domestic_business`, `government`, `non_bank_financial` | this spec; computed from the institution's own transactions and customer type | yes | One value per customer, the first rule that applies, in this order. Individuals: remittance_linked (≥1 inward personal remittance credited to any of the customer's accounts in the 6 months before the segment date); pensioner (≥1 pension credit in the 3 months before); student (holds a student product at the segment date; a declared occupation alone doesn't count); salaried (a salary credit, by payroll code or employer bulk credit, in at least 2 of the 3 months before); other_individual. Organisations: government (central and local government, public agencies and state-owned enterprises, by customer type); non_bank_financial (insurers, funds, brokers, finance companies); then businesses by trade payments in the 12 months before: importer (import payments > export receipts), exporter (export receipts ≥ import payments > 0, or receipts only), domestic_business (neither). Joint accounts take the primary holder's segment. |
| `age_band` | `under_18`, `18_24`, `25_34`, `35_49`, `50_64`, `65_plus` | this spec | yes | Age of the individual customer (the primary holder) at the segment date. |
| `size_band` | `startup`, `micro`, `sme`, `corporate` | the institution's credit-policy size classification (usually the local regulator's), mapped at onboarding | yes | Business size, first rule that applies: startup (incorporated less than 3 years before the segment date), then micro, sme or corporate by the institution's declared size rule (turnover, employees or exposure). Examples of local rules: the EU SME definition (fewer than 250 staff), India's MSME bands, a central bank's SME lending definition. |
| `sector` | ISIC Rev.4 sections A-U | UN ISIC Rev.4; NACE Rev.2 sections are identical; NAICS and national lists are mapped through published concordances | yes | The business customer's main economic activity at the segment date. |
| `sector_l2` | ISIC Rev.4 divisions (2 digits, 01-99); each names its section as parent | UN ISIC Rev.4 (or mapped to it) | yes | The same activity at division level, so a shock to one industry (garments = 14, tourism accommodation = 55) can be separated from its section. |
| `employer_sector` | ISIC Rev.4 sections A-U, plus unknown | UN ISIC Rev.4 | yes | ISIC section of the employer that paid the individual's most recent salary credit before the segment date (public administration is section O). |
| `merchant_sector` | ISIC Rev.4 sections A-U | mapped from the merchant category code (ISO 18245) through a table published with the institution's catalog | no | The merchant's activity, for card spend and acquiring. |
| `channel` | `branch`, `mobile`, `internet`, `atm`, `agent`, `contact_centre`, `api` | this spec | no | The service channel where the transaction or application was made. `api` covers host-to-host and open-banking access; `agent` covers banking agents and correspondents. |
| `sales_channel` | `agency`, `broker`, `bancassurance`, `direct`, `digital`, `partner` | this spec | no | How an insurance policy (or a bank-distributed policy) was sold. `partner` covers affinity, retail, telecom and employer schemes; `direct` is the insurer's own staff and branches; `digital` its own web and app sales. |
| `vehicle_type` | `two_wheeler`, `three_wheeler`, `car`, `light_commercial`, `heavy_commercial`, `bus`, `agricultural`, `other` | this spec; map local registration classes at onboarding | no | Class of the financed or insured vehicle. |
| `new_used` | `new`, `used` | this spec | no | Whether the vehicle was new (first registration) when financed or first insured. |
| `cover` | `comprehensive`, `third_party_only`, `third_party_fire_theft` | this spec | no | Motor cover level. |
| `claim_type` | motor: `collision`, `third_party`, `theft`, `natural_peril`, `glass_other`<br>health: `inpatient`, `outpatient`, `day_care`, `maternity`, `dental_optical`, `critical_illness`, `accident`<br>travel: `medical`, `trip_cancellation`, `baggage_delay`, `other` | this spec | no | What the claim is for; the value set depends on the category. A motor flood claim is claim_type=natural_peril with peril=flood. |
| `peril` | `flood`, `storm`, `earthquake`, `fire`, `drought`, `pest_disease`, `other` | this spec | no | The cause of loss. `storm` covers wind, cyclone, hurricane and typhoon. |
| `settlement_mode` | `cashless`, `reimbursement` | this spec | no | Health claims: billed directly by the provider (cashless) or claimed back by the insured. |
| `plan` | institution_defined | the insurer's plan tiers, listed in its catalog | no | Health plan or benefit tier. |
| `traveller_type` | `leisure`, `business`, `student`, `migrant_worker`, `pilgrimage`, `other` | this spec | no | Purpose of travel as recorded on the policy. |
| `tenor_band` | `lt_3m`, `3m_6m`, `6m_12m`, `1y_3y`, `gt_3y` | this spec | no | Contractual tenor at placement or booking. |
| `rate_type` | `fixed`, `variable`, `hybrid` | this spec | no | Whether the interest or profit rate is fixed for the life of the contract, resets with a reference rate, or is fixed for an initial period and then resets. |
| `lc_type` | `sight`, `usance` | this spec | no | Letter of credit payable at sight or deferred (usance, acceptance, deferred payment). |
| `terms` | `collection`, `open_account`, `advance` | this spec | no | Import payment terms outside letters of credit: documentary collection (D/P, D/A), open account, or payment in advance. |
| `withdrawal_reason` | `hardship`, `emigration`, `housing`, `medical`, `education`, `other` | this spec | no | Reason recorded for an early retirement-plan withdrawal. |
| `restructure_reason` | `income_loss`, `business_downturn`, `disaster`, `other`, `not_stated` | this spec | no | Reason recorded on a restructure request. |
| `asset_class` | `equity`, `fixed_income`, `money_market`, `mixed`, `other` | this spec | no | Main asset class of an investment product or fund. |
| `outflow_type` | `at_maturity`, `premature` | this spec | no | Term-deposit outflow at maturity, or a premature withdrawal (a broken deposit). |
| `action` | `writeoff`, `restructure` | this spec | no | Write-off, or restructure because of financial difficulty. |
| `instrument` | `cheque`, `direct_debit` | this spec | no | Payment instrument returned unpaid. |
| `spend_location` | `domestic`, `cross_border` | this spec | no | Card spend at a merchant in the profile's country or abroad (including foreign e-commerce). |
| `card_origin` | `domestic`, `foreign` | this spec | no | Acquiring: whether the card was issued in the profile's country or abroad. |
| `payout_method` | `account_credit`, `cash_pickup`, `wallet` | this spec | no | How an inward remittance was paid to the beneficiary. |
| `source` | `fc_deposit`, `export_proceeds`, `inward_remittance`, `cash`, `other` | this spec | no | Where the foreign currency a customer sells to the institution comes from. |
| `insurance_line` | `life`, `health`, `general`, `credit_protection` | this spec | no | Line of an insurance policy distributed by a bank. |
| `policy_duration_band` | `year_1`, `year_2`, `years_3_5`, `years_6_plus` | this spec | no | Policy year at the event date, counted from issue. |
| `cause_group` | `illness`, `infectious_disease`, `accident`, `other` | this spec; map ICD-10 chapters where coded | no | Cause of death as notified on the claim. |
| `collection_method` | `bank_debit`, `card`, `payroll`, `mobile_wallet`, `airtime`, `agent_cash`, `other` | this spec | no | How a premium instalment is collected. |
| `trade_direction` | `import`, `export`, `domestic` | this spec | no | Direction of an insured shipment relative to the profile's country. |
| `commodity_group` | Harmonized System sections I-XXI | WCO Harmonized System | no | Goods shipped, by HS section. |
| `liability_line` | `public`, `products`, `professional`, `employers_workers`, `directors_officers`, `other` | this spec | no | Line of liability cover. |
| `crop_group` | `cereals`, `vegetables_melons`, `fruit_nuts`, `oilseeds`, `roots_tubers`, `beverage_spice`, `leguminous`, `sugar`, `other_crops`, `livestock`, `aquaculture` | FAO Indicative Crop Classification (ICC) groups, plus livestock and aquaculture | no | Insured crop or animal group. |
| `scheme` | `public_subsidised`, `private` | this spec | no | Whether the premium is subsidised under a public scheme. |

---

## 8. Breaks and events

A **break** is anything other than customer behaviour that changes a metric: a new system, a new product rule, a book bought or sold, a large group scheme joining, a relief scheme, a disaster that closed branches, a redenomination. Declare breaks at `GET /metrics/v1/breaks`. The checks need them to avoid reading your own changes as a market effect.

**Two types.**
- **Lasting shifts** have a start date and **no `until`**. Comparisons use only spans wholly after the shift; for a seasonal ratio, their year-ago and growth windows must be after it too. A lasting shift inside the window being judged means no verdict, unless the break **is** the event being checked: give it that event's `event_id`.
- **Episodes** have a start and an **`until`** (exclusive). Spans that touch an episode are left out of baselines. A `relief` episode inside the watch masks the credit-quality family (or premium collection, with `relief_kind: premium_grace_extension`) when no trigger metric is served.

| Kind | Type | Meaning |
|---|---|---|
| `system_migration` | lasting (no until) | a core, card, policy or claims system change that alters how or when records are posted |
| `product_change` | lasting (no until) | a product launched, withdrawn, repriced structurally, or its terms changed |
| `rule_change` | lasting (no until) | a regulatory, accounting or tax rule that changes what is recorded (a new dpd counting rule, IFRS 9 or IFRS 17 adoption, a change of weekend) |
| `portfolio_transfer` | lasting (no until) | a book bought, sold, merged or moved between products or entities |
| `large_scheme_change` | lasting (no until) | a group scheme, fleet, payroll or corporate relationship larger than 5% of a metric's exposure or volume joining or leaving |
| `classification_change` | lasting (no until) | a change in how customers, sectors or regions are classified (including branch mergers and ISO 3166-2 code changes) |
| `definition_change` | lasting (no until) | the institution changed how it computes a spec metric (e.g. a new transaction-code list) |
| `currency_redenomination` | lasting (no until) | the base currency was redenominated (e.g. SLL to SLE in 2022, at 1,000 to 1); history is restated at the legal factor and the break records the date and factor |
| `relief` | episode (with until) | a payment moratorium, deferral, premium-grace extension or fee waiver, with its end date; `relief_kind` says which |
| `disaster` | episode (with until) | a flood, storm, earthquake, epidemic or conflict that disrupted operations or customers |
| `outage` | episode (with until) | a system or network outage that disrupted transactions |
| `campaign` | episode (with until) | a one-off promotion large enough to move a metric (recurring campaigns go in the calendar as flags) |
| `market_disruption` | episode (with until) | a market closure, bank holiday declared at short notice, or capital-control episode |

**Fields** (schema `Break` in the reference API):

| Field | Meaning |
|---|---|
| `break_id` | your id |
| `kind` | a kind from the table above |
| `type` | `lasting` or `episode` |
| `date`, `until` | local dates |
| `product_ids`, `metrics` | which products and metrics it affects (empty = all) |
| `applies_to` | a dimension filter, e.g. `{region_l1: [IN-KL]}` for a regional flood |
| `relief_kind` | for relief: `credit_moratorium`, `premium_grace_extension` or `fee_waiver` |
| `factor` | for `currency_redenomination`: old units per new unit |
| `event_id` | optional: the event this break is, when it's known |
| `description` | plain words. **Never names a customer, employer or obligor** (R1) |
| `declared_at` | when you declared it, so late declarations are visible |

**What to declare, at the least:**
- every core, card, policy or claims-system migration of the last 39 months;
- every relief scheme, including farm-loan waivers;
- product launches and withdrawals;
- group schemes, fleets, payrolls or corporate relationships above 5% of a metric's exposure joining or leaving;
- changes to how you compute a spec metric;
- disasters that closed branches or stopped claims handling;
- currency redenominations.

Recurring seasonal events (festivals, salary days, harvests, campaigns that come back every year) go in the **calendar** as flags, not in breaks.

> **Example (Europe).** A German bank migrates its core on 2026-11-16. Standing-order collections move from the due date to T+3. Declared as `system_migration`, lasting, for `retail_loan.installment_collection_rate`.
>
> **Example (Africa).** A Kenyan health insurer onboards a 45,000-life employer scheme on 2026-04-01, growing its insured lives by 38%. Declared as `large_scheme_change`, lasting, for `group_health` metrics.
>
> **Example (South Asia).** A flood-relief moratorium is declared from 2026-12-07 to 2027-03-07 for two districts. Declared as `relief`, episode, `relief_kind: credit_moratorium`, with `applies_to: {region_l2: [...]}`.

---

## 9. Conformance checks and errors

You can run these checks yourself before onboarding; the connector runs the same ones and reports each as pass, fail or not applicable, with the fix. The **Level** column is the lowest capability level at which a check applies.

| Id | Level | Check | Passes when | Fix |
|---|---|---|---|---|
| C01 | L1 | **Profile complete.** GET /catalog returns spec_version, time_zone (a valid IANA name), business_calendars (a primary one, and one per region with its own holidays or weekend), base_currency and pivot_currency (ISO 4217), fx_reference_sources, region_basis, accounting_framework with the dpd fields, suppression rule and capability_level. | Every field present and valid. | Fill the profile; use IANA names such as Asia/Dubai, never offsets like +04:00; declare a calendar for every region whose holidays or weekend differ. |
| C02 | L1 | **Products mapped.** Every product in the catalog names a category and product type from this spec; every metric key is a spec key or an alias, offered only for categories that define it. | No unknown category, product type or metric key. | Map the product to the nearest type, or leave it out of the catalog; rename keys to spec keys. |
| C03 | L1 | **Grid periods.** Rows for daily, weekly and monthly requests: from < until, until exclusive, weeks start on Monday, months on the 1st, business-day rows only on business days of the calendar that applies (the region's, or the primary calendar for multi-region totals); no gaps or overlaps. | Every row sits on the grid. | Compute periods in the profile's time zone with until exclusive; never return partial periods. |
| C04 | L1 | **No relative, off-grid or over-filtered requests.** A request whose start or until is off the metric's grid, that names a relative window, that filters on more than 3 dimensions, or whose segment_as_of is not a Monday, is rejected with the matching error code; the current, still-open period is never returned. | 400 off_grid, too_many_filters or segment_date_not_on_grid; no row for an open period. | Validate dates and filters before querying; drop 'last N days' and 'month to date' parameters. |
| C05 | L1 | **Units and currency.** unit matches the spec; currency is an ISO 4217 code; currency_basis=original returns metrics whose rule is `original` in the currency the customer paid or was paid in, and base returns the same totals converted at transaction-date rates. | Units equal the spec; original and base differ only by the conversion. | Store the original amount and currency per transaction (for remittances: the sender's instructed currency); convert at the declared reference rate of the transaction's date, not the period end. |
| C06 | L2 | **Ratio and rate arithmetic.** For ratios, value = numerator ÷ denominator × 100; for rates, value = numerator ÷ exposure × 1,000; within 0.01 of the unit. | All rows agree. | Return the numerator and denominator the value was computed from, not separately rounded figures. |
| C07 | L2 | **Additivity.** For flows and counts: the sum over a breakdown's values (including unknown) equals the unfiltered total, allowing for suppressed cells; daily rows summed over a week equal the weekly total the institution would compute. | Differences only where cells are suppressed. | Use one set of inclusion rules and one booking date for every grain and breakdown; send records without the attribute to `unknown` instead of dropping them. |
| C08 | L2 | **Stock consistency.** A weekly or monthly stock equals the daily stock on the period's last business day. | Equal. | Read stocks from the end-of-day snapshot of the last business day. |
| C09 | L2 | **Suppression.** No unsuppressed row has fewer distinct contributors than the minimum, breaks the (1, 50%) or (2, 85%) dominance rule on its measured component, or serves a median from fewer than 20 contributors; suppressed rows return null value, numerator, denominator, exposure and volume. | No row breaks the rule. | Apply suppression to every returned aggregate, after filtering, on the requested period, counting customers rather than accounts. |
| C10 | L2 | **Complementary suppression over served combinations.** For a sample of suppressed cells, the connector tries to rebuild each one from published cells: parent total minus siblings, across every filter combination the catalog serves (up to 3 dimensions). | No suppressed cell can be rebuilt. | Run secondary suppression over the full set of served combinations (or restrict them with filter_sets). |
| C11 | L3 | **History depth.** Each metric's earliest row is at least history_months before the latest closed period (39 for seasonal, recent-vs-prior and trend tests, 27 for level tests), or at the product's declared launch date. | Deep enough, or launch declared. | Back-fill from the system of record, flagging the rows backfilled: true; declare launch dates and any system migration as a break. |
| C12 | L3 | **Publication.** Every live (not back-filled) row has published_at; in the last 12 live months, at least 95% of periods were published within max_lag_days of their last day. | Present and on time. | Record the local date each period's value was first produced; if your lag is longer, declare it in the catalog (the checks then wait longer). |
| C13 | L3 | **Breaks declared.** GET /breaks returns valid rows (kind, type, date, until for episodes, scope); system migrations, relief periods, large scheme or fleet changes and currency redenominations of the last 39 months are present; descriptions name no customer. | Valid, and none known to be missing. | Declare past migrations, product changes, relief schemes and large portfolio moves; lasting shifts have no until. |
| C14 | L4 | **Vintages.** For a period known to have been revised: known_through before its first publication returns it as unpublished; between publication and revision returns the first value; same_age_days returns the value as known that many days after the period ended; rows say vintage, revised and revision_held. | All behave as described. | Keep every published value with the date it was produced, or reconstruct vintages from posting timestamps (entries posted by the date, with value dates in the period). |
| C15 | L2 | **Frozen segments and the cohort rule.** A request with segment_as_of returns customer attributes as they were on that date; customers who left before it keep the attribute of their last day; customers who joined after it take their attribute at onboarding; facility limits are held at the earlier of the period's start and the segment date. | All four hold on test customers. | Keep dated history of customer attributes, or weekly snapshots; declare the snapshot frequency in the catalog. |
| C16 | L5 | **Change concentration.** GET /change-concentration rejects overlapping, unequal or off-grid windows (windows_invalid) and returns only a band of the top share, never a change value, identifier, rank or amount. | Invalid windows rejected; a band only. | Compute per-contributor changes inside your systems and return only the band. |
| C17 | L1 | **Calendars.** Business days, holidays and standard flags (weekend, holidays, salary_day, month_end, season:<name>, dst_change) are available for every declared calendar, from the start of history to 12 months ahead, with moving holidays dated. | Complete, per calendar, with named holidays and seasons. | Serve /calendar per calendar_id, or declare the public calendars and their sources in the profile. |
| C18 | L1 | **Limits and speed.** A request for a metric's full history (in pages if needed) completes within 30 seconds; 429 and 503 responses carry Retry-After; a page token keeps the known_through of the first page. | Within limits; pages consistent. | Pre-aggregate per period and breakdown; page by period; pin the vintage in the token. |
| C19 | L1 | **No personal data.** No response (series, breaks, catalog notes) contains fields or values that look like account, card or policy numbers, names, national identifiers, or single-customer amounts; dimension values are from the spec or the mapped lists. | Nothing flagged. | Remove the field or text; replace identifiers by spec dimension values. |
| C20 | L1 | **Spec-version header and aliases.** Every response carries Metrics-Spec-Version with a version this spec accepts (same MAJOR); the catalog lists the aliases and deprecations the server honours; an alias whose filter conflicts with the request's filter returns alias_filter_conflict. | Header present; aliases listed and enforced. | Add the header from configuration; serve the spec's alias table. |
| C21 | L2 | **Booking-date self-test (institution only).** Post test transactions: one at 23:30 local time, one on a regional holiday, one reversed two days later, one own-account transfer, one joint-account transfer from a co-holder, one instalment due on a Sunday and paid on Monday. | 23:30 in that local day; regional-holiday flow on the region's next business day; reversal netted to the original date; own-account and co-holder transfers excluded; the Sunday instalment counted as collected. | Use local dates of the value date; apply each region's calendar; net reversals to the original date; treat joint accounts as the co-holders' own accounts; measure collections with the clearing days of R4. |
| C22 | L4 | **Revision and segment-date guards.** A revision resting on fewer than min_contributors contributors is held (revision_held: true) until it passes or reaches the stable age; a segment_as_of whose membership difference from the previous Monday is between 1 and min_contributors - 1 is refused for that cell. | Both guards fire on test data. | Compare each new vintage and each segment date with the last served one before releasing it. |

**Error codes.** Errors are RFC 9457 problem details with a `code`. Each code always comes with the same HTTP status:

| HTTP status | Codes |
|---|---|
| 400 | `off_grid`, `relative_window`, `range_too_large`, `invalid_parameter`, `too_many_filters`, `segment_date_not_on_grid`, `windows_invalid`, `alias_filter_conflict`, `known_through_in_future`, `unsupported_version` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `unknown_product`, `unknown_metric` |
| 422 | `unknown_breakdown`, `value_not_allowed`, `filter_set_not_allowed`, `unsupported_capability` |
| 429 | `rate_limited` |
| 500 | `internal` |
| 501 | `not_implemented` |
| 503 | `unavailable` |

**The coverage report** lists, per category and product: the coverage status (§3), the capability level and grain reached per metric, failed checks with fixes, and unmapped products, fields or dimension values.

---

## 10. Open points and assumptions

**Open points**
1. **Region basis.** Banks may choose home branch or customer domicile (domicile is required without branches), so two banks' regional numbers aren't strictly comparable. The checks only compare an institution with itself, so this version allows both.
2. **Claims by loss date.** Frequency uses the reported date, compared at the same age. Loss-date counts with development factors (the actuarial standard) are deferred.
3. **Segment precedence.** One value per customer means a salaried customer who also receives remittances is only `remittance_linked`. Flag dimensions would allow overlaps, at the cost of more suppression.
4. **Cost indices.** Procedure and parts baskets are chosen by each insurer. They are comparable over time within an insurer, not across insurers.
5. **Multi-time-zone countries** (the US, Brazil, Indonesia, Australia). This version assumes one time zone per profile (normally the head office's), with every transaction dated in it.
6. **Fund returns** come from public prices. They could become reference data supplied by the checks rather than an institution metric.
7. **Still missing:** a treasury and ALM view; mortgage collateral value (house-price LTV); unit-linked and annuity flows for insurers; fee-cap effects on payments; a trust signal for insurers.
8. **The clearing window** (3 business days) is a convention chosen to absorb weekend and holiday due dates. Placebo runs may show a shorter window is enough.
9. **The high-inflation threshold** (25% a year, or IAS 29) is a judgement. It only switches the checks to real terms; institutions always serve nominal amounts.
10. **Micro insurance** is defined by the local rule, or by a declared sum-insured ceiling where none exists. A neutral default ceiling hasn't been chosen.

**Assumptions**
- The checks run inside the institution, and only verdicts and the aggregates behind them leave it. Suppression still applies inside, because the aggregates reach model prompts, event briefs and the people who operate the checks.
- The (1, 50%) and (2, 85%) dominance rules, the 10-contributor minimum and the 3-dimension filter limit are acceptable to most supervisors. Stricter local rules are honoured.
- Institutions can keep dated history of customer attributes, or at least weekly snapshots, and can reconstruct vintages from posting dates.
- Rival rates, gold prices, FX reference rates, CPI, building-material prices and system-wide cheque-return rates are public. The checking system collects them, not the institution.
- Validation thresholds are starting points. Placebo runs on each institution's history replace them before alerts reach bankers.

---

## 11. Event themes each category helps check

The checking system tests hypotheses raised by twelve kinds of event (the themes under `vocabularies.themes` in `metrics-spec-1.0.0.yaml`). This table shows, per category, the metrics that help check each kind. ° marks context, book-size or mask metrics (shown next to verdicts, never tested).

| Category | fx | rates | prices | commodities | remittance | regulation | competitor | macro | sector | disaster | trust | markets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `savings` | balance<br>inward_remittance_credits | deposit_inflow<br>withdrawals<br>large_depositor_net_flow<br>td_placements<br>td_non_renewal_outflow<br>customer_closures<br>offered_rate° | withdrawals<br>new_accounts | deposit_inflow<br>withdrawals | deposit_inflow<br>balance<br>inward_remittance_credits | withdrawals<br>balance<br>inward_remittance_credits<br>td_placements<br>td_non_renewal_outflow | deposit_inflow<br>withdrawals<br>large_depositor_net_flow<br>td_placements<br>td_non_renewal_outflow<br>new_accounts<br>customer_closures<br>offered_rate° | deposit_inflow<br>withdrawals<br>inward_remittance_credits<br>new_accounts | deposit_inflow | deposit_inflow<br>withdrawals<br>inward_remittance_credits | deposit_inflow<br>withdrawals<br>balance<br>large_depositor_net_flow<br>td_placements<br>td_non_renewal_outflow<br>new_accounts<br>customer_closures |  |
| `wealth` |  | investment_subscriptions<br>investment_redemptions<br>fund_return_20d | contributions<br>contribution_rate<br>early_withdrawals |  |  | early_withdrawals | investment_subscriptions | contributions<br>contribution_rate<br>early_withdrawals | contributions<br>contribution_rate |  | early_withdrawals<br>investment_subscriptions<br>investment_redemptions | investment_subscriptions<br>investment_redemptions<br>fund_return_20d<br>fund_relative_return_20d° |
| `gold_loan` | loans_above_ltv_limit | offered_rate° | new_pledges<br>redemptions<br>overdue_pawns<br>auctions | new_pledges<br>renewals°<br>topups°<br>redemptions<br>loans_above_ltv_limit<br>overdue_pawns<br>auctions | new_pledges |  | new_pledges<br>offered_rate° | new_pledges<br>redemptions<br>overdue_pawns<br>auctions |  | new_pledges |  |  |
| `retail_loan` | roll_rate_to_30 | installment_collection_rate<br>roll_rate_to_30<br>dpd_30_plus°<br>restructure_requests<br>applications<br>prepayments<br>facility_utilization | installment_collection_rate<br>roll_rate_to_30<br>facility_utilization |  | installment_collection_rate<br>roll_rate_to_30 | writeoffs_and_restructures°<br>moratorium_enrolled°<br>approval_rate | applications<br>prepayments | installment_collection_rate<br>roll_rate_to_30<br>dpd_30_plus°<br>writeoffs_and_restructures°<br>restructure_requests<br>applications<br>approval_rate<br>facility_utilization | installment_collection_rate<br>roll_rate_to_30<br>restructure_requests<br>facility_utilization | installment_collection_rate<br>restructure_requests<br>moratorium_enrolled° |  |  |
| `vehicle_finance` | new_leases | installment_collection_rate<br>roll_rate_to_30<br>new_leases | installment_collection_rate<br>roll_rate_to_30<br>new_leases |  |  | new_leases<br>moratorium_enrolled° |  | installment_collection_rate<br>roll_rate_to_30<br>repossessions°<br>new_leases |  | installment_collection_rate<br>moratorium_enrolled° |  |  |
| `cards` | card_spend_cross_border | card_spend<br>card_payment_rate<br>revolving_share<br>roll_rate_to_30 | card_spend<br>card_spend_cross_border<br>card_payment_rate<br>revolving_share<br>roll_rate_to_30 |  |  | card_spend_cross_border<br>moratorium_enrolled° | card_fraud_rate | card_spend<br>card_spend_cross_border<br>card_payment_rate<br>revolving_share<br>roll_rate_to_30<br>writeoffs_and_restructures° | card_spend | card_spend<br>card_spend_cross_border<br>moratorium_enrolled° | card_fraud_rate |  |
| `business_loan` | facility_utilization<br>installment_collection_rate<br>roll_rate_to_30<br>returned_cheque_rate | facility_utilization<br>installment_collection_rate<br>roll_rate_to_30<br>applications | facility_utilization<br>installment_collection_rate |  |  | moratorium_enrolled° |  | facility_utilization<br>installment_collection_rate<br>roll_rate_to_30<br>dpd_30_plus°<br>returned_cheque_rate<br>restructure_requests<br>applications | facility_utilization<br>installment_collection_rate<br>roll_rate_to_30<br>dpd_30_plus°<br>returned_cheque_rate<br>restructure_requests<br>applications<br>exposure° | installment_collection_rate<br>restructure_requests<br>moratorium_enrolled° |  |  |
| `agri_loan` |  | disbursements | disbursements<br>installment_collection_rate<br>roll_rate_to_30 | disbursements<br>installment_collection_rate<br>roll_rate_to_30<br>restructure_requests |  | disbursements<br>installment_collection_rate<br>roll_rate_to_30<br>moratorium_enrolled° |  |  |  | disbursements<br>installment_collection_rate<br>roll_rate_to_30<br>restructure_requests<br>moratorium_enrolled° |  |  |
| `trade_finance` | lc_openings<br>import_bills<br>export_receipts |  |  | lc_openings<br>import_bills<br>export_receipts |  | lc_openings<br>import_bills<br>export_receipts |  | lc_openings<br>import_bills | lc_openings<br>import_bills<br>export_receipts | export_receipts |  |  |
| `payments` |  |  | merchant_acquiring_volume |  |  |  | digital_transactions<br>active_digital_users<br>merchant_acquiring_volume | cash_withdrawals<br>merchant_acquiring_volume | merchant_acquiring_volume | digital_transactions<br>failed_transactions_own<br>cash_withdrawals<br>merchant_acquiring_volume | digital_transactions<br>failed_transactions_own<br>active_digital_users<br>cash_withdrawals |  |
| `remittances` | inward_remittances<br>outward_remittances |  |  |  | inward_remittances | inward_remittances<br>outward_remittances | inward_remittances<br>outward_remittances | inward_remittances<br>outward_remittances |  | inward_remittances | outward_remittances |  |
| `fx` | customer_fx_purchases<br>customer_fx_sales |  |  | customer_fx_purchases | customer_fx_sales | customer_fx_purchases<br>customer_fx_sales |  | customer_fx_purchases |  |  | customer_fx_purchases<br>customer_fx_sales |  |
| `distribution` |  | bancassurance_new_premium |  |  |  | bancassurance_new_premium | bancassurance_new_premium | bancassurance_new_premium |  |  |  |  |
| `life` |  | premium_collection_rate<br>new_policies<br>lapse_rate<br>surrenders<br>new_money_yield_vs_guarantee° | premium_collection_rate<br>new_policies<br>new_premium<br>lapse_rate |  | premium_collection_rate | new_policies | new_policies<br>new_premium | premium_collection_rate<br>new_policies<br>new_premium<br>lapse_rate<br>surrenders |  | premium_collection_rate<br>death_claims | surrenders | surrenders<br>new_money_yield_vs_guarantee° |
| `health` | procedure_cost_index<br>median_claim_cost° |  | claims_per_1000<br>procedure_cost_index<br>median_claim_cost°<br>renewal_rate<br>new_policies |  |  | new_policies | renewal_rate<br>new_policies | renewal_rate<br>new_policies |  | claims_per_1000 |  |  |
| `motor` | parts_cost_index<br>median_claim_cost°<br>new_policies |  | claims_per_1000<br>parts_cost_index<br>median_claim_cost°<br>renewal_rate |  |  | parts_cost_index<br>new_policies | new_policies<br>renewal_rate | new_policies<br>renewal_rate |  | claims_per_1000 |  |  |
| `travel` | new_policies<br>median_claim_cost° |  | median_claim_cost° |  | new_policies | new_policies |  | new_policies |  | new_policies<br>claims_per_1000 |  |  |
| `property` | median_claim_cost° |  | median_claim_cost° |  |  | new_policies | new_policies | new_policies |  | claims_per_1000<br>median_claim_cost°<br>sum_insured° |  |  |
| `marine` | insured_shipments |  |  | insured_shipments |  | insured_shipments |  | insured_shipments | insured_shipments | insured_shipments |  |  |
| `liability` |  |  |  |  |  | new_policies | new_policies<br>renewal_rate | new_policies<br>renewal_rate | new_policies |  |  |  |
| `agriculture` |  |  |  | new_policies<br>sum_insured°<br>claims_per_1000 |  | new_policies |  | new_policies |  | new_policies<br>sum_insured°<br>claims_per_1000 |  |  |
| `micro_insurance` |  |  | new_policies<br>premium_collection_rate<br>lapse_rate |  | premium_collection_rate | new_policies | new_policies | new_policies<br>premium_collection_rate<br>lapse_rate |  | premium_collection_rate<br>claims_per_1000 |  |  |
| `insurer_company` | reinsurance_cost° | solvency_ratio° |  |  |  |  |  |  |  | reinsurance_cost° |  | solvency_ratio° |

**Why cells are empty.**
- **`markets`** only fills `wealth`, `life` (surrenders) and `insurer_company`. Equity and bond moves reach customers through investment values and savings policies. Deposit flows after a market fall are checked under `trust` and `rates`.
- **`commodities`** fills where a commodity is the product or the trade (gold loans, agricultural lending, trade finance, FX, marine cargo, crop insurance), plus deposits through `segment=government` in commodity-exporting economies. Elsewhere a commodity shock reaches customers through `prices` (fuel, food).
- **`remittance`** fills deposits, remittances, FX, gold loans, retail credit (remittance-linked borrowers), travel (migrant workers), and life and micro premiums. Business lending, agricultural lending and general-insurance lines have no remittance channel worth testing.
- **`trust`** is about the institution or the system. It fills deposits, payments and cash, remittances, FX, investments, life surrenders and card fraud, where customers can move money quickly. Credit books don't react to trust news within the checks' windows.
- **`competitor`** is empty for vehicle finance, business and agricultural lending, trade finance, FX, travel, marine and agriculture. Their pricing is negotiated, bundled or set by public schemes, so there is no public rival price to react to within the checks' windows.
- **`rates`** is empty for trade finance, payments, remittances, FX and general insurance. Their volumes don't depend on interest rates within months.
- **`prices`** is empty for trade finance, remittances, FX, distribution and the commercial insurance lines. Consumer prices act there only through `macro` or `sector`.
- **`fx`** is empty for investments, agricultural lending, payments, distribution, life, liability, agriculture and micro insurance. They are priced and paid in the base currency.
- **`sector`** fills business-facing categories, cards (merchant sector), and wherever employer sector is a breakdown. Retail insurance lines have no sector attribute.
- **`disaster`** is empty for investments, FX, distribution and liability (whose claims metric was cut as too rare to test).
- **`regulation`** is empty for gold loans and payments: there is no tested rule-change mechanism there yet; fee caps are open point 7.
- **`macro`** is empty for agricultural lending (driven by weather and crop prices, under `commodities` and `disaster`) and for `insurer_company`, which is context by design.

---

## 12. Counts

- **Categories:** 23 (13 bank, 10 insurer).
- **Metric rows** (a key counted once per category that defines it): 128, over 76 distinct keys. 86 are tested; the rest are context, book size or mask metrics. Derived (computed by the checks, not served): 1.
- **Starter set:** 9 bank and 5 insurer metrics (★ in §5).

| Tier | Banks | Insurers | Total |
|---|---|---|---|
| required | 34 | 23 | 57 |
| recommended | 35 | 18 | 53 |
| optional | 14 | 4 | 18 |
| all | 83 | 45 | 128 |

Required metrics per category: `savings` 3, `wealth` 4, `gold_loan` 3, `retail_loan` 3, `vehicle_finance` 3, `cards` 3, `business_loan` 3, `agri_loan` 3, `trade_finance` 3, `payments` 2, `remittances` 1, `fx` 2, `distribution` 1, `life` 3, `health` 3, `motor` 3, `travel` 2, `property` 2, `marine` 2, `liability` 2, `agriculture` 3, `micro_insurance` 3, `insurer_company` 0.

---

## 13. Common misreadings

The definitions that are easiest to get wrong, and what the spec means.

| # | Metric | Easy to get wrong | What the spec means |
|---|---|---|---|
| 1 | `segment` = `student` | Keeping graduates in the segment until their product is converted | Only customers holding a student product on the segment date |
| 2 | `installment_collection_rate` | Using the loan system's allocation (oldest arrears first), which understates collections for borrowers in arrears | Apply each payment to the period's instalment before older arrears, and count receipts up to the 3rd business day after the due date |
| 3 | `facility_utilization` | Switching between a "shadow" limit and the recorded limit of an uncommitted overdraft | One recorded limit per line, held at the earlier of the period's start and the segment date |
| 4 | `large_depositor_net_flow` | Ranking accounts, or connected groups, instead of customers | Rank customers by total deposits on the first day of the month; the group holds 20% of deposits, at least 30 customers |
| 5 | `procedure_cost_index`, `parts_cost_index` | Serving the average claim cost under the index's name | A fixed, declared basket of items priced each month, weights fixed for a year |
| 6 | `claims_per_1000` | Counting a three-day storm as three events, or a multi-vehicle collision as one claim; counting bills or pre-authorisations | One claim per insured risk (vehicle, location, life) per loss event; exposure counts risks, not policies |
| 7 | `customer_fx_purchases`, `customer_fx_sales` | Leaving card-scheme or remittance FX inside because it is booked as deal tickets | By transaction code: customer FX deals and account conversions only; anything settled through a card scheme or remittance network is out |
| 8 | `offered_rate` | Serving an average of rates actually paid, or changing the reference tenor silently | The advertised standard (or announced expected profit) rate for the declared reference tenor; a tenor change is a `product_change` break |
| 9 | `lapse_rate` | Counting policies still in grace as lapsed; leaving unit-linked discontinuances out | Lapse date = end of grace; count policies not reinstated within 90 days; map discontinuances to lapses |
| 10 | `card_fraud_rate` | Counting merchant disputes as fraud | Purchases reported or detected as fraud, by transaction date; disputes that aren't fraud are out |
| 11 | `roll_rate_to_30`, `dpd_30_plus` | Using 30 days or more, or resetting dpd when a loan is restructured | More than 30 days (31+); dpd keeps counting through a restructure |
| 12 | `inward_remittances` | Serving the settlement currency (often USD) instead of the sender's currency | The sender's instructed currency from the payment message |
