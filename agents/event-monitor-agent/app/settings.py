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
        # Models: each list is tried in order; a busy, slow or out-of-quota
        # model hands the call to the next (app/models.py). Each model has its
        # own quota, so a longer list is also more daily capacity.
        Setting(
            "AGENT_MODELS",
            "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
            "Models for the agent's steps.",
        ),
        Setting(
            "REVIEWER_MODELS",
            "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite",
            "Models that review every finding: stronger first.",
        ),
        Setting(
            "SEARCH_MODELS",
            "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
            "Models for web search (Google Search grounding). Needs a key whose plan "
            "allows search grounding: the AI Studio free tier gives Gemini 3 none, "
            "and Gemini 2.5 is closed to new users. Without it, web_search fails "
            "and a check can find nothing (Vertex AI or billing on the key's project is needed).",
        ),
        Setting("AGENT_TEMPERATURE", "0.2", "Sampling temperature for the agent."),
        # Reliability
        Setting(
            "MODEL_CALL_TIMEOUT_SECONDS",
            "90",
            "Seconds an agent model gets for one call before the next model is tried.",
        ),
        Setting(
            "REVIEWER_TIMEOUT_SECONDS",
            "20",
            "Seconds a reviewer model gets before the next is tried.",
        ),
        Setting(
            "SEARCH_TIMEOUT_SECONDS",
            "30",
            "Seconds a search model gets before the next is tried.",
        ),
        Setting(
            "MODEL_COOLDOWN_SECONDS",
            "60",
            "Seconds a failed model is skipped. A quota error that says when to "
            "retry (e.g. a daily cap) is skipped until then instead.",
        ),
        # Cited pages (app/pages.py)
        Setting(
            "PAGE_TIMEOUT_SECONDS",
            "6",
            "Seconds to read a cited page's date and title.",
        ),
        Setting(
            "PAGE_MAX_BYTES",
            "600000",
            "Bytes read from a cited page at most (its head is enough).",
        ),
        Setting(
            "PAGE_DATE_GRACE_HOURS",
            "24",
            "A cited page published this many hours before the check's window still counts (search "
            "finds news late); the monitor's already-reported pages are never reported again.",
        ),
        # Server
        Setting(
            "RUNS_DB_PATH",
            "data/runs.db",
            "Where check runs are kept (relative to the project).",
        ),
        Setting(
            "MAX_CONCURRENT_CHECKS",
            "4",
            "Checks run at once per server; more wait as queued.",
        ),
        Setting(
            "ALLOW_ORIGINS",
            "",
            "Comma-separated CORS origins for the API; empty = none.",
        ),
        Setting(
            "LOG_FORMAT",
            "text",
            "text (local) or json (Cloud Run: severity, one entry per traceback, "
            "linked to the run's trace; app/logs.py).",
        ),
        Setting("LOG_LEVEL", "INFO", "Lowest level logged: DEBUG, INFO, WARNING or ERROR."),
        Setting(
            "OTEL_TO_CLOUD",
            "",
            "true/false: export traces to Cloud Trace (needs Google Cloud "
            "credentials). Empty = on only on Cloud Run.",
        ),
        # Development only
        Setting(
            "MODEL_MIN_INTERVAL_SECONDS",
            "",
            "Development only: seconds between model requests for a rate-limited key "
            "(devtools/pacing.py, not in the image). Empty = no waiting.",
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
