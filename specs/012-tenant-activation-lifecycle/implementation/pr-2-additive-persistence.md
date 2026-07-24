# Implementation PR-2: Additive Operation Projection Foundation

## Status

Repository foundation only. This PR does not authorize migration apply, runtime wiring, registry activation, provider calls, credential changes, external sends, deployment, or production mutation.

## Scope

This slice prepares additive persistence and repository foundations for Spec 012 tasks T020-T023, T026, and T074 without marking them complete. Final behavior remains dependent on T010-T017, especially the state machine, transition matrix, error taxonomy, and provider-stage contracts.

## Stable identity

`activation_runs.run_id` remains the shared Activation operation identity. The planned `activation_operation_projections.operation_id` will use the same value and reference `activation_runs.run_id`; PR-2 will not create a competing run identity.

`workflow_run_id` remains an optional reference. No workflow FK will be added until collation and lifecycle authority are validated through the existing operation ownership model.

## Planned additive tables

- `activation_operation_projections`
- `activation_stage_attempts`
- `activation_evidence_items`
- `activation_deliveries`
- `activation_acknowledgements`
- `activation_reconciliation_attempts`

The migration must use additive `CREATE TABLE IF NOT EXISTS` statements only. No existing table may be altered, truncated, deleted, or dropped by this PR.

## Repository boundary

The planned repository will remain disconnected from runtime routes and Activation services in this PR. It will provide deterministic fingerprints, hash-only idempotency persistence, tenant/user scoped reads, optimistic version checks, append-only ledgers, and bounded evidence sanitization.

State values remain constrained identifiers rather than final SQL enums until T015 and T016 are complete.

## Migration governance

The migration will not be added to the legacy bootstrap allowlist and will not receive a live authorization registry row in this PR. Any future dry-run or apply requires a separate migration-specific capability envelope, governed preflight, typed confirmation, and explicit production approval.

## Rollback

Before apply, rollback is repository revert only.

After a future approved apply but before runtime wiring, the preferred rollback is to revoke authorization and leave unused additive tables in place.

After runtime wiring, a separate destructive rollback approval would be required to stop writes, validate legacy read authority, remove bindings, and only then consider reverse-FK table removal. No destructive rollback SQL is included here.

## Deferred work

- Final states and transition enforcement: T015.
- Final error/result taxonomy: T016.
- Provider stage retry/timeout mapping: T017.
- Runtime dual-write/readback integration: later implementation PR.
- Migration registration and apply: separate explicit approval after CI, review, and release readiness.
