-- The assistant's side of the server: chat sessions, their transcript, and proposals
-- (changes the assistant suggests; nothing changes until the user confirms).
-- The agent itself (amiri-assistant, Google ADK) keeps its own session state; these
-- tables are what the web app shows and what the audit needs.

CREATE SCHEMA IF NOT EXISTS assistant;

CREATE TABLE assistant.sessions (
    session_id     text PRIMARY KEY,
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,   -- null: before the institution exists
    user_id        text NOT NULL,                                          -- the signed-in person (IAP email later)
    mode           text NOT NULL CHECK (mode IN ('setup', 'ongoing')),
    status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    agent_session  text,                                                   -- the ADK session id, once connected
    created_at     timestamptz NOT NULL,
    updated_at     timestamptz NOT NULL
);
CREATE INDEX sessions_user ON assistant.sessions (user_id, updated_at DESC);

CREATE TABLE assistant.messages (
    message_id bigserial PRIMARY KEY,
    session_id text NOT NULL REFERENCES assistant.sessions ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    kind       text NOT NULL CHECK (kind IN ('text', 'answer', 'question', 'proposal', 'state', 'error')),
    content    jsonb NOT NULL,
    at         timestamptz NOT NULL
);
CREATE INDEX messages_session ON assistant.messages (session_id, message_id);

CREATE TABLE assistant.proposals (
    proposal_id           text PRIMARY KEY,
    institution_id        text NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    session_id            text REFERENCES assistant.sessions ON DELETE SET NULL,
    created_by            text NOT NULL,          -- "assistant"
    on_behalf_of          text NOT NULL,          -- the user it is for; only they confirm
    summary               text NOT NULL,
    operations            jsonb NOT NULL,         -- the :batch operations to apply
    changes               jsonb NOT NULL,         -- the dry run's diff, shown on the card
    warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
    base_profile_version  integer NOT NULL,
    status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired', 'failed')),
    decided_by            text,
    decided_at            timestamptz,
    result                jsonb,                  -- the applied batch, or the error
    created_at            timestamptz NOT NULL
);
CREATE INDEX proposals_inst ON assistant.proposals (institution_id, status, created_at DESC);
