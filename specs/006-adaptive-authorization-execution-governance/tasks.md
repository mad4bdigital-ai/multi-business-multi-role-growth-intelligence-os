# Tasks: Adaptive Authorization and Execution Governance

## Specification

- [x] T001 Define problem, goals, non-goals, scenarios, states, and success criteria.
- [x] T002 Record the hybrid relationship, attribute, and grant ADR.
- [x] T003 Define logical resources and three pilot capabilities.
- [x] T004 Add an OpenAPI 3.1 draft contract and structured error model.
- [ ] T005 Review terminology with security, runtime, tenant, and platform owners.
- [ ] T006 Map every logical resource to existing SQL authority or an approved additive migration.

## Decision plane

- [ ] T010 Implement canonical capability and alias resolution.
- [ ] T011 Implement typed subject-action-resource-context decision input.
- [ ] T012 Implement relationship revision resolution.
- [ ] T013 Implement grant and contextual policy composition.
- [ ] T014 Implement obligation and mismatch taxonomy.
- [ ] T015 Persist bounded shadow decisions and parity evidence.

## Enforcement, adapters, and evidence

- [ ] T020 Implement the shared enforcement kernel for every pilot boundary.
- [ ] T021 Implement revision-bound, expiring, replay-resistant envelopes.
- [ ] T022 Implement scoped approval requests and append-only decisions.
- [ ] T023 Implement stale-envelope invalidation, idempotency, and concurrency controls.
- [ ] T030 Implement adapter bindings, certification, deterministic selection, readback contracts, execution evidence, and drift reconcilers.

## Pilot and migration

- [ ] T040 Run the three pilots in shadow mode without provider mutation.
- [ ] T041 Classify all legacy/adaptive mismatches.
- [ ] T042 Approve parity thresholds before canary enforcement.
- [ ] T043 Add compatibility wrappers and measured deprecation metadata.

## Verification and completion

- [ ] T050 Register unit, integration, isolation, replay, stale-revision, ambiguity, and redaction tests.
- [ ] T051 Add OpenAPI lint and compatibility checks.
- [ ] T052 Update canonicals and `AI_Agent_Knowledge_Guide.md` during implementation.
- [ ] T053 Run CI, dev verification, release readiness, rollback rehearsal, production parity, and post-merge audit.
- [x] T060 Select `multi_pr` delivery.
- [ ] T061 Record implementation, migration, rollout, and closeout PR evidence.
- [ ] T062 Resolve all checklists and run `spec-kit-completion-gate.mjs --changed` before closeout.

## Delivery evidence and handoff

- [x] D001 Merge PR1 state semantics and operational projections as PR #1936.
- [x] D002 Record PR1 merge SHA `809e81f9dc3c9198a2a4c2d45b4cd4177ef7b158`.
- [x] D003 Record four successful required CI checks and verified merge ancestry.
- [x] D004 Delete the merged source branch and the two verified-equivalent PR1936 resolution branches.
- [x] D005 Review the two older orphan reconciliation branches against current `main`.
- [ ] D006 Decide the explicit archival or deletion policy for orphan branches whose historical test blob differs from `main`.
- [ ] D007 Start PR2 for canonical capability and alias resolution after T005 and T006 authority review.

See `handoff-report-2026-06-29.md` for branch-level evidence, blockers, and the next execution boundary.
