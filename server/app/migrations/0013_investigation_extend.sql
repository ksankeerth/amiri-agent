-- A development that brings new themes to an open event starts an `extend` run, whose
-- hypotheses join that event. A run the agent lost (another instance, a restart) is sent
-- again, a few times, before it counts as failed.

ALTER TABLE cases.investigations ADD COLUMN extend_event_id text REFERENCES cases.events ON DELETE CASCADE;
ALTER TABLE cases.investigations ADD COLUMN reposts integer NOT NULL DEFAULT 0;
ALTER TABLE cases.investigations DROP CONSTRAINT IF EXISTS investigations_trigger_check;
ALTER TABLE cases.investigations ADD CONSTRAINT investigations_trigger_check CHECK (trigger IN ('tick', 'now', 'extend'));
