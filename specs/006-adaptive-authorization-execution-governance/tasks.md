# Tasks: Adaptive Authorization and Execution Governance

## Specification

- [x] T001 Define problem, goals, non-goals, scenarios, states, and success criteria.
- [x] T002 Record the hybrid relationship, attribute, and grant ADR.
- [x] T003 Define logical resources and three pilot capabilities.
- [x] T004 Add an OpenAPI 3.1 draft contract and structured error model.
- [x] T005 Review terminology across security, runtime, tenant, and platform authority surfaces.
- [x] T006 Map every logical resource to existing SQL authority or a bounded additive migration candidate.

## Decision plane

- [x] T010 Implement canonical capability and alias resolution.
- [x] T011 Implement typed subject-action-resource-context decision input.
- [x] T012 Implement relationship revision resolution.
- [x] T013 Implement grant and contextual policy composition.
- [x] T014 Implement obligation and mismatch taxonomy.
- [x] T015 Persist bounded shadow decisions and parity evidence.

## Enforcement, adapters, and evidence

- [x] T020 Implement the shared enforcement kernel for every pilot boundary.
- [x] T021 Implement revision-bound, expiring, replay-resistant envelopes.
- [x] T022 Implement scoped approval requests and append-only decisions.
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
- [x] D004 Delete the merged source branch and the verified-equivalent resolution branches.
- [x] D005 Repair and delete the historical orphan reconciliation branches without force.
- [x] D006 Merge the documented PR1 handoff as PR #1967.
- [x] D007 Complete the governed terminology review and SQL authority map.
- [x] D008 Start the remaining-task loop after explicit instruction and record live PR2-adjacent resolver evidence.
- [x] D009 Close the remaining decision-plane tasks T011 through T014 with implementation, tests, CI, and live readiness smoke.
- [ ] D010 Close enforcement, adapter, pilot, migration, verification, rollout, and closeout tasks.

See `terminology-review-2026-06-29.md`, `sql-authority-map-2026-06-29.md`, `handoff-report-2026-06-29.md`, `remaining-task-loop-2026-07-07.md`, `docs/tenant-capability-enforcement-kernel.md`, `docs/platform-execution-envelope-kernel.md`, and `docs/platform-scoped-approval-kernel.md`.
