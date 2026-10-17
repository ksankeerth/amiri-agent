"""Logs: one JSON line per entry (tracebacks inside it, linked to the request's trace), and a tick
whose step fails still runs the others and says so in one line."""

import json
import logging

from app import logs, tick


def test_json_line_with_traceback_and_trace(env):
    env.setenv("GOOGLE_CLOUD_PROJECT", "proj-1")
    logs._trace.set(logs.trace_id({b"x-cloud-trace-context": b"abc123/1;o=1"}))
    try:
        raise ValueError("boom")
    except ValueError:
        rec = logging.getLogger("amiri.test").makeRecord("amiri.test", logging.ERROR, __file__, 1, "it failed: %s",
                                                         ("x",), __import__("sys").exc_info())
    line = logs.JsonFormatter().format(rec)
    assert "\n" not in line  # one line, one entry
    e = json.loads(line)
    assert e["severity"] == "ERROR" and e["message"].startswith("it failed: x\nTraceback")
    assert "ValueError: boom" in e["message"]
    assert e["logging.googleapis.com/trace"] == "projects/proj-1/traces/abc123"
    assert logs.trace_id({b"traceparent": b"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}) == \
        "4bf92f3577b34da6a3ce929d0e0e4736"
    logs._trace.set(None)


async def test_a_failing_tick_step_does_not_stop_the_others(app, caplog):
    async def broken():
        raise RuntimeError("radar exploded")
    app.state.radar.run_due = broken
    with caplog.at_level(logging.INFO, logger="amiri.tick"):
        out = await tick.run_tick(app)
    steps = [s.get("step") for s in out["ran"]]
    assert steps == ["market_series", "radar", "monitors", "investigate", "validate"]  # all five ran
    assert "radar exploded" in out["ran"][1]["error"]
    lines = [r for r in caplog.records if r.name == "amiri.tick"]
    assert any(r.levelno == logging.ERROR and r.exc_info for r in lines)  # the step's traceback
    summary = [r for r in lines if r.getMessage().startswith("tick ")][-1]
    assert summary.levelno == logging.WARNING and "radar error" in summary.getMessage()
