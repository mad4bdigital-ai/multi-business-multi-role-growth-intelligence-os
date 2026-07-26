# Tasks

Legend: checked tasks are implemented and locally validated in the Spec Kit 005 PR. Unchecked tasks remain required follow-up work and are not implied by merge.

## Baseline
- [ ] T001 Capture production schema hashes/counts. Counts are captured; production schema hashes remain pending.
- [x] T002 Add empty-`execution_guardrail` regression.
- [ ] T003 Measure exact tenant-visible catalog with real JWT.
- [ ] T004 Classify selected authority tables.
- [ ] T005 Fix read-only SQL Tool Bus classification.

## Generation
- [x] T010 Create `custom-gpt-surfaces.yaml`.
- [ ] T011 Add per-operation `x-mad4b-surfaces`. Registry selectors are implemented; per-operation metadata remains optional follow-up.
- [x] T012 Generalize generator.
- [x] T013 Temporary-first generation.
- [x] T014 Recursive Builder guard.
- [x] T015 Budget and host/auth checks.
- [x] T016 Byte parity CI.
- [x] T017 Review-only schema Auto-sync PRs.

## Surface split
- [x] T020 Admin Core.
- [x] T021 Tenant Core.
- [x] T022 Activation Admin.
- [x] T023 Tenant Activation.
- [x] T024 Local Connector canonical.
- [ ] T025 Aliases/deprecation. Compatibility alias is retained; measured deprecation and sunset remain pending.
- [x] T026 Prevent incompatible auth-profile duplication.

## SQL contracts
- [ ] T030 Inventory existing schema/version fields.
- [ ] T031 Add only missing additive storage.
- [ ] T032 Normalize surface bindings.
- [ ] T033 Output schema validation.
- [ ] T034 Registry version/ETag.
- [ ] T035 Schema-version conflict.
- [ ] T036 Availability/blocking reasons.
- [ ] T037 Principal differential tests with real admin and tenant credentials.

## Gateway
- [x] T040 Generated route policy.
- [x] T041 Stateless edge.
- [x] T042 Path/query/header guards.
- [x] T043 Size/timeout limits.
- [ ] T044 Signed manifest publisher/verifier. Verifier and typed attestation contract are implemented; governed publisher remains pending.
- [x] T045 Stale mutation fail-closed.
- [ ] T046 Health/readiness/metrics. Health and readiness are implemented; deployment metrics remain pending.
- [x] T047 OpenAPI-policy parity.

## Release
- [ ] T050 Dark deploy.
- [ ] T051 Contract/security smoke on temporary deployment.
- [ ] T052 Bind `activation.mad4b.com`.
- [ ] T053 Dual-run.
- [ ] T054 Update GPT Actions.
- [ ] T055 Monitor legacy usage.
- [ ] T056 Rehearse rollback.
- [ ] T057 Final readiness/traceability.
