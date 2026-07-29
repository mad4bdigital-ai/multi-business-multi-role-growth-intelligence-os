# Tasks

## P0 — Definitions and evidence

- [ ] T001 Inventory every Admin and Tenant authorization path.
- [ ] T002 Map authority-owning tables and views from live SQL census.
- [ ] T003 Define compatibility meanings for `active`, `connected`, and `ready`.
- [x] T004 Add typed Actor, Subject Scope, Capability, Resource, Decision, Gap, and Version Vector contracts.
- [x] T005 Encode non-configurable safety invariants in domain code.
- [x] T006 Add stable reason-code catalog and redaction rules.

## P1 — Shadow decision plane

- [ ] T010 Implement Principal Resolver.
- [ ] T011 Implement Subject Scope and delegation resolver.
- [ ] T012 Implement bounded Resource Graph resolver.
- [ ] T013 Integrate semantic capability before provider selection.
- [ ] T014 Implement policy/grant evaluator.
- [x] T015 Implement deterministic connection selection and ambiguity blocking.
- [ ] T016 Implement endpoint and certification resolution.
- [x] T017 Emit no-secret Effective Authority Manifest.
- [x] T018 Persist bounded decision evidence.
- [ ] T019 Run shadow-only parity with no execution effect.

## P1 — Data and migration

- [x] T020 Design additive migrations against live table census.
- [ ] T021 Add revisions/version support where absent.
- [ ] T022 Add resource relation/restriction storage only for uncovered semantics.
- [ ] T023 Add delegation contexts.
- [ ] T024 Add decision, projection, invalidation, and drift ledgers.
- [x] T025 Add indexes and query plans.
- [x] T026 Document rollback and backfill.

## P1 — Projections

- [x] T030 Implement connector readiness dimensions.
- [x] T031 Implement Admin authority diagnostics.
- [ ] T032 Compile Dynamic Tabs from authority projection.
- [ ] T033 Compile Dashboard from authority projection.
- [ ] T034 Compile Tool Catalog visibility and action eligibility.
- [x] T035 Preserve backward-compatible legacy fields.
- [x] T036 Compare exact IDs and reasons across projections.

## P1 — Security and tests

- [x] T040 Add cross-tenant negative test matrix.
- [x] T041 Add Admin visibility versus mutation tests.
- [x] T042 Add support delegation and impersonation tests.
- [ ] T043 Add graph inheritance/restriction property tests.
- [x] T044 Add connection ambiguity tests.
- [x] T045 Add approval replay and manifest binding tests.
- [x] T046 Add no-secret serialization tests.
- [x] T047 Add stale and revocation revalidation tests.

## P2 — Invalidation and reconciliation

- [ ] T050 Publish authority change events.
- [ ] T051 Implement cache/projection invalidation consumers.
- [x] T052 Implement Registered/Authorized/Projected/Executable/Observed reconciler.
- [x] T053 Create `AUTHORITY_PROJECTION_DRIFT` lifecycle.
- [x] T054 Add synthetic Admin, Tenant, support, agent, and revoked principals.
- [ ] T055 Add alerting, ownership, and SLO telemetry.

## P2 — Enforcement rollout

- [ ] T060 Add shared PEP at dispatch.
- [ ] T061 Add same-cycle critical revalidation.
- [ ] T062 Canary low-risk read capabilities.
- [ ] T063 Pilot draft/internal reversible writes.
- [ ] T064 Certify high-risk capabilities individually.
- [ ] T065 Add typed approval, idempotency, readback, and rollback.

## P3 — Cutover and cleanup

- [ ] T070 Approve parity thresholds.
- [ ] T071 Migrate registered projection consumers.
- [x] T072 Update canonicals and generated OpenAPI artifacts.
- [ ] T073 Run CI, release readiness, production verification, and audit.
- [ ] T074 Deprecate measured legacy paths.
- [ ] T075 Remove local authorization SQL only after approved cutover.
- [ ] T076 Close the Spec Kit with implementation evidence.
