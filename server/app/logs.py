"""Logging: one line per thing worth knowing, in a shape Cloud Logging understands.

LOG_FORMAT=json (Cloud Run) writes one JSON object per line. Cloud Logging reads its
`severity` (filter on WARNING or ERROR), keeps a traceback in one entry (so Error Reporting
groups repeated errors), and links the entry to its request's trace (click a log, see the
whole request). LOG_FORMAT=text (local) is plain lines.

What is logged, so a problem is easy to find without paying for noise:
- INFO: one line per tick, passed bot checks, the prototype reset, the server waking.
- WARNING: an agent run that failed or broke the contract, a series whose fetches start
  failing, a failing tick step, the daily reCAPTCHA cap reached.
- ERROR: unexpected exceptions, with the traceback.
Nothing per normal request: Cloud Run's own request log has those (with LOG_FORMAT=json,
uvicorn's access log is off).
"""

import contextvars
import json
import logging
import sys
import traceback

from app import settings

_trace: contextvars.ContextVar[str | None] = contextvars.ContextVar("trace", default=None)
_done = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        entry: dict = {"severity": record.levelname, "logger": record.name}
        if record.exc_info:
            # the traceback in the message, one entry: Error Reporting finds and groups it
            msg = f"{msg}\n{''.join(traceback.format_exception(*record.exc_info)).rstrip()}"
            entry["@type"] = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
            entry["serviceContext"] = {"service": "amiri-server"}
        entry["message"] = msg
        trace, project = _trace.get(), settings.raw("GOOGLE_CLOUD_PROJECT")
        if trace and project:
            entry["logging.googleapis.com/trace"] = f"projects/{project}/traces/{trace}"
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup() -> None:
    """Once per process. Run after uvicorn configured its own loggers (it does before importing the app)."""
    global _done
    if _done:
        return
    _done = True
    level = settings.raw("LOG_LEVEL").upper() or "INFO"
    root = logging.getLogger()
    root.setLevel(level)
    if settings.raw("LOG_FORMAT") == "json":
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        root.handlers = [handler]
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):  # uvicorn's lines in the same shape
            lg = logging.getLogger(name)
            lg.handlers, lg.propagate = [], True
        # no line per request: Cloud Run's own request log has every one (status, latency, trace)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    elif not root.handlers:
        logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("httpx", "httpcore", "psycopg.pool"):  # a line per outgoing call or pool event is noise
        logging.getLogger(noisy).setLevel(logging.WARNING)


class TraceContext:
    """Remembers the request's trace id (Cloud Run sends it) for the log lines it causes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            _trace.set(trace_id(dict(scope.get("headers") or [])))
        await self.app(scope, receive, send)


def trace_id(headers: dict[bytes, bytes]) -> str | None:
    """From `traceparent` (00-TRACE-SPAN-FLAGS) or Cloud Run's `x-cloud-trace-context` (TRACE/SPAN;o=1)."""
    tp = headers.get(b"traceparent", b"").decode("latin-1")
    if tp.count("-") == 3:
        return tp.split("-")[1]
    xc = headers.get(b"x-cloud-trace-context", b"").decode("latin-1")
    return xc.split("/")[0] or None if xc else None
