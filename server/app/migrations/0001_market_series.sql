-- Market series: the series Amiri Agent watches, their hourly bars, every call to the
-- price provider (fetch log and credit accounting), and findings.
-- Plain Postgres 16; runs unchanged on AlloyDB and Cloud SQL.

CREATE SCHEMA IF NOT EXISTS signals;

CREATE TABLE signals.series (
    series_id              text PRIMARY KEY,
    world                  text        NOT NULL DEFAULT 'live',
    provider               text        NOT NULL DEFAULT 'twelvedata',
    symbol                 text        NOT NULL,
    interval               text        NOT NULL DEFAULT '1h' CHECK (interval IN ('1h')),
    name                   text        NOT NULL,
    instrument             jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- type, exchange, currencies, time zone
    theme                  jsonb,                                     -- {theme, direction_up, direction_down}
    places                 text[]      NOT NULL DEFAULT '{}',
    detector               jsonb       NOT NULL,                      -- z_threshold, sigma_days, windows_days, cooldown_hours, stale_after_hours
    enabled                boolean     NOT NULL DEFAULT true,
    next_fetch_at          timestamptz,                               -- the hourly schedule
    fetch_started_at       timestamptz,                               -- lease: a fetch is running
    last_fetch_at          timestamptz,
    last_fetch_status      text CHECK (last_fetch_status IN ('ok', 'no_new_data', 'error')),
    last_fetch_error       jsonb,                                     -- {code, message, http_status, at}, as raised
    last_manual_refresh_at timestamptz,
    detection              jsonb,                                     -- latest evaluation (z per window, typical move)
    last_finding_id        text,
    last_finding_at        timestamptz,
    created_at             timestamptz NOT NULL,
    updated_at             timestamptz NOT NULL,
    version                integer     NOT NULL DEFAULT 1,
    UNIQUE (world, provider, symbol, interval)
);
CREATE INDEX series_due ON signals.series (next_fetch_at) WHERE enabled;

CREATE TABLE signals.price_bars (
    series_id  text        NOT NULL REFERENCES signals.series ON DELETE CASCADE,
    interval   text        NOT NULL,
    ts         timestamptz NOT NULL,          -- bar start, UTC; only closed bars are stored
    open       numeric     NOT NULL,
    high       numeric     NOT NULL,
    low        numeric     NOT NULL,
    close      numeric     NOT NULL,
    volume     numeric,
    fetched_at timestamptz NOT NULL,
    PRIMARY KEY (series_id, interval, ts)
);

-- Every provider call, also for series since deleted: the fetch log and the
-- credit budget (no foreign key on purpose).
CREATE TABLE signals.provider_calls (
    call_id       bigserial PRIMARY KEY,
    provider      text        NOT NULL,
    endpoint      text        NOT NULL,       -- time_series | symbol_search
    series_id     text,
    trigger       text        NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'backfill', 'lookup')),
    at            timestamptz NOT NULL,
    finished_at   timestamptz,
    status        text        NOT NULL CHECK (status IN ('started', 'ok', 'no_new_data', 'error')),
    credits       integer     NOT NULL DEFAULT 1,
    http_status   integer,
    error_code    text,
    error_message text,
    bars_received integer,
    bars_new      integer,
    duration_ms   integer
);
CREATE INDEX provider_calls_at ON signals.provider_calls (provider, at);
CREATE INDEX provider_calls_series ON signals.provider_calls (series_id, at DESC);

-- Findings from every source (time-series now; Radar and monitors later).
CREATE TABLE signals.findings (
    finding_id     text PRIMARY KEY,
    world          text        NOT NULL DEFAULT 'live',
    institution_id text        NOT NULL,
    source         text        NOT NULL CHECK (source IN ('timeseries', 'radar', 'monitor')),
    source_ref     jsonb       NOT NULL,
    kind           text        NOT NULL,
    title          text        NOT NULL,
    explanation    text        NOT NULL,
    score          integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
    themes         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    effective_from date,
    period         jsonb,
    places         text[]      NOT NULL DEFAULT '{}',
    evidence       jsonb       NOT NULL,
    status         text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'grouped', 'linked')),
    created_at     timestamptz NOT NULL
);
CREATE INDEX findings_series ON signals.findings ((source_ref ->> 'series_id'), created_at DESC)
    WHERE source = 'timeseries';
CREATE INDEX findings_new ON signals.findings (institution_id, created_at) WHERE status = 'new';
