"""Every setting the setup agent reads, in one place.

Change any of them in .env (local runs) or as environment variables (deployment);
.env.example lists them all with their defaults. A value is read each time it is used,
so tests and scripts can change it on the fly.

Credentials are Google's own variables and are not listed here: GEMINI_API_KEY for an
AI Studio key, or GOOGLE_GENAI_USE_ENTERPRISE / GOOGLE_CLOUD_PROJECT /
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
            "Models for the track agents.",
        ),
        Setting(
            "ROUTER_MODELS",
            "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
            "Models for the router (one structured choice of track per message).",
        ),
        Setting("AGENT_TEMPERATURE", "0.2", "Sampling temperature for the track agents."),
        # Reliability
        Setting(
            "MODEL_CALL_TIMEOUT_SECONDS",
            "60",
            "Seconds a track agent's model gets for one call before the next model is tried.",
        ),
        Setting(
            "ROUTER_TIMEOUT_SECONDS",
            "8",
            "Seconds a router model gets before the next is tried. If every router model fails, "
            "the turn stays in its current track (code).",
        ),
        Setting(
            "MODEL_COOLDOWN_SECONDS",
            "60",
            "Seconds a failed model is skipped. A quota error that says when to retry "
            "(e.g. a daily cap) is skipped until then instead.",
        ),
        Setting(
            "TURN_TIMEOUT_SECONDS",
            "105",
            "Longest one turn may take (the server waits ASSISTANT_TIMEOUT_SECONDS, 120); "
            "after it the turn ends with an error event.",
        ),
        Setting("MAX_STEPS_PER_TURN", "12", "Model calls a track agent may make in one turn."),
        Setting(
            "MAX_REPAIRS",
            "2",
            "Times a track may fix and resend a proposal the server refused (422) in one turn.",
        ),
        # The server (the agent's tools are its API)
        Setting(
            "SERVER_AUTH",
            "none",
            "How the agent calls amiri-server: none (local), or id_token (a Google ID token "
            "for the session's server_url, on Cloud Run).",
        ),
        Setting("SERVER_TIMEOUT_SECONDS", "20", "Seconds one call to amiri-server may take."),
        Setting(
            "SESSION_IDLE_HOURS",
            "12",
            "A session not used for this long is dropped; the server starts a new one "
            "(it does after 30 minutes idle anyway).",
        ),
        Setting(
            "ALLOW_ORIGINS",
            "",
            "Comma-separated CORS origins for the API; empty = none.",
        ),
        Setting(
            "OTEL_TO_CLOUD",
            "",
            "true/false: export traces to Cloud Trace (needs Google Cloud credentials). "
            "Empty = on only on Cloud Run.",
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
