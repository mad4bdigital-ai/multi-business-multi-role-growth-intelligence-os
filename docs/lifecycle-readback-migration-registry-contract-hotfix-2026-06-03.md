# Lifecycle Readback Migration Registry Contract Hotfix

Date: 2026-06-03

## Purpose

This hotfix updates migration `186_sprint66_database_lifecycle_scheduler_approval_readback.sql` so it matches the current admin tool registry contract.

## Problem

A governed apply of migration `186` failed with:

```text
Unknown column 'method' in 'INSERT INTO'
```

The migration was using legacy `admin_platform_endpoint_tools` column names:

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

The migration also attempted to insert into `tool_policy_registry`, which is not present in the current runtime.

## Decision

Migration `186` now:

- uses the current `admin_platform_endpoint_tools` columns
- keeps readback policy intent in admin tool tags
- removes the unused `tool_policy_registry` insert
- remains additive and idempotent

## Safety

- No destructive SQL.
- No `DROP`.
- No `DELETE`.
- No `TRUNCATE`.
- No `CAST(? AS JSON)`.
- No runtime behavior change.
- Governed migration runner remains the only production apply path.

## Operational note

After merge, apply migration `186` through the governed migration runner and verify `release_readiness` returns to pass.
