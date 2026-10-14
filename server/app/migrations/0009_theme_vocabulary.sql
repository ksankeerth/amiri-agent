-- Series themes move to the shared vocabulary:
-- Metrics Spec theme ids, Amiri Agent's neutral directions. FX follows the institution's base currency;
-- a pair without it gets no theme. Findings already written keep their words.

UPDATE signals.series s SET theme = CASE
    WHEN theme ->> 'theme' IN ('gold_price', 'gold')
        THEN '{"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "gold"}'::jsonb
    WHEN theme ->> 'theme' = 'oil_price'
        THEN '{"theme": "commodities", "direction_up": "up", "direction_down": "down", "item": "oil"}'::jsonb
    WHEN theme ->> 'theme' = 'interest_rate'
        THEN '{"theme": "rates", "direction_up": "up", "direction_down": "down"}'::jsonb
    WHEN theme ->> 'theme' = 'fx' AND split_part(symbol, '/', 2) IN (SELECT base_currency FROM core.institutions)
        THEN '{"theme": "fx", "direction_up": "home_weaker", "direction_down": "home_stronger"}'::jsonb
    WHEN theme ->> 'theme' = 'fx' AND split_part(symbol, '/', 1) IN (SELECT base_currency FROM core.institutions)
        THEN '{"theme": "fx", "direction_up": "home_stronger", "direction_down": "home_weaker"}'::jsonb
    ELSE NULL
END
WHERE theme IS NOT NULL
  AND theme ->> 'direction_up' IN ('depreciation', 'appreciation', 'rise', 'fall');
