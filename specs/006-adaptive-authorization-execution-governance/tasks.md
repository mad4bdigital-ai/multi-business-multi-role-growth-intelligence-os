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
