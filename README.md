# Amiri Agent

An early-warning assistant for banks and insurers. It watches the news and the markets for one
institution, traces each event to the products it could move, and tells the team that owns them,
before the numbers show it.

> **A prototype.** It runs against an invented demo bank (Serendib Commercial Bank) with sample data.
> It isn't a production system and nothing it says is financial advice.

## What it does

```
Watch ──────────▶ Find ───────────▶ Trace to you ───────▶ Alert
market series      a finding: one     an event, and which    the team that owns each
monitors           unusual thing      products it could      affected product reviews
Radar (news)       that was noticed   move, and which way    it, and acknowledges it
```

- **Market series**: prices and rates watched by plain code. A move far outside what is normal for
  its length becomes a finding.
- **Monitors**: standing questions about the news ("tell me if a Gulf state limits visas for foreign
  workers"), drafted from the institution's profile and approved by a Risk Manager.
- **Radar**: reads the world's news for the institution's footprint and sends what matters.
- **Investigation**: groups findings into events and traces each to the products it could affect,
  using a Metrics Spec of what a bank's or insurer's numbers look like.
- **Alerts**: risk only. One early warning per event and owning team, with the reason, the evidence
  and who acknowledged it.
- **Scenario Studio**: run a what-if (a template, or your own headlines and price move) in a sandbox
  that never touches live data; record a run and replay it in seconds.
- **Setup agent**: a chat that helps fill in the institution's profile. Nothing is saved until the
  person confirms it.

**How it is built.** Code enumerates; models only choose. The server in this repository contains no
model: it enumerates what could be affected, scores, schedules and stores. The language models live
in separate agent services (investigation, monitors, Radar, setup) behind documented HTTP contracts,
and a model never produces a number a person reads.

## Repository

| Folder | What |
|---|---|
| [`server/`](server) | The API, the work tick and the code components (Python, FastAPI, Postgres 16 with pgvector) |
| [`web/`](web) | The web app (React, TypeScript, Vite); the server serves its build |
| [`server/contracts/`](server/contracts) | OpenAPI contracts of the setup, Radar and investigation agents |
| `compose.yaml`, `infra/local/` | Local Postgres, and an optional ticker that stands in for Cloud Scheduler |

The agent services are developed separately and connect over those contracts. The server runs without
them and says on each page what isn't connected; `uv run amiri fake-agent` and `uv run amiri radar-fake`
start stand-ins for the setup agent and Radar.

## Run it locally

You need Docker, [uv](https://docs.astral.sh/uv/), a recent Node, and a free
[Twelve Data](https://twelvedata.com) API key for the market series.

```bash
docker compose up -d postgres

cd server
cp .env.example .env              # set TWELVEDATA_API_KEY
uv sync
uv run amiri seed-series          # USD/LKR, AED/LKR, USD/INR and gold
uv run amiri seed-institution     # the demo bank
uv run amiri serve                # http://localhost:8000  (API docs at /docs)

cd ../web
npm install && npm run build      # the server now serves the app at http://localhost:8000
```

`uv run pytest` runs the server's tests (they use the `amiri_test` database from the same Compose
service). `uv run python scripts/demo_seed.py` fills a running server with a demo state through its own
API. The server's README has the settings, the tick and the details.

## Putting it on a public URL

Set `AUTH_MODE=prototype` to put a Google reCAPTCHA check and a session cookie in front of everything,
and set `PROTOTYPE_RESET=false`. Search engines and AI crawlers are asked to stay away and known ones are
refused. See [`server/README.md`](server/README.md#signing-in). It is designed for Google Cloud: Cloud Run,
Postgres on Cloud SQL or AlloyDB, Cloud Scheduler, Secret Manager, and agents built with Google's Agent
Development Kit on Gemini.

## License

[Apache License 2.0](LICENSE). Third-party notices are in [NOTICE](NOTICE).
