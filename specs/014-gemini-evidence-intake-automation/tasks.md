# Tasks — Gemini Evidence Intake and Development Automation

Unchecked tasks are not complete. Task scope, dependencies, allowed paths, forbidden actions, tests, gates, evidence, and resume keys are authoritative in `development-automation.json`.

## WAVE-00 — Specification freeze and automation contract

- [ ] **T001** Review and freeze repository-native feature contracts. Refs: FR-001..FR-005, FR-007, FR-009, FR-049, FR-052; AC-001, AC-002, AC-018; OP-001, OP-009.
- [ ] **T002** Resolve every Work Map/domain decision and move implementation readiness to `ready`. Depends on T001. Refs: FR-005, FR-050; AC-001, AC-018; OP-001.

## WAVE-01 — Persistent state and registry foundations

- [ ] **T003** Implement evidence intake, canonical evidence, usage-link, review, and clarification persistent state through additive governed migrations. Depends on T002 and OD-003.
- [ ] **T004** Implement AI job/result, prompt/model/policy, budget, lineage, and provider-file-lease registries. Depends on T002 and OD-003/004/005.

## WAVE-02 — Intake and form adapters

- [ ] **T005** Implement authenticated internal and bounded client intake endpoints with canonical context and idempotent receipts. Depends on T003.
- [ ] **T006** Implement Google Forms/Sheets/Drive and bounded client-link adapters behind governed connector contracts. Depends on T005 and OD-006/007.

## WAVE-03 — Drive file lifecycle and duplicate foundation

- [ ] **T007** Implement original preservation, deterministic naming, routing, quarantine/restricted handling, and storage readback. Depends on T003/T005 and OD-007.
- [ ] **T008** Implement exact duplicate detection and human-governed canonical candidate lifecycle. Depends on T003/T007.

## WAVE-04 — Gemini gateway and secret boundary

- [ ] **T009** Implement disabled-by-default Gemini provider adapter and backend gateway with bounded retry/readback/manual fallback. Depends on T004 and OD-001/002/004/005.
- [ ] **T010** Implement provider temporary-file lease, expiry, reconciliation, and cleanup. Depends on T007/T009 and OD-003/007.

## WAVE-05 — Structured extraction and semantic validation

- [ ] **T011** Implement pinned Structured Output validation, semantic validators, Arabic/mixed-language golden tests, and prompt-injection tests. Depends on T009 and OD-005.
- [ ] **T012** Implement allowlisted function intents and clarification proposals without direct execution authority. Depends on T011.

## WAVE-06 — Review queue and promotion lifecycle

- [ ] **T013** Implement reviewer object authority, optimistic concurrency, decision taxonomy, audit, and queue. Depends on T003/T011 and OD-006.
- [ ] **T014** Implement typed downstream usage/promotion links with source lineage and consumer compatibility. Depends on T013.

## WAVE-07 — Client surveys and clarification journeys

- [ ] **T015** Implement client profile, maturity, voice, asset, creative preference, approval, and outcome journeys. Depends on T006/T013 and OD-006/007/009.
- [ ] **T016** Implement minimal clarification request/response lifecycle with expiring bounded links. Depends on T013/T015.

## WAVE-08 — Embeddings and semantic duplicate candidates

- [ ] **T017** Implement embedding generation, versioned registry, scoped storage, retention, and cost controls. Depends on T004/T009/T011 and OD-003/005/008.
- [ ] **T018** Implement semantic candidate ranking and precision/recall benchmark; no automatic merge. Depends on T008/T017.

## WAVE-09 — Audio and video evidence processing

- [ ] **T019** Implement audio summary/transcript/quote proposals with consent and verbatim provenance. Depends on T011/T015 and OD-005/009.
- [ ] **T020** Implement bounded video scene/timestamp proposals with rights, size, duration, and cost policy. Depends on T010/T011/T015 and OD-005/007/009.

## WAVE-10 — Observability, cost, recovery, and operator tooling

- [ ] **T021** Implement metrics, scoped budgets, alerts, cost ledger, and no-secret diagnostics. Depends on T004/T009/T011/T013 and OD-004.
- [ ] **T022** Implement dead-letter repair, unknown-outcome reconciliation, manual fallback, and operator runbooks. Depends on T009/T013/T021.

## WAVE-11 — Pilot, production hardening, and closeout

- [ ] **T023** Run a scoped non-sensitive pilot, golden benchmark, cost/privacy review, manual fallback, and rollback rehearsal. Depends on T015/T018/T019/T020/T022 and OD-010.
- [ ] **T024** Complete production hardening, exact-head verification, governed release evidence, and Spec closeout. Depends on T023.

## Global task rules

- [ ] No implementation task starts before T002 is complete and `work-map-integration.json` is current and ready.
- [ ] No provider task starts before gateway, privacy, budget, and model decisions are resolved.
- [ ] No migration is applied from this task list; apply requires separate exact checksum/statement-count authority.
- [ ] No external provider receives Restricted data by default.
- [ ] No AI output performs approval, delete, access grant, publish, or protected-resource mutation.
- [ ] Every task closes only with the evidence listed in `development-automation.json`.
- [ ] Exact-head CI and authoritative readback are required; narrative status is insufficient.
