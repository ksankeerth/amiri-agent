-- The Scenario Studio: scenarios from templates, one
-- simulation at a time in the fixed world 'studio', its prices, monitor checks, agent runs,
-- the record for replay, and the timeline the run page shows.

CREATE SCHEMA studio;

CREATE TABLE studio.scenarios (
    scenario_id    text PRIMARY KEY,
    institution_id text        NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    template_id    text        NOT NULL,
    title          text        NOT NULL,
    intensity      text        NOT NULL DEFAULT 'medium' CHECK (intensity IN ('low', 'medium', 'high')),
    switched_off   text[]      NOT NULL DEFAULT '{}',   -- template parts turned off (headline or shock ids)
    version        integer     NOT NULL DEFAULT 1,      -- bumped on every change: a record is for one version
    created_by     text        NOT NULL,
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);

CREATE TABLE studio.simulations (
    sim_id           text PRIMARY KEY,
    scenario_id      text        NOT NULL REFERENCES studio.scenarios ON DELETE CASCADE,
    scenario_version integer     NOT NULL,
    institution_id   text        NOT NULL,
    mode             text        NOT NULL CHECK (mode IN ('live', 'record', 'replay')),
    status           text        NOT NULL CHECK (status IN ('running', 'waiting', 'finished', 'failed', 'stopped')),
    step             integer     NOT NULL DEFAULT 0,     -- steps done; the clock is start_at + step × step_hours
    steps            integer     NOT NULL,
    step_hours       integer     NOT NULL DEFAULT 24,
    start_at         timestamptz NOT NULL,               -- virtual
    virtual_now      timestamptz NOT NULL,
    built            jsonb       NOT NULL,               -- the scenario built for the institution (headlines, prices, monitor, expected)
    profile_version  integer,
    error            text,
    created_by       text        NOT NULL,
    created_at       timestamptz NOT NULL,               -- real
    finished_at      timestamptz                         -- real
);
CREATE UNIQUE INDEX simulations_one_running ON studio.simulations ((true)) WHERE status IN ('running', 'waiting');

CREATE TABLE studio.sim_bars (
    sim_id text        NOT NULL REFERENCES studio.simulations ON DELETE CASCADE,
    symbol text        NOT NULL,
    ts     timestamptz NOT NULL,                         -- virtual close time
    close  double precision NOT NULL,
    PRIMARY KEY (sim_id, symbol, ts)
);

CREATE TABLE studio.sim_checks (
    check_id     text PRIMARY KEY,                       -- chk-studio-<step>-<n>
    sim_id       text        NOT NULL REFERENCES studio.simulations ON DELETE CASCADE,
    step         integer     NOT NULL,
    monitor_key  text        NOT NULL,                   -- the template's monitor
    window_since timestamptz NOT NULL,
    window_until timestamptz NOT NULL,
    headlines    integer     NOT NULL,                   -- given to the agent (0: quiet, no call)
    status       text        NOT NULL CHECK (status IN ('running', 'completed', 'stopped_early', 'failed', 'quiet')),
    request      jsonb,
    result       jsonb,
    findings     integer,
    error        text
);

CREATE TABLE studio.agent_runs (                         -- every agent run a simulation started, in real time
    run_id       text PRIMARY KEY,
    sim_id       text        NOT NULL REFERENCES studio.simulations ON DELETE CASCADE,
    step         integer     NOT NULL,
    kind         text        NOT NULL CHECK (kind IN ('check', 'investigation')),
    ordinal      integer     NOT NULL,
    started_real timestamptz NOT NULL,
    done         boolean     NOT NULL DEFAULT false,
    replayed     boolean     NOT NULL DEFAULT false
);

CREATE TABLE studio.records (                            -- one recorded run of a scenario version
    scenario_id      text        NOT NULL REFERENCES studio.scenarios ON DELETE CASCADE,
    scenario_version integer     NOT NULL,
    complete         boolean     NOT NULL DEFAULT false,
    sim_id           text,
    recorded_at      timestamptz NOT NULL,
    PRIMARY KEY (scenario_id, scenario_version)
);

CREATE TABLE studio.record_calls (                       -- an agent's result, by position
    scenario_id      text        NOT NULL,
    scenario_version integer     NOT NULL,
    step             integer     NOT NULL,
    kind             text        NOT NULL CHECK (kind IN ('check', 'investigation')),
    ordinal          integer     NOT NULL,
    fingerprint      text        NOT NULL,               -- of the request; a mismatch on replay only warns
    run_id           text        NOT NULL,               -- as recorded (ids in the result are rewritten on replay)
    result           jsonb       NOT NULL,               -- the agent's whole status answer
    PRIMARY KEY (scenario_id, scenario_version, step, kind, ordinal),
    FOREIGN KEY (scenario_id, scenario_version) REFERENCES studio.records ON DELETE CASCADE
);

CREATE TABLE studio.timeline (
    seq    bigserial PRIMARY KEY,
    sim_id text        NOT NULL REFERENCES studio.simulations ON DELETE CASCADE,
    step   integer     NOT NULL,
    at     timestamptz NOT NULL,                         -- virtual
    kind   text        NOT NULL,                         -- headline, price, check, finding, investigation, event, development, note
    ref    text,
    data   jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX timeline_sim ON studio.timeline (sim_id, seq);

-- a simulation's investigations are started by its steps
ALTER TABLE cases.investigations DROP CONSTRAINT IF EXISTS investigations_trigger_check;
ALTER TABLE cases.investigations ADD CONSTRAINT investigations_trigger_check
    CHECK (trigger IN ('tick', 'now', 'extend', 'studio'));
