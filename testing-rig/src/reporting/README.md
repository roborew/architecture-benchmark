# Reporting (TODO: M5)

Generates the immutable `effective-config.yaml`, raw JSON/CSV, and HTML report
per run: per-op p50/p95/p99 (where sample sizes justify it), trial spread,
success/error/timeout counts, offered vs achieved throughput, request and SQL
statement counts. A generated report is a reproducible view over raw data,
never the only copy of results.
