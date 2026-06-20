# Tasks: Unified Capability Authorization & Execution Security Hardening

## Conventions

- `[P]` means parallelizable after dependencies are met.
- Each task includes requirement or acceptance references.
- P0 containment tasks precede feature development.
- No production mutation is permitted until the staging mutation gate.

## Phase 0 — Safety containment

- [ ] **T001** Add tenant deny rule for all platform-admin tool surfaces without an explicit tenant-safe canonical binding. `[FR-010, FR-011]`
- [x] **T002** Add boundary validation that rejects requests containing multiple selectors. `[FR-001, FR-002]`
- [ ] **T003** Disable or route known dual-surface bypass aliases through the stricter policy. `[FR-006, FR-007]`
- [ ] **T004** Deny all state-changing capabilities without an explicit mutation policy. `[FR-019, FR-021]`
- [x] **T005** Block provider execution for pending, revoked, expired, and scope-mismatched credentials. `[FR-025, FR-028]`
- [x] **T006** Disable tenant access to raw admin credential-intake tools. `[FR-029, FR-030]`
- [ ] **T007** Verify kill switches for local shell, file write/delete, Cloudflare mutation, n8n mutation, and raw intake creation.
- [ ] **T008** Add temporary high-severity alerts for tenant-to-admin requests and selector parity mismatches.
- [ ] **T009** Record containment validation evidence and named owners.

## Phase 1 — Repository and registry discovery

- [ ] **T010** Inspect live repository canonicals and map current dispatcher, resolver, credential, approval, device, and audit modules.
- [ ] **T011** Inventory every active action/tool/intent alias and surface.
- [ ] **T012** Identify all dual-surface capabilities and compare current policies.
- [ ] **T013** Identify tenant-visible administrative capabilities.
- [ ] **T014** Inventory state-changing capabilities without complete mutation policy.
- [ ] **T015** Inventory credential binding states and current resolver semantics.
- [ ] **T016** Inventory device state fields, heartbeat source, and connector identity model.
- [ ] **T017** Establish resolver p50/p95/p99 baseline and request volume.
- [ ] **T018** Confirm database migration, test, feature-flag, and OpenAPI build mechanisms.
- [ ] **T019** Update this plan where live repository facts differ; retain constitution constraints.

## Phase 2 — Canonical capability domain

- [ ] **T020** Create `CanonicalCapability` domain model. `[FR-003, FR-006]`
- [ ] **T021** Create `CapabilityAlias` model with one-active-alias-to-one-capability invariant. `[FR-004, FR-005]`
- [ ] **T022** Create canonical/surface policy composition rules. `[FR-007, FR-010]`
- [ ] **T023** Add registry migrations and backfill plan for existing aliases.
- [ ] **T024** Build registry integrity checks for duplicate/missing mappings.
- [ ] **T025** Add admin report for alias inventory, dual-surface capabilities, and policy completeness.
- [ ] **T026** Add unit tests for alias normalization, integrity, and dual-surface parity. `[FR-008, A01-A08]`

## Phase 3 — Strict request contract

- [ ] **T027** Implement one-selector union schema at the API boundary. `[FR-001]`
- [ ] **T028** Implement `MISSING_CAPABILITY_SELECTOR`. `[FR-001]`
- [ ] **T029** Implement `AMBIGUOUS_CAPABILITY_SELECTOR`. `[FR-002]`
- [ ] **T030** Reject unknown request fields where security strictness applies.
- [ ] **T031** Remove silent selector precedence from every dispatcher path.
- [ ] **T032** Add compatibility telemetry for legacy clients.
- [ ] **T033** Add API integration tests for selector cases. `[A01-A05]`

## Phase 4 — Security decision engine

- [ ] **T034** Create `SecurityDecision` and `GateResult` domain models. `[FR-015]`
- [ ] **T035** Implement principal and tenant authorization evaluator. `[FR-009-FR-014]`
- [ ] **T036** Implement surface exposure evaluator. `[FR-010, FR-011]`
- [ ] **T037** Implement target-resource ownership abstraction. `[FR-012, FR-013]`
- [ ] **T038** Integrate skill evaluation as a separate gate.
- [ ] **T039** Implement fail-closed policy completeness validator. `[FR-016, FR-021]`
- [ ] **T040** Implement `dispatch_ready` invariant. `[FR-017]`
- [ ] **T041** Ensure preview mode cannot execute. `[FR-018]`
- [ ] **T042** Fix explicit tool requests incorrectly classified as `no_action_requested`. `[FR-020]`
- [ ] **T043** Route action and tool surfaces through the same application use case.
- [ ] **T044** Add decision-engine unit tests for all gate-state combinations. `[C01-C07]`
- [ ] **T045** Add property test: no allowed decision contains an unevaluated required gate.

## Phase 5 — Credential-policy separation

- [ ] **T046** Define credential requirement, resolution, and usability types. `[FR-022]`
- [ ] **T047** Move credential lookup after authorization and ownership. `[FR-023]`
- [ ] **T048** Ensure `not_required` has no effect on permission gates. `[FR-024]`
- [ ] **T049** Enforce validated usable states for execution. `[FR-025]`
- [ ] **T050** Enforce target authorization for platform-managed credentials. `[FR-027]`
- [ ] **T051** Implement stable credential-scope denial reasons. `[FR-028]`
- [ ] **T052** Add secret-redaction tests. `[FR-026]`
- [ ] **T053** Add credential acceptance tests. `[D01-D09]`

## Phase 6 — Secure tenant credential intake

- [x] **T054** Create dedicated tenant-safe intake canonical capability. `[FR-029]`
- [ ] **T055** Implement subject/tenant/integration/target/purpose binding. `[FR-031]`
- [ ] **T056** Add allowlisted redirect validation. `[FR-031]`
- [x] **T057** Add nonce, short expiry, single-use consumption, and replay protection. `[FR-032]`
- [ ] **T058** Invalidate sessions after relevant authority changes. `[FR-034]`
- [x] **T059** Add create/consume audit events without secrets. `[FR-033]`
- [x] **T060** Remove raw tenant route to admin intake implementation. `[FR-030]`
- [x] **T061** Add secure-intake integration tests. `[E01-E09]`

## Phase 7 — Device trust

- [x] **T062** Require `device_id` for device-scoped capabilities. `[FR-035]`
- [x] **T063** Implement device existence and tenant ownership checks. `[FR-036]`
- [x] **T064** Implement caller-to-device authorization. `[FR-036]`
- [x] **T065** Implement connector identity verification. `[FR-036]`
- [x] **T066** Define and enforce heartbeat freshness threshold. `[FR-036, FR-037]`
- [ ] **T067** Implement device lifecycle checks for archived/revoked state.
- [x] **T068** Implement capability-support check. `[FR-036]`
- [x] **T069** Add device trust evidence to decision trace.
- [x] **T070** Add device matrix tests. `[F01-F11]`

## Phase 8 — Local consent, shell, and files

- [ ] **T071** Define risk-based local-consent policy. `[FR-038, FR-041]`
- [ ] **T072** Implement bounded local approval token. `[FR-041]`
- [ ] **T073** Replace arbitrary shell exposure with registered command capabilities. `[FR-039]`
- [ ] **T074** Define typed argument schemas and reject shell metacharacter injection.
- [ ] **T075** Define allowlisted file roots and canonical path normalization. `[FR-040]`
- [ ] **T076** Prevent traversal and symlink escape. `[FR-040]`
- [ ] **T077** Separate file read/write/delete permissions.
- [ ] **T078** Deny protected secret paths and redact output.
- [ ] **T079** Add output/time/size bounds.
- [ ] **T080** Add local shell/file tests. `[G01-G08]`

## Phase 9 — Mutation approval and integrations

- [ ] **T081** Define explicit mutation-policy enum. `[FR-019]`
- [ ] **T082** Bind approval to capability, subject, tenant, target, request digest, and expiry.
- [ ] **T083** Add approval replay protection and consumption state.
- [ ] **T084** Add preflight and same-cycle readback hooks. `[FR-044]`
- [ ] **T085** Implement Cloudflare zone ownership and record protection. `[FR-042]`
- [ ] **T086** Implement Cloudflare preview/readback/rollback metadata. `[FR-042, FR-044]`
- [ ] **T087** Implement n8n instance-mode and ownership binding. `[FR-043]`
- [ ] **T088** Separate n8n read/run/activate permissions. `[FR-043]`
- [ ] **T089** Add mutation and integration tests. `[H01-H09, I01-I07]`

## Phase 10 — Status and observability

- [ ] **T090** Implement component-level activation/readiness projection. `[FR-045]`
- [ ] **T091** Define health freshness policy and eliminate registered-equals-healthy language. `[FR-046]`
- [ ] **T092** Persist structured decision traces. `[FR-047, FR-048]`
- [ ] **T093** Add public-safe trace projection and governed admin detail. `[FR-049]`
- [ ] **T094** Implement immutable/tamper-evident audit controls. `[FR-050]`
- [ ] **T095** Add metrics and alerts for invariant violations.
- [ ] **T096** Add readiness and audit tests. `[J01-J08]`

## Phase 11 — Contract, documentation, and client migration

- [ ] **T097** Validate OpenAPI 3.1 contract against implementation.
- [ ] **T098** Synchronize stable error codes and response examples.
- [ ] **T099** Publish client migration guide for one-selector requests.
- [ ] **T100** Update architecture, folder map, API standards, and operational runbooks.
- [ ] **T101** Run canonical/OpenAPI generation scripts required by the repository.
- [ ] **T102** Document deprecation timeline for legacy policy paths.

## Phase 12 — Verification and release

- [ ] **T103** Run full unit/integration/security test suites.
- [ ] **T104** Run the complete acceptance matrix in staging preview mode.
- [ ] **T105** Enable shadow evaluation and analyze every mismatch.
- [ ] **T106** Verify latency and resource budgets.
- [ ] **T107** Perform dependency-outage tests proving fail-closed behavior.
- [ ] **T108** Perform bounded approved staging mutations with readback and cleanup.
- [ ] **T109** Complete security and architecture reviews.
- [ ] **T110** Exercise feature-flag rollback while retaining P0 containment.
- [ ] **T111** Complete release-readiness checklist.
- [ ] **T112** Obtain explicit production promotion approval.
- [ ] **T113** Roll out by enforcement group and monitor.
- [ ] **T114** Retire legacy branches only after stability and parity criteria pass.
