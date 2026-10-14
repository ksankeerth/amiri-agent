# amiri-server

The Amiri Agent server: the web app's API, the work tick, and the code components. A prototype: it
runs against a demo bank with sample data.

What it does:

- **Institution profile** (bank or insurer): identity, footprint, customer groups, products, flows,
  regulators, rivals, counterparties and known risks, with suggestions, readiness checks, history
  with undo, import, and the context the agents read.
- **Market series**: prices and rates watched by code (Twelve Data, hourly); a move far outside its
  normal range becomes a finding. "Simulate a move" makes a sandbox finding for demos.
- **Monitors**: standing questions about the news, drafted from the profile, approved by a Risk
  Manager, checked by the monitor agent.
- **Radar**: reads the world's news for the institution's footprint and sends what matters.
- **Findings → investigation → events → alerts**: the tick batches new findings to the investigation
  agent, stores the events it traces to the institution's products, and raises an early warning for the
  team that owns each affected product.
- **Scenario Studio**: run a what-if (a template or your own headlines and price move) in a sandbox
  world that never touches live data; record a run and replay it without any agent.
- **Setup agent chat**: one thread per institution, with tracks and proposals the person confirms.
- **Sign-in** for a public URL, **prototype reset**, and an **Overview** page that gathers it all.

The models are only in the agents. This server is code: it chooses nothing a person didn't approve and
never produces a number a model wrote.

## Run it locally

```bash
docker compose up -d postgres           # Postgres 16 + pgvector (compose.yaml at the repository root)
cd server
cp .env.example .env                    # then set TWELVEDATA_API_KEY in .env
uv sync
uv run amiri serve                      # http://localhost:8000/docs
uv run amiri seed-series                # optional: USD/LKR, AED/LKR, USD/INR, XAU/USD
uv run amiri seed-institution           # optional: the demo bank's profile (sample data)
```

The web app: `cd ../web && npm install && npm run build`, and the server serves it at
http://localhost:8000 (or `npm run dev` for http://localhost:5173 with live reload).

The hourly work runs on the tick. Locally, call it yourself (`uv run amiri tick`, or
`curl -X POST localhost:8000/internal/tick`), or start the ticker container, which plays the part of
Cloud Scheduler (every 15 minutes): `docker compose --profile ticker up -d`.

The agents (investigation, monitor, setup, Radar) are separate services; each is connected by a URL
setting (`INVESTIGATION_URL`, `MONITOR_URL`, `ASSISTANT_URL`, `RADAR_URL`). Without them the server runs
and says what is not connected. `uv run amiri fake-agent` and `uv run amiri radar-fake` start fakes that
follow the contracts in `contracts/` (OpenAPI for the setup, Radar and investigation agents; the
setup and Radar ones are generated from the server's own models, `tests/test_agent_contracts.py` checks that what the
server sends the investigation agent fits its contract).

Every setting is in `.env.example` (generated from `app/settings.py` by `uv run amiri env-example`).
Tests use the `amiri_test` database and fake agents: `uv run pytest`. `uv run amiri openapi` rewrites
`openapi.yaml`. `uv run python scripts/demo_seed.py --server http://localhost:8000` fills a running
server with a demo state through its own API.

## Signing in

`AUTH_MODE=off` (the default) lets everyone in: for local runs. `AUTH_MODE=prototype` is for a public
URL: a Google reCAPTCHA check, then a signed session cookie. Set `RECAPTCHA_SITE_KEY`,
`RECAPTCHA_SECRET` and `SESSION_SECRET`; the agents and Cloud Scheduler call with Google ID tokens
(`INTERNAL_AUTH=id_token`, `INTERNAL_CALLERS`). On a public URL also set `PROTOTYPE_RESET=false`.
Search engines and AI crawlers are asked to stay away (`robots.txt`, `noindex`) and known ones are
refused (`BLOCK_AI_CRAWLERS`).

## Prototype limits (shown in the UI through `GET /api/v1/series:status`)

| Limit | Default | Setting |
|---|---|---|
| Prices are pulled hourly, not live | every 60 min, on the hour | `SERIES_FETCH_EVERY_MINUTES` |
| Refresh now, per series | once per 120 s | `SERIES_REFRESH_COOLDOWN_SECONDS` |
| Series watched | 8 | `SERIES_MAX` |
| Twelve Data credits | 8 a minute, 800 a day (free plan) | `TWELVEDATA_CREDITS_PER_MINUTE`, `_PER_DAY` |
| Only closed hourly bars | the current hour appears once it closes | — |
| One institution per installation | on | `SINGLE_INSTITUTION` |

## API

The full API is in `openapi.yaml` (and at `/docs` on a running server), under `/api/v1`. Errors are
RFC 9457 problem details with a `code`. No role checks in the API: the web app applies roles.

## States a series can be in

`pending` (no prices yet) · `warming_up` (fewer than 20 trading days to know a typical move) ·
`normal` · `moved` (fired; quiet for the cooldown) · `stale` (no new bar for longer than
`stale_after_hours`, counting weekday hours only) · `paused`. Separately, `fetch.last_status` is `ok`,
`no_new_data` or `error` (with Twelve Data's message as raised).
