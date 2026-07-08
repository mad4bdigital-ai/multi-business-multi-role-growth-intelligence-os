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
