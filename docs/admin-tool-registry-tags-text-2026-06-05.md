# Admin Tool Registry Tags Capacity

Date: 2026-06-05

## Problem

`admin_platform_endpoint_tools.tags` was `VARCHAR(255)`. The connected execution enqueue tool now needs complete governance metadata for preflight, read-only execution, budgeting, output redaction, and explicit no-write/no-secret guarantees.

The row for `connected_execution_resume_action_enqueue_dry_run` was truncated after `no_provider_call,`, hiding the remaining guardrail tags.

## Change

Migration `196_sprint66_admin_tool_registry_tags_text.sql` widens the column:

```sql
ALTER TABLE admin_platform_endpoint_tools
  MODIFY COLUMN tags TEXT NULL;
```

It then rewrites the connected execution enqueue tool tags with the full intended value.

## Safety

- Non-destructive widening change.
- No rows are deleted.
- No secrets are introduced.
- The preflight allow rule is scoped only to `admin_platform_endpoint_tools.tags` widening to `TEXT`.
- Other `ALTER TABLE` statements remain review-gated.

## Readback expectation

After apply:

```text
data_type: text
tags include:
  no_local_device_call
  no_apply
  no_secrets
```
