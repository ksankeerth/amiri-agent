-- Investigations of findings, and what they produce.
-- The database is the queue: a run is posted on one tick and collected on a later one.

CREATE SCHEMA IF NOT EXISTS cases;

ALTER TABLE signals.findings DROP CONSTRAINT IF EXISTS findings_status_check;
ALTER TABLE signals.findings ADD CONSTRAINT findings_status_check
    CHECK (status IN ('new', 'grouped', 'linked', 'set_aside'));
ALTER TABLE signals.findings ADD COLUMN run_id text;          -- the investigation that took it
ALTER TABLE signals.findings ADD COLUMN outcome jsonb;        -- {event_id} or {reason, note}

CREATE TABLE cases.investigations (
    run_id         text PRIMARY KEY,
    institution_id text        NOT NULL,
    world          text        NOT NULL DEFAULT 'live',
    status         text        NOT NULL CHECK (status IN ('running', 'completed', 'stopped_early', 'failed')),
    trigger        text        NOT NULL CHECK (trigger IN ('tick', 'now')),
    finding_ids    text[]      NOT NULL,
    validation     boolean     NOT NULL,
    request        jsonb       NOT NULL,
    result         jsonb,
    report         text,
    error          text,
    attempt        integer     NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL,
    finished_at    timestamptz,
    next_poll_at   timestamptz
);
CREATE INDEX investigations_open ON cases.investigations (next_poll_at) WHERE status = 'running';

CREATE TABLE cases.events (
    event_id       text PRIMARY KEY,               -- ev-<run>-<n>
    run_id         text        NOT NULL REFERENCES cases.investigations ON DELETE CASCADE,
    institution_id text        NOT NULL,
    world          text        NOT NULL,
    title          text        NOT NULL,           -- the event's phrase, by code
    themes         jsonb       NOT NULL,
    country        text        NOT NULL,
    country_code   text,
    anchor         timestamptz NOT NULL,
    anchor_basis   text        NOT NULL,
    size           jsonb,
    places         text[]      NOT NULL DEFAULT '{}',
    regions        text[]      NOT NULL DEFAULT '{}',
    finding_ids    text[]      NOT NULL,
    status         text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at     timestamptz NOT NULL
);
CREATE INDEX events_recent ON cases.events (institution_id, world, anchor DESC);

CREATE TABLE cases.hypotheses (
    hypothesis_id  text PRIMARY KEY,               -- hy-<run>-<n>
    event_id       text        NOT NULL REFERENCES cases.events ON DELETE CASCADE,
    run_id         text        NOT NULL,
    product_id     text        NOT NULL,
    product_type   text        NOT NULL,
    angle          text        NOT NULL,
    mechanism_id   text        NOT NULL,
    chain_label    text        NOT NULL,
    statement      text        NOT NULL,
    segment        jsonb,
    expected       jsonb       NOT NULL,
    task_id        text
);
CREATE INDEX hypotheses_event ON cases.hypotheses (event_id);

CREATE TABLE cases.validation_tasks (
    task_id        text PRIMARY KEY,               -- vt-<run>-<n>
    hypothesis_id  text        NOT NULL REFERENCES cases.hypotheses ON DELETE CASCADE,
    event_id       text        NOT NULL,
    run_id         text        NOT NULL,
    task           jsonb       NOT NULL,           -- the agent's ValidationTask, ids rewritten
    status         text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
    created_at     timestamptz NOT NULL
);
