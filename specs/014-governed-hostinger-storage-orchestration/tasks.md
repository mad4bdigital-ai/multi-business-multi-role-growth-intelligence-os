# Tasks: Governed Hostinger Storage Orchestration

**Spec**: `specs/014-governed-hostinger-storage-orchestration/spec.md`  
**Plan**: `specs/014-governed-hostinger-storage-orchestration/plan.md`

## Rules

- Stable IDs are mandatory.
- `[P]` means genuinely independent after prerequisites.
- Mutation tasks name authority, approval, readback, rollback, and dispatch state.
- No live provider action is authorized by task completion alone.
- Work Map readiness and schema classification must remain current.
- Completion requires commit/test/migration/runtime evidence, not narrative.

## Phase 0 — Baseline, clarification, and Work Map readiness

- [x] **T001** [FR-027/OP-012] Capture Hostinger incident baseline and permanent-control objective. Evidence: `research.md`, provider response recorded in spec.
- [x] **T002** Synchronize feature branch with current `main` through ancestry-preserving PR #4353; no force push. Evidence: merge `44e131117e3959099c8607cca4f5fc139ef5a228`.
- [x] **T003** Generate/construct complete `work-map-integration.json` for all 19 maps and 16 domains.
- [x] **T004** Resolve every map/domain decision and prove zero unresolved/intentionally unclassified schema objects in current registry.
- [x] **T005** Mark Work Map integration ready with requirement/task/acceptance/evidence bindings.
- [ ] **T006** Re-run Work Map scaffold/gate on final exact head and repair any fingerprint drift caused by later `main` movement.
- [ ] **T007** Resolve open research gates Q-001–Q-005 with owners and evidence.

## Phase 1 — Contract freeze

- [x] **T010** [P] [FR-001–FR-010/OP-001–OP-004] Finalize OpenAPI 3.1 Admin/Tenant read contracts and examples. Evidence: `contracts/openapi.yaml` and the 18-operation compatibility floor in `contracts/contract-compatibility-baseline.json`.
- [x] **T011** [P] [FR-011–FR-023/OP-003–OP-009] Finalize plan/apply/readback operation schema. Evidence: `contracts/storage-operation.schema.json` and executable contract regression.
- [x] **T012** [P] [FR-012–FR-026] Finalize plan and evidence JSON Schemas with no-secret constraints. Evidence: `storage-plan.schema.json`, `storage-evidence.schema.json`, closed-object and `secrets_included=false` assertions.
- [x] **T013** Validate contracts using repository OpenAPI/JSON Schema tooling and negative examples. Evidence: `http-generic-api/test-hostinger-storage-contracts.mjs`; first successful Workstream head `03ffa7a46c0dc74627892105f8b7d447294ca084`.
- [x] **T014** Freeze error catalog and compatibility/versioning policy. Evidence: 59-code baseline plus `contracts/compatibility.md` additive-only policy.

## Phase 2 — Data model and migration design

- [x] **T020** [P] [FR-003/FR-012/FR-020] Define storage resource graph and durable entity model in `data-model.md`.
- [x] **T021** [P] Classify proposed tables/views into existing schema domains and Work Maps. Evidence: `.github/contracts/spec014/hostinger-storage-schema-classification.json` enumerates the exact 15 additive tables and binds each to one existing domain and its Work Maps.
- [x] **T022** Define indexes, uniqueness, FK, CAS lease, immutable-plan, retention, and encrypted/opaque path constraints. Evidence: the guarded schema-classification contract and validator enforce per-object keys, indexes, authority, immutability, retention, and sensitive-data boundaries.
- [x] **T023** Update canonical schema classification registry before SQL creation; prove zero ambiguity/unresolved objects. Evidence: `.specify/work-map-schema-classification-registry.json` contains one bounded exact rule per proposed table; the official registry-contract and classification validators remain fail-closed. No SQL or migration apply is included.
- [ ] **T024** Draft additive migration wave 1: provider accounts, targets, bindings, snapshots.
- [ ] **T025** Draft additive migration wave 2: operations, plans, items, impacts, approvals, leases.
- [ ] **T026** Draft additive migration wave 3: runs, reconciliation, reserves, incidents, read-only projections and default-off tool seeds.
- [ ] **T027** Add migration preflight/readback/rollback tests; no apply in specification PR.

## Phase 3 — Resource, context, and authority orchestration

- [ ] **T030** [FR-003/OP-001–OP-003] Implement target/resource resolver over existing Platform Resource Graph.
- [ ] **T031** [FR-003/FR-028] Implement active deployment/root and layout-certification binding.
- [ ] **T032** [FR-004/FR-006] Implement platform/tenant/shared ownership and impact-set resolver.
- [x] **T033** [FR-001/FR-002/FR-014/FR-015] Implement pure Admin/Tenant operation authority policy. Evidence: `hostingerStorageOrchestrationPolicy.js`.
- [x] **T034** [FR-004/FR-005/FR-006] Add dual-role, tenant target, shared impact, delegation, reserve, and revision regressions. Evidence: `test-hostinger-storage-orchestration-policy.mjs`.
- [ ] **T035** Bind policy to live Context Kernel, Effective Authority, Resource Authority, and Capability Envelope.
- [ ] **T036** Bind Workspace Owner/Admin/Release/incident approvals, delegation, break-glass, and support-case evidence.
- [x] **T037** Define and guard operation state machine including `unknown_outcome`. Evidence: pure transition tests.
- [ ] **T038** Implement durable operation envelope, idempotency, approval hold, and state-transition service.
- [ ] **T039** Add Tenant/Admin bounded projection service and cross-tenant leakage tests.

## Phase 4 — Provider and runtime adapters

- [x] **T040** [FR-009/FR-011/FR-018–FR-020] Implement conservative SSH scan/plan/inspect/apply script with exact per-item revalidation. Evidence: `hostinger-storage-cleanup.sh`.
- [x] **T041** Add filesystem safety regression for protected paths, inode replacement, replay, and reserve lifecycle. Evidence: `test-hostinger-storage-cleanup-script.mjs`.
- [ ] **T042** [FR-016/FR-017] Implement fixed `hostinger_ssh_storage_v1` adapter with structured arguments, pinned host key, credential references, bounded/redacted output.
- [ ] **T043** Run adapter only on dedicated worker/connector; prove public runtime cannot dispatch.
- [ ] **T044** Resolve supported hPanel quota evidence source and implement freshness/ingestion adapter.
- [ ] **T045** Certify actual Hostinger directory/deployment layout and target allowlists.
- [ ] **T046** Fix and certify reserve release so inode exhaustion does not require creating a lock/state file first.
- [ ] **T047** Implement dispatch certification registry and default-off feature flags.

## Phase 5 — Planning, approval, execution, and reconciliation

- [ ] **T050** [FR-012/FR-021/OP-003–OP-008] Implement immutable plan/item/impact repositories and plan hashing.
- [ ] **T051** [FR-020/FR-021] Implement lease, idempotency, consumed-plan marker, and per-item journal/checkpoints.
- [ ] **T052** [FR-022/OP-009] Implement same-operation unknown-outcome reconciliation and outcome classifier.
- [ ] **T053** Implement approval invalidation on context/target/ownership/policy/plan/impact/expiry changes.
- [ ] **T054** Implement shared-impact approval completeness and policy-defined quorum support.
- [ ] **T055** [FR-005/OP-012] Integrate support case and delegation/break-glass workflow.
- [ ] **T056** [FR-024/OP-010/OP-012] Integrate reserve and storage incident lifecycle.
- [ ] **T057** Implement cancellation, lease expiry, worker interruption, and reconciliation handoff.

## Phase 6 — Observability, release, and readback

- [ ] **T060** [FR-007/FR-008] Implement byte/inode pressure snapshots, freshness, confidence, and growth attribution metrics.
- [ ] **T061** [FR-023] Implement before/after provider, SSH, File Manager, environment-variable, and runtime readback completeness.
- [ ] **T062** [FR-025/OP-011] Integrate read-only storage preflight into governed Production promotion; block without auto-cleaning.
- [ ] **T063** Add warning/critical/emergency operational attention and incident creation.
- [ ] **T064** Add Tenant-safe and Admin platform audit projections.
- [ ] **T065** Define retention/aggregation for snapshots, plans, runs, item journals, and incidents.

## Phase 7 — Tests, docs, and generated artifacts

- [x] **T070** Add dedicated Hostinger Storage Orchestration Guard for policies, shell safety, and Admin/Tenant authority regressions.
- [ ] **T071** Register new tests in canonical manifests and run full ordered CI/diagnostic shards.
- [ ] **T072** Complete runbooks, quickstart, support templates, API examples, and threat-model test mapping.
- [ ] **T073** Add contract tests for Admin/Tenant projections and error catalog.
- [ ] **T074** Add fault injection: host-key mismatch, worker timeout/crash, changed inode, stale approval, lease conflict, duplicate response, unknown outcome.
- [ ] **T075** Add secret-scanning and absolute/cross-tenant path leakage tests.
- [ ] **T076** Regenerate Work Maps through governed producer if classified source surfaces change.

## Phase 8 — Rollout certification

- [ ] **T080** Phase 2: enable read-only Admin/Tenant scan for allowlisted non-production target; compare SSH and hPanel evidence.
- [ ] **T081** Phase 3: enable durable plan/inspect/approval center with apply disabled; execute support/incident drill.
- [ ] **T082** Phase 4: synthetic apply drill with exact plan, lease, checkpoint, readback, and unknown-outcome simulation.
- [ ] **T083** Phase 5: tenant-exclusive canary with Workspace Owner approval and full projection audit.
- [ ] **T084** Phase 6: platform/shared canary with impact approvals and reserve certification.
- [ ] **T085** Phase 7: deployment-history and release preflight only after active-SHA/rollback proof.

## Phase 9 — Governed delivery and closeout

- [ ] **T090** Open/finalize PR with exact risks, authority, database/API/provider impact, Work Map summary, rollout, and rollback.
- [ ] **T091** Synchronize final branch with latest `main` through normal merge and prove `behind_by=0`; no force/rebase.
- [ ] **T092** Pass exact-head CI, Work Map Integration, diagnostics, review, and zero unresolved threads.
- [ ] **T093** Merge exact validated head only after explicit authority.
- [ ] **T094** Apply authorized migrations and same-cycle readback in a separate governed stage.
- [ ] **T095** Promote current `main` to protected `Production`; Hostinger deploy remains separate from Spec PR.
- [ ] **T096** Verify `/status`, `/health`, `/version`, `/deployment-info`, hPanel pressure, File Manager write, environment-variable save, and exact Production SHA.
- [ ] **T097** Complete `completion.json`, classify remaining gaps, and record human closeout.

## Dependency graph

```text
T001 -> T002 -> T003 -> T004 -> T005 -> T006
T005 -> T010/T011/T012/T020
T010/T011/T012 -> T013/T014
T020 -> T021 -> T022 -> T023 -> T024/T025/T026 -> T027
T030/T031/T032 -> T035/T036
T033/T034/T037 -> T035/T036/T038/T039
T040/T041 -> T042 -> T043/T045/T047
T044 + T045 + T047 -> T080
T038 + T050 + T051 + T053/T054 -> T081
T042/T043/T046/T047 + T052/T057 + T081 -> T082
T082 -> T083 -> T084 -> T085
T060/T061 -> T062/T063/T064/T065
T013/T027/T039/T074/T075 + T085 -> T090 -> T091 -> T092 -> T093
T093 -> T094 -> T095 -> T096 -> T097
```

## Current implementation boundary

Completed items establish specification, conservative local tooling, pure authority logic, and CI regression only. They do not create live SQL authority, runtime routes, provider dispatch, credential access, file deletion on Hostinger, Production promotion, or deployment.

## Completion rule

`completion.json.status` remains `in_progress` until all mandatory tasks, contracts, migration/readbacks, worker certification, synthetic/canary evidence, exact-head CI, Production parity, and unresolved-gap decisions are complete.
