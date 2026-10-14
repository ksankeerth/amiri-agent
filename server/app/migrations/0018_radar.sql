-- Radar: its runs, and the stories they found (one row per story, by
-- fingerprint: a story seen again is updated). Stories the agent sends become findings.

CREATE TABLE signals.radar_runs (
    run_id          text PRIMARY KEY,
    institution_id  text        NOT NULL,
    trigger         text        NOT NULL CHECK (trigger IN ('tick', 'now')),
    window_since    timestamptz NOT NULL,
    window_until    timestamptz NOT NULL,
    status          text        NOT NULL CHECK (status IN ('running', 'completed', 'stopped_early', 'failed')),
    request         jsonb       NOT NULL,
    result          jsonb,
    stories         integer,
    sent            integer,
    bytes_processed bigint,
    error           text,
    reposts         integer     NOT NULL DEFAULT 0,
    created_by      text,
    created_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    next_poll_at    timestamptz
);
CREATE INDEX radar_runs_open ON signals.radar_runs (next_poll_at) WHERE status = 'running';
CREATE INDEX radar_runs_recent ON signals.radar_runs (institution_id, created_at DESC);

CREATE TABLE signals.radar_stories (
    story_id       text PRIMARY KEY,
    institution_id text        NOT NULL,
    fingerprint    text        NOT NULL,
    title          text        NOT NULL,
    summary        text        NOT NULL,
    why            text        NOT NULL,
    places         text[]      NOT NULL DEFAULT '{}',
    themes         jsonb       NOT NULL DEFAULT '[]',
    relevance      text        NOT NULL CHECK (relevance IN ('high', 'medium', 'low')),
    score          integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
    publishers     integer     NOT NULL,
    headlines      jsonb       NOT NULL,
    development_of text,                                  -- the fingerprint it continues
    status         text        NOT NULL CHECK (status IN ('sent', 'below', 'dismissed')),
    sent_by        text,                                  -- agent, or the person who sent it anyway
    finding_id     text,
    run_id         text        NOT NULL,                  -- the run that last saw it
    runs_seen      integer     NOT NULL DEFAULT 1,
    first_seen_at  timestamptz NOT NULL,
    last_seen_at   timestamptz NOT NULL,
    dismissed_by   text,
    dismissed_at   timestamptz,
    UNIQUE (institution_id, fingerprint)
);
CREATE INDEX radar_stories_recent ON signals.radar_stories (institution_id, last_seen_at DESC);
