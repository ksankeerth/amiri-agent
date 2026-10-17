"""Sample institutions: a bank and an insurer that serve the Metrics Spec reference API.

They are shaped by a profile (the installation's own when it is of the sample's kind, otherwise a
bundled one): its products, home country, currency, time zone and customer groups. Their history
is synthetic and deterministic, with seasonality, holidays, publication lags, vintages and
suppression, plus a few switchable conditions (conditions.py). The connector checks them, the
validator reads them, and a bank's developers can look at them as a working example.
"""
