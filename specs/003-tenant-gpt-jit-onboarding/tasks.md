# Tasks: Tenant GPT JIT Signup and Activation

## Setup and contracts

- [x] T001 Create Spec Kit branch and record base SHA.
- [x] T002 Add specification, plan, tasks, checklist, and contracts.
- [ ] T003 Confirm exact generated OpenAPI and canonical build commands.
- [ ] T004 Add ADR for the single Tenant GPT facade.

## Tenant GPT behavior

- [ ] T010 Remove `/connect` onboarding fallback.
- [ ] T011 Require immediate post-OAuth `activateSession` retry.
- [ ] T012 Add prohibited-response regression tests.
- [ ] T013 Ensure fallback sequence invokes governed tools instead of describing calls.

## Authentication and provisioning

- [ ] T020 Normalize email consistently.
- [ ] T021 Require verified Google email and validate Google token claims.
- [ ] T022 Add unique provider-subject migration with duplicate preflight.
- [ ] T023 Make first-login races deterministic.
- [ ] T024 Persist and atomically consume OAuth authorization codes.
- [ ] T025 Add repeated-login, concurrency, and replay tests.

## Bootstrap orchestration

- [ ] T030 Resolve action and endpoint keys from registry authority.
- [ ] T031 Implement `connect_bootstrap` with Managed default.
- [ ] T032 Register the tool and input schema in SQL authority.
- [ ] T033 Handle incomplete provisioning versus blocked principals.
- [ ] T034 Handle multi-tenant selection safely.
- [ ] T035 Require final activation readback.
- [ ] T036 Add idempotency and partial-failure resume tests.

## OAuth UX and facade

- [ ] T040 Remove setup/dashboard/`/connect` links from OAuth UI.
- [ ] T041 Preserve privacy, terms, and support links.
- [ ] T042 Generate one OpenAPI 3.1 Tenant GPT facade.
- [ ] T043 Verify five stable operation IDs and OAuth security.

## Validation and rollout

- [ ] T050 Run unit and integration tests.
- [ ] T051 Run migration and concurrency tests.
- [ ] T052 Run OpenAPI and instruction contract tests.
- [ ] T053 Build canonicals and generated schemas.
- [ ] T054 Verify staging and GPT Preview flows.
- [ ] T055 Produce release-readiness report and rollback evidence.
- [ ] T056 Open PR, pass CI, and merge after approval.
