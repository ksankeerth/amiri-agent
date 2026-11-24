-- The institution's data comes from an imported JSON file only (amiri-institution-data/1): no address, key or
-- sample institution any more. The file is kept as one header row (catalog, calendar, breaks, what it covers)
-- and one row per series (its rows as jsonb), so serving a request reads one indexed series, never the whole
-- file. A connection that pointed at a sample or an address reads as not configured, and its checks go with it.
-- Written to run again safely on a table still in the 0023 shape (tests/test_import.py does that).

DELETE FROM ops.data_checks;
DELETE FROM ops.data_connection WHERE source IS DISTINCT FROM 'imported';
ALTER TABLE ops.data_connection DROP CONSTRAINT IF EXISTS data_connection_source_check;
ALTER TABLE ops.data_connection
    DROP COLUMN IF EXISTS sample,
    DROP COLUMN IF EXISTS base_url,
    DROP COLUMN IF EXISTS openapi_url,
    DROP COLUMN IF EXISTS auth_header,
    DROP COLUMN IF EXISTS auth_value;
ALTER TABLE ops.data_connection ADD CONSTRAINT data_connection_source_check CHECK (source = 'imported');

DROP TABLE IF EXISTS ops.mock_institutions;

CREATE TABLE IF NOT EXISTS ops.imported_data (
    id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    file_name    text,
    bytes        bigint NOT NULL,
    sha256       text NOT NULL,
    as_of        date NOT NULL,          -- the last day the data covers
    about        text,
    catalog      jsonb NOT NULL,         -- served as GET /catalog (filter_sets filled in from the series)
    calendar     jsonb NOT NULL,         -- the primary calendar, served by GET /calendar
    breaks       jsonb NOT NULL,
    summary      jsonb NOT NULL,         -- products, metrics, series, rows, date range
    imported_at  timestamptz NOT NULL,
    imported_by  text
);

CREATE TABLE IF NOT EXISTS ops.imported_series (
    series_key  text PRIMARY KEY,        -- product/metric?dim=value&… (dimensions sorted)
    product_id  text NOT NULL,
    metric      text NOT NULL,
    filter      jsonb NOT NULL,
    currency    text,
    rows        jsonb NOT NULL           -- oldest first, as in the file
);
