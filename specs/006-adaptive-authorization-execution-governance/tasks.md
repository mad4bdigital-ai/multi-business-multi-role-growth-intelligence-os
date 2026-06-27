# Tasks: Adaptive Authorization and Execution Governance

## Specification

- [x] T001 Define the problem, goals, non-goals, scenarios, states, and success criteria.
- [x] T002 Record the hybrid relationship, attribute, and grant architecture decision.
- [x] T003 Define the logical resources and three pilot capabilities.
- [x] T004 Add an OpenAPI 3.1 draft contract and structured error model.
- [ ] T005 Review terminology with security, runtime, tenant, and platform owners.
- [ ] T006 Map every logical resource to existing SQL authority or an approved additive migration.

## Decision plane

- [ ] T010 Implement canonical capability and alias resolution.
- [ ] T011 Implement typed subject-action-resource-context decision input.
- [ ] T012 Implement relationship revision resolution.
- [ ] T013 Implement grant and contextual policy composition.
- [ ] T014 Implement obligation and mismatch taxonomy.
- [ ] T015 Persist no-secret shadow decisions and legacy parity evidence.

## Enforcement and approval

- [ ] T020 Implement the shared PEP kernel for every pilot execution boundary.
- [ ] T021 Implement revision-bound, expiring, replay-resistant execution envelopes.
- [ ] T022 Implement scoped approval request and append-only decision resources.
- [ ] T023 Implement stale-envelope invalidation.
- [ ] T024 Implement idempotency and concurrency controls.

## Adapters and evidence

- [ ] T030 Implement adapter binding and deterministic selection.
- [ ] T031 Implement certification and rollout-mode checks.
- [ ] T032 Implement capability-specific readback contracts.
- [ ] T033 Implement execution and evidence ledgers.
- [ ] T034 Implement relationship, grant, policy, connection, certification, approval, and readback reconcilers.

## Pilot and migration

- [ ] T040 Run `activation.skills.read` in shadow mode.
- [ ] T041 Run `platform.output-artifact.write` in shadow mode.
- [ ] T042 Run `content.wordpress.publish` in shadow mode with no provider write.
- [ ] T043 Classify all legacy/adaptive mismatches.
- [ ] T044 Approve parity thresholds before canary enforcement.
- [ ] T045 Add compatibility wrappers and measured deprecation metadata.

## Verification

- [ ] T050 Add unit and integration tests to the explicit test manifest.
- [ ] T051 Add cross-tenant, replay, stale-revision, ambiguity, and secret-redaction tests.
- [ ] T052 Add OpenAPI lint and compatibility checks.
- [ ] T053 Update canonicals and `AI_Agent_Knowledge_Guide.md` during implementation.
- [ ] T054 Run CI, dev verification, release readiness, rollback rehearsal, production parity, and post-merge audit.

## Completion governance

- [x] T060 Select `multi_pr` delivery.
- [ ] T061 Record implementation, migration, rollout, and closeout PR evidence.
- [ ] T062 Resolve all checklists and run `spec-kit-completion-gate.mjs --changed` before closeout.
