"""The institution's data: the import format (importfmt.py, IMPORT_FORMAT.md), the imported data served in-process
as the Metrics Spec reference API (imported.py, refapi.py), the one client that reads it (client.py), the connector
that checks it before it is trusted (checker.py, coverage.py), and the installation's connection with its reports
(service.py). The validator reads data through the same client, so what was checked is what runs."""
