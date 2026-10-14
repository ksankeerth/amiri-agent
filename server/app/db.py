"""Database pool and migrations.

Migrations are the numbered .sql files in app/migrations, applied in order and
recorded in public.schema_migrations. An advisory lock makes two instances
starting at once apply them only once.
"""

from pathlib import Path

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app import settings

MIGRATIONS = Path(__file__).parent / "migrations"
MIGRATION_LOCK = 7_310_001  # pg advisory lock key


def make_pool(url: str | None = None) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        url or settings.raw("DATABASE_URL"),
        min_size=1,
        max_size=settings.integer("DB_POOL_MAX"),
        kwargs={"row_factory": dict_row, "autocommit": True},
        open=False,
    )


async def migrate(conn: AsyncConnection) -> list[str]:
    """Applies pending migrations; returns the versions applied."""
    applied: list[str] = []
    await conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK,))
    try:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS public.schema_migrations "
            "(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        cur = await conn.execute("SELECT version FROM public.schema_migrations")
        done = {r["version"] for r in await cur.fetchall()}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.stem in done:
                continue
            async with conn.transaction():
                await conn.execute(f.read_text())
                await conn.execute(
                    "INSERT INTO public.schema_migrations (version) VALUES (%s)", (f.stem,)
                )
            applied.append(f.stem)
    finally:
        await conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK,))
    return applied


async def schema_version(conn: AsyncConnection) -> str | None:
    cur = await conn.execute(
        "SELECT max(version) AS v FROM public.schema_migrations"
    )
    row = await cur.fetchone()
    return row["v"] if row else None
