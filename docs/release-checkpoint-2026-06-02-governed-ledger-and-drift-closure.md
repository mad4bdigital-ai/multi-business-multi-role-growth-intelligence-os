# Release Checkpoint — Governed Ledger and Drift Closure

Date: 2026-06-02
Environment: production (`auth.mad4b.com`)

## Status

The platform release-readiness baseline is green after closing schema, engine, and admin-tool registry drift.

Latest verified readiness before this checkpoint work:

- `release_readiness` run: `d8f65b85-aaac-4735-a2ed-02f0434325de`
- Overall: `pass`
- Summary: `63 pass / 0 warn / 0 fail`
- Migration drift actionable missing total: `0`
- Migration apply preflight status: `pass`
- Migration apply preflight risk count: `0`

## Merged changes

The stabilization sequence added:

- dynamic migration drift classification
- route-aware admin tool registry exposure classification
- governed migration runner allowlist for approved migrations
- SQL splitter fixes for inter-statement comments and `UPDATE` boundaries
- governed migration ledger table
- record-only ledger backfill mode

## Governed migration ledger baseline

`governed_migration_ledger` is now active.

Expected baseline coverage:

| Migration | Expected mode |
| --- | --- |
| `051_sprint48_cloudflare_and_self_repair_tools.sql` | `record_only` |
| `052_sprint49_local_connector_install_bundle.sql` | `record_only` |
| `054_sprint50_admin_device_seed_and_self_repair_tool.sql` | `record_only` |
| `055_sprint51_sql_primary_data_source.sql` | `record_only` |
| `057_sprint53_admin_session_turn_tools.sql` | `record_only` |
| `162_sprint66_cms_site_resource_access_grants.sql` | `record_only` |
| `163_sprint65_session_archive_smoke_tool.sql` | `record_only` |
| `166_sprint65_ai_intelligence_runtime_governance.sql` | `record_only` |
| `168_sprint65_database_table_lifecycle_governance.sql` | `record_only` |
| `176_sprint66_governed_migration_ledger.sql` | `apply` |

Record-only entries are historical evidence. They do not re-run SQL.

## Authority decision

SQL is the runtime authority.

Google Sheets is not required for runtime release readiness. Sheets may remain as an async mirror, legacy diagnostic, or recovery helper, but failure of `governance_execution_log_sheets_recovery` is not a release blocker while SQL authority is healthy.

`governance_execution_log_sheets_recovery` is therefore classified as a legacy/non-required diagnostic surface for this checkpoint.

## Admin tool registry smoke baseline

Release readiness now performs a read-only registry smoke check for required admin tool surfaces restored during this stabilization pass. The check verifies registry presence, enabled state, and method/path metadata only; it does not dispatch high-risk tools.

Required smoke tools:

- `admin_cloudflare`
- `admin_connector_activate`
- `gpt_session_end`
- `gpt_session_turn_write`
- `local_connector_install_bundle`
- `local_connector_self_repair`
- `platform_data_source_census`
- `platform_self_repair_diagnose`
- `release_session_archive_smoke`

`governance_execution_log_sheets_recovery` is intentionally excluded from the required smoke list and remains classified as `legacy_non_required_diagnostic`.

## Remaining raw drift

`activation_sheets_bootstrap_read` remains a raw migration artifact from older registry history, but it is satisfied by the system-layer replacement surface:

- classification: `system_layer_replacement_present`
- actionable drift: `0`

Do not reseed it into `admin_platform_endpoint_tools` unless a future compatibility review proves a direct registry alias is still required.

## Safety notes

- No destructive SQL was applied.
- Historical ledger backfill used record-only mode.
- Record-only mode sets `applies_sql: false`.
- JSON payloads are stored as regular `JSON.stringify(...)` placeholder values.
- Do not use `CAST(? AS JSON)` for MariaDB JSON writes.

## Next recommended work

1. Keep `governed_migration_ledger` visible in `release_readiness`.
2. Add optional read-only smoke for high-risk admin tools using metadata or dry-run surfaces only.
3. Avoid further reseed/migration work while readiness is green unless a new actionable gap appears.
