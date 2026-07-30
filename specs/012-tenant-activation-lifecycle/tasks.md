# Tasks: Tenant GPT Activation Lifecycle

**Spec**: `specs/012-tenant-activation-lifecycle/spec.md`  
**Plan**: `specs/012-tenant-activation-lifecycle/plan.md`

## Rules

- IDs are stable and dependency ordered.
- `[P]` marks genuinely parallel work.
- Every task references requirements and operation paths.
- Mutation tasks require their own capability/approval/resource authority and readback.
- This specification PR does not authorize implementation tasks.

## Phase 0 — Clarification and baseline

- [x] **T001** `[FR-001..040][OP-001..018]` Inventory all current Tenant Activation and Resolution public operations, operation IDs, auth schemes, route handlers, middleware, and consumers. Evidence: `implementation/pr-1-inventory.json` and `implementation/pr-1-inventory.md`.
- [x] **T002** `[FR-019][OP-006][OP-008]` Inventory SQL/bootstrap/provider validation authority and deprecated paths. Evidence: backend-runtime/DB bootstrap authority, same-cycle provider validation chain, and deprecated no-Sheets alias in `implementation/pr-1-inventory.json`.
- [x] **T003** `[FR-026..032][OP-010..014]` Inventory existing operation, attempt, evidence, delivery, acknowledgement, and reconciliation tables/services. Evidence: `physical_mappings` in `implementation/pr-1-inventory.json`.
- [x] **T004** `[ADR-001]` Adopt the hybrid operation model: general operation ledger for shared identity/idempotency/audit plus an Activation-specific projection linked by `operation_id`. Decision recorded in `decisions/ADR-001-hybrid-activation-operation-ledger.md`. Physical table mapping remains T001-T003/T014.
- [x] **T005** `[ADR-002][ADR-003][FR-006]` Approve phased legacy generic-token cutoff, targeted telemetry/communication, cleanup policy, and one unified Tenant GPT OAuth client with resource-bound external access tokens.
- [x] **T006** `[ADR-004][FR-008..012][FR-022..025]` Keep Resolution under the Activation protected resource, adopt five stable coarse scopes, and resolve route/action authorization dynamically from a versioned governed SQL policy registry. Route inventory, policy-row mapping, parity tests, and canonical contract work remain implementation tasks.
- [x] **T007** `[ADR-005][NFR-002..004]` Adopt the Governed Interactive Policy Questionnaire Engine for Activation stage SLO, timeout, retry, freshness, degradation, and synchronous/asynchronous policy.
- [ ] **T007A** `[ADR-005][NFR-002..004]` Measure production baselines and publish versioned starter profiles (`fast`, `balanced`, `complete`, `high_reliability`) with approved safety bounds, compiler version, impact model, rollout, and rollback evidence.
- [x] **T008** `[ADR-006][FR-033..035]` Adopt tiered deployment evidence exposure: opaque release/version states for Tenant/public diagnostics and full Git/deployment parity evidence for authorized Admin/service diagnostics.
- [ ] **T009** `[C-017][C-018]` Complete data classification, retention, and redaction review.

## Phase 1 — Contract and state finalization

- [x] **T010** `[P][FR-001..012][OP-001..004]` Finalize OAuth/gateway OpenAPI operations, security schemes, and errors. Evidence: `implementation/pr-3-contract-finalization.json`, `implementation/pr-3-contract-finalization.md`, final target OpenAPI metadata, and green `test-activation-contract-finalization.mjs` on PR #3122.
- [x] **T011** `[P][FR-013..025][OP-005..010]` Finalize session/bootstrap/tool operation contracts. Evidence: runtime-current versus target-lifecycle classification, OP-005..010 coverage, and green contract-finalization parity CI on PR #3122.
- [x] **T012** `[P][FR-026..032][OP-011..014]` Finalize operation status, retry, delivery, acknowledgement, and reconciliation contracts. Evidence: target lifecycle operations, merged lifecycle authority linkage, OP-011..014 coverage, and green contract-finalization parity CI on PR #3122.
- [x] **T013** `[P][FR-033..040][OP-016..018]` Finalize deployment/operational evidence contracts. Evidence: bounded tenant deployment exposure, Admin-only full evidence separation, OP-016..018 coverage, and green contract-finalization parity CI on PR #3122.
- [x] **T014** `[data-model]` Map logical entities to existing/new SQL tables and define indexes/constraints/retention. Evidence: `data-model.md` PR-1 mapping and `implementation/pr-1-inventory.json`; retention remains gated by T009.
- [x] **T015** `[state machine]` Approve operation/stage/delivery/ack state transitions and terminal semantics. Evidence: `implementation/pr-2a-lifecycle-contracts.json`, `implementation/pr-2a-lifecycle-contracts.md`, and green `test-activation-lifecycle-contract-foundation.mjs` on PR #3085.
- [x] **T016** `[errors]` Freeze stable error taxonomy and reconnect-guidance mapping. Evidence: machine-readable error/reconnect matrix in `implementation/pr-2a-lifecycle-contracts.json`, parity against `spec.md`, and green CI on PR #3085.
- [x] **T017** `[compatibility]` Define optional fields, compatibility window, and deprecation/cutoff. Evidence: ADR-002 parity, hard cutoff/extension/cleanup rules, and green CI on PR #3085.
- [ ] **T018** `[ADR-005]` Finalize generic questionnaire/session/answer/compilation/proposal/preview/approval/activation/readback/rollback API and JSON Schema contracts.
- [ ] **T019** `[ADR-005]` Finalize domain safety-bound registry, deterministic compiler contract, risk-to-approval matrix, version provenance, cache-invalidation policy, and platform domain-adoption gate.

## Phase 2 — Data and domain foundation

- [ ] **T020** `[FR-026..032][OP-010..014]` Implement or extend durable activation operation repository and optimistic versioning.
- [ ] **T021** `[FR-027][OP-010..014]` Implement stage attempt and evidence repositories with bounded no-secret summaries.
- [ ] **T022** `[FR-031][OP-011]` Implement delivery and acknowledgement repositories/services.
- [ ] **T023** `[FR-029..030][OP-014]` Implement reconciliation repository and state transitions.
- [ ] **T024** `[FR-033..035][OP-016]` Implement deployment observation adapter/projection with request-time historical correlation and authoritative main/deployed/health/contract evidence.
- [ ] **T024A** `[ADR-006][FR-033..035]` Implement opaque release-ID generation, `current/deploying/stale/diverged/unknown` classification, tenant `none/opaque/diagnostic` exposure, optional `Deployment-Revision` header, and Admin-only full parity evidence.
- [ ] **T024B** `[ADR-005][ADR-006]` Implement versioned `deployment_evidence_exposure_policy` questionnaire adapter, immutable principal exposure ceilings, exact-version registry readback, and critical cache invalidation.
- [ ] **T025** `[FR-037][concerns]` Implement operational attention projection rules.
- [ ] **T026** `[migration]` Add governed additive migration and readback if inventory requires schema change.
- [ ] **T027** `[domain]` Implement activation lifecycle state machine.
- [x] **T028** `[domain]` Implement stage classification and reconnect-guidance policy. Evidence: `http-generic-api/activationReconnectGuidancePolicy.js`, deterministic contract and inherited-key regressions in `http-generic-api/test-activation-reconnect-guidance-policy.mjs`, explicit CI registration, green CI and Frontend surface dispatch on PR #3296, squash merge `3a4a643c64e16ccddafd3967c6b87b3f1b4ad7a0`, and same-cycle `main` readback.
- [ ] **T029** `[domain]` Implement retry, idempotency, and reconcile-before-retry policy.
- [ ] **T029A** `[ADR-005]` Implement versioned questionnaire definitions, context-aware question selection, pinned answer sessions, and schema validation.
- [ ] **T029B** `[ADR-005]` Implement deterministic policy compilation, immutable safety-bound validation, impact preview, risk classification, and approval resolution.
- [ ] **T029C** `[ADR-005]` Implement governed policy proposal activation, exact-version SQL registry readback, cache invalidation, supersession, and rollback.
- [ ] **T029D** `[ADR-005][T007A]` Implement the Activation stage SLO questionnaire adapter and versioned starter profiles after production baseline measurement.

## Phase 3 — OAuth and gateway correlation

- [ ] **T030** `[FR-001..007][OP-001..003]` Integrate operation/correlation evidence with OAuth authorize/code/token without exposing secrets.
- [ ] **T031** `[FR-003..004][C-007]` Harden atomic code consumption and ambiguous token-response behavior.
- [ ] **T032** `[FR-005..006][C-004][C-026]` Add single-audience/legacy compatibility telemetry and cutoff enforcement.
- [ ] **T033** `[FR-008..012][OP-004]` Attach verified principal and gateway stage evidence before route dispatch.
- [ ] **T034** `[FR-010][C-003]` Eliminate/deny tenant, user, role, workspace, and resource overrides.
- [ ] **T035** `[FR-026][C-023]` Implement OAuth-to-gateway gap classification and metric.

## Phase 4 — Session, bootstrap, tools, and readiness

- [ ] **T040** `[FR-013..015][OP-005]` Integrate session-context stage with create/reuse/read-only policy and bounded evidence.
- [ ] **T041** `[FR-016..018][OP-006..007]` Implement Managed default and Dedicated/mixed readiness classification.
- [ ] **T042** `[FR-019][OP-006]` Enforce backend runtime bootstrap authority and remove deprecated Sheets path usage.
- [ ] **T043** `[FR-020..021][OP-008]` Integrate provider-bootstrap stage and evidence classifications.
- [ ] **T044** `[FR-022..024][OP-009..010]` Integrate tenant tool discovery and separate visibility/dependency/credential/execution readiness.
- [ ] **T045** `[FR-023..025][OP-010]` Integrate registry-resolved dispatch preparation and sensitive-action block policy.
- [ ] **T046** `[FR-038][OP-004..008]` Replace generic connection fallback with stage-specific remediation.

## Phase 5 — Retry, reconciliation, delivery, and status

- [ ] **T050** `[FR-026..030][OP-013..014]` Persist stage attempts, retry budgets, unknown outcomes, and reconciliation results.
- [ ] **T051** `[FR-028..030][C-009][C-010]` Add idempotency and duplicate suppression for unsafe retryable operations.
- [ ] **T052** `[FR-031..032][OP-011]` Implement bounded activation status response from authoritative evidence.
- [ ] **T053** `[FR-031][OP-011]` Implement delivery retry without execution replay.
- [ ] **T054** `[FR-031][OP-011]` Implement acknowledgement capture/status retrieval.
- [ ] **T055** `[FR-030][C-023]` Require same-operation evidence for recovered success.

## Phase 6 — Observability and operational recovery

- [ ] **T060** `[NFR-004][concerns]` Add structured logs/traces for operation/stage/deployment/delivery with redaction.
- [ ] **T061** `[FR-037][concerns]` Add stage/error/latency/retry/legacy/gap/deployment metrics and alerts.
- [ ] **T062** `[FR-033..035][OP-016]` Add deployment freshness classification to operator diagnostics.
- [ ] **T063** `[FR-039][OP-017]` Add governed targeted recovery operations and same-cycle readback.
- [ ] **T064** `[FR-036][OP-018]` Add feature-disable/rollback controls and in-flight reconciliation.
- [ ] **T065** `[C-036]` Publish operator/user remediation runbooks by stage.

## Phase 7 — Tests and fault injection

- [ ] **T070** `[P][FR-001..007][OP-001..003]` Add OAuth client/callback/resource/code/replay/concurrency tests.
- [ ] **T071** `[P][FR-008..012][OP-004]` Add gateway issuer/audience/resource/purpose/cross-tenant/revocation tests.
- [ ] **T072** `[P][FR-013..021][OP-005..008]` Add session/bootstrap/mode/provider classification tests.
- [ ] **T073** `[P][FR-022..025][OP-009..010]` Add tool scope/readiness/forbidden key/sensitive-action tests.
- [ ] **T074** `[P][FR-026..032][OP-011..014]` Add state/idempotency/unknown-outcome/reconciliation/delivery/ack tests.
- [ ] **T075** `[P][ADR-006][FR-033..040][OP-016..018]` Add deployment freshness/rollback/recovery tests covering opaque versus Admin evidence, tenant denial of `admin_full`, header/body consistency, all five deployment states, historical request-time correlation, `unknown` on incomplete evidence, and no reconnect guidance for deployment mismatch.
- [x] **T076** `[contracts]` Add OpenAPI/JSON Schema/canonical-generated parity tests. Evidence: `http-generic-api/test-tenant-activation-contract-inventory-parity.mjs` is wired into CI and passed on PR #3036.
- [ ] **T077** `[C-017][C-031]` Add secret/log-injection/oversized-input security tests.
- [ ] **T078** `[fault injection]` Add dependency 401/403/429/5xx/timeout/database conflict/cache-stale scenarios.
- [ ] **T079** `[production]` Add protected Tenant user JWT smoke and rollback smoke.

## Phase 8 — Canonicals, documentation, and CI

- [ ] **T080** Update canonical OpenAPI sources and run `node build-canonicals.mjs`.
- [ ] **T081** Update API examples, errors, metadata, and compatibility documentation.
- [ ] **T082** Update `AI_Agent_Knowledge_Guide.md` and affected runbooks/canonical docs.
- [ ] **T083** Add CI gates for lifecycle contract, state transition, secret scan, and production smoke prerequisites.
- [ ] **T084** Validate folder map/ownership documentation for new modules or directories.

## Phase 9 — Rollout

- [ ] **T090** Deploy shadow evidence and compare classifications to current runtime.
- [ ] **T091** Enable internal/operator lifecycle status.
- [ ] **T092** Enable tenant canary and monitor approved thresholds.
- [ ] **T093** Complete GA readiness review and feature rollout.
- [ ] **T094** End legacy compatibility at approved cutoff and remove dead paths.

## Phase 10 — Governed delivery and closeout

- [ ] **T100** Open implementation PRs with scope, tests, risks, API/database impact, rollout, and rollback.
- [ ] **T101** Keep each branch fresh with `main` without force; pass required CI.
- [ ] **T102** Obtain fresh merge authority bound to exact head/base SHA.
- [ ] **T103** Verify migrations/registries after merge where applicable.
- [ ] **T104** Verify GitHub `main` and Hostinger production parity.
- [ ] **T105** Verify health and protected Tenant user-path activation smoke.
- [ ] **T106** Verify degraded, reconnect, stale-deployment, retry, unknown-outcome, and rollback scenarios.
- [ ] **T107** Validate no unresolved critical/high concerns and assign remaining gaps.
- [ ] **T108** Update `completion.json` with authoritative evidence and no secrets.
- [ ] **T109** Create closeout PR and archive only superseded historical material.

## Dependency graph

```text
T001-T009
  → T010-T017
  → T020-T029
  → {T030-T035, T040-T046}
  → T050-T055
  → T060-T065
  → T070-T079
  → T080-T084
  → T090-T094
  → T100-T109
```

Safe parallel groups are explicitly marked `[P]`; all other tasks require dependency review before parallel execution.

## Completion rule

No implementation or closeout task is complete from narrative alone. Each completed task must cite code commit/PR, test result, migration/registry readback, deployment parity, runtime smoke, or approved operational evidence. `completion.json.status` remains non-complete until T100-T109 pass.
