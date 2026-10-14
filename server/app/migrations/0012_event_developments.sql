-- Events stay open while their story continues; a later finding about the same move joins
-- the open event as a development instead of starting a new investigation.

ALTER TABLE cases.events ADD COLUMN open_until timestamptz;
ALTER TABLE cases.events ADD COLUMN closed_at timestamptz;
UPDATE cases.events SET open_until = created_at + interval '14 days' WHERE open_until IS NULL;
ALTER TABLE cases.events ALTER COLUMN open_until SET NOT NULL;

CREATE TABLE cases.event_developments (
    finding_id   text PRIMARY KEY,
    event_id     text        NOT NULL REFERENCES cases.events ON DELETE CASCADE,
    joined_at    timestamptz NOT NULL,
    linked_by    text        NOT NULL CHECK (linked_by IN ('rule', 'radar')),
    reason       text        NOT NULL
);
CREATE INDEX event_developments_event ON cases.event_developments (event_id, joined_at);
