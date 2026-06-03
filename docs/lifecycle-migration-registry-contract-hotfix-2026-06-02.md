# Lifecycle Migration Registry Contract Hotfix

Date: 2026-06-02

## Purpose

This hotfix updates database lifecycle migrations `182` through `185` so they match the current admin tool registry contract.

## Problem

A governed apply of migration `182_sprint66_database_lifecycle_report_snapshots.sql` failed with:

```text
Unknown column 'method' in 'INSERT INTO'
```

The affected migrations were using legacy `admin_platform_endpoint_tools` column names:

```text
method
path
path_params_json
input_schema_json
output_schema_json
is_active
```

The current runtime table uses:

```text
http_method
http_path
path_param_keys
input_schema
fixed_body
is_enabled
```

## Additional issue

The migrations also inserted rows into `tool_policy_registry`, but that table is not present in the current runtime and no runtime code references it.

## Decision

The migrations now:

- use the current `admin_platform_endpoint_tools` column names
- keep the tool policy intent in admin tool tags
- remove `tool_policy_registry` inserts
- keep all SQL additive and idempotent

## Scope

Affected files:

```text
182_sprint66_database_lifecycle_report_snapshots.sql
183_sprint66_database_lifecycle_snapshot_schedule_readiness.sql
184_sprint66_database_lifecycle_scheduler_binding_readiness.sql
185_sprint66_database_lifecycle_scheduler_approval_metadata.sql
```

## Safety

- No destructive SQL.
- No `DROP`.
- No `DELETE`.
- No `TRUNCATE`.
- No `CAST(? AS JSON)`.
- No runtime behavior change.
- No API contract change.
- Governed migration runner remains the only apply path.

## Operational note

Migration `182` partially created idempotent schema objects before failing. Re-running the corrected migration is safe because the affected schema statements use `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE VIEW`.

After merge, apply migrations `182`, `183`, `184`, and `185` through the governed migration runner and verify `release_readiness` returns to pass.
