# event-monitor-agent

Simple ReAct agent
Agent generated with `agents-cli` version `1.9.0`

## Project Structure

```
event-monitor-agent/
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

## Development

Edit your agent logic in `app/agent.py` and test with `agents-cli playground` - it auto-reloads on save.

### How a check works (contract 2.0)

amiri-server sends the monitor, the
institution from its profile, the check's window, a web search budget and the pages this
monitor already reported. The agent searches the web (Gemini with Google Search grounding,
model fallback for 429/503), and **code** reads each source page's own publication time and
title (`app/pages.py`); only pages dated inside the window can support a finding. Findings are
`news_match` only (prices and rates are the server's market series), with the lines they meet,
the monitor's places and key dates; numbers, names and quotes are checked against the evidence
(`app/grounding.py`) and a reviewer model reads each finding (`app/verifier.py`). In a
simulation the check reads `provided_news` instead of searching.

### Check API (local)

`POST /checks` starts a check and returns 202 at once; `GET /checks/{run_id}`
returns its status, and the result once it has finished (`openapi.yaml`, generated from
`app/contract.py` and `app/examples.py` by `uv run python scripts/write_openapi.py`).

```bash
uv run uvicorn app.fast_api_app:app --port 8002
python3 -c "import json; from app import examples; print(json.dumps(examples.REQUEST))" > /tmp/req.json
curl -i -X POST localhost:8002/checks -H 'Content-Type: application/json' -d @/tmp/req.json
curl -s localhost:8002/checks/chk-mon-gulf-jobs-20261012-1000      # poll until finished
```

Sending the same run_id again returns that run (200) without starting another;
a different body with the same run_id is 409. Runs are kept in `data/runs.db`
(`RUNS_DB_PATH`) for 24 hours. A run left unfinished by a restart is marked
failed. Because that file belongs to one server, deploy with a single instance
(amiri-server sends a run again when an instance doesn't know it). Runs work in the
background after the 202, so on Cloud Run the CPU must stay allocated.

### Configuration

Every setting (models, time limits, paths, concurrency) is in `app/settings.py`,
and `.env.example` lists all of them with their defaults: copy a line into `.env`
and uncomment it to change it, then restart. The server logs the effective
settings at startup. The main ones:

| Setting | Default | What it does |
|---|---|---|
| `AGENT_MODELS` | `gemini-3.5-flash-lite,gemini-3.1-flash-lite` | the agent's models, tried in order |
| `REVIEWER_MODELS` | `gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite` | the reviewer's models, stronger first |
| `SEARCH_MODELS` | `gemini-3.5-flash-lite,gemini-3.1-flash-lite` | web search (Google Search grounding); needs billing or Vertex AI, since the free tier allows none |
| `REVIEWER_TIMEOUT_SECONDS` | `20` | a slow reviewer model hands over after this |

A model that is busy (503), out of quota (429), too slow or unknown hands the call
to the next in its list. A quota error that says when to retry (a daily cap) keeps
that model aside until then (`app/models.py`).

If every search of a check fails (every search model out of quota, say), the check **fails**
("Web search failed for every query…") instead of reporting nothing new: nothing was read, so
the server keeps the window and the next check reads it again. When only some searches fail,
the check completes and `coverage.web_failed` counts them.

### Live scenario tests

Six scenarios (`tests/scenarios/catalog.py`) run real checks with the live model; web search
and pages are stubbed with each scenario's sources, so they are repeatable and need no
grounding quota:

| Scenario | What it tests |
|---|---|
| `quota_cut` | Saudi quota cut → line 2, citing the dated page; not the off-topic or the old page |
| `quiet` | Gulf business news that meets no line → no finding |
| `undated_only` | the only matching page has no date → nothing can be reported |
| `confused_name` | "Coastal Bank fined" is not the watched "Coastal Remit"; its fee cut is |
| `ph_tagalog` | a Philippine bank's monitor, a Tagalog headline → line 2 |
| `id_flood` | an Indonesian insurer's flood monitor, Bahasa and English pages; the old flood is not reported |

```bash
uv run python -m tests.scenarios.run                  # each scenario once → tests/scenarios/RESULTS.md
uv run python -m tests.scenarios.run --repeat 3 --only quota_cut,id_flood
```

Pacing is development only and off by default. With `--interval 13` (or
`MODEL_MIN_INTERVAL_SECONDS=13` in `.env`), model requests are spaced 13s apart
and 429/503 responses are retried after a wait. That code lives in
`devtools/pacing.py`, which is not in the Docker image; the app itself never
sleeps, and instead falls back to the next model when one is busy. Every run, with its full result, is appended to
`data/scenario_runs.jsonl`. `tests/unit/test_scenarios.py` checks offline that
each scenario's reference answer passes, so a live failure is the agent's.

## Deployment

```bash
gcloud config set project <your-project-id>
agents-cli deploy
```

To add CI/CD and Terraform, run `agents-cli scaffold enhance`.
To set up your production infrastructure, run `agents-cli infra cicd`.

## Observability

Built-in telemetry exports to Cloud Trace, BigQuery, and Cloud Logging.

## A2A Inspector

This agent supports the [A2A Protocol](https://a2a-protocol.org/). Use the [A2A Inspector](https://github.com/a2aproject/a2a-inspector) to test interoperability.
See the [A2A Inspector docs](https://github.com/a2aproject/a2a-inspector) for details.
