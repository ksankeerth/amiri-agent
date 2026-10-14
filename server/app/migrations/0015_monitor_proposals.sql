-- The setup agent's monitors track: a proposal of monitors.
ALTER TABLE assistant.proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE assistant.proposals ADD CONSTRAINT proposals_kind_check CHECK (kind IN ('profile', 'create_institution', 'monitors'));
