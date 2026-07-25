# Implementation PR-2: Additive Operation Projection Foundation

## Status

Repository foundation only. This PR does not authorize migration apply, runtime wiring, registry activation, provider calls, credential changes, external sends, deployment, or production mutation.

## Scope

This slice adds persistence and repository foundations for Spec 012 tasks T020-T023, T026, and T074 without marking those implementation tasks complete.

The lifecycle state, error, reconnect, and compatibility contracts from T015-T017 are now merged into `main` through PR #3085 and are represented by:

- `implementation/pr-2a-lifecycle-contracts.md`
- `implementation/pr-2a-lifecycle-contracts.json`
- `test-activation-lifecycle-contract-foundation.mjs`

This PR consumes those contracts as design authority only. It does not wire their state machine, retries, reconciliation, delivery, acknowledgement, or error mapping into runtime services.

## Stable identity

`activation_runs.run_id` remains the shared Activation operation identity. `activation_operation_projections.operation_id` uses the same value and references `activation_runs.run_id`; PR-2 does not create a competing run identity.

`workflow_run_id` remains an optional indexed reference. No workflow FK is added because workflow collation and lifecycle ownership remain governed through the existing operation ownership model.

## Additive tables

- `activation_operation_projections`
- `activation_stage_attempts`
- `activation_evidence_items`
- `activation_deliveries`
- `activation_acknowledgements`
- `activation_reconciliation_attempts`

The migration uses additive `CREATE TABLE IF NOT EXISTS` statements only. It does not alter, truncate, delete, or drop existing data or tables.

## Repository boundary

`activationOperationProjectionRepository.js` remains disconnected from runtime routes and Activation services in this PR. It provides deterministic fingerprints, hash-only idempotency persistence, tenant/user-scoped reads, optimistic version checks, append-only ledgers, and bounded evidence sanitization.

State values remain constrained identifiers rather than SQL enums. Their semantic authority comes from the merged lifecycle contract; runtime transition enforcement is deferred to a later governed integration PR.

## Migration governance

The migration is not added to the legacy bootstrap allowlist and does not receive a live authorization registry row in this PR. Any future dry-run or apply requires a separate migration-specific capability envelope, governed preflight, typed confirmation, and explicit production approval.

## Rollback

Before apply, rollback is repository revert only.

After a future approved apply but before runtime wiring, the preferred rollback is to revoke authorization and leave unused additive tables in place.

After runtime wiring, a separate destructive rollback approval would be required to stop writes, validate legacy read authority, remove bindings, and only then consider reverse-FK table removal. No destructive rollback SQL is included here.

## Validation

`test-activation-operation-projection-foundation.mjs` is deterministic and offline. It verifies additive DDL, uniqueness and FK constraints, hash-only idempotency, evidence sanitization and size bounds, tenant/user scoping, optimistic concurrency, and 409 conflict behavior using fake pools only.

CI runs both lifecycle-contract parity and persistence-foundation tests so the merged T015-T017 authority and this PR remain compatible.

## Deferred work

- Runtime enforcement of the merged lifecycle transition and error contracts.
- Runtime dual-write/readback integration.
- Canonical OpenAPI adoption and consumer rollout where required.
- Migration registration and apply under separate explicit approval after review and release readiness.
