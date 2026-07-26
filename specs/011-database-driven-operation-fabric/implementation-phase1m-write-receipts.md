# Phase 1M Implementation — Operation Write Receipts and Same-Cycle Readback

## Purpose

Implement Spec 011 task T306 as an additive operation-level receipt contract for retry-safe governed writes. The service reserves an idempotency receipt before dispatch, performs same-cycle readback after every dispatch attempt, and requires conclusive recovery readback before retrying an unresolved receipt.

## Authority reuse

The receipt layer reuses:

- `operation_run_ownership` for tenant, workspace, and user ownership;
- `operation_run_revision_pins` for the immutable revision-bundle hash and resource fingerprint;
- the caller's governed dispatch authority for the actual write.

A receipt never grants dispatch authority. Every result reports `dispatch_authorized_by_receipt=false`.

## Additive persistence

`operation_write_receipts` stores one receipt for `(run_id, step_key, idempotency_key_sha256)`. It stores only hashes and bounded status evidence:

- SHA-256 of the idempotency key, never the raw key;
- canonical request SHA-256;
- revision-bundle and resource fingerprints;
- optimistic state revision;
- attempt count and last attempt ID;
- dispatch, readback, and result hashes;
- same-cycle readback, write-observed, and recovery flags.

The table uses a restrictive foreign key to the immutable run revision pin and exposes no delete path.

## Execution contract

`executeOperationWriteWithReceipt` is dependency-injected and follows this sequence:

1. validate non-secret input before database access;
2. lock and verify run ownership and immutable authority hashes;
3. reserve or load the unique receipt;
4. return an exact terminal replay without dispatch;
5. for an unresolved existing receipt, perform recovery readback before any retry;
6. block dispatch when recovery readback is inconclusive;
7. mark one new attempt as dispatching with optimistic revision control;
8. invoke the supplied write dispatcher;
9. invoke the supplied readback function in the same cycle, including after transport failure;
10. classify and persist the outcome;
11. read the finalized receipt back before commit.

## Outcome classification

- dispatch success plus applied readback: `completed`;
- dispatch failure or timeout plus applied readback: `recovered_completed`;
- conclusive not-applied readback after dispatch failure: `retry_ready`;
- successful dispatch without observed write: `blocked_recovery`;
- inconclusive or unavailable readback: `blocked_recovery`.

`retry_ready` permits a later governed attempt, but the next invocation still performs recovery readback before dispatch. The receipt service does not loop or retry automatically.

## Idempotency and conflicts

An exact terminal replay returns the persisted receipt and performs neither dispatch nor readback. Reuse of the same idempotency key with a different request hash, revision bundle, or resource fingerprint fails with a conflict.

## Security

Request, dispatch, and readback payloads are validated recursively. Credential payloads, provider URLs, endpoint URLs, authorization headers, cookies, tokens, private keys, passwords, and secret values are rejected. External dispatch and readback results must explicitly report `secrets_included=false`.

## Scope boundaries

This phase adds migration and application-service code only. It does not apply the migration, add a route, change OpenAPI, dispatch a live write, call a provider, read credentials, activate runtime behavior, deploy, or merge. Runtime integration remains a separate governed follow-up.
