-- Alerts are about risk only: no opportunity alerts. Favourable effects stay on the event.
DELETE FROM core.alerts WHERE level = 'opportunity';
ALTER TABLE core.alerts DROP CONSTRAINT alerts_level_check;
ALTER TABLE core.alerts ADD CONSTRAINT alerts_level_check CHECK (level IN ('warning', 'developing', 'adverse'));
