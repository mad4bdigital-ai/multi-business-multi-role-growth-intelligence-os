# Acceptance Contract

## Core recovered

The following must all be true in one exact-SHA closure evidence pack:

```json
{
  "exact_source_sha_verified": true,
  "durable_inspection_verified": true,
  "governance_baseline_ready": true,
  "runtime_persistence_baseline_ready": true,
  "canonical_grants_ready": true,
  "bootstrap_ledger_ready": true,
  "mcp_catalog_schema_ready": true,
  "admin_catalog_functional_readback": true,
  "device_catalog_functional_readback": true,
  "response_chunk_storage_smoke": true,
  "production_activation_readiness": true,
  "backup_evidence_verified": true,
  "production_mutation_audited": true,
  "unknown_outcome": false
}
```

## Status derivation

- `unknown_outcome`: any mutation outcome is unknown and reconciliation is required.
- `blocked`: any structural or core recovery requirement is incomplete.
- `degraded_non_db`: core recovery is complete but connector auth and/or rate-limit attribution is incomplete.
- `recovered`: core recovery is complete and all non-DB closure gates are complete.

## Invariants

- recovered may not be caller-declared;
- recovered may not be derived from exit code only;
- recovered may not be inferred from migration success only;
- recovered requires backup evidence;
- recovered requires behavioral readback;
- recovered requires exact SHA;
- automatic retry is always false after partial or unknown outcome;
- closure evaluation itself performs no mutation.


## Convergence active gate

`platform_recovery_converge_v1` may report `active=true` only after every ordered stage is `pass` or an explicitly proven `skipped_not_required`.

Required live acceptance includes exact SHA/version/deployment-info parity, verified backup evidence, durable full inspection, governance/runtime-persistence baseline readiness, canonical grants readback, MCP catalog migration/readback, real response-chunk write/read smoke, Admin and Device tool functional readbacks, Production activation readiness, connector authenticated HTTP 200, Local Manager create→claim→complete round-trip, and final deployment parity.

A role baseline rebuild is `skipped_not_required` only when the durable inspection proves that role is not zero-object. Runtime is never rebuilt by this convergence plan.

Each mutation boundary requires its own server-resolved exact-step approval and same-cycle readback. Completed steps are not replayed. Unknown outcome requires readback-only reconciliation and automatic retry remains false.
\n## Transition acceptance\n\nEvery consequential stage must re-prove exact public deployment parity immediately before mutation. Every mutation receipt must match the planned canonical authority reference and nested operation. A successful mutation must return a checkpoint before any later mutation can execute.\n\nBackup evidence must be durable, hash-addressed, exact-SHA bound, no-secret, and cover runtime, governance, and runtime-persistence. Full inspection may run before backup because it is read-only, but no mutation may run before backup passes.\n\nPersistent external 429 may return `degraded` only when HTTP status is handled before JSON parsing, bounded Retry-After is honored, backoff survives restart, and the rate-limit source is attributed. 429 must never authorize credential rotation.\n