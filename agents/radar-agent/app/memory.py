"""What the agent remembers between runs: the stories it reported, and today's model calls.

The server knows a story only by its fingerprint. To say "this is the same story as an hour ago"
(reuse the fingerprint) or "this develops last week's story" (development_of), the agent keeps
what it reported: fingerprint, title, places and terms, for MEMORY_DAYS, per institution.

It's local SQLite next to the run store: a new instance (a redeploy) starts empty, and continuing
stories come back as new ones for a while. The model-call count (a cost guard) is in the same
file; lost with it, it errs on the side of a fresh day's allowance, which the server's run limits
still bound (one scheduled run and a few checks a day).
"""

import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app import settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stories (
    institution TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    title       TEXT NOT NULL,
    places      TEXT NOT NULL,
    terms       TEXT NOT NULL,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    PRIMARY KEY (institution, fingerprint)
);
CREATE TABLE IF NOT EXISTS model_calls (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
"""


@dataclass
class Remembered:
    fingerprint: str
    title: str
    places: set[str]
    terms: set[str]
    last_seen: datetime


class Memory:
    def __init__(self, path: str | Path | None = None):
        path = path or settings.path("RUNS_DB_PATH")
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(_SCHEMA)

    def recall(self, institution: str) -> list[Remembered]:
        cutoff = (datetime.now(UTC) - timedelta(days=settings.integer("MEMORY_DAYS"))).isoformat()
        with self._lock:
            self._conn.execute("DELETE FROM stories WHERE last_seen < ?", (cutoff,))
            rows = self._conn.execute("SELECT * FROM stories WHERE institution = ?", (institution,)).fetchall()
        return [Remembered(r["fingerprint"], r["title"], set(json.loads(r["places"])), set(json.loads(r["terms"])),
                           datetime.fromisoformat(r["last_seen"])) for r in rows]

    def remember(self, institution: str, fingerprint: str, title: str, places: set[str], terms: set[str]) -> None:
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._conn.execute(
                """INSERT INTO stories (institution, fingerprint, title, places, terms, first_seen, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (institution, fingerprint) DO UPDATE SET title = excluded.title,
                     places = excluded.places, terms = excluded.terms, last_seen = excluded.last_seen""",
                (institution, fingerprint, title, json.dumps(sorted(places)), json.dumps(sorted(terms)), now, now))

    # ------------------------------------------------------------ the model-call guard

    def calls_today(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT n FROM model_calls WHERE day = ?", (datetime.now(UTC).date().isoformat(),)).fetchone()
        return int(row["n"]) if row else 0

    def add_call(self) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO model_calls (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1",
                               (datetime.now(UTC).date().isoformat(),))
