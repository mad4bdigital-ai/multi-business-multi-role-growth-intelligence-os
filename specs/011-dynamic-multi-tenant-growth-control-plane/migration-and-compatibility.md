# Migration and Compatibility Strategy

## Principles

- MySQL-primary remains the runtime authority.
- Migrations are additive first and ledger-governed.
- Existing workflow, capability, tenant, provider, and configuration behavior remains available during shadow rollout.
- No global cutover or destructive rename in the initial sequence.
- Historical plans/runs retain pinned versions and remain readable.

## Authority mapping before schema change

For each proposed logical resource:

1. inspect existing registry tables and source links;
2. reuse or extend an existing authority where possible;
3. document why a new table is necessary;
4. define Admin/Tenant operation matrix;
5. define migration, seed, rollback, readback, and projection impact.

A platform data-source census and repository inspection MUST be recorded before final migration design.

## Phased migration

### Phase 0 — specification and mapping

- approve Spec 011;
- map overlaps with Specs 006 and 007;
- map logical resources to existing tables;
- freeze canonical identity and lifecycle contracts.

### Phase 1 — additive registry foundations

- add missing configuration definition/schema/version/source-link resources;
- add Activity Pack and brand activity binding authority only where absent;
- add indexes, constraints, revision, checksums, and lifecycle fields;
- seed no active tenant behavior automatically.

### Phase 2 — read-only APIs and projections

- list/get/search/permissions/changes/revisions/readback;
- effective config preview and lineage;
- Activity Pack validation preview;
- no active enforcement.

### Phase 3 — shadow resolver and compiler

- compute new context/config/policy/workflow decisions alongside legacy behavior;
- persist bounded comparison evidence;
- define mismatch taxonomy and acceptance thresholds;
- block cutover on unexplained high-risk mismatch.

### Phase 4 — internal-only reference slice

- allowlist one platform-owned pilot tenant/brand;
- compile and run internal artifact nodes only;
- persist snapshots, approvals, outputs, and readiness;
- provider nodes remain held.

### Phase 5 — staging cohort

- activate certified provider adapter and staging resource binding;
- typed approval, idempotency, rollback, and readback;
- no production resource.

### Phase 6 — production canary

- one bounded brand/resource/action cohort;
- explicit release approval and rollback;
- monitor SLOs, effects, readback, and audit.

### Phase 7 — general availability

- broaden cohorts only after parity and operations acceptance;
- preserve hard-disable and rollback;
- update canonicals, OpenAPI, knowledge guide, and completion evidence.

## Compatibility rules

### Configuration schemas

- adding optional fields is backward-compatible;
- required fields require migration/default and compatibility declaration;
- changing type or semantic meaning requires a new schema major version;
- unknown fields remain rejected.

### Workflows and capabilities

- active versions are immutable;
- new plans may select newer compatible versions;
- in-flight plans retain pinned versions;
- capability input/output incompatibility requires a new major version or adapter node.

### Activity Packs

- package activation declares supported Brand Core, capability, workflow, KPI, and provider versions;
- deprecated versions remain readable until all dependent active bindings are migrated or archived.

### APIs

- additive optional fields preferred;
- stable errors and status codes retained;
- route or operation removal requires deprecation and migration plan;
- tenant-safe allowlists are versioned and tested.

## Backfill

Backfills are resumable, idempotent, chunked, scope-aware, and auditable. They do not infer tenant, brand, activity, or resource binding from display names where canonical mapping is ambiguous. Ambiguous rows are quarantined for remediation.

## Rollback

- schema rollback uses additive compatibility wherever possible;
- runtime rollback changes active feature/cohort pointers rather than deleting data;
- configuration/workflow rollback activates a prior immutable version;
- provider write rollback follows the action-specific rollback contract;
- unknown effects require reconciliation before rollback or retry.

## Cutover gates

- migration dry-run and checksum verified;
- ledger apply and row/index readback verified;
- shadow sample minimum met;
- critical mismatch count zero;
- cross-tenant isolation suite passes;
- provider/resource/approval/readback tests pass;
- rollback exercised in dev/staging;
- release readiness approved.
