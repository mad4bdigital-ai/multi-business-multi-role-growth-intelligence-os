# Tasks: Tenant GPT JIT Signup and Activation

## Setup and contracts

- [x] T001 Create Spec Kit branch and record base SHA.
- [x] T002 Add specification, plan, tasks, checklist, and contracts.
- [x] T003 Confirm exact generated OpenAPI and canonical build commands.
- [x] T004 Add ADR for the single Tenant GPT facade.

## Tenant GPT behavior

- [x] T010 Remove `/connect` onboarding fallback.
- [x] T011 Require immediate post-OAuth `activateSession` retry.
- [x] T012 Add prohibited-response regression tests.
- [x] T013 Ensure fallback sequence invokes governed tools instead of describing calls.

## Authentication and provisioning

- [x] T020 Normalize email consistently.
- [x] T021 Require verified Google email and validate Google token claims.
- [x] T022 Add unique provider-subject migration with duplicate preflight.
- [x] T023 Make first-login races deterministic.
- [x] T024 Persist and atomically consume OAuth authorization codes.
- [x] T025 Add repeated-login, concurrency, and replay tests.

## Bootstrap orchestration

- [x] T030 Resolve action and endpoint keys from registry authority.
- [x] T031 Implement `connect_bootstrap` with Managed default.
- [x] T032 Register the tool and input schema in SQL authority.
- [x] T033 Handle incomplete provisioning versus blocked principals.
- [x] T034 Handle multi-tenant selection safely.
- [x] T035 Require final activation readback.
- [x] T036 Add idempotency and partial-failure resume tests.

## OAuth UX and facade

- [x] T040 Remove setup/dashboard/`/connect` links from OAuth UI.
- [x] T041 Preserve privacy, terms, and support links.
- [x] T042 Generate one OpenAPI 3.1 Tenant GPT facade.
- [x] T043 Verify five stable operation IDs and OAuth security.

## Validation and rollout

- [x] T050 Run unit and integration tests.
- [x] T051 Run migration and concurrency tests.
- [x] T052 Run OpenAPI and instruction contract tests.
- [x] T053 Build canonicals and generated schemas.
- [~] T054 N/A — governed staging and GPT Preview execution surfaces were unavailable; production OAuth verification, release readiness, CI, and production parity were completed instead.
- [x] T055 Produce release-readiness report and rollback evidence.
- [x] T056 Open PR, pass CI, and merge after approval.
