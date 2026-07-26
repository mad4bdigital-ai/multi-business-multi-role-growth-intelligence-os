# Platform Execution Concurrency Kernel

## Purpose

T023 adds stale-envelope invalidation, idempotency, and optimistic concurrency controls for adaptive authorization execution governance.

This PR is intentionally non-executing and non-persistent. It does not call providers, mutate external systems, create migrations, or cut over enforcement.

## Stale-envelope invalidation

The control record binds execution to the current execution envelope manifest, approval request manifest, approval decision log hash, execution status, and approval status. Validation fails closed when any of those values no longer match.

The kernel also revalidates the T021 execution envelope and T022 scoped approval request before reporting readiness.

## Idempotency

The record stores an `idempotency_key_hash`. Callers provide already-seen idempotency hashes during validation. A replayed idempotency key is rejected with `execution_concurrency_idempotency_replay_detected`.

## Concurrency

The record stores a `concurrency_token`. Callers provide currently active tokens during validation or reservation. A duplicate active token is rejected with `execution_concurrency_lock_conflict`.

## Safety guarantees

All outputs force `provider_apply_allowed: false`, `mutation_allowed: false`, `enforcement_cutover: false`, and `secrets_included: false`.

## Non-goals

This PR does not implement persistence, lock storage, provider adapters, migration execution, canary enforcement, pilot execution, or rollout. Those remain T030 and pilot/verification work.
