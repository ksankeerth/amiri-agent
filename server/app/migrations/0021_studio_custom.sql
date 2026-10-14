-- A scenario's own edits: its headline list (edited, added, removed) and, for a blank
-- scenario, its price move. Empty: the template as written.
ALTER TABLE studio.scenarios ADD COLUMN custom jsonb NOT NULL DEFAULT '{}';
