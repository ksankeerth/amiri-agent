-- Platform settings that outlive a prototype reset: the sample institutions' switches and conditions.
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.mock_institutions (
    kind        text PRIMARY KEY CHECK (kind IN ('bank', 'insurer')),
    enabled     boolean NOT NULL DEFAULT false,
    conditions  jsonb NOT NULL DEFAULT '[]',
    updated_at  timestamptz,
    updated_by  text
);
