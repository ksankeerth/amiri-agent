"""Radar runs behind the API: a durable record of each run, and the service that works them.

RunStore keeps one row per run_id in SQLite (RUNS_DB_PATH): the request (and its hash, to tell a
retry from a different request), the status, and the result or error. RadarService starts each new
run as a background task, at most MAX_CONCURRENT_RUNS at a time; the rest wait as "queued". The
whole run is bounded by the request's timeout_seconds.

The store is a local file, so every POST and GET for a run must reach the same instance: run one
instance (as the monitor agent does).
"""

import asyncio
import hashlib
import json
import logging
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

from google.genai import errors

from app import settings
from app.contract import RadarRunRequest, RadarRunResult, RadarRunStatus
from app.radar_runner import Deps, RunFailed, run_radar

logger = logging.getLogger(__name__)

RETENTION = timedelta(hours=24)
INTERRUPTED = "The agent restarted before this run finished; the next run reads the news again."

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id       TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    request_json TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'stopped_early', 'failed')),
    created_at   TEXT NOT NULL,
    started_at   TEXT,
    finished_at  TEXT,
    result_json  TEXT,
    error        TEXT
);
CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
"""


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def request_hash(req: RadarRunRequest) -> str:
    return hashlib.sha256(json.dumps(req.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()


class RunExists(Exception):
    """The run_id is taken by a different request."""


class RunStore:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            if str(path) != ":memory:":
                self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.executescript(_SCHEMA)

    def _execute(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def create(self, req: RadarRunRequest) -> tuple[RadarRunStatus, bool]:
        """A new queued run, or the existing one for the same body (created False). Raises RunExists otherwise."""
        digest = request_hash(req)
        with self._lock:
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO runs (run_id, request_hash, request_json, status, created_at) VALUES (?,?,?,'queued',?)",
                (req.run_id, digest, req.model_dump_json(), _now()))
            created = cur.rowcount == 1
            row = self._conn.execute("SELECT * FROM runs WHERE run_id = ?", (req.run_id,)).fetchone()
        if row["request_hash"] != digest:
            raise RunExists(req.run_id)
        return self._status(row), created

    def get(self, run_id: str) -> RadarRunStatus | None:
        rows = self._execute("SELECT * FROM runs WHERE run_id = ?", (run_id,))
        return self._status(rows[0]) if rows else None

    def mark_running(self, run_id: str) -> None:
        self._execute("UPDATE runs SET status = 'running', started_at = ? WHERE run_id = ?", (_now(), run_id))

    def complete(self, run_id: str, result: RadarRunResult) -> None:
        status = "completed" if result.stop_reason == "finished" else "stopped_early"
        self._execute("UPDATE runs SET status = ?, finished_at = ?, result_json = ? WHERE run_id = ?",
                      (status, _now(), result.model_dump_json(), run_id))

    def fail(self, run_id: str, error: str) -> None:
        self._execute("UPDATE runs SET status = 'failed', finished_at = ?, error = ?, started_at = COALESCE(started_at, ?) "
                      "WHERE run_id = ?", (_now(), error, _now(), run_id))

    def fail_interrupted(self) -> int:
        stale = [r["run_id"] for r in self._execute("SELECT run_id FROM runs WHERE status IN ('queued', 'running')")]
        for run_id in stale:
            self.fail(run_id, INTERRUPTED)
        return len(stale)

    def purge(self, older_than: timedelta = RETENTION) -> int:
        cutoff = (datetime.now(UTC) - older_than).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            return self._conn.execute("DELETE FROM runs WHERE created_at < ?", (cutoff,)).rowcount

    @staticmethod
    def _status(row: sqlite3.Row) -> RadarRunStatus:
        return RadarRunStatus(
            run_id=row["run_id"], status=row["status"], created_at=row["created_at"], started_at=row["started_at"],
            finished_at=row["finished_at"],
            result=RadarRunResult.model_validate_json(row["result_json"]) if row["result_json"] else None,
            error=row["error"])


def error_message(e: BaseException) -> str:
    if isinstance(e, RunFailed):
        return str(e)
    if isinstance(e, errors.APIError):
        why = "quota exceeded" if e.code == 429 else "busy" if e.code in (500, 502, 503, 504) else f"error {e.code}"
        return f"Every model was unavailable ({why}); Radar tries again at the next run."
    if isinstance(e, TimeoutError):
        return "The run took longer than its time limit; Radar tries again at the next run."
    return f"The run failed ({type(e).__name__}); Radar tries again at the next run."


class RadarService:
    def __init__(self, store: RunStore, deps: Deps, max_concurrent: int | None = None):
        self.store, self.deps = store, deps
        self._slots = asyncio.Semaphore(max_concurrent or settings.integer("MAX_CONCURRENT_RUNS"))
        self._tasks: set[asyncio.Task] = set()

    def start(self, req: RadarRunRequest) -> None:
        task = asyncio.create_task(self._run(req), name=f"radar-{req.run_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, req: RadarRunRequest) -> None:
        async with self._slots:
            self.store.mark_running(req.run_id)
            try:
                async with asyncio.timeout(req.limits.timeout_seconds):
                    result = await run_radar(req, self.deps)
            except Exception as e:
                if not isinstance(e, RunFailed):
                    logger.exception("radar run %s failed", req.run_id)
                self.store.fail(req.run_id, error_message(e))
            else:
                self.store.complete(req.run_id, result)

    async def drain(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
