# Implementation PR-2C: Activation Persistence Repository Services

## Status

Repository foundation only. This slice does not apply the additive migration, wire public routes, mutate a production database, activate registries, deploy, restart, call providers, read credentials, or send externally.

## Scope

This slice implements the repository interfaces needed by Spec 012 tasks T020, T021, and T023 on top of the already-merged additive schema artifact:

- tenant-scoped operation create/read/update with optimistic versioning;
- transaction-compatible monotonic stage-attempt numbering;
- scoped stage-attempt read and fail-closed transition semantics;
- bounded, sanitized evidence read and exact evidence identity/type verification;
- transaction-compatible reconciliation-attempt numbering and scoped read;
- an immutable repository adapter matching the lifecycle operation service dependency interface.

## Files

- `http-generic-api/activationOperationPersistenceRepository.js`
- `http-generic-api/test-activation-operation-persistence-repository.mjs`
- `.github/workflows/ci.yml`

The module composes the existing append/create/update functions in `activationOperationProjectionRepository.js` instead of duplicating their normalization, deduplication, and no-secret evidence contracts.

## Concurrency and scope

Attempt-number reads use locking reads (`FOR UPDATE`) and are intended to run on the same transaction connection as the subsequent append. Database unique constraints remain the final conflict guard.

Every read or transition requires:

- exact operation or child-record identity;
- exact tenant scope;
- the declared source state for mutations;
- exact optimistic version for operation projection updates through the composed repository.

Stage-attempt transitions are explicitly bounded. Terminal states cannot reopen. A zero-row update is accepted only when the exact scoped record already has the requested target state; otherwise it fails with a conflict.

## Evidence boundary

Evidence reads expose only the sanitized bounded projection and require:

- `secrets_included = 0`;
- `redaction_state` of `sanitized` or `reference_only`;
- `summary_bytes` within the platform evidence limit;
- exact evidence, operation, and tenant identity;
- optional exact evidence-type allowlists for success readback verification.

The repository never returns raw credentials or authorization payloads.

## Migration boundary

The additive migration remains:

`http-generic-api/migrations/20260724_activation_operation_projection_foundation.sql`

It is still explicitly unauthorized for apply in this slice. T026 remains open until a separate governed migration capability, dry-run, apply, ledger registration, and same-cycle database readback are completed.

## Runtime boundary

The new adapter is dependency-injection ready but is not imported by `server.js`, `activationSessionLifecycleService.js`, or `activationHardResponseService.js`. Public runtime wiring remains a later governed slice after migration readiness.

## Validation

The deterministic regression verifies:

- scoped locking attempt-number queries;
- safe stage, reconciliation, and evidence reads;
- stage transition success, idempotence, conflict, and terminal-state rejection;
- exact evidence identity and evidence-type filtering;
- bounded no-secret evidence predicates;
- immutable adapter method coverage;
- absence of premature runtime wiring;
- continued migration non-apply boundary.
