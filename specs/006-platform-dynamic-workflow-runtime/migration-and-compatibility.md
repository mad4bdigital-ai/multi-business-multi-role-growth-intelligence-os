# Migration and Backward Compatibility Strategy

## Principles

- Additive first.
- Dual-read and shadow comparison before cutover.
- No destructive migration until evidence and rollback exist.
- Historical runs remain interpretable.
- Legacy execution labels never become authority grants.
- New runtime remains behind explicit feature flags.

## Inventory phase

Map existing workflow, agent, execution, approval, connector, credential, memory, and writeback surfaces. For each source record:

- system of record;
- tenant/owner scope;
- mutability;
- state mapping;
- idempotency behavior;
- readback availability;
- migration owner;
- rollback path.

## Additive schema phase

Create new tables, indexes, views, and foreign keys without changing legacy writers. Seed:

- Platform Scope;
- Platform Admin Workspace;
- Platform Brand containment edge;
- setting definitions;
- adapter certifications;
- state and error catalogs.

## Shadow phase

For eligible legacy operations:

1. execute current path;
2. resolve new authority, settings, and adapter in shadow;
3. compile an equivalent new plan;
4. compare decisions and expected effects;
5. record drift without changing live behavior.

Any unexplained authority widening blocks release.

## Dual-write constraints

Dual-write is allowed only when atomicity and reconciliation are defined. Prefer a canonical writer plus asynchronous compatibility projection through the outbox. Never perform two unrelated provider writes.

## Backfill

Backfill immutable definitions and versions with source reference, normalized content, content hash, inferred owner, confidence, and validation status.

Ambiguous ownership or state is quarantined, not guessed.

## Cutover cohorts

1. platform internal read-only workflows;
2. platform internal low-risk mutations;
3. selected tenant template installations;
4. selected external adapters;
5. tenant-authored workflows;
6. legacy-path retirement.

## Rollback

- disable routing flags;
- stop new claims;
- continue reconciliation for in-flight dispatches;
- retain all new evidence;
- restore legacy readers/writers only where compatibility is proven;
- never delete tenant forks or installations.

## Deprecation

Legacy paths retire only after traffic is zero or excepted, parity and audit reconstruction pass, rollback window closes, clients migrate, contracts/docs align, and release approval is recorded.
