"""The cost guards in the agent: the cap, the budget from BigQuery's own job list (failing closed), the table."""

import pytest

from app.bq import BigQuery, BudgetSpent, cap, check_tables
from app.queries import plan
from tests.unit.conftest import ROWS, FakeClient, request


def test_a_query_over_the_cap_is_never_run():
    q, _ = plan(request())
    client = FakeClient(rows=ROWS, dry_bytes=2_000_000_000)
    with pytest.raises(BudgetSpent, match=r"over the 1\.50 GB cap"):
        BigQuery(client).run(q.sql, q.params, cap(1_500_000_000))
    assert client.queries == []


def test_the_daily_budget_from_bigquerys_job_list(monkeypatch):
    monkeypatch.setenv("BQ_DAILY_BYTES", "1000000000")
    q, _ = plan(request())
    client = FakeClient(rows=ROWS, dry_bytes=600_000_000, billed_today=500_000_000)  # 0.5 + 0.6 > 1 GB
    with pytest.raises(BudgetSpent, match="daily BigQuery budget is spent"):
        BigQuery(client).run(q.sql, q.params, 1_500_000_000)
    assert client.queries == []


def test_the_budget_fails_closed_when_the_job_list_cant_be_read():
    q, _ = plan(request())
    client = FakeClient(rows=ROWS, list_fails=True)
    with pytest.raises(BudgetSpent, match="couldn't be read"):
        BigQuery(client).run(q.sql, q.params, 1_500_000_000)
    assert client.queries == []


def test_only_the_partitioned_table():
    with pytest.raises(BudgetSpent, match=r"only gdelt-bq\.gdeltv2\.gkg_partitioned"):
        check_tables("SELECT 1 FROM `gdelt-bq.gdeltv2.gkg`")


def test_a_capped_labelled_run(monkeypatch):
    q, _ = plan(request())
    client = FakeClient(rows=ROWS, dry_bytes=600_000_000)
    ran = BigQuery(client).run(q.sql, q.params, cap(2_000_000_000))
    assert len(ran.rows) == len(ROWS) and ran.bytes_processed == 600_000_000
    _, cfg = client.queries[0]
    assert cfg.maximum_bytes_billed == 1_500_000_000 and cfg.labels == {"app": "amiri-radar"}  # the lower cap wins
    assert {p.name for p in cfg.query_parameters} >= {"home_names", "actor_names", "foot_fips"}
