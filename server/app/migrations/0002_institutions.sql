-- Institution profile: the institution, the items of its profile (one table for
-- every section, each item a validated JSON document), and every change.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE core.institutions (
    institution_id   text PRIMARY KEY,
    name             text        NOT NULL,
    institution_type text        NOT NULL CHECK (institution_type IN ('bank', 'insurer')),
    fields           jsonb       NOT NULL,          -- every field of InstitutionFields
    status           text        NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'archived')),
    version          integer     NOT NULL DEFAULT 1, -- the institution's own fields
    profile_version  integer     NOT NULL DEFAULT 1, -- any change to the institution or its profile
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    activated_at     timestamptz,
    archived_at      timestamptz
);

CREATE TABLE core.profile_items (
    institution_id text        NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    section        text        NOT NULL,
    item_id        text        NOT NULL,
    data           jsonb       NOT NULL,
    version        integer     NOT NULL DEFAULT 1,
    position       integer     NOT NULL DEFAULT 0,  -- order shown
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL,
    created_by     text,
    updated_by     text,
    PRIMARY KEY (institution_id, section, item_id)
);

CREATE TABLE core.profile_changes (
    change_id       bigserial PRIMARY KEY,
    institution_id  text        NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    profile_version integer     NOT NULL,
    at              timestamptz NOT NULL,
    actor           text        NOT NULL,
    source          text        NOT NULL,  -- form | assistant | setup | import | system
    batch_id        text        NOT NULL,
    section         text        NOT NULL,  -- institution | footprint | ...
    item_id         text,
    op              text        NOT NULL CHECK (op IN ('create', 'update', 'delete', 'status')),
    before          jsonb,
    after           jsonb
);
CREATE INDEX profile_changes_inst ON core.profile_changes (institution_id, change_id DESC);
