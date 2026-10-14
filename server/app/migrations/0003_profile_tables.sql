-- Institution profile as relational tables.
-- Replaces 0002's one-JSON-table storage; the API is unchanged. Prototype: the old
-- tables are dropped (reload the demo with `uv run amiri seed-institution`).
--
-- ref:  shared reference data, loaded from server/app/reference by app/reference/load.py
-- core: one institution's profile. Links between items are tables with foreign keys:
--       RESTRICT where an item is pointed at (the API's in_use), CASCADE from the owner.
-- Short free-text lists (aliases, controls, income sources, months) are arrays.

DROP TABLE IF EXISTS core.profile_changes, core.profile_items, core.institutions CASCADE;

CREATE SCHEMA IF NOT EXISTS ref;

-- ---------------------------------------------------------------- reference

CREATE TABLE ref.meta (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE ref.places (
    place_code   text PRIMARY KEY,                 -- ISO 3166-1/-2, or chk: sea: port: city:
    kind         text NOT NULL,                    -- country, province, district, state, ..., chokepoint, sea, port, city
    name         text NOT NULL,
    parent_code  text REFERENCES ref.places DEFERRABLE INITIALLY DEFERRED,
    country_code text,
    lat          double precision,
    lon          double precision,
    iso          boolean NOT NULL
);
CREATE INDEX places_parent ON ref.places (parent_code);
CREATE INDEX places_country ON ref.places (country_code);

CREATE TABLE ref.place_aliases (
    place_code text REFERENCES ref.places ON DELETE CASCADE,
    alias      text,
    PRIMARY KEY (place_code, alias)
);

CREATE TABLE ref.currencies (currency_code text PRIMARY KEY, name text NOT NULL);

CREATE TABLE ref.product_categories (
    category_id      text PRIMARY KEY,
    institution_type text NOT NULL CHECK (institution_type IN ('bank', 'insurer')),
    name             text NOT NULL,
    UNIQUE (category_id, institution_type)
);

CREATE TABLE ref.product_types (
    product_type_id  text PRIMARY KEY,
    category_id      text NOT NULL REFERENCES ref.product_categories,
    typical_products text,
    islamic_variant  text,
    attribute_schema jsonb,                        -- JSON Schema of products.attributes (null: free)
    UNIQUE (product_type_id, category_id)
);

CREATE TABLE ref.spec_dimension_values (
    dimension text,
    value     text,
    PRIMARY KEY (dimension, value)
);

CREATE TABLE ref.segment_templates (
    template_id      text PRIMARY KEY,
    institution_type text NOT NULL CHECK (institution_type IN ('bank', 'insurer')),
    label            text NOT NULL,
    kind             text NOT NULL,
    note             text,
    income_sources   text[] NOT NULL DEFAULT '{}',
    spec_values      jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE ref.regulators (
    regulator_id text PRIMARY KEY,
    name         text NOT NULL,
    short        text,
    country_code text REFERENCES ref.places,      -- null: global standard or regime
    area         text NOT NULL,
    for_bank     boolean NOT NULL,
    for_insurer  boolean NOT NULL,
    islamic_only boolean NOT NULL DEFAULT false,
    controls     text[] NOT NULL DEFAULT '{}',
    reviewed     boolean NOT NULL DEFAULT false
);

CREATE TABLE ref.sanctions_regimes (
    currency_code text REFERENCES ref.currencies,
    regulator_id  text REFERENCES ref.regulators ON DELETE CASCADE,
    PRIMARY KEY (currency_code, regulator_id)
);

CREATE TABLE ref.flow_figures (
    figure_id         text PRIMARY KEY,
    kind              text NOT NULL,
    local_place       text NOT NULL REFERENCES ref.places,
    counterpart_place text NOT NULL REFERENCES ref.places,
    goods             text,
    amount_usd        numeric NOT NULL,
    year              integer NOT NULL,
    dataset           text NOT NULL,
    sample            boolean NOT NULL DEFAULT false
);

CREATE TABLE ref.routes (
    route_id text PRIMARY KEY,
    name     text NOT NULL,
    kind     text NOT NULL,
    points   jsonb NOT NULL                        -- [[lat, lon], ...]
);

CREATE TABLE ref.route_places (
    route_id   text REFERENCES ref.routes ON DELETE CASCADE,
    seq        integer,
    place_code text NOT NULL REFERENCES ref.places,
    PRIMARY KEY (route_id, seq)
);

CREATE TABLE ref.hazards (
    hazard_id  text PRIMARY KEY,
    kind       text NOT NULL,
    name       text NOT NULL,
    note       text,
    months     integer[] NOT NULL DEFAULT '{}',    -- empty: any time
    centre_lat double precision,
    centre_lon double precision,
    radius_km  double precision
);

CREATE TABLE ref.hazard_places (
    hazard_id  text REFERENCES ref.hazards ON DELETE CASCADE,
    place_code text REFERENCES ref.places,
    PRIMARY KEY (hazard_id, place_code)
);

-- ---------------------------------------------------------------- the institution

CREATE TABLE core.institutions (
    institution_id          text PRIMARY KEY,
    name                    text NOT NULL,
    legal_name              text,
    short_name              text,
    institution_type        text NOT NULL CHECK (institution_type IN ('bank', 'insurer')),
    subtype                 text,
    islamic                 boolean NOT NULL DEFAULT false,
    lei                     text,
    home_country            text NOT NULL REFERENCES ref.places,
    base_currency           text NOT NULL REFERENCES ref.currencies,
    time_zone               text NOT NULL,
    summary                 text,
    governance_body         text,
    size_band               text CHECK (size_band IN ('small', 'mid', 'large', 'systemic')),
    fiscal_year_start_month integer NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    website                 text,
    status                  text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'archived')),
    version                 integer NOT NULL DEFAULT 1,
    profile_version         integer NOT NULL DEFAULT 1,
    created_at              timestamptz NOT NULL,
    updated_at              timestamptz NOT NULL,
    activated_at            timestamptz,
    archived_at             timestamptz,
    UNIQUE (institution_id, institution_type),
    CHECK (subtype IS NULL OR
           (institution_type = 'bank' AND subtype IN ('commercial', 'savings', 'cooperative', 'development', 'islamic',
                                                      'microfinance', 'finance_company', 'digital', 'rural')) OR
           (institution_type = 'insurer' AND subtype IN ('life', 'general', 'composite', 'health', 'takaful', 'reinsurer', 'micro')))
);

CREATE TABLE core.institution_currencies (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    currency_code  text REFERENCES ref.currencies,
    role           text NOT NULL DEFAULT 'clearing' CHECK (role IN ('clearing')),
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, currency_code, role)
);

-- Every item table carries the same bookkeeping columns.
-- (institution_id, <item>_id) is the key; ids are slugs chosen by the API.

CREATE TABLE core.footprint (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    footprint_id   text,
    place_code     text NOT NULL REFERENCES ref.places,
    role           text NOT NULL CHECK (role IN ('home', 'branches', 'subsidiary', 'representative_office', 'agents', 'digital_only')),
    scope          text NOT NULL CHECK (scope IN ('all', 'part')),
    branch_count   integer CHECK (branch_count >= 0),
    note           text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, footprint_id),
    UNIQUE (institution_id, place_code)
);

CREATE TABLE core.watch_places (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    watch_place_id text,
    name           text NOT NULL,
    place_code     text REFERENCES ref.places,
    kind           text NOT NULL,
    reason         text,
    lat            double precision CHECK (lat BETWEEN -90 AND 90),
    lon            double precision CHECK (lon BETWEEN -180 AND 180),
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, watch_place_id),
    CHECK ((lat IS NULL) = (lon IS NULL))
);
CREATE UNIQUE INDEX watch_places_name ON core.watch_places (institution_id, lower(name));

CREATE TABLE core.segments (
    institution_id         text REFERENCES core.institutions ON DELETE CASCADE,
    segment_id             text,
    label                  text NOT NULL,
    kind                   text NOT NULL CHECK (kind IN ('individual', 'business', 'public_sector', 'financial', 'mixed')),
    note                   text,
    income_sources         text[] NOT NULL DEFAULT '{}',
    share_of_customers_pct numeric CHECK (share_of_customers_pct BETWEEN 0 AND 100),
    template_id            text REFERENCES ref.segment_templates,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, segment_id)
);
CREATE UNIQUE INDEX segments_label ON core.segments (institution_id, lower(label));

CREATE TABLE core.segment_places (
    institution_id text,
    segment_id     text,
    place_code     text REFERENCES ref.places,
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, segment_id, place_code),
    FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE CASCADE
);
CREATE INDEX segment_places_place ON core.segment_places (place_code);

-- A group's identity in the institution's data: Metrics Spec dimension values.
-- Enumerated dimensions are checked by the API against ref.spec_dimension_values;
-- ISO-coded ones (regions, corridors, currencies) against ref.places and ref.currencies.
CREATE TABLE core.segment_spec_values (
    institution_id text,
    segment_id     text,
    dimension      text,
    value          text,
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, segment_id, dimension, value),
    FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE CASCADE
);

CREATE TABLE core.products (
    institution_id     text,
    product_id         text,
    institution_type   text NOT NULL,              -- copied from the institution; ties categories to bank or insurer
    name               text NOT NULL,
    category_id        text NOT NULL,
    product_type_id    text NOT NULL,
    islamic            boolean NOT NULL DEFAULT false,
    owner              text,                       -- business unit, free text
    status             text NOT NULL CHECK (status IN ('active', 'launching', 'closing', 'closed')),
    launched_on        date,
    book_amount        numeric CHECK (book_amount >= 0),
    book_currency      text REFERENCES ref.currencies,
    book_as_of         date,
    data_source_id     text,
    catalog_product_id text,
    attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
    note               text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, product_id),
    -- the institution's type can't change while it has products of that type's categories
    FOREIGN KEY (institution_id, institution_type) REFERENCES core.institutions (institution_id, institution_type)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (category_id, institution_type) REFERENCES ref.product_categories (category_id, institution_type),
    FOREIGN KEY (product_type_id, category_id) REFERENCES ref.product_types (product_type_id, category_id),
    CHECK ((book_amount IS NULL) = (book_currency IS NULL))
);
CREATE UNIQUE INDEX products_name ON core.products (institution_id, lower(name));

CREATE TABLE core.product_currencies (
    institution_id text,
    product_id     text,
    currency_code  text REFERENCES ref.currencies,
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, product_id, currency_code),
    FOREIGN KEY (institution_id, product_id) REFERENCES core.products ON DELETE CASCADE
);

CREATE TABLE core.product_segments (                 -- who uses the product
    institution_id text,
    product_id     text,
    segment_id     text,
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, product_id, segment_id),
    FOREIGN KEY (institution_id, product_id) REFERENCES core.products ON DELETE CASCADE,
    FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE RESTRICT
);

CREATE TABLE core.flows (
    institution_id    text REFERENCES core.institutions ON DELETE CASCADE,
    flow_id           text,
    kind              text NOT NULL CHECK (kind IN ('remittances_in', 'remittances_out', 'tourism', 'services', 'exports', 'imports')),
    local_place       text NOT NULL REFERENCES ref.places,
    counterpart_place text NOT NULL REFERENCES ref.places,
    route_id          text REFERENCES ref.routes,
    label             text,
    goods             text,
    amount            numeric CHECK (amount >= 0),
    currency          text REFERENCES ref.currencies,
    year              integer CHECK (year BETWEEN 1990 AND 2100),
    source_kind       text NOT NULL CHECK (source_kind IN ('dataset', 'user', 'assistant')),
    figure_id         text REFERENCES ref.flow_figures ON DELETE SET NULL,
    dataset           text,
    dataset_year      integer,
    sample            boolean NOT NULL DEFAULT false,
    original_amount   numeric,
    edited_by         text,
    edited_at         text,
    status            text NOT NULL CHECK (status IN ('suggested', 'confirmed')),
    note              text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, flow_id),
    CHECK ((amount IS NULL) = (year IS NULL))
);
CREATE INDEX flows_counterpart ON core.flows (counterpart_place);

CREATE TABLE core.flow_segments (
    institution_id text,
    flow_id        text,
    segment_id     text,
    position       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, flow_id, segment_id),
    FOREIGN KEY (institution_id, flow_id) REFERENCES core.flows ON DELETE CASCADE,
    FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE RESTRICT
);

CREATE TABLE core.regulators (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    item_id        text,
    regulator_id   text REFERENCES ref.regulators,  -- set when it came from the rule table
    name           text NOT NULL,
    short          text,
    country_code   text REFERENCES ref.places,
    area           text NOT NULL,
    relation       text NOT NULL CHECK (relation IN ('home', 'host', 'reach', 'standard')),
    basis          text NOT NULL CHECK (basis IN ('rule', 'user')),
    rule_ref       text,
    controls       text[] NOT NULL DEFAULT '{}',
    note           text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, item_id)
);
CREATE UNIQUE INDEX regulators_name ON core.regulators (institution_id, lower(name));

CREATE TABLE core.rivals (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    rival_id       text,
    name           text NOT NULL,
    type           text NOT NULL,
    overlap        text NOT NULL CHECK (overlap IN ('high', 'medium', 'low')),
    aliases        text[] NOT NULL DEFAULT '{}',
    website        text,
    note           text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, rival_id)
);
CREATE UNIQUE INDEX rivals_name ON core.rivals (institution_id, lower(name));

CREATE TABLE core.rival_places (
    institution_id text, rival_id text, place_code text REFERENCES ref.places, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, rival_id, place_code),
    FOREIGN KEY (institution_id, rival_id) REFERENCES core.rivals ON DELETE CASCADE
);

CREATE TABLE core.rival_categories (
    institution_id text, rival_id text, category_id text REFERENCES ref.product_categories, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, rival_id, category_id),
    FOREIGN KEY (institution_id, rival_id) REFERENCES core.rivals ON DELETE CASCADE
);

CREATE TABLE core.counterparties (
    institution_id  text REFERENCES core.institutions ON DELETE CASCADE,
    counterparty_id text,
    name            text NOT NULL,
    kind            text NOT NULL,
    importance      text NOT NULL CHECK (importance IN ('critical', 'important', 'other')),
    aliases         text[] NOT NULL DEFAULT '{}',
    note            text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, counterparty_id)
);
CREATE UNIQUE INDEX counterparties_name ON core.counterparties (institution_id, lower(name));

CREATE TABLE core.counterparty_places (
    institution_id text, counterparty_id text, place_code text REFERENCES ref.places, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, counterparty_id, place_code),
    FOREIGN KEY (institution_id, counterparty_id) REFERENCES core.counterparties ON DELETE CASCADE
);

-- A known risk that meets something the institution depends on, and what it touches.
CREATE TABLE core.risk_exposures (
    institution_id text REFERENCES core.institutions ON DELETE CASCADE,
    exposure_id    text,
    title          text NOT NULL,
    hazard_id      text REFERENCES ref.hazards,     -- set when the risk finder proposed it
    kind           text NOT NULL,
    months         integer[] NOT NULL DEFAULT '{}',
    source         text NOT NULL CHECK (source IN ('finder', 'user', 'assistant')),
    status         text NOT NULL CHECK (status IN ('active', 'dismissed')),
    note           text,
    position integer NOT NULL DEFAULT 0, version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, created_by text, updated_by text,
    PRIMARY KEY (institution_id, exposure_id)
);
CREATE UNIQUE INDEX risk_exposures_title ON core.risk_exposures (institution_id, lower(title));
CREATE UNIQUE INDEX risk_exposures_hazard ON core.risk_exposures (institution_id, hazard_id) WHERE hazard_id IS NOT NULL;

CREATE TABLE core.exposure_places (
    institution_id text, exposure_id text, place_code text REFERENCES ref.places, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, place_code),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE
);
CREATE TABLE core.exposure_segments (
    institution_id text, exposure_id text, segment_id text, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, segment_id),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE,
    FOREIGN KEY (institution_id, segment_id) REFERENCES core.segments ON DELETE RESTRICT
);
CREATE TABLE core.exposure_products (
    institution_id text, exposure_id text, product_id text, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, product_id),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE,
    FOREIGN KEY (institution_id, product_id) REFERENCES core.products ON DELETE RESTRICT
);
CREATE TABLE core.exposure_flows (
    institution_id text, exposure_id text, flow_id text, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, flow_id),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE,
    FOREIGN KEY (institution_id, flow_id) REFERENCES core.flows ON DELETE RESTRICT
);
CREATE TABLE core.exposure_routes (
    institution_id text, exposure_id text, route_id text REFERENCES ref.routes, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, route_id),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE
);
CREATE TABLE core.exposure_watch_places (
    institution_id text, exposure_id text, watch_place_id text, position integer NOT NULL DEFAULT 0,
    PRIMARY KEY (institution_id, exposure_id, watch_place_id),
    FOREIGN KEY (institution_id, exposure_id) REFERENCES core.risk_exposures ON DELETE CASCADE,
    FOREIGN KEY (institution_id, watch_place_id) REFERENCES core.watch_places ON DELETE RESTRICT
);

CREATE TABLE core.profile_changes (
    change_id       bigserial PRIMARY KEY,
    institution_id  text        NOT NULL REFERENCES core.institutions ON DELETE CASCADE,
    profile_version integer     NOT NULL,
    at              timestamptz NOT NULL,
    actor           text        NOT NULL,
    source          text        NOT NULL,
    batch_id        text        NOT NULL,
    section         text        NOT NULL,
    item_id         text,
    op              text        NOT NULL CHECK (op IN ('create', 'update', 'delete', 'status')),
    before          jsonb,
    after           jsonb
);
CREATE INDEX profile_changes_inst ON core.profile_changes (institution_id, change_id DESC);
