# Registry Export Schema Parity

## Purpose

`endpoints.schema_json` is the canonical runtime contract for provider endpoint execution. Active rows in `platform_endpoint_tool_exports` must keep `input_schema_json` synchronized with the referenced endpoint row.

A stale export schema can cause two unsafe outcomes:

- a successful provider response is misclassified as `response_schema_missing` or contract drift;
- a dispatcher exposes an older request or response contract than the SQL endpoint authority.

## Guard

Migration `1029_sprint69_registry_export_schema_parity_gate.sql` synchronizes active export schemas from their active canonical endpoint rows and creates the diagnostic view:

```sql
v_platform_endpoint_export_schema_parity
```

The view emits one row per active export with `schema_parity_status`:

- `pass`
- `missing_source_endpoint`
- `missing_endpoint_row`
- `endpoint_inactive`
- `endpoint_not_ready`
- `schema_mismatch`

A release or dispatcher expansion is not ready when any active export returns a status other than `pass`.

## Scope boundaries

The migration is metadata-only. It performs no provider call, credential payload read, raw-secret access, external send, external write, runtime dispatch, route registration, or public API shape change.

## Operational rule

Before adding or expanding a registry-driven dispatcher, verify:

```sql
SELECT COUNT(*)
FROM v_platform_endpoint_export_schema_parity
WHERE schema_parity_status <> 'pass';
```

The expected count is `0`.
