"""Running the query in BigQuery, behind cost guards that each stop the spend on their own.

1. Per query: a dry run first (free) and no query over the cap; then the run with
   maximum_bytes_billed, so BigQuery itself refuses (unbilled) one that would read more. The cap is
   the lower of the request's limit and BQ_MAX_BYTES_PER_QUERY.
2. Per run: only the partitioned GKG table, at most two day partitions (queries.py), one query.
3. The server adds up the bytes each run reports, and stops runs at its daily cap.
4. Here, independently of the server: before a query, BigQuery's own job list (free to read) gives
   what this agent's jobs billed today (UTC) and this month; over BQ_DAILY_BYTES or BQ_MONTHLY_BYTES,
   or if the list can't be read, the query isn't run.
5. A BigQuery quota on the project (set in Google Cloud) refuses everything over it.

Jobs carry the label app=amiri-radar, so the budget counts only Radar's queries even when the
credentials are a person's (locally). BigQuery's client is blocking: callers run these methods in
a worker thread.
"""

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from app import settings

log = logging.getLogger(__name__)
LABEL = {"app": "amiri-radar"}
ALLOWED_TABLE = "gdelt-bq.gdeltv2.gkg_partitioned"


class BudgetSpent(Exception):
    """A cost guard refused the query; the message says which and why."""


@dataclass
class Ran:
    rows: list[dict]
    bytes_processed: int
    bytes_billed: int
    cached: bool


def check_tables(sql: str) -> None:
    """Only the partitioned GKG table: the unpartitioned one is tens of TB."""
    tables = set(re.findall(r"`([^`]+)`", sql))
    if tables != {ALLOWED_TABLE}:
        raise BudgetSpent(f"refused: the query reads {sorted(tables)}, only {ALLOWED_TABLE} is allowed")


class BigQuery:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        if self._client is None:
            from google.cloud import bigquery

            self._client = bigquery.Client(project=settings.raw("BQ_PROJECT") or None,
                                           location=settings.raw("BQ_LOCATION"))
        return self._client

    def _config(self, params: dict, **kw):
        from google.cloud import bigquery

        qp = []
        for name, (kind, value) in params.items():
            if kind.startswith("ARRAY<"):
                qp.append(bigquery.ArrayQueryParameter(name, kind[6:-1], value))
            else:
                qp.append(bigquery.ScalarQueryParameter(name, kind, value))
        return bigquery.QueryJobConfig(query_parameters=qp, labels=LABEL, **kw)

    def dry_run(self, sql: str, params: dict) -> int:
        check_tables(sql)
        job = self.client.query(sql, job_config=self._config(params, dry_run=True, use_query_cache=False))
        return int(job.total_bytes_processed or 0)

    def billed_since(self, start: datetime) -> int:
        """Bytes billed by this principal's Radar jobs created since `start` (BigQuery's job list; free)."""
        total = 0
        for job in self.client.list_jobs(min_creation_time=start, all_users=False, state_filter="done"):
            if (getattr(job, "labels", None) or {}).get("app") == LABEL["app"]:
                total += int(getattr(job, "total_bytes_billed", 0) or 0)
        return total

    def budget(self, planned: int) -> None:
        """Guard 4: refuses when today's or this month's billed bytes plus this query would pass the budget."""
        now = datetime.now(UTC)
        try:
            month = self.billed_since(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
            today = self.billed_since(now.replace(hour=0, minute=0, second=0, microsecond=0))
        except Exception as e:  # can't tell what was spent: don't spend
            raise BudgetSpent(f"BigQuery's job list couldn't be read ({type(e).__name__}), so no query was run") from e
        day_cap, month_cap = settings.integer("BQ_DAILY_BYTES"), settings.integer("BQ_MONTHLY_BYTES")
        if today + planned > day_cap:
            raise BudgetSpent(f"Radar's daily BigQuery budget is spent ({today / 1e9:.1f} of {day_cap / 1e9:.0f} GB "
                              "today); it resets at midnight UTC")
        if month + planned > month_cap:
            raise BudgetSpent(f"Radar's monthly BigQuery budget is spent ({month / 1e9:.0f} of {month_cap / 1e9:.0f} GB "
                              "this month)")

    def run(self, sql: str, params: dict, max_bytes: int) -> Ran:
        """Guards 1 and 4, then the capped run. Raises BudgetSpent instead of spending."""
        check_tables(sql)
        planned = self.dry_run(sql, params)
        if planned > max_bytes:
            raise BudgetSpent(f"the query would read {planned / 1e9:.2f} GB, over the {max_bytes / 1e9:.2f} GB cap; "
                              "not run")
        self.budget(planned)
        job = self.client.query(sql, job_config=self._config(params, maximum_bytes_billed=max_bytes))
        rows = [dict(r.items()) for r in job.result()]
        log.info("bigquery: %d rows, %.2f GB processed, %.2f GB billed%s", len(rows),
                 (job.total_bytes_processed or 0) / 1e9, (job.total_bytes_billed or 0) / 1e9,
                 " (cached)" if job.cache_hit else "")
        return Ran(rows, int(job.total_bytes_processed or 0), int(job.total_bytes_billed or 0), bool(job.cache_hit))


def cap(request_limit: int) -> int:
    """Guard 1's cap: the lower of the request's limit and this agent's own."""
    return min(request_limit, settings.integer("BQ_MAX_BYTES_PER_QUERY"))
