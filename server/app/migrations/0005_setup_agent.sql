-- The setup agent: one chat thread per
-- institution, sessions with the context pack the agent started from, tracks, and
-- proposals tagged with their track (and the create-institution kind). Replaces 0004's
-- tables (prototype: no data to keep).

DROP TABLE IF EXISTS assistant.proposals, assistant.messages, assistant.sessions CASCADE;

CREATE TABLE assistant.threads (
    thread_id      text PRIMARY KEY,
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,  -- null until the institution exists
    owner_user     text NOT NULL,                                         -- who started it
    current_track  text,
    summary        text,                                                  -- running summary of earlier sessions (the agent writes it)
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX threads_institution ON assistant.threads (institution_id) WHERE institution_id IS NOT NULL;
CREATE UNIQUE INDEX threads_pre_institution ON assistant.threads (owner_user) WHERE institution_id IS NULL;

CREATE TABLE assistant.sessions (
    session_id          text PRIMARY KEY,
    thread_id           text NOT NULL REFERENCES assistant.threads ON DELETE CASCADE,
    user_id             text NOT NULL,
    agent_session       text,                    -- the ADK session id, once connected
    context             jsonb NOT NULL,          -- the context pack the agent started from
    seen_profile_version integer,                -- the profile version the agent last saw
    started_at          timestamptz NOT NULL,
    last_active_at      timestamptz NOT NULL,
    ended_at            timestamptz
);
CREATE INDEX sessions_thread ON assistant.sessions (thread_id, started_at DESC);

CREATE TABLE assistant.messages (
    message_id bigserial PRIMARY KEY,
    thread_id  text NOT NULL REFERENCES assistant.threads ON DELETE CASCADE,
    session_id text REFERENCES assistant.sessions ON DELETE SET NULL,
    track      text,
    role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    kind       text NOT NULL CHECK (kind IN ('text', 'answer', 'question', 'proposal', 'track', 'track_concluded',
                                             'session', 'applied', 'error')),
    content    jsonb NOT NULL,
    at         timestamptz NOT NULL
);
CREATE INDEX messages_thread ON assistant.messages (thread_id, message_id);

CREATE TABLE assistant.track_state (
    thread_id  text REFERENCES assistant.threads ON DELETE CASCADE,
    track      text,
    status     text NOT NULL CHECK (status IN ('not_started', 'in_progress', 'concluded')),
    summary    text,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (thread_id, track)
);

CREATE TABLE assistant.proposals (
    proposal_id          text PRIMARY KEY,
    thread_id            text NOT NULL REFERENCES assistant.threads ON DELETE CASCADE,
    session_id           text REFERENCES assistant.sessions ON DELETE SET NULL,
    track                text NOT NULL,
    kind                 text NOT NULL CHECK (kind IN ('profile', 'create_institution')),
    institution_id       text REFERENCES core.institutions ON DELETE CASCADE,  -- null for create_institution
    created_by           text NOT NULL,
    on_behalf_of         text NOT NULL,
    summary              text NOT NULL,
    operations           jsonb NOT NULL DEFAULT '[]'::jsonb,
    institution          jsonb,                       -- create_institution: the institution's fields
    evidence             jsonb NOT NULL DEFAULT '[]'::jsonb,
    changes              jsonb NOT NULL,
    warnings             jsonb NOT NULL DEFAULT '[]'::jsonb,
    base_profile_version integer,
    status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')),
    decided_by           text,
    decided_at           timestamptz,
    result               jsonb,
    created_at           timestamptz NOT NULL
);
CREATE INDEX proposals_thread ON assistant.proposals (thread_id, created_at DESC);

-- Provenance: which proposal a profile change came from.
ALTER TABLE core.profile_changes ADD COLUMN IF NOT EXISTS proposal_id text;
