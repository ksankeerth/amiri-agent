-- Monitors: standing questions a Risk Manager writes, checked by the
-- monitor agent (web search) on a schedule once approved. Versions keep a live monitor
-- running while its next version waits for approval.

CREATE TABLE core.monitors (
    monitor_id          text PRIMARY KEY,
    institution_id      text        NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    status              text        NOT NULL CHECK (status IN ('draft', 'submitted', 'live', 'paused', 'retired')),
    live_version        integer,                  -- the version that runs; null until first approved
    latest_version      integer     NOT NULL,     -- the newest version (a draft while the live one runs)
    origin              text        NOT NULL CHECK (origin IN ('form', 'template', 'profile', 'radar_story', 'setup')),
    origin_ref          jsonb,                    -- {section, item_id} or {template_id}
    drafted_fields      text[]      NOT NULL DEFAULT '{}',
    next_check_at       timestamptz,
    last_check_at       timestamptz,
    last_check_status   text,
    last_check_findings integer,
    created_by          text        NOT NULL,
    created_at          timestamptz NOT NULL,
    updated_at          timestamptz NOT NULL
);
CREATE INDEX monitors_due ON core.monitors (next_check_at) WHERE status = 'live';

CREATE TABLE core.monitor_versions (
    monitor_id   text        NOT NULL REFERENCES core.monitors ON DELETE CASCADE,
    version      integer     NOT NULL,
    spec         jsonb       NOT NULL,
    status       text        NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'superseded')),
    note         text,                             -- the change note, or the approver's request for changes
    created_by   text        NOT NULL,
    created_at   timestamptz NOT NULL,
    submitted_by text,
    submitted_at timestamptz,
    approved_by  text,
    approved_at  timestamptz,
    PRIMARY KEY (monitor_id, version)
);

CREATE TABLE signals.monitor_runs (
    run_id         text PRIMARY KEY,
    monitor_id     text        NOT NULL REFERENCES core.monitors ON DELETE CASCADE,
    version        integer     NOT NULL,
    institution_id text        NOT NULL,
    world          text        NOT NULL DEFAULT 'live',   -- sandbox: a test run of a draft
    trigger        text        NOT NULL CHECK (trigger IN ('tick', 'now', 'test')),
    window_since   timestamptz NOT NULL,
    window_until   timestamptz NOT NULL,
    status         text        NOT NULL CHECK (status IN ('running', 'completed', 'stopped_early', 'failed')),
    request        jsonb       NOT NULL,
    result         jsonb,
    findings       integer,
    error          text,
    reposts        integer     NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL,
    finished_at    timestamptz,
    next_poll_at   timestamptz
);
CREATE INDEX monitor_runs_open ON signals.monitor_runs (next_poll_at) WHERE status = 'running';
CREATE INDEX monitor_runs_monitor ON signals.monitor_runs (monitor_id, created_at DESC);
