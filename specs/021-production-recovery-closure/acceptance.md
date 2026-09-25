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


## Convergence recovered gate

`platform_recovery_converge_v1` may report `status=recovered` with `active=true` only after every ordered stage is `pass` or an explicitly proven `skipped_not_required`, final same-cycle Production parity succeeds, final Production activation recertification succeeds, and `mad4b.production-recovery-closure.v1` independently derives `recovered`.

Required live acceptance includes exact SHA/version/deployment-info parity, verified backup evidence, durable full inspection with consistent role census and tri-state readiness, governance/runtime-persistence baseline readiness, bounded handoff for any non-empty runtime-persistence schema drift, canonical grants readback, MCP catalog migration/readback, real response-chunk write/read/delete/absence smoke, Admin and Device tool functional readbacks, connector authenticated HTTP 200, Local Manager create→claim→complete round-trip, final deployment parity, and final Production activation readiness.

A role baseline rebuild is `skipped_not_required` only when the durable inspection proves that role is not zero-object. Runtime is never rebuilt by this convergence plan.

Each mutation boundary requires its own server-resolved exact-step approval and same-cycle readback. Completed steps are not replayed. Unknown outcome requires readback-only reconciliation and automatic retry remains false.

## Transition acceptance

Every consequential stage must re-prove exact public deployment parity immediately before mutation. Every mutation receipt must match the planned canonical authority reference and nested operation. A successful mutation must return a checkpoint before any later mutation can execute.

Backup evidence must be durable, hash-addressed, exact-SHA bound, no-secret, and cover runtime, governance, and runtime-persistence. Full inspection may run before backup because it is read-only, but no mutation may run before backup passes.

Persistent external 429 may return `degraded` only when HTTP status is handled before JSON parsing, bounded Retry-After is honored, backoff survives restart, and the rate-limit source is attributed. 429 must never authorize credential rotation.

A stale prior-process execution may not be retried. It becomes reconciliation-eligible only after the bounded liveness window, is promoted to `unknown_outcome`, and must be resolved by a read-only reconciler before any subsequent mutation.

A repair mutation may not be selected from missing readiness evidence. `null`/unknown readiness blocks before approval resolution, reservation, execution claim, or provider/database mutation.

When the full inspection proves `classification=nonempty_objects`, a positive object count, and `runtime_persistence_ready=false`, convergence must block with the canonical remediation-plan handoff; it must not execute `runtime_persistence.schema.repair` directly. Zero-object roles remain on the baseline-rebuild path. After separate Recovery Kernel remediation, the same convergence run may resume only after fresh readiness evidence. Runtime-core partial corruption and unregistered Governance schema corruption remain fail-closed.

For every mutation, the exact approval is durably reserved after the orchestration claim and finalized only after a verified terminal receipt. Unknown outcome or approval-finalization uncertainty requires reconciliation under the original idempotency key; no second mutation is allowed.


## Partial-corruption acceptance

For non-empty Runtime Persistence with `runtime_persistence_ready=false`:

- exactly one deterministic canonical finding with capability `runtime_persistence.schema.repair` must exist;
- the finding must match the full inspection run ID and evidence hash;
- the server-derived finding binding must be carried through approval, durable reservation, execution, receipt, and reconciliation;
- one request may execute at most that one bounded mutation;
- the following Runtime Persistence readiness verification must pass before grants/MCP/connector stages continue.

Zero-object roles must never execute the partial-schema repair. Unknown or ambiguous corruption must remain blocked; no raw SQL, migration selection, or generic schema reconstruction is inferred.
