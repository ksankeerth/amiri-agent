-- The validator's work on each task: every evaluation (the verdict, what it rests on, and the alert
-- lifecycle's memory), and when to look again. The institution's: a prototype reset wipes it.
CREATE TABLE cases.validation_evaluations (
    task_id          text        NOT NULL REFERENCES cases.validation_tasks ON DELETE CASCADE,
    task_hash        text        NOT NULL,
    as_of            date        NOT NULL,
    verdict          text        NOT NULL,
    final            boolean     NOT NULL,
    alert            text        NOT NULL,
    signal           text        NOT NULL,
    look_percentile  double precision,
    signature        text        NOT NULL,
    unchanged_since  date,
    result           jsonb       NOT NULL,
    computed_at      timestamptz NOT NULL,
    PRIMARY KEY (task_id, task_hash, as_of)
);

ALTER TABLE cases.validation_tasks
    ADD COLUMN next_check_after date,          -- null: due now
    ADD COLUMN stop_after       date,
    ADD COLUMN checked_at       timestamptz,
    ADD COLUMN verdict          text,          -- the latest
    ADD COLUMN final            boolean NOT NULL DEFAULT false;
CREATE INDEX validation_tasks_due ON cases.validation_tasks (status, next_check_after);
