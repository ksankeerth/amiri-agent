-- Alerts: what an event means for one team's products, for someone to
-- acknowledge. One per (event, owning team); early warnings now, verdicts later (0020: risk only).
CREATE TABLE core.alerts (
    alert_id        text PRIMARY KEY,
    institution_id  text        NOT NULL,
    event_id        text        NOT NULL REFERENCES cases.events ON DELETE CASCADE,
    owner           text        NOT NULL,
    level           text        NOT NULL CHECK (level IN ('warning', 'opportunity', 'developing', 'adverse')),
    title           text        NOT NULL,
    effects         jsonb       NOT NULL,          -- [{product_id, product, metric, metric_name, direction, adverse, …}]
    product_ids     text[]      NOT NULL DEFAULT '{}',
    hypothesis_ids  text[]      NOT NULL DEFAULT '{}',
    finding_ids     text[]      NOT NULL DEFAULT '{}',
    via_monitor     text,                          -- the monitor whose owner or also_notify routed it here
    status          text        NOT NULL CHECK (status IN ('new', 'acknowledged', 'resolved')),
    history         jsonb       NOT NULL,          -- [{at, change, text, by}]
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    acknowledged_by text,
    acknowledged_at timestamptz,
    ack_note        text,
    resolved_by     text,
    resolved_at     timestamptz,
    resolved_note   text,
    UNIQUE (event_id, owner)
);
CREATE INDEX alerts_open ON core.alerts (institution_id, status, updated_at DESC);
