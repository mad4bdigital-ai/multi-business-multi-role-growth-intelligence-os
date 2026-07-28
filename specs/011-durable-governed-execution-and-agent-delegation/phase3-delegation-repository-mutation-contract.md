# Phase 3 Slice E — Delegation Repository Mutation Contract

## Purpose

Define the injected transactional repository boundary that can consume an eligible Slice D lifecycle plan and persist a create, revoke, or expire mutation only after canonical schema readiness and a fresh governed authorization are independently proven.

Slice E is an application/repository contract. It does not provide a MariaDB adapter, route, provider action, runtime authority, or migration operation.

## Inputs

The orchestrator requires:

- an eligible `delegation_grant_lifecycle_shadow_plan`;
- the tenant UUID;
- complete schema-readiness evidence;
- a typed governed authorization bound to the exact request fingerprint; and
- an injected repository exposing `beginTransaction`.

Schema readiness must include:

- status `verified_applied`;
- `migration_applied: true`;
- `readback_complete: true`;
- the migration SHA-256 checksum;
- the approved statement count; and
- a schema-readback fingerprint.

The current migration remains `contract_only_unapplied`, so no production caller can satisfy this gate yet.

## Transaction port

`beginTransaction` returns a transaction object exposing:

- `findReceiptByIdempotencyKey`;
- `insertPendingReceipt`;
- `applyCreateGrant`;
- `applyGrantTransition`;
- `inspectGrant`;
- `finalizeReceipt`;
- `inspectReceipt`;
- `commit`; and
- `rollback`.

The service contains no SQL, connection-pool dependency, ORM dependency, or HTTP handler. A future infrastructure adapter must implement this port without leaking persistence details into lifecycle policy logic.

## Mutation protocol

For a new request, the transaction must:

1. check the tenant-scoped idempotency key;
2. persist the pending receipt before the grant mutation;
3. create the grant or apply the expected-status transition;
4. read the grant back in the same transaction;
5. compare the readback with the command;
6. compute a deterministic readback fingerprint;
7. reconcile the receipt as `verified_success`;
8. read the receipt back in the same transaction;
9. verify `readback_complete: true` and `retry_allowed: false`; and
10. commit only after both readbacks pass.

Any pre-commit error rolls the transaction back.

## Idempotency and reconciliation

When the same idempotency key and request fingerprint already have a reconciled verified-success receipt, the orchestrator performs readback and returns `idempotent_replay` without repeating the mutation.

When an idempotency key is bound to a different request fingerprint, the request fails with an idempotency conflict.

When an existing receipt is pending, failed, or otherwise unreconciled, the orchestrator returns `blocked_existing_receipt_requires_reconciliation`. Automatic retry is forbidden.

## Unknown commit outcome

If the commit call fails after mutation work has been attempted, the orchestrator reports `DELEGATION_REPOSITORY_COMMIT_OUTCOME_UNKNOWN` and sets `retry_allowed: false`.

It does not issue a second mutation. A later invocation must inspect the persisted receipt and grant state and either return an idempotent replay or remain blocked for explicit reconciliation.

## Authorization binding

Repository mutation authorization must include:

- an approved capability-envelope UUID;
- an approved hold UUID;
- a resource-authority reference; and
- the exact lifecycle request fingerprint.

A stale or mismatched fingerprint fails before the repository transaction begins.

## Deterministic tests

The in-memory transactional test covers:

- verified create and receipt reconciliation;
- idempotent replay;
- idempotency conflict;
- pending-receipt reconciliation block;
- rollback on grant-readback mismatch;
- unknown commit outcome and safe later replay;
- revoke and expire transitions;
- schema-readiness failure before transaction start;
- stale authorization failure before transaction start; and
- static proof that the orchestrator contains no SQL, pool, Express, or router binding.

## Guarantees and boundaries

- No migration apply.
- No live database write or backfill.
- No MariaDB repository adapter.
- No route or OpenAPI change.
- No grant runtime-authority activation.
- No provider call, external write, Release Operation, or deployment.
- No secrets included.

T141 remains open until the engine validation phase verifies and applies the migration and a certified MariaDB adapter performs governed create, inspect, revoke, and expire mutations with same-cycle persistence readback.
