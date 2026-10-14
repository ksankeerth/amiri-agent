"""Every setting the agent reads, in one place.

Change any of them in .env (local runs) or as environment variables
(deployment); .env.example lists them all with their defaults. A value is read
each time it is used, so tests and scripts can change it on the fly.

Credentials are Google's own variables and are not listed here: GEMINI_API_KEY
for an AI Studio key, or GOOGLE_GENAI_USE_ENTERPRISE / GOOGLE_CLOUD_PROJECT /
GOOGLE_CLOUD_LOCATION for Vertex AI (see .env.example).
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
        # Models: each list is tried in order; a busy, slow or out-of-quota model
        # hands the call to the next (app/models.py).
        Setting(
            "AGENT_MODELS",
            "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
            "Models for the classify, screen and choose steps.",
        ),
        Setting("AGENT_TEMPERATURE", "0.0", "Sampling temperature for every step."),
        # Reliability
        Setting(
            "MODEL_CALL_TIMEOUT_SECONDS",
            "60",
            "Seconds a model gets for one step before the next model is tried.",
        ),
        Setting(
            "MODEL_COOLDOWN_SECONDS",
            "60",
            "Seconds a failed model is skipped. A quota error that says when to "
            "retry (e.g. a daily cap) is skipped until then instead.",
        ),
        Setting(
            "DATA_AUTH",
            "none",
            "How the agent calls amiri-server's coverage and calendar: none (local), or id_token (a Google "
            "ID token for the request's server_url; Cloud Run).",
        ),
        Setting(
            "DATA_TIMEOUT_SECONDS",
            "20",
            "Seconds amiri-server gets to answer a coverage or calendar call.",
        ),
        # Server
        Setting(
            "RUNS_DB_PATH",
            "data/runs.db",
            "Where investigation runs are kept (relative to the project).",
        ),
        Setting(
            "MAX_CONCURRENT_INVESTIGATIONS",
            "2",
            "Investigations run at once per server; more wait as queued.",
        ),
        Setting(
            "ALLOW_ORIGINS",
            "",
            "Comma-separated CORS origins for the API; empty = none.",
        ),
        Setting(
            "OTEL_TO_CLOUD",
            "",
            "true/false: export traces to Cloud Trace (needs Google Cloud "
            "credentials). Empty = on only on Cloud Run.",
        ),
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
