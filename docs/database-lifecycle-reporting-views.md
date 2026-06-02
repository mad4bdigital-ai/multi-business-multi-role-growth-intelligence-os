# Database lifecycle reporting views

## Purpose

The database lifecycle registry records ownership, usage status, retention, and risk metadata for runtime tables. The reporting views in migration `172_sprint65_database_lifecycle_reporting_views.sql` provide read-only operational summaries for the AI Intelligence Runtime & Governance Layer.

## Scope

These views are visibility surfaces only. They do not drop, truncate, delete, archive, or mutate application tables.

## Views

### `v_database_lifecycle_status_summary`
Summarizes table counts and size by `usage_status` and `risk_level`.

### `v_database_lifecycle_owner_coverage`
Shows how many tables each owner engine covers, including high-risk, unclassified, and placeholder counts.

### `v_database_lifecycle_growth_hotspots`
Lists large or high-row-count tables that need growth monitoring.

### `v_database_lifecycle_placeholder_review`
Lists tables marked as `planned_placeholder` so owners can decide whether to keep, link to roadmap, or propose archive candidacy.

### `v_database_lifecycle_high_risk_review`
Lists high-risk tables across all families for periodic review.

### `v_database_lifecycle_credential_review`
Lists credential/secret/token-related lifecycle entries without exposing secret values.

### `v_database_lifecycle_backup_snapshot_review`
Lists backup and repair snapshot tables for retention review.

## Retention plan CLI

`http-generic-api/scripts/database-lifecycle-retention-plan.mjs` reads the
lifecycle registry and emits a dry-run retention/growth action plan for
hotspots, backup snapshots, placeholders, and high-risk rows.

The plan is review-only:

- it does not write to the database;
- it does not drop, truncate, or delete tables;
- it does not execute archive or compaction work;
- every generated action has `execution_allowed = false`.

Execution requires a future, separate governed runner with approval, validator,
readback, and audit evidence gates.

## Operating rules

- Treat all reports as decision support, not automatic action.
- Archive or deletion proposals require separate approval-gated workflows.
- Credential-related rows must never expose secret values.
- Placeholder tables should become either owned runtime tables, roadmap-linked placeholders, or explicitly reviewed archive candidates.

## Related surfaces

- `database_table_lifecycle_registry`
- `database_table_lifecycle_engine`
- `database_table_lifecycle_decision_brief`
- `database_table_lifecycle_register_plan`
