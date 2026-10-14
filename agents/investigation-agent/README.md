# investigation-agent

Simple ReAct agent
Agent generated with `agents-cli` version `1.9.0`

## Project Structure

```
investigation-agent/
├── app/         # Core agent code
│   ├── agent.py               # Main agent logic
│   ├── fast_api_app.py        # FastAPI Backend server
│   └── app_utils/             # App utilities and helpers
├── tests/                     # Unit, integration, and load tests
├── GEMINI.md                  # AI-assisted development guide
└── pyproject.toml             # Project dependencies
```

> 💡 **Tip:** Use [Antigravity CLI](https://antigravity.google/) for AI-assisted development - project context is pre-configured in `GEMINI.md`.

## Requirements

Before you begin, ensure you have:
- **uv**: Python package manager (used for all dependency management in this project) - [Install](https://docs.astral.sh/uv/getting-started/installation/) ([add packages](https://docs.astral.sh/uv/concepts/dependencies/) with `uv add <package>`)
- **agents-cli**: Agents CLI - Install with `uv tool install google-agents-cli`
- **Google Cloud SDK**: For GCP services - [Install](https://cloud.google.com/sdk/docs/install)


## Quick Start

Install `agents-cli` and its skills if not already installed:

```bash
uvx google-agents-cli setup
```

Install required packages:

```bash
agents-cli install
```

Test the agent with a local web server:

```bash
agents-cli playground
```

You can also use features from the [ADK](https://adk.dev/) CLI with `uv run adk`.

## Commands

| Command              | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `agents-cli install` | Install dependencies using uv                                                         |
| `agents-cli playground` | Launch local development environment                                                  |
| `agents-cli lint`    | Run code quality checks                                                               |
| `agents-cli eval`    | Evaluate agent behavior (generate, grade, analyze, and more — see `agents-cli eval --help`) |
| `uv run pytest tests/unit tests/integration` | Run unit and integration tests                                                        || [A2A Inspector](https://github.com/a2aproject/a2a-inspector) | Launch A2A Protocol Inspector                                                        |

## 🛠️ Project Management

| Command | What It Does |
|---------|--------------|
| `agents-cli scaffold enhance` | Add CI/CD pipelines and Terraform infrastructure |
| `agents-cli infra cicd` | One-command setup of entire CI/CD pipeline + infrastructure |
| `agents-cli scaffold upgrade` | Auto-upgrade to latest version while preserving customizations |

---

## How the investigation works

amiri-server sends the
request: findings in one shape for every source (a market series move, a Radar story,
a monitor's news match), the institution from its profile, and its products in
Metrics Spec terms. Code enumerates and the model only chooses:

| Step | Who | What |
|---|---|---|
| 1. coverage | code (amiri-server) | `GET /api/v1/internal/coverage`: per profile product, the metrics its data source serves, breakdowns, book size and the spec's validation rules |
| 2. classify | model | a finding's themes with directions, size, effective date (schema-constrained, then checked). **Skipped** when the source set the themes (series moves; Radar) |
| 3. where | code | home or abroad, and the channel home (remittance corridor, trade partner), from the finding's place codes and the profile's flows |
| 4. events | code | implied themes, grouping, netting, anchor and size (`app/normalize.py`) |
| 5. candidates | code | product type x angle x mechanism the events trigger, ranked and capped (`app/tracks.py`, `app/candidates.py`); products are mapped from Metrics Spec types; ones without tracks are listed as `untracked_products` |
| 6. screen | model | keep or reject each candidate, which products, one reason |
| 7. choose | model | mechanism and segment, only when there's a choice; affected regions and corridor countries are one task each, by code |
| 8. tasks | code | metric, filter, business-date windows, method, thresholds, masking, owner, calendar from amiri-server (`app/tasks.py`) |

Themes are Metrics Spec v1.0's ids with neutral directions (`fx: home_weaker`,
`commodities: up` item gold, `regulation: central_bank_relief`, …; `app/vocab.py`).
Each model step is one structured call whose JSON schema only allows the listed
options. It runs as a custom ADK agent (`app/agent.py`) under the ADK runner.

### Run it locally

```bash
# 1. amiri-server, serving coverage and the calendar (amiri-agent/server)
uv run amiri serve

# 2. one investigation, printed (the request's server_url points at the server)
uv run python scripts/run_investigation.py scripts/requests/big_move_local.json

# 3. or the API: POST /investigations, then GET /investigations/{run_id}
uv run uvicorn app.fast_api_app:app --port 8001
```

Credentials: put `GEMINI_API_KEY` in `.env` and comment out the Vertex lines
(see `.env.example`), or configure Vertex AI. All settings are in `.env.example`.

## Checking it

| What | Command | Result |
|---|---|---|
| Unit tests (code, scripted model) | `uv run pytest tests/unit` | |
| Scenarios, live (real model, fixture data, no server) | `uv run python -m tests.scenarios.run [--repeat 3]` | `tests/scenarios/RESULTS.md` |
| Model steps (classify, screen) on the hard cases | `uv run python -m tests.eval.steps_eval` | `tests/eval/RESULTS.md` |

The JAPAC scenarios' coverage is what amiri-server's spec builder answers for the profiles in
`tests/fixtures/profiles/`; regenerate after a spec change with
`cd ../../server && uv run amiri coverage --profile ../agents/investigation-agent/tests/fixtures/profiles/ph_bank.json --out ../agents/investigation-agent/tests/fixtures/coverage_ph_bank.json`.

## Development

Edit your agent logic in `app/agent.py` and test with `agents-cli playground` - it auto-reloads on save.

## Deployment

```bash
gcloud config set project <your-project-id>
agents-cli scaffold enhance . --deployment-target cloud_run   # once: the project was scaffolded without a target
agents-cli deploy --max-instances 1 --timeout 900 --no-confirm-project
```

What the deployed agent needs:

| Setting | Why |
|---|---|
| **Not public** | deploy without unauthenticated access, and give amiri-server's service account `roles/run.invoker` on this service; amiri-server sends an ID token (`INVESTIGATION_AUTH=id_token`) |
| `DATA_AUTH=id_token` | the agent sends an ID token to amiri-server's `/api/v1/internal/*`; on the server set `INTERNAL_AUTH=id_token` and put this service's account in `INTERNAL_CALLERS` |
| **One instance** (`--max-instances 1`) | runs are kept in the instance's SQLite (`RUNS_DB_PATH`). If a status poll reaches another instance, or the instance restarts, the server sends the run again (same `run_id`, up to 3 times), so more instances work but redo work |
| `--timeout 900` | a run may take up to `limits.timeout_seconds` (600 by default) in the background; the request itself returns at once |
| Model access | Vertex AI (the service account needs `roles/aiplatform.user`) or `GEMINI_API_KEY` from Secret Manager (`--secrets GEMINI_API_KEY=...`) |

To add CI/CD and Terraform, run `agents-cli scaffold enhance`.
To set up your production infrastructure, run `agents-cli infra cicd`.

## Observability

Built-in telemetry exports to Cloud Trace, BigQuery, and Cloud Logging.

## A2A Inspector

This agent supports the [A2A Protocol](https://a2a-protocol.org/). Use the [A2A Inspector](https://github.com/a2aproject/a2a-inspector) to test interoperability.
See the [A2A Inspector docs](https://github.com/a2aproject/a2a-inspector) for details.
