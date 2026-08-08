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

## Post-dispatch schema drift safety

Schema parity remains mandatory, but runtime safety cannot depend on registry/export metadata always being fresh.

For safe read methods (`GET`, `HEAD`, `OPTIONS`), strict response-schema enforcement keeps the existing validation behavior. A missing or mismatched response schema may still return the schema-validation failure because retrying a read does not repeat an external mutation.

For a potentially mutating method after the provider has already returned a successful 2xx response, response-schema drift is a post-side-effect uncertainty boundary. The runtime must not present that condition as an ordinary retry-safe `422` failure. Instead it returns `409 UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED` and records evidence that:

- the provider success was observed and its upstream HTTP status is preserved;
- `outcome_classification=unknown_outcome`;
- `reconciliation_required=true`;
- `retry_allowed=false`;
- `automatic_retry_performed=false`;
- the original schema error (`response_schema_missing` or `response_schema_mismatch`) and drift diagnostics remain visible;
- no credential or secret material is added to the diagnostic payload.

The universal execution-log writer maps the `unknown_outcome` status source to the existing generic stored status `unknown`; the precise reconciliation classification remains in the structured error/evidence payload. This avoids adding an ad hoc execution-log status while also avoiding a false `failed` classification for a provider mutation that may already have committed.

Before any retry, the caller or automation must perform governed reconciliation/readback and prove that the external side effect did not occur. This runtime guard does **not** make stale schemas acceptable and does not repair catalog/export parity by itself; the canonical endpoint/export schema must still be reconciled.

## Scope boundaries

The migration is metadata-only. It performs no provider call, credential payload read, raw-secret access, external send, external write, runtime dispatch, route registration, or public API shape change.

The post-dispatch runtime safety guard is also non-mutating with respect to provider behavior: it performs no automatic retry and no compensating provider write. It changes only the local classification returned after an already-observed upstream success when strict response-schema validation cannot safely confirm the final result.

## Operational rule

Before adding or expanding a registry-driven dispatcher, verify:

```sql
SELECT COUNT(*)
FROM v_platform_endpoint_export_schema_parity
WHERE schema_parity_status <> 'pass';
```

The expected count is `0`.
