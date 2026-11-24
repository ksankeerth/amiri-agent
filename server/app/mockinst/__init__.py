"""Sample institutions: a bank and an insurer whose data is generated, for the example import file.

They are shaped by a profile (the installation's own, otherwise a bundled demo one): its products, home country,
currency, time zone and customer groups. Their history is synthetic and deterministic, with seasonality, holidays,
publication lags, vintages and suppression, plus a few planted scenarios (conditions.py). export.py writes it in
the import format (GET /api/v1/data-connection:example); the tests import it to check the whole path.
"""
