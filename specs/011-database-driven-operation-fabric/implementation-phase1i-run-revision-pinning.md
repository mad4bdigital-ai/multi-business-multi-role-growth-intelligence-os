# Phase 1I Implementation — Immutable Run Revision Pinning

## Purpose

Implement Spec 011 task T302 by persisting the exact contract, step, binding, policy, and schema revisions selected for one governed operation run.

## Authority reuse

The implementation extends existing authorities rather than creating a new run system:

- `operation_run_ownership` proves the governed run identity and operation ownership;
- `operation_registry` proves the operation version and current contract revision;
- `operation_compiled_manifests` and its current pointer prove the selected compiled binding graph;
- repository automation remains the parent run authority.

## Data model

`operation_run_revision_pins` stores one immutable pin per `run_id`, including operation and manifest identity, scope and resource fingerprints, input and idempotency digests, and a deterministic bundle hash.

`operation_run_revision_items` stores canonical non-secret snapshots for five revision classes:

- contract;
- step;
- binding;
- policy;
- schema.

The tables expose no update or delete path. Foreign keys use `ON DELETE RESTRICT` so a pinned run cannot silently lose its evidence.

## Persistence behavior

The repository:

1. validates all hashes and canonical JSON before database access;
2. rejects credential, provider URL, raw scope, authorization, cookie, or secret-bearing fields;
3. locks and verifies run ownership;
4. locks and verifies the current operation revision;
5. verifies the selected manifest identity, lifecycle, certification, current pointer, expiry, and revocation state;
6. computes a deterministic revision bundle hash;
7. inserts the pin and all revision items in one transaction;
8. performs same-cycle content and hash readback before commit;
9. treats an identical retry as an idempotent readback;
10. rejects any attempt to repin the run to different revisions.

## Scope boundaries

This phase adds migration and repository code only. It does not apply the migration, create a run, execute a step, consume an authority envelope, reserve idempotency, call a provider, read credentials, add a route, change OpenAPI, activate runtime behavior, deploy, or merge.
