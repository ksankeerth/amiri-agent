# amiri-setup-agent

The agent behind the setup chat: a bank or insurer describes itself in plain words and the
agent turns it into proposals the user confirms. amiri-server calls it once per chat turn
through a fixed contract (`app/contract.py`, mirroring `server/app/assistant/contract.py`).
The contract it is built to is `server/contracts/setup-agent-openapi.yaml`.

Generated with `agents-cli` 1.9.0 (ADK, prototype).

## How a turn works

1. **Route** (`app/router.py`). Code decides when it can: a track the user picked (no model
   call), an answer to the agent's question (same track), no institution yet (the institution
   track). Otherwise one structured model call (`ROUTER_MODELS`) picks the track: sticky,
   off-topic flagged, and facts meant for other tracks kept as notes. If every router model
   fails, the turn stays in its track.
2. **The track answers** (`app/track_loop.py`): one ADK agent per track, built each turn from
   the track's guide (`app/guides.py`: what it changes, how it works, its tools) and the
   institution as it is now. It reads the server's API (`app/tools.py`), asks with options
   (`ask_user`, which ends the turn), and concludes with `propose` (code fixes the track, the
   kind and the person; the server checks it; up to `MAX_REPAIRS` fixes when it's refused) or
   `conclude` (read-only tracks, or nothing to change). Each track remembers its own
   conversation within a session.
3. Events stream back as server-sent events: `track`, `track_notes`, the track's messages,
   questions and proposals, then `usage`. A failure ends the turn with an `error` event.

## Project structure

```
setup-agent/
├── app/
│   ├── contract.py     # the contract's models (checked against the server's OpenAPI)
│   ├── turn_api.py     # POST /sessions, POST /sessions/{id}/turns, GET /health/details
│   ├── sessions.py     # sessions in memory (a restart loses them; the server starts new ones)
│   ├── engine.py       # one turn: route, answer, events
│   ├── router.py       # which track a message belongs to
│   ├── tracks.py       # the tracks as the router reads them; the first-setup order
│   ├── guides.py       # each track as configuration: what it changes, its steps, its tools
│   ├── track_loop.py   # the shared loop: the track's ADK agent for one turn, events out
│   ├── tools.py        # the server's API as tools, plus ask_user, propose, conclude
│   ├── server_api.py   # amiri-server's API (the tools), with the on-behalf-of headers
│   ├── models.py       # model fallback (AGENT_MODELS, ROUTER_MODELS)
│   ├── settings.py     # every setting; scripts/write_env_example.py writes .env.example
│   ├── agent.py        # the ADK root agent (playground, A2A)
│   └── fast_api_app.py # the service
├── devtools/           # development-only pacing for a rate-limited key (not in the image)
├── scripts/smoke_tools.py  # every tool against a running server, with a scripted model
└── tests/unit          # contract, routing, turns and the track loop (scripted model, fake server)
```

## Run it with the server

```bash
cp .env.example .env                                   # then set the credentials
uv run uvicorn app.fast_api_app:app --port 8004
cd ../../server
uv run amiri agent-check --url http://localhost:8004   # the protocol: must be all PASS
ASSISTANT_BACKEND=http ASSISTANT_URL=http://localhost:8004 uv run amiri serve
uv run amiri scenarios --server http://localhost:8000 --out ../agents/setup-agent/tests/scenario-results.json
```

Tests without a model: `uv run pytest tests/unit`.

## Status (13 Oct 2026)

- Contract layer, router and the track loop for all tracks: built. 17 unit tests;
  `agent-check` 28/28 PASS; `scripts/smoke_tools.py` against the dev server: every tool
  answers and proposals pass the server's checks. No model has been called yet.
- Next: live runs (agent-check with a model, then `amiri scenarios`, S01–S54) once there is
  model quota; tune the guides from the results.

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
