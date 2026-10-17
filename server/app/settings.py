"""Every setting the server reads, in one place.

Change any of them in .env (local runs) or as environment variables (Cloud Run;
secrets through Secret Manager). .env.example lists them all with their
defaults (`uv run amiri env-example` writes it). A value is read each time it is
used, so tests can change it on the fly.
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
    secret: bool = False


SETTINGS: dict[str, Setting] = {
    s.name: s
    for s in [
        # Server
        Setting("SERVER_PORT", "8000", "Port of `uv run amiri serve`."),
        # Logs (app/logs.py)
        Setting("LOG_FORMAT", "text", "text (local) or json (Cloud Run: severity, one entry per traceback, linked to the "
                "request's trace)."),
        Setting("LOG_LEVEL", "INFO", "Lowest level logged: DEBUG, INFO, WARNING or ERROR."),
        Setting("GOOGLE_CLOUD_PROJECT", "", "The Google Cloud project; with LOG_FORMAT=json it links each log line to its "
                "request's trace."),
        # The bot check (no login: a reCAPTCHA box keeps bots out)
        Setting("AUTH_MODE", "off", "Keeping bots out: off (no check; local runs and tests) or prototype (no login, just "
                "a Google reCAPTCHA box to tick, then a cookie; the public URL)."),
        Setting("RECAPTCHA_SITE_KEY", "", "reCAPTCHA v2 checkbox site key (public; shown to the browser). Local test key: "
                "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI (always passes, shows a test banner)."),
        Setting("RECAPTCHA_SECRET", "", "reCAPTCHA secret key, checked by the server (local test secret: "
                "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe).", secret=True),
        Setting("RECAPTCHA_VERIFY_URL", "https://www.google.com/recaptcha/api/siteverify", "Where the server checks a reCAPTCHA token."),
        Setting("RECAPTCHA_HOSTNAMES", "", "Comma-separated hostnames a token must be issued for (the public URL's host); "
                "empty: not checked."),
        Setting("SESSION_SECRET", "", "Signs session cookies (32+ random characters). Changing it signs everyone out.", secret=True),
        Setting("SESSION_HOURS", "12", "How long a passed check lasts; then the box shows again."),
        Setting("LOGIN_PER_MINUTE", "10", "Checks per IP address per minute."),
        Setting("LOGIN_CHECKS_PER_DAY", "1000", "reCAPTCHA checks one server instance makes a day at most (the free "
                "allowance is 10,000 a month for the whole organisation)."),
        Setting("AUTH_LOCAL_AGENTS", "true", "With the bot check on, agents on this machine (loopback, no proxy) skip it: "
                "local runs only, never true on Cloud Run."),
        Setting("BLOCK_AI_CRAWLERS", "true", "Refuse requests from AI crawlers and simple scripts that name themselves "
                "(GPTBot, ClaudeBot, PerplexityBot, CCBot, HeadlessChrome, …); robots.txt asks every bot to stay away."),
        Setting(
            "CORS_ORIGINS",
            "http://localhost:5173",
            "Comma-separated origins allowed to call the API from a browser (a web "
            "app served from another port during development). Empty: none.",
        ),
        Setting(
            "WEB_DIST",
            "../web/dist",
            "The built web app (npm run build in web/), served at / when it exists "
            "(relative to the server folder).",
        ),
        Setting(
            "INSTITUTION_ID",
            "bank-a",
            "The institution this installation serves (one installation per institution).",
        ),
        # Database
        Setting(
            "DATABASE_URL",
            "postgresql://amiri:amiri@localhost:5432/amiri",
            "Postgres connection string (the compose.yaml database locally; AlloyDB "
            "or Cloud SQL in Google Cloud).",
            secret=True,
        ),
        Setting(
            "TEST_DATABASE_URL",
            "postgresql://amiri:amiri@localhost:5432/amiri_test",
            "Database the tests wipe and rebuild. Never point it at real data.",
            secret=True,
        ),
        Setting("DB_POOL_MAX", "10", "Most database connections the server holds."),
        Setting("DB_CONNECT_TIMEOUT_SECONDS", "5", "Seconds to wait for the database when checking whether it is up."),
        Setting("DB_WAKE_PROBE_SECONDS", "15",
                "While the database is stopped (asleep), how often a request may try it again; once it answers the "
                "server wakes without a restart."),
        Setting(
            "AUTO_MIGRATE",
            "true",
            "Apply pending migrations when the server starts.",
        ),
        # Twelve Data
        Setting(
            "TWELVEDATA_API_KEY",
            "",
            "Twelve Data API key. Without it, the series pages still work, but "
            "adding, refreshing and the hourly fetch return provider_not_configured.",
            secret=True,
        ),
        Setting("TWELVEDATA_BASE_URL", "https://api.twelvedata.com", "Twelve Data API base."),
        Setting("TWELVEDATA_PLAN", "Basic", "The Twelve Data plan of the key (Basic is the free plan; then Grow, Pro, Ultra, "
                "Enterprise). Search results above it can't be added."),
        Setting(
            "TWELVEDATA_TIMEOUT_SECONDS",
            "15",
            "Seconds Twelve Data gets to answer one call.",
        ),
        Setting(
            "TWELVEDATA_CREDITS_PER_MINUTE",
            "8",
            "API credits Amiri Agent may spend in any 60 seconds (the free plan allows 8). "
            "Scheduled fetches over it wait for the next tick; manual refreshes and "
            "adds get 429 with Retry-After.",
        ),
        Setting(
            "TWELVEDATA_CREDITS_PER_DAY",
            "800",
            "API credits Amiri Agent may spend per UTC day (the free plan allows 800).",
        ),
        # Assistant (amiri-assistant, the ADK chat agent)
        Setting(
            "ASSISTANT_BACKEND",
            "none",
            "Where chat messages go. none: not connected (replies say so; forms still work). "
            "stub: canned replies and keyword routing in-process, for UI work. http: the setup agent "
            "service at ASSISTANT_URL through the contract (app/assistant/contract.py): the real "
            "amiri-setup-agent, or `uv run amiri fake-agent`.",
        ),
        Setting("ASSISTANT_URL", "http://localhost:8003", "Base URL of the setup agent service (http backend)."),
        Setting(
            "ASSISTANT_AUTH",
            "none",
            "How the server calls the agent: none (local), or id_token (a Google ID token for ASSISTANT_URL, on Cloud Run).",
        ),
        Setting(
            "SERVER_PUBLIC_URL",
            "http://localhost:8000",
            "The server's URL as the agent reaches it, for its tools (sent to the agent with each session).",
        ),
        Setting("ASSISTANT_TIMEOUT_SECONDS", "120", "Longest one assistant turn may take."),
        Setting("ASSISTANT_HEALTH_TIMEOUT_SECONDS", "3", "How long the status check waits for the setup agent. No answer "
                "in time means it is starting (Cloud Run starting it from zero): the chat says so and checks again."),
        Setting("ASSISTANT_KEEP_WARM_SECONDS", "240", "While the chat is open, the page checks the agent this often so "
                "Cloud Run keeps it running (it stops an idle agent after about 15 minutes); 0: off."),
        Setting("ASSISTANT_KEEP_WARM_IDLE_MINUTES", "30", "The page stops keeping the agent warm after this long without "
                "anyone using it, so an open but forgotten tab lets the agent scale to zero."),
        Setting(
            "ASSISTANT_SESSION_IDLE_MINUTES",
            "30",
            "A chat session ends after this long without a message; the next message starts a new "
            "one with a fresh context pack (the chat history stays).",
        ),
        Setting(
            "ASSISTANT_TURNS_PER_MINUTE",
            "6",
            "Messages one person may send to the setup agent in any minute (cost and abuse control).",
        ),
        Setting("ASSISTANT_TURNS_PER_DAY", "300", "Messages one person may send per UTC day."),
        Setting(
            "ASSISTANT_PROPOSAL_TTL_HOURS",
            "24",
            "A proposal not confirmed within this many hours expires.",
        ),
        # Investigation
        Setting(
            "INVESTIGATION_URL",
            "",
            "The investigation agent (agents/investigation-agent; locally http://localhost:8001). "
            "Empty: not connected; new findings wait.",
        ),
        Setting(
            "INVESTIGATION_AUTH",
            "none",
            "How the server calls the investigation agent: none (local), or id_token (Cloud Run).",
        ),
        Setting(
            "INVESTIGATION_WAIT_MINUTES",
            "10",
            "A new finding waits this long for related ones before its batch is investigated "
            "(Investigate now skips the wait).",
        ),
        Setting(
            "INVESTIGATION_MAX_ATTEMPTS",
            "3",
            "A batch whose run fails is sent again this many times in all; then its findings are set aside.",
        ),
        Setting(
            "INTERNAL_AUTH",
            "none",
            "Who may call /api/v1/internal/* (what the agents read): none (local), or id_token (a Google ID "
            "token for SERVER_PUBLIC_URL from a service account in INTERNAL_CALLERS; Cloud Run).",
        ),
        Setting(
            "INTERNAL_CALLERS",
            "",
            "Comma-separated service-account emails allowed on /api/v1/internal/* when INTERNAL_AUTH=id_token "
            "(the investigation agent's).",
        ),
        Setting(
            "EVENT_RESIZE_FACTOR",
            "1.5",
            "A later market move this many times the open event's size re-sizes it, and the effects that need the "
            "bigger move are investigated (the ones the event has aren't repeated).",
        ),
        Setting(
            "EVENT_OPEN_DAYS",
            "14",
            "An event stays open this many days after its last finding; a new finding about the same move "
            "joins it as a development meanwhile, then it closes.",
        ),
        Setting(
            "METRICS_VALIDATION",
            "off",
            "on: the investigation builds validation tasks against the institution's metrics. off: it "
            "stops at hypotheses and a readable investigation.",
        ),
        # Monitors
        Setting("MONITOR_URL", "", "The monitor agent (agents/event-monitor-agent; locally http://localhost:8002). "
                "Empty: not connected; live monitors wait."),
        Setting("MONITOR_AUTH", "none", "How the server calls the monitor agent: none (local), or id_token (Cloud Run)."),
        Setting("MONITORS_LIVE_MAX", "10", "Live monitors at most (each check is a model and web search cost)."),
        Setting("MONITOR_MIN_FREQUENCY_MINUTES", "60", "The most often a monitor may be checked: 15, 60, 360 or 1440."),
        Setting("PROTOTYPE_RESET", "true", "Allow the prototype reset (wipes the institution and all Amiri Agent made for it; "
                "keeps market prices and reference data). Switch off for a real deployment."),
        Setting("MOCK_INSTITUTIONS", "true", "Allow the sample bank and insurer (the Metrics Spec reference API at "
                "/mock/bank and /mock/insurer, switched on by the Platform Admin). Switch off for a real deployment."),
        # The institution's data (the Metrics Spec reference API) and the connector that checks it
        Setting("DATA_CONNECTION_TIMEOUT_SECONDS", "15", "How long the connector waits for one answer from an "
                "institution's API (the spec asks for a full history within 30 seconds)."),
        Setting("DATA_CONNECTION_MAX_CALLS", "200", "Calls one check may make at most (the institution's rate limits)."),
        Setting("DATA_CONNECTION_MAX_BYTES", "5000000", "The largest answer the connector reads; bigger ones are cut off "
                "and reported."),
        Setting("DATA_CONNECTION_ALLOW_LOCAL", "false", "Let the connector call http:// and private or loopback addresses "
                "(local development only; never on a public deployment)."),
        Setting("VALIDATION_TASKS_PER_TICK", "20", "Validation tasks judged per tick at most (each reads the "
                "institution's API several times); the rest wait for the next tick."),
        Setting("DATA_SECRET_KEY", "", "Empty (the prototype): data connections have no authorization. Set it (32+ "
                "random characters) to let a connection send a key or token, stored encrypted with it; changing it "
                "means entering the key again.", secret=True),
        Setting("SUPPORTED_REGION", "japac", "The region the prototype is tested for: an institution's home country and "
                "base currency must be in it (app/reference/regions.json). Empty: anywhere."),
        Setting("SINGLE_INSTITUTION", "true", "One institution per platform (a deployment serves one bank or insurer); "
                "a second can't be created until the prototype is reset."),
        Setting("MONITOR_RETRY_MINUTES", "60", "After a check fails, try again this many minutes later (not the whole frequency): a "
                "failed check read nothing and moved no window, so retrying early loses nothing."),
        Setting("MONITOR_CHECKS_PER_TICK", "5", "Checks started per tick at most; the rest wait for the next tick."),
        Setting("MONITOR_FIRST_LOOKBACK_HOURS", "24", "A monitor's first check reads news this far back."),
        Setting("MONITOR_WEB_QUERIES_PER_CHECK", "3", "Web searches one check may run."),
        Setting("MONITOR_RECENT_DAYS", "7", "Pages a monitor reported in this many days are not reported again."),
        # Radar
        Setting("AGENT_COLD_START_TIMEOUT_SECONDS", "120", "When an agent doesn't answer a new run in time (Cloud Run "
                "starting it from zero), the run is sent again once, waiting this long."),
        Setting("RADAR_URL", "", "Base URL of the Radar agent (agents/radar-agent); empty: not connected."),
        Setting("RADAR_AUTH", "none", "How the server calls the Radar agent: none (local) or id_token (Cloud Run)."),
        Setting("RADAR_EVERY_MINUTES", "1440", "Minutes between scheduled Radar runs (1440: once a day). Only scheduled "
                "runs count; Check now doesn't move the schedule."),
        Setting("RADAR_RUN_AT", "06:00", "With a daily period (RADAR_EVERY_MINUTES 1440): the local time (the institution's "
                "time zone, HH:MM) the scheduled run starts. Empty: every RADAR_EVERY_MINUTES from the last scheduled run."),
        Setting("RADAR_RUN_NOW_PER_DAY", "5", "Check now runs allowed per local day (the prototype's limit; shown on the "
                "Radar page). Runs refused by a budget don't count."),
        Setting("RADAR_FIRST_LOOKBACK_HOURS", "24", "The first run reads this many hours back."),
        Setting("RADAR_SEEN_DAYS", "14", "Stories reported in this many days go with each run (seen_stories): the "
                "agent keeps no memory, so this is how it recognises a story again and links developments."),
        Setting("RADAR_MAX_STORIES", "10", "Stories a run may return at most."),
        Setting("RADAR_MAX_MODEL_CALLS", "40", "Model calls a run may make at most."),
        Setting("RADAR_MODEL_CALLS_PER_DAY", "300", "Cost guard: model calls Radar may make a day (the institution's "
                "local day). Past it, a run reports stories from code scoring alone and sends none."),
        Setting("RADAR_TIMEOUT_SECONDS", "300", "Longest a run may take inside the agent."),
        Setting("RADAR_MAX_QUERIES", "1", "BigQuery queries a run may make at most."),
        Setting("RADAR_MAX_BYTES_PER_QUERY", "1500000000",
                "BigQuery maximum_bytes_billed for each query (bytes)."),
        Setting("RADAR_DAILY_BYTES_CAP", "20000000000",
                "BigQuery bytes Radar may scan per UTC day; scheduled runs and Check now are refused once it is spent (bytes)."),
        # Scenario Studio
        Setting(
            "SIM_INVESTIGATION_WAIT_STEPS",
            "2",
            "Steps a simulation waits before its first investigation, so a story's first findings go in together.",
        ),
        Setting(
            "SIM_AGENT_DEADLINE_SECONDS",
            "480",
            "Real seconds a simulation waits for one agent run before it gives up on it and moves on.",
        ),
        Setting("SIM_MAX_ATTEMPTS", "2", "Times a simulation's investigation is tried (the first try and one retry)."),
        # Market series
        Setting(
            "SERIES_MAX",
            "8",
            "Most series one installation may watch (prototype limit; paused series "
            "count).",
        ),
        Setting(
            "SERIES_FETCH_EVERY_MINUTES",
            "60",
            "How often each series is fetched. Fetches are due on the hour (for 60), "
            "and run on the first tick at or after that time.",
        ),
        Setting(
            "SERIES_REFRESH_COOLDOWN_SECONDS",
            "120",
            "Least time between two manual refreshes of one series.",
        ),
        Setting(
            "SERIES_BACKFILL_BARS",
            "2000",
            "Hourly bars read when a series is added (60 trading days need about "
            "1,440 for a 24-hour market). One call, at most 5000.",
        ),
        Setting(
            "SERIES_FETCH_LEASE_SECONDS",
            "300",
            "A fetch that hasn't finished after this long (a crashed instance) no "
            "longer blocks the next one.",
        ),
        Setting("SERIES_Z_THRESHOLD", "3", "A move fires at |z| at or above this."),
        Setting(
            "SERIES_SIGMA_DAYS",
            "60",
            "Trading days of daily moves that set a series' typical daily move.",
        ),
        Setting(
            "SERIES_MIN_SIGMA_DAYS",
            "20",
            "Fewer daily moves than this: the series is warming up and nothing fires.",
        ),
        Setting(
            "SERIES_WINDOWS_DAYS",
            "1,3,5",
            "Move lengths checked, in trading days.",
        ),
        Setting(
            "SERIES_COOLDOWN_HOURS",
            "24",
            "After a series fires, it stays quiet this long.",
        ),
        Setting(
            "SERIES_STALE_AFTER_HOURS_24H",
            "6",
            "Default for markets that trade around the clock on weekdays (currencies, "
            "metals, crypto): no new bar for this many weekday hours means stale.",
        ),
        Setting(
            "SERIES_STALE_AFTER_HOURS_SESSION",
            "30",
            "Default for markets with daily sessions (shares, funds, indices).",
        ),
    ]
}


def raw(name: str) -> str:
    return (os.getenv(name) or "").strip() or SETTINGS[name].default


def names(name: str) -> list[str]:
    return list(dict.fromkeys(x.strip() for x in raw(name).split(",") if x.strip()))


def number(name: str) -> float:
    return float(raw(name))


def integer(name: str) -> int:
    return int(raw(name))


def flag(name: str) -> bool:
    return raw(name).lower() in ("1", "true", "yes", "on")


def env_example() -> str:
    """The .env.example text: every setting, commented out, with its default."""
    import textwrap

    lines = [
        "# Configuration for amiri-server. Copy to .env and change what you need.",
        "# Every setting is optional: uncomment a line to change it. The value shown",
        "# is the default (app/settings.py). Real environment variables win over .env.",
        "",
    ]
    for s in SETTINGS.values():
        lines += ["# " + x for x in textwrap.wrap(s.help, 78)]
        lines += [f"# {s.name}={s.default}", ""]
    return "\n".join(lines)
