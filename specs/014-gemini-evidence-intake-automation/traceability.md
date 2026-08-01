# Traceability — Spec 014

The machine-readable source is `development-automation.json`. This document provides a reviewer-friendly summary.

## Contract and governance

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-001..FR-010 | T001, T002, T022, T024 | OP-001, OP-008, OP-009 | AC-001, AC-002, AC-003, AC-010, AC-018 |

## Context and intake

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-011..FR-018 | T003, T005, T006, T013..T016 | OP-002, OP-004, OP-006 | AC-004, AC-006, AC-009, AC-014 |

## File lifecycle and duplicates

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-019..FR-025 | T007, T008, T010, T017, T018 | OP-002, OP-005, OP-008 | AC-005, AC-010, AC-011, AC-014 |

## Provider and structured intelligence

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-026..FR-035 | T004, T009..T012, T017, T019, T020 | OP-003, OP-007, OP-008 | AC-007..AC-013, AC-016 |

## Review, clarification, and promotion

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-036..FR-041 | T013..T016 | OP-004, OP-005, OP-006 | AC-006, AC-007, AC-014 |

## Lifecycle, privacy, cost, and release

| Requirements | Tasks | Operation paths | Acceptance |
|---|---|---|---|
| FR-042..FR-052 | T004, T009, T010, T017, T019..T024 | OP-003, OP-007, OP-008, OP-009 | AC-011, AC-012, AC-015..AC-018 |

## Open-decision blockers

| Decision | Blocks | Primary tasks |
|---|---|---|
| OD-001 Gateway runtime | WAVE-04 | T009 |
| OD-002 Client Confidential provider policy | WAVE-04 | T009 |
| OD-003 Retention | WAVE-01, WAVE-04, WAVE-08 | T003, T004, T010, T017 |
| OD-004 Budgets | WAVE-04, WAVE-10 | T004, T009, T021 |
| OD-005 Model benchmark | WAVE-01, WAVE-04, WAVE-05, WAVE-08, WAVE-09 | T004, T009, T011, T017, T019, T020 |
| OD-006 Review interface | WAVE-02, WAVE-06, WAVE-07 | T006, T013, T015 |
| OD-007 File upload policy | WAVE-02, WAVE-03, WAVE-04, WAVE-07, WAVE-09 | T006, T007, T010, T015, T020 |
| OD-008 Embedding store | WAVE-08 | T017 |
| OD-009 Recording consent | WAVE-07, WAVE-09 | T015, T019, T020 |
| OD-010 Pilot cohort | WAVE-11 | T023 |

## Evidence closure classes

| Class | Required when |
|---|---|
| Schema/reference validation | Every Spec/contract change |
| Work Map and classification readback | Before implementation and after schema/map changes |
| Exact-head CI | Every implementation/closeout PR |
| Migration checksum, statement count, ledger | Persistent schema change |
| Provider mock/fault evidence | Provider boundary change |
| Security/privacy review | Scope, file, provider, client, or review authority change |
| Benchmark and human evaluation | Model/prompt/schema/modality activation |
| Deployment parity and runtime smoke | Runtime production change |
| Manual fallback and rollback rehearsal | Before pilot and production closeout |

## No-orphan rule

- A requirement without an acceptance criterion is invalid.
- A ready task without requirement, acceptance, operation-path, dependency, gate, test, evidence, allowed-path, forbidden-action, and resume bindings is invalid.
- An implementation file change outside the selected work packet is scope drift.
- A completion claim without authoritative evidence is invalid.
