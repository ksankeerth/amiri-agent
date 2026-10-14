-- fx themes name the currency that moved: home_weaker/home_stronger
-- become weaker/stronger with the currency; the side of the pair that was the home currency.

UPDATE signals.series SET theme = jsonb_build_object(
    'theme', 'fx',
    'direction_up', CASE WHEN theme ->> 'direction_up' = 'home_weaker' THEN 'weaker' ELSE 'stronger' END,
    'direction_down', CASE WHEN theme ->> 'direction_up' = 'home_weaker' THEN 'stronger' ELSE 'weaker' END,
    'currency', CASE WHEN theme ->> 'direction_up' = 'home_weaker' THEN split_part(symbol, '/', 2)
                     ELSE split_part(symbol, '/', 1) END)
WHERE theme ->> 'theme' = 'fx' AND theme ->> 'direction_up' IN ('home_weaker', 'home_stronger');
