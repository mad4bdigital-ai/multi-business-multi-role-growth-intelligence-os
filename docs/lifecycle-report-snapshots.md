# Lifecycle report snapshots

## Purpose

`platform_lifecycle_report_snapshots` stores bounded historical snapshots of database lifecycle reporting views. This makes growth, placeholder, credential, high-risk, and backup snapshot trends auditable without executing cleanup or archive workflows.

## Scope

Snapshot creation is evidence-only.

It does not:

- drop, truncate, delete, or archive database tables
- run cleanup jobs
- mutate lifecycle registry rows
- perform external writes
- read or return secrets

## Source views

Snapshots are built from the read-only lifecycle reporting views:

- `v_database_lifecycle_status_summary`
- `v_database_lifecycle_owner_coverage`
- `v_database_lifecycle_growth_hotspots`
- `v_database_lifecycle_placeholder_review`
- `v_database_lifecycle_high_risk_review`
- `v_database_lifecycle_credential_review`
- `v_database_lifecycle_backup_snapshot_review`

## Table

`platform_lifecycle_report_snapshots` stores:

- `snapshot_id`
- `report_key`
- `report_scope`
- status
- `summary_json`
- `snapshot_json`
- `source_views_json`
- trace/actor/tenant metadata
- timestamp

## Admin tools

### `database_lifecycle_report_snapshot_create`

Creates a bounded snapshot from the source views.

### `database_lifecycle_report_snapshots`

Lists stored snapshots without returning large full payloads.

## Operating model

1. Lifecycle views expose current state.
2. Snapshot tool records bounded evidence for trend review.
3. Operators compare snapshots over time.
4. Archive/delete proposals remain separate approval-gated workflows.

## Safety rules

- Snapshot reports are decision support, not cleanup execution.
- Credential reports must remain metadata-only.
- Backup snapshot reports must not imply archive approval.
- Placeholder reductions must be owner/roadmap/policy decisions, not automatic deletion.
