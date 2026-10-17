-- The institution's data connection (one per installation) and the connector's reports. Platform
-- settings: a prototype reset keeps them.
CREATE TABLE ops.data_connection (
    id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    source             text NOT NULL CHECK (source IN ('sample', 'url')),
    sample             text CHECK (sample IN ('bank', 'insurer')),
    base_url           text,
    openapi_url        text,
    auth_header        text,
    auth_value         bytea,        -- encrypted with DATA_SECRET_KEY; never returned
    approved_check_id  text,
    approved_at        timestamptz,
    approved_by        text,
    validation_enabled boolean NOT NULL DEFAULT false,
    version            integer NOT NULL DEFAULT 1,   -- +1 on every change: a check is of one version
    updated_at         timestamptz,
    updated_by         text
);

CREATE TABLE ops.data_checks (
    check_id        text PRIMARY KEY,
    seq             bigint GENERATED ALWAYS AS IDENTITY,
    connection_version integer,
    started_at      timestamptz NOT NULL,
    finished_at     timestamptz,
    status          text NOT NULL CHECK (status IN ('ready', 'ready_with_gaps', 'not_ready')),
    target          text NOT NULL,
    server_version  text,
    report          jsonb NOT NULL,
    run_by          text
);
CREATE INDEX data_checks_seq ON ops.data_checks (seq DESC);
