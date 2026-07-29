# Phase 3 Slice F — Delegation MariaDB Adapter and Validation Contract

## Purpose

Define the infrastructure adapter that can implement the Slice E transactional repository port after the canonical delegation migration has been independently applied and verified.

Slice F remains contract-only. The adapter is not wired to `getPool()`, a route, an engine, or runtime authority.

## Reuse decisions

The adapter reuses the existing authoritative tables:

- `agent_delegations` for canonical delegation grants; and
- `repository_automation_receipts` for mutation receipts.

No new receipt table or parallel delegation store is introduced.

The tenant-scoped receipt binding is represented by a deterministic `operation_key` derived from the tenant UUID and idempotency key. `run_id`, `step_key`, and `request_sha256` preserve the canonical operation, step, and request fingerprint.

## Grant mapping

Create writes the canonical grant to `agent_delegations` with:

- `status = 'pending'` for legacy compatibility;
- `canonical_status = 'active'`;
- the canonical approval mode, plan hash, resource scope, intents, limits, policy version, grant hash, and idempotency key;
- explicit approval metadata from the authorized lifecycle command; and
- `runtime_policy_ready = 0`.

Revoke writes `canonical_status = 'revoked'` while leaving the legacy enum unchanged. Expire writes both legacy and canonical status as `expired`.

Every transition is conditional on tenant, grant id, expected canonical status, and expected grant hash. A zero-row update is a conflict, not a success.

## Receipt mapping

A pending receipt is inserted before the grant mutation. The complete canonical receipt is stored in `provider_receipt_json`, while deterministic reconciliation evidence is stored in `readback_json`.

Reads fail closed when more than one row matches a tenant-scoped idempotency binding. Receipt inspection verifies the deterministic tenant operation key before returning data.

## Transaction guarantees

The adapter requires a transaction-capable injected pool. It exposes only the repository methods required by Slice E and releases the connection after commit or rollback.

The adapter never:

- obtains a global pool itself;
- sets `runtime_policy_ready = 1`;
- creates a route;
- calls a provider;
- applies a migration; or
- changes runtime binding.

## MariaDB readiness contract

`delegationGrantMariaDbValidationService.js` emits `verified_applied` only when all of the following are proven:

- the governed migration ledger records `mode = apply` and `ledger_status = applied`;
- checksum, statement count, and ledger readback are complete;
- the required tables, columns, indexes, and effective view exist;
- schema readback did not read row data or include secrets;
- InnoDB, utf8mb4, strict SQL mode, JSON support, check constraints, and transaction isolation are verified; and
- rollback assessment passes with runtime binding still disabled.

Any missing evidence returns `blocked`, leaves `migration_applied = false`, and omits the schema-readback fingerprint.

## Deterministic tests

The fake-MariaDB test validates:

- the complete create transaction through the Slice E orchestrator;
- canonical approval-mode persistence;
- tenant-scoped receipt storage and reconciliation;
- legacy/canonical status mapping;
- `runtime_policy_ready = 0`;
- commit and connection release behavior;
- positive and negative engine/schema readiness evidence; and
- static absence of `getPool()`, Express, and Router bindings.

## Boundaries

- No migration apply or rollback execution.
- No live database connection or write.
- No backfill.
- No runtime adapter registration.
- No public route or OpenAPI change.
- No provider call, Release Operation, or deployment.
- T141 remains open until a separately approved engine-validation and migration-apply cycle produces same-cycle schema and ledger readback, followed by certified adapter binding and live mutation readback.
