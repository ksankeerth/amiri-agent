# radar-agent

Radar for the Amiri Agent: it reads the world's news (GDELT 2.0 on BigQuery) for stories that
touch one institution's footprint, groups the articles into stories, and judges each one for
that institution: how much it matters, why, and whether to send it for investigation.
Agent generated with `agents-cli` version `1.9.0`.

## Project Structure

```
radar-agent/
├── app/
│   ├── radar_api.py        # POST /radar-runs, GET /radar-runs/{run_id}, GET /health
│   ├── runs.py             # the run store (SQLite) and the background service
│   ├── radar_runner.py     # one run, start to finish
│   ├── queries.py          # the one BigQuery query a run sends (built by code)
│   ├── bq.py               # BigQuery with the cost guards
│   ├── geo.py              # places: ISO -> GDELT's FIPS codes, names for titles
│   ├── articles.py         # cleaning: titles, English only, syndicated copies
│   ├── stories.py          # grouping, scoring, shortlist, fingerprints, send rules
│   ├── judge.py, prompt.py # the judge's batches and instruction
│   ├── agent.py            # the ADK judge (structured output, no tools)
│   ├── memory.py           # stories remembered, model calls counted (SQLite)
│   ├── contract.py         # the API's models: a copy of the server's, kept identical
│   ├── reference/          # gazetteer and theme vocabulary (copies of the server's)
│   └── settings.py         # every setting (see .env.example)
├── scripts/capture_fixture.py  # saves one real query's rows for offline tuning
├── tests/unit              # no network: fake BigQuery, scripted judge, a real day's rows
├── tests/fixtures          # one bank's real GDELT day (16-17 Oct 2026) and its request
├── tests/integration       # test_agent.py: one live judge call on provided news
├── GEMINI.md
└── pyproject.toml
```

## How a run works

The server sends a run: the institution from its profile, the scope (places with why each is
watched, themes, actors), the window, the stories it has already seen and the limits.

1. **Query (code).** One query on `gdelt-bq.gdeltv2.gkg_partitioned`, for the day partitions the
   window touches (two at most), English articles only, eight columns: about 0.9 GB for a
   24-hour window, and about 1,000 articles for one bank. It keeps an article when:
   - **home:** the home country is in its title, is mentioned 3 or more times, or the outlet is on
     the home country's domain (`ft.lk`);
   - **footprint:** a footprint place is in its title, or a closely watched footprint country
     (branches, a place to watch, a remittance corridor) makes up 40% of its place mentions;
     either way, together with one of the institution type's theme codes. A country watched only
     for a trade flow or a background risk must be named in the title. Without this rule, the US
     (in scope for garment exports) brought 3,500 articles of US domestic news a day;
   - **place:** a strait, sea, port or city from the scope is named in its title;
   - **actor:** a rival, regulator or counterparty is named, together with a home or footprint
     country.

   GDELT codes countries in FIPS 10-4 (Sri Lanka is `CE`), so `geo.py` maps them. Every value
   goes in as a query parameter.
2. **Clean (code).** Titles are decoded from HTML, and outlet names before or after them are
   dropped. Articles that aren't in English are dropped. Copies of one article on several outlets
   collapse to one, so syndication doesn't inflate a story.
3. **Group and score (code).** Articles with overlapping titles become one story, and a day's
   headlines naming the same strait are one story ("tanker explodes", "two ships sink"). The score
   is the weight of the places the story is about × corroboration (weighs little: a local paper's
   one report matters more than a wire story on fifty sites) × freshness × named in a title ×
   money and business themes. The best `SHORTLIST_FACTOR × max_stories` (30) go to the judge, no
   one place taking more than a third of them, each with any remembered look-alike.
4. **Judge (model).** The judge sees batches of 5 stories, with the institution's profile. For
   each story it decides the relevance (high, medium or low), `send`, a one-line `why`, a neutral
   title and summary, and themes from the vocabulary. It also says whether the story is a
   remembered one (`same_as`) or a new development of one (`continues`). It never writes a
   number: the score is code's.
5. **Check and send (code).** Themes outside the vocabulary are dropped. A low story is never
   sent, and at most 3 stories are sent per run (`SEND_MAX_PER_RUN`). Fingerprints stay stable
   across runs: one remembered story keeps its fingerprint, even when the judge misses it. Stories
   are remembered for 14 days.

In a simulation (`provided_news`), the run reads those headlines instead of querying BigQuery.

## Cost guards

| Layer | Guard |
|---|---|
| Each query | Dry run first; then run with `maximum_bytes_billed` = the lower of the request's limit and `BQ_MAX_BYTES_PER_QUERY` (1.5 GB) |
| Each run | One query, at most two day partitions, only the partitioned GKG table (any other table is refused) |
| The agent, per day and month | Before each query it adds up what its own labelled jobs (`app=amiri-radar`) billed: 20 GB a day, 600 GB a month (under BigQuery's free 1 TiB). If it can't check, it refuses (fails closed) |
| The server | Its own daily byte cap, the daily schedule, and Check now 5 times a day |
| The Google project | A custom BigQuery quota ("Query usage per day") and a budget alert |

Model calls are capped too: `max_model_calls` per run, and `MODEL_CALLS_PER_DAY` (300) a day.
Past the daily cap, stories are still reported from the code's score, but nothing is sent.

## Run it locally

```bash
cp .env.example .env                      # then set credentials (and BQ_PROJECT for real queries)
gcloud auth application-default login     # BigQuery
uv sync
uv run uvicorn app.fast_api_app:app --port 8906
curl -s localhost:8906/health
```

Point the server at it with `RADAR_URL=http://localhost:8906`. From `server/`, run
`uv run amiri radar-check --url http://localhost:8906` to check the API against the contract.
Locally nothing ticks by itself (Cloud Scheduler does it in the cloud): `uv run amiri tick` from
`server/` starts the scheduled run when it's due, and Check now on the Radar page starts one at once.
A live run reads BigQuery for real: about 0.9 GB for a 24-hour window.

To tune offline, `scripts/capture_fixture.py` saves one real query's rows (see its docstring;
`--dry-run` shows the bytes first), and `tests/fixtures/recall.py` replays the current query's rules
on them, so a change can be checked without querying again (`tests/unit/test_fixture_serendib.py`).

The API: `POST /radar-runs` starts a run and returns 202 at once. `GET /radar-runs/{run_id}`
returns its status, and the result once it has finished. The contract is
`server/contracts/radar-agent-openapi.yaml`.

Sending the same `run_id` again returns that run without starting another, and a different body
with the same `run_id` returns 409. Runs are kept in `data/runs.db` (`RUNS_DB_PATH`) for 24
hours, so deploy a single instance, with CPU kept allocated after the response.

## Tests

```bash
uv run pytest tests/unit                          # offline: geo, query, guards, cleaning, stories, runner, API
uv run pytest tests/integration/test_agent.py     # one live judge call (needs model credentials)
```

## Configuration

Every setting is in `app/settings.py`, and `.env.example` lists them all with their defaults
(`tests/unit/test_settings.py` keeps the two in step). The agent logs the effective settings
at startup.

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
