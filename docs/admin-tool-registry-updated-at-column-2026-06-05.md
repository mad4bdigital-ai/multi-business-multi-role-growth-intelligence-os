# Admin Tool Registry `updated_at` Column

Date: 2026-06-05

## Purpose

`admin_platform_endpoint_tools.updated_at` records operational freshness for tool registry rows. It is useful when migrations, registry repairs, or governance updates change descriptions, tags, fixed bodies, paths, or enablement state.

## Migration

Migration `194_sprint66_admin_tool_registry_updated_at_column.sql` ensures the column exists:

```sql
ALTER TABLE admin_platform_endpoint_tools
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
```

## Safety

- Additive schema change only.
- Idempotent when the column already exists.
- No destructive SQL.
- No secret values.
- Existing rows keep their current data and receive normal timestamp behavior on future updates.

## Operational use

Future registry updates can rely on `updated_at` for readback freshness, drift diagnosis, and admin audit summaries.
