# Phase 3 Slice D — Delegation Lifecycle Shadow Contract

## Purpose

Define the fail-closed application contract that sits between the existing delegation grant preview and future canonical persistence mutations. Slice D plans create, revoke, and expire operations, produces deterministic pending mutation receipts, and evaluates renewal no-widening rules without writing state.

## Scope

Slice D adds:

- canonical grant normalization against `spec011-delegation-grant-v1`;
- create, revoke, and expire shadow command planning;
- deterministic `spec011-mutation-receipt-v1` pending receipts;
- exact expected-hash and preview-hash drift checks;
- a read-only repository port for canonical inspection;
- renewal no-widening validation; and
- deterministic tests registered in CI.

## Schema-readiness gate

Lifecycle planning is blocked unless the caller supplies a complete schema-readiness evidence object containing:

- status `verified_applied`;
- `migration_applied: true`;
- `readback_complete: true`;
- the migration SHA-256 checksum;
- the approved statement count; and
- a schema-readback fingerprint.

A boolean readiness flag is intentionally insufficient. This prevents a caller from treating the migration file or a stale readiness narrative as proof that canonical persistence is available.

The current Slice C migration remains `contract_only_unapplied`, so production callers cannot satisfy this gate yet.

## Mutation receipts

Eligible shadow commands receive a deterministic pending receipt containing:

- operation and step UUIDs;
- idempotency key;
- stable request fingerprint;
- repository adapter identity;
- pending state and outcome classification;
- `retry_allowed: false`; and
- `readback_complete: false`.

The receipt is planning evidence only. It is not persisted or dispatched in this slice.

## Renewal no-widening

A requested renewal is blocked when it:

- changes the grant, delegator, delegate, approval mode, plan ID, plan hash, or policy version;
- adds a resource binding or changes a snapshot hash;
- adds an allowed intent;
- removes a denied intent;
- raises the risk ceiling;
- increases mutation, retry, or pull-request limits; or
- extends expiry.

Narrower resource, intent, risk, limit, and expiry scopes may proceed to a new approval preview. Slice D never renews or mutates the grant itself.

## Repository boundary

The repository port exposes read-only `inspectGrant` and `inspectReceipt` methods. No write method is accepted or invoked. Canonical inspection computes a grant hash and readback fingerprint but always returns `dispatch_eligible: false`.

## Guarantees

- No migration apply.
- No database write or backfill.
- No route or OpenAPI change.
- No approval mutation.
- No grant creation, activation, revocation, expiry, or renewal.
- No runtime-authority cutover.
- No provider call, external write, Release Operation, or deployment.
- No secrets included.

## Follow-up

1. Validate and apply the Slice C migration through governed migration tooling in the engine-validation phase.
2. Implement the canonical repository adapter with transaction boundaries, idempotency receipt persistence, and same-cycle readback.
3. Add governed create and inspect operations.
4. Add governed revoke and expire operations.
5. Add renewal approval that requires no-widening evidence or a fresh broader approval.

T141 remains open until persistence mutations and readback are implemented and verified. Spec 011 remains `in_progress`.
