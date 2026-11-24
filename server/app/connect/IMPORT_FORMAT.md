# The import format: `amiri-institution-data/1`

Amiri Agent reads the institution's own figures from one JSON file. The file is a **snapshot of what the
institution's Metrics Spec reference API would answer** (`app/spec/reference-openapi-1.0.0.yaml`): the catalog, the
primary business calendar, the breaks, and the rows of every series. The server stores it and serves it back as that
API, in-process, so the connector's **Check** and the validator read it exactly as they would read a live API.

Get a valid file from **Data connections › Download an example file** (`GET /api/v1/data-connection:example`): the
sample bank, or the sample insurer for an insurer, shaped by your profile. Import it with
`POST /api/v1/data-connection:import` (the file as the JSON body; `?file_name=` names it on the page).

```json
{
  "format": "amiri-institution-data/1",
  "metrics_spec": "1.0.0",
  "as_of": "2026-11-23",
  "about": "Optional: where the figures come from.",
  "catalog":  { "spec_version": "1.0.0", "generated_at": "…", "profile": { … }, "products": [ … ], "aliases": [], "deprecations": [] },
  "calendar": { "calendar_id": "lk-banks", "primary": true, "time_zone": "Asia/Colombo", "weekend_days": [6, 7], "days": [ … ] },
  "breaks":   [ ],
  "series": [
    { "product_id": "migrant-savings", "metric": "deposit_inflow", "filter": {}, "currency": "LKR",
      "rows": [ { "from": "2026-11-20", "until": "2026-11-21", "value": 308457507.53, "volume": 96694, "published_at": "2026-11-21" } ] },
    { "product_id": "personal-loans", "metric": "roll_rate_to_30", "filter": { "segment": "salaried" }, "currency": null,
      "rows": [ { "from": "2026-07-01", "until": "2026-08-01", "value": 2.1, "numerator": 2100.5, "denominator": 100023.8,
                  "volume": 9120, "published_at": "2026-08-05",
                  "vintages": [ { "superseded_on": "2026-09-01", "value": 2.7, "numerator": 2700.6, "denominator": 100023.8, "volume": 9120 } ] } ] }
  ]
}
```

## The parts

| Field | What |
|---|---|
| `format` | Always `amiri-institution-data/1`. |
| `metrics_spec` | The Metrics Spec version the figures follow; MAJOR 1. |
| `as_of` | The last day the data covers, all of it closed: before today in the institution's time zone. No row may end after it. |
| `about` | Optional text, shown on the page. |
| `catalog` | The `GET /catalog` answer (schema `Catalog`). `profile.time_zone` must be an IANA name, with exactly one primary business calendar. Each offered metric's `filter_sets` may be left `null`: it is filled in from the series in the file. |
| `calendar` | The `GET /calendar` answer for the primary calendar (schema `CalendarResponse`), one entry per day with no gap, from the start of history to at least a year after `as_of` (C17). |
| `breaks` | The `GET /breaks` answer's `breaks` (schema `Break`); `[]` if there are none. |
| `series` | One entry per product, metric and filter. |

**A series** has `product_id` and `metric` (an offered metric in the catalog), `filter` (dimension → value, from the
metric's `breakdowns`, at most 3; `{}` for the total), `currency` (the ISO 4217 code of an amount; `null` for anything
else) and `rows`.

- Every offered metric needs its total (`filter: {}`).
- A filter combination given once must be given for every value: a series on `segment` needs one for each `segment`
  value in the catalog. The combinations given are what is served (`filter_sets`); others answer
  `422 filter_set_not_allowed`.

**A row** is a `SeriesRow` without the fields the server works out (`data_as_of`, `vintage`, `revised`,
`revision_held`):

| Field | |
|---|---|
| `from`, `until` | One period of the metric's grain, `until` exclusive (weeks start on Monday, months on the 1st). Oldest first, no overlap. |
| `value` | A number; `null` only when `suppressed`. |
| `numerator`, `denominator`, `exposure`, `volume` | Optional; as the spec defines them (L2). `volume` is a whole number. |
| `suppressed`, `suppression_reason` | Optional; `false` and `null` when left out. |
| `published_at` | The local date the value was first produced (L3). Left out or `null`: treated as published at the metric's `max_lag_days`. |
| `backfilled` | Optional; `true` for rows produced at onboarding. |
| `extras` | Optional; the spec's metric extras. |
| `vintages` | Optional: earlier values, oldest first. Each holds from the row's publication (or the previous vintage's `superseded_on`) until the day before its own `superseded_on`; the row's own fields are the latest value. Set `profile.vintages_kept` to `true` only when every revision is listed. |

## What is served from it

| | |
|---|---|
| `/catalog`, `/calendar`, `/breaks` | As imported (`filter_sets` filled in). |
| `/series` | Ranges on the grid with the spec's limits, filters, pages of up to 500 rows (a page token pins the vintage and the file), `known_through` (rows published by then), `same_age_days` (each row as known that many days after its period), from the row's `published_at` and `vintages`. Closed periods after the file's last row are listed as `unpublished`. `segment_as_of` is accepted and echoed: the file's segmentation is the one served. `currency_basis=base` only for metrics not kept in the customer's currency. |
| `/change-concentration` | `501 not_implemented`: it needs per-contributor changes, which a file of aggregates doesn't have. The check reports C16 as not applicable, so imported data reaches **L4** at most. |

Errors are the spec's RFC 9457 problems with its codes.

## Upload errors

The upload is refused with `422 invalid_import` and a list of `errors`, each `{"field", "message"}`, for example
`{"field": "series[3].rows[12].value", "message": "must be a number or null"}` (up to 50). Invalid JSON is
`422 invalid_json`; a file over `DATA_IMPORT_MAX_MB` (25 MB by default) is `413 too_large`; during a demo lock,
`403 demo_locked`. Nothing is stored unless the whole file is valid. Upload checks that the data can be served;
whether it is conformant and covers your profile is the **Check**.
