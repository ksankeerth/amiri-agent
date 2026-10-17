"""Every setting the agent reads, in one place.

Change any of them in .env (local runs) or as environment variables (deployment); .env.example
lists them all with their defaults. A value is read each time it is used, so tests and scripts can
change it on the fly.

Credentials are Google's own variables and are not listed here: GEMINI_API_KEY for an AI Studio
key, or GOOGLE_GENAI_USE_ENTERPRISE / GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION for Vertex AI.
BigQuery uses the Google Cloud credentials (gcloud auth application-default login locally, the
service account on Cloud Run).
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parents[1]

# Real environment variables win over .env; there is no .env in the image.
load_dotenv(PROJECT / ".env", override=False)


@dataclass(frozen=True)
class Setting:
    name: str
    default: str
    help: str


SETTINGS: dict[str, Setting] = {
    s.name: s
    for s in [
        # The judge model (app/models.py: a busy or out-of-quota model hands the call to the next)
        Setting("AGENT_MODELS", "gemini-3.5-flash-lite,gemini-3.1-flash-lite", "Models that judge stories, tried in order."),
        Setting("AGENT_TEMPERATURE", "0.2", "Sampling temperature for the judge."),
        Setting("MODEL_CALL_TIMEOUT_SECONDS", "90", "Seconds a model gets for one call before the next is tried."),
        Setting("MODEL_COOLDOWN_SECONDS", "60", "Seconds a failed model is skipped."),
        Setting("JUDGE_BATCH_SIZE", "5", "Stories per model call."),
        Setting("SHORTLIST_FACTOR", "3", "The model judges at most this many times max_stories (the best by score)."),
        Setting("MODEL_CALLS_PER_DAY", "300", "Cost guard: model calls a day (UTC) at most; over it, stories are "
                "reported from code scoring alone, held back (send false)."),
        # BigQuery (GDELT 2.0, public)
        Setting("BQ_PROJECT", "", "The project that runs and pays for the queries; empty: GOOGLE_CLOUD_PROJECT."),
        Setting("BQ_LOCATION", "US", "Where GDELT's dataset lives."),
        Setting("BQ_ROW_LIMIT", "10000", "Articles a query returns at most, newest first (returned rows cost nothing; "
                "this bounds memory). A day for one bank was about 1,000 after the query's rules."),
        Setting("BQ_MAX_BYTES_PER_QUERY", "1500000000", "Cost guard: maximum_bytes_billed for a query; the request's "
                "limit applies too, the lower wins (bytes)."),
        Setting("BQ_DAILY_BYTES", "20000000000", "Cost guard: bytes this agent's own BigQuery jobs may bill a day (UTC); "
                "checked against BigQuery's job list before each query (bytes)."),
        Setting("BQ_MONTHLY_BYTES", "600000000000", "Cost guard: bytes this agent's own jobs may bill a calendar month; "
                "below the free 1 TiB (bytes)."),
        Setting("FOOTPRINT_SHARE", "0.4", "A footprint country counts as what an article is about when it makes up "
                "at least this share of the article's place mentions (and 2 or more)."),
        Setting("HOME_MENTIONS", "3", "The home country counts when the article mentions it this many times (or in the title)."),
        # Stories
        Setting("MEMORY_DAYS", "14", "Stories reported are remembered this long (stable fingerprints, developments)."),
        Setting("SEND_MAX_PER_RUN", "3", "At most this many stories a run are sent for investigation; never a low one."),
        # Server
        Setting("RUNS_DB_PATH", "data/runs.db", "Runs, memory and the model-call count (SQLite, relative to the project)."),
        Setting("MAX_CONCURRENT_RUNS", "2", "Runs worked at once; more wait as queued."),
        Setting("ALLOW_ORIGINS", "", "Comma-separated CORS origins for the API; empty = none."),
        Setting("LOG_FORMAT", "text", "text (local) or json (Cloud Run; app/logs.py)."),
        Setting("LOG_LEVEL", "INFO", "Lowest level logged: DEBUG, INFO, WARNING or ERROR."),
        Setting("OTEL_TO_CLOUD", "", "true/false: export traces to Cloud Trace. Empty = on only on Cloud Run."),
    ]
}


def raw(name: str) -> str:
    """The value from the environment, or the default."""
    return (os.getenv(name) or "").strip() or SETTINGS[name].default


def names(name: str) -> list[str]:
    """A comma-separated list, trimmed, without repeats."""
    return list(dict.fromkeys(x.strip() for x in raw(name).split(",") if x.strip()))


def number(name: str) -> float:
    return float(raw(name))


def integer(name: str) -> int:
    return int(raw(name))


def path(name: str) -> Path:
    p = Path(raw(name))
    return p if p.is_absolute() else PROJECT / p


def flag(name: str) -> bool | None:
    """true/false, or None when unset."""
    value = raw(name).lower()
    return None if not value else value in ("1", "true", "yes", "on")


def current() -> dict[str, str]:
    """Every setting's effective value, for a startup log."""
    return {name: raw(name) for name in SETTINGS}
