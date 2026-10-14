-- Every tick's run, so the Overview can say when background work last ran.
CREATE TABLE signals.ticks (
    started_at  timestamptz PRIMARY KEY,
    duration_ms integer     NOT NULL,
    ran         jsonb       NOT NULL
);
