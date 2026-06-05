# Migration 193 Registry Schema Hotfix

Date: 2026-06-05

## Purpose

Migration `193_sprint66_connected_execution_read_only_tool_call_preflight.sql` initially attempted to update `admin_platform_endpoint_tools.updated_at`.

Production `admin_platform_endpoint_tools` does not have an `updated_at` column, so governed apply failed with:

```text
Unknown column 'updated_at' in 'SET'
```

## Change

This hotfix removes the `updated_at = CURRENT_TIMESTAMP` assignment from migration 193.

## Safety

- Migration 193 had not been applied successfully before this hotfix.
- No destructive SQL is introduced.
- The migration remains additive/idempotent: one certification upsert and one tool registry update.
- Behavior remains unchanged: connected execution `tool_call` is still preflight/evidence only and does not execute tools.
