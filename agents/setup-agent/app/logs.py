"""Logging: one line per thing worth knowing, in a shape Cloud Logging understands.

LOG_FORMAT=json (Cloud Run) writes one JSON object per line: Cloud Logging reads its severity,
keeps a traceback in one entry (Error Reporting groups repeated errors), and links the line to
the trace of the run that wrote it. LOG_FORMAT=text (local) is plain lines.

Logged: one line when a run (or a chat turn) ends, with its model and counts; a model that fails
over to the next; failures with their traceback. Never a prompt, a model's answer or what a
person typed: the traces leave them out too (ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false on Cloud
Run). Requests themselves are in Cloud Run's request log (with LOG_FORMAT=json, uvicorn's access log is off).
"""

import json
import logging
import os
import sys
import traceback

from app import settings

SERVICE = "amiri-setup"
_done = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        entry: dict = {"severity": record.levelname, "logger": record.name}
        if record.exc_info:
            msg = f"{msg}\n{''.join(traceback.format_exception(*record.exc_info)).rstrip()}"
            entry["@type"] = "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"
            entry["serviceContext"] = {"service": SERVICE}
        entry["message"] = msg
        trace, project = _trace_id(), os.environ.get("GOOGLE_CLOUD_PROJECT")
        if trace and project:
            entry["logging.googleapis.com/trace"] = f"projects/{project}/traces/{trace}"
        return json.dumps(entry, ensure_ascii=False, default=str)


def _trace_id() -> str | None:
    """The current OpenTelemetry trace (ADK's spans, exported to Cloud Trace on Cloud Run)."""
    try:
        from opentelemetry import trace

        ctx = trace.get_current_span().get_span_context()
        return format(ctx.trace_id, "032x") if ctx.is_valid else None
    except Exception:  # no tracing here: the line is still written
        return None


def setup() -> None:
    """Once per process, after uvicorn configured its own loggers."""
    global _done
    if _done:
        return
    _done = True
    level = (settings.raw("LOG_LEVEL") or "INFO").upper()
    root = logging.getLogger()
    root.setLevel(level)
    if settings.raw("LOG_FORMAT") == "json":
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        root.handlers = [handler]
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            lg = logging.getLogger(name)
            lg.handlers, lg.propagate = [], True
        # no line per request: Cloud Run's own request log has every one (status, latency, trace)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    elif not root.handlers:
        logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s")
    for noisy in ("httpx", "httpcore", "google_genai", "google.auth", "urllib3", "opentelemetry"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
