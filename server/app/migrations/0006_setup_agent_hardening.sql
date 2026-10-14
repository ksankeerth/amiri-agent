-- Hardening from the scenario review:
-- notes per track (facts mentioned before their track), one turn at a time per thread,
-- usage per session, and a second confirmation for proposals that delete 3+ items.

ALTER TABLE assistant.track_state ADD COLUMN notes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE assistant.threads ADD COLUMN turn_id text;
ALTER TABLE assistant.threads ADD COLUMN turn_started_at timestamptz;

ALTER TABLE assistant.sessions ADD COLUMN usage jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE assistant.proposals ADD COLUMN deletes integer NOT NULL DEFAULT 0;

ALTER TABLE assistant.messages DROP CONSTRAINT messages_kind_check;
ALTER TABLE assistant.messages ADD CONSTRAINT messages_kind_check CHECK (kind IN (
    'text', 'answer', 'question', 'proposal', 'track', 'track_concluded', 'notes', 'session', 'applied', 'error'));
CREATE INDEX messages_user_time ON assistant.messages (thread_id, at) WHERE role = 'user';
