# Phase 1D Implementation — Immutable Manifest Persistence

## Purpose

Persist deterministic Phase 1C compiler output without activating runtime execution or mutating historical manifest content.

## Data model

`operation_compiled_manifests` stores immutable compiled content and independent validation, rollout, and certification dimensions. `operation_compiled_manifest_current` stores the single transactional current pointer for one operation version and scope fingerprint. Separating the pointer prevents historical content from being rewritten when a new manifest becomes current or rollback selects a prior manifest.

The bounded readback view exposes identifiers, hashes, lifecycle dimensions, pointer revision, readiness, and timestamps. It excludes `manifest_json`, actor identity, raw resource references, credentials, and provider transport details.

## Repository behavior

The repository:

- validates canonical manifest and source hashes before database access;
- rejects sensitive or raw scope fields;
- locks the operation version and checks its revision hash;
- serializes manifest version allocation through the locked operation row;
- treats identical manifest persistence as idempotent;
- rejects immutable-content and lifecycle conflicts;
- updates the current pointer transactionally with a monotonic pointer revision;
- performs same-cycle content, hash, and pointer readback before commit;
- rolls back on every mismatch.

## Lifecycle posture

Persisting or selecting a current manifest does not activate runtime execution. Runtime eligibility still requires a current manifest with valid validation state, allowed rollout mode, valid certification, non-expired status, compatible compiler version, and same-cycle authority verification.

## Scope boundaries

This phase includes migration and repository code only. It performs no migration apply, live database write, seed row, runtime route, cache, tool projection, provider call, external send, deployment, or merge.
