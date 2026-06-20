# Task Breakdown

Branch-level implementation evidence is recorded in [`completion-evidence.md`](./completion-evidence.md). Checked items mean the implementation, tests, and branch-safe gates are complete. They do not authorize production migration apply or enforcement.

## Specification
- [x] Domain/tenancy, merge, threat, DB/index, API, performance, and rollout reviews. Evidence: `spec.md`, `plan.md`, `research.md`, `data-model.md`, API contracts, migration preflight, benchmark, and rollout-safety tests.
- [x] Design-freeze approval. Evidence: the specification/plan are the frozen branch scope; later Co-workspace and Workspace/Brand team management additions are documented and tested without changing authority invariants.

## Auth lifecycle
- [x] Authorization/schema before credential materialization. Evidence: resolver boundary validation and runtime regression tests.
- [x] Remove actionless provider clients. Evidence: Dynamic Container services create no provider clients and make no provider calls.
- [x] Prove preview has zero secret/token/provider side effects. Evidence: immutable ledger markers, preview tests, benchmark output, and no-secret assertions.
- [x] Add regression tests. Evidence: `test-dynamic-container-authority-runtime.mjs`, `test-dynamic-container-team-management.mjs`, and `test-dynamic-container-rollout-safety.mjs`.

## Container foundation
- [x] Type/container registries. Evidence: migration 319.
- [x] Relationship registry and rows. Evidence: migration 319 and runtime tests.
- [x] Transaction-safe cycle preflight. Evidence: mutation service and cycle regression tests.
- [x] Closure and bounded rebuild. Evidence: closure tables/helpers, bounded path tests, and relationship-issue views.
- [x] Authority epoch/invalidation. Evidence: epoch table, mutation transactions, cache invalidation events, and stale-epoch tests.
- [x] Readiness views/indexes/default topology. Evidence: migrations 319/320, query-index contracts, and rollout readiness tests.

## Classifications, roles, and bindings
- [x] Classification schema/assignment/merge. Evidence: migration 319 and resolver tests.
- [x] Role templates/composition/assignments. Evidence: managed role registries, composition tests, and Workspace/Brand team service.
- [x] Resource dimension registry/bindings. Evidence: migration 319 and repository/resolver contracts.
- [x] Deny/restrict and operation matching. Evidence: deny-first and operation-pattern regression tests.
- [x] Delegator-authority validation. Evidence: sharing/delegation and over-delegation tests.
- [x] Legacy adapters. Evidence: projection service, shadow comparison, and bounded legacy evidence references.

## Identity and projections
- [x] Project Platform/Tenant/Workspace. Evidence: `dynamicContainerProjectionService.js` and runtime tests.
- [x] Project Brands via `brands.target_key`. Evidence: projection plan and ambiguity handling.
- [x] Hold ambiguous workspace-brand links. Evidence: `container_identity_projection_issues` with high-risk hold status.
- [x] Project Activity/Workflow. Evidence: projection service source loaders and generated container relationships.
- [x] Project to Platform Graph with taxonomy validation. Evidence: projection-only/context-only graph rows and graph-authority regression assertions.

## Resolver
- [x] Bounded multi-parent loader. Evidence: path limits and multi-parent tests.
- [x] Classification/role/binding/share/delegation resolution. Evidence: resolver and runtime tests.
- [x] Typed conflicts and limit exhaustion. Evidence: stable error codes and limit tests.
- [x] Authority-epoch retry/block. Evidence: retry-once logic and stale-epoch tests.
- [x] Immutable no-secret snapshots. Evidence: effective-context ledger schema and no-secret markers.
- [x] Epoch-bound cache/invalidation. Evidence: resolver cache key, epoch readback, and invalidation tests.
- [x] Shadow comparison dashboard. Evidence: shadow comparison tables/views and rollout readiness surface.

## Overrides
- [x] Envelope-linked request/approval records. Evidence: override request/approval schemas and service tests.
- [x] Normal resolution first. Evidence: override flow starts from a persisted normal resolution.
- [x] Exact path/dimension/resource/operation/snapshot. Evidence: exact-scope fields and tests.
- [x] 15/60 minute caps. Evidence: override policy registry and TTL assertions.
- [x] Distinct second approver for critical classes. Evidence: critical/destructive/credential/deployment policy tests.
- [x] Atomic one-time consumption. Evidence: transaction/consumption table and replay tests.
- [x] Remove implicit platform-owner bypass in canary. Evidence: platform-owner role metadata and no-bypass resolver tests.
- [x] Use/readback/stale/expiry evidence. Evidence: override readiness view and service regression tests.

## API and tests
- [x] Resolution, relationship, role, binding, override resources. Evidence: `openapi/container-authority.yaml` and route coverage tests.
- [x] Structured 400/401/403/404/409/422/429/503 examples. Evidence: OpenAPI 3.1 error envelopes and route contracts.
- [x] Idempotency and optimistic concurrency. Evidence: idempotency store, `Idempotency-Key`, `If-Match`, and authority-epoch tests.
- [x] Multi-parent, cycle, conflict, deny, share/delegation, over-delegation, pre-credential block, platform owner, dual approval, stale epoch, replay, cross-tenant, preview side effects, audit hash, cache invalidation, and query-plan tests. Evidence: Dynamic Container foundation/runtime/team/rollout/preflight test suites.

## Co-workspace and team management
- [x] Co-workspace discovery with cursor pagination and inherited-authority filtering.
- [x] Workspace team list/add/update/remove resources.
- [x] Brand team list/add/update/remove resources.
- [x] User JWT and object-level authorization.
- [x] Workspace tenant-membership bootstrap with least privilege.
- [x] Brand membership precondition and cross-tenant guard.
- [x] Last-container-admin protection.
- [x] Partial PATCH, metadata preservation, idempotency, epoch concurrency, and cache invalidation.
- [x] OpenAPI and regression coverage for all nine operations.

## Rollout
- [x] Define mismatch/latency thresholds. Evidence: 0.5% mismatch, zero critical mismatch, 150 ms p95, 400 ms p99, 100% audit coverage, 100 minimum samples.
- [x] Select read-only canaries. Evidence: `createContainerContextResolution` and `getContainerAuthorityRolloutReadiness`, selected in `shadow` with no provider/credential/external-write side effects.
- [x] Require 100% audit coverage. Evidence: `v_container_audit_coverage` and readiness evaluator tests.
- [x] Run rollback drill. Evidence: dry-run, typed confirmation, transaction rollback/commit, and policy readback tests.
- [x] Promote one capability at a time. Evidence: canary records and promotion metadata are capability-scoped; branch execution intentionally performs no live promotion.
- [x] Retire bypasses only after adoption evidence. Evidence: platform-owner implicit bypass is removed, while legacy bypass retirement is explicitly held behind post-merge adoption evidence.

## Branch validation
- [x] Migration 319 branch-safe preflight: pass, 22/22 statements, zero risks.
- [x] Migration 320 branch-safe preflight: pass, 25/25 statements, zero risks.
- [x] Resolver benchmark below p95/p99 budgets for cold and warm preview paths.
- [x] Activation surface coverage: 18 internal tables explicitly excluded, zero missing surfaces.
- [x] Full manifest passed before final evidence registration: 513/513.
- [x] Architecture validation: 173/173.
- [ ] Final full manifest after the final evidence/generated-file commit.
- [ ] Final deterministic maintenance check after generated artifacts are committed.

## Post-merge operational gates
- [ ] Run production governed migration dry-run for migrations 319 and 320 after the default branch contains their bootstrap authorization.
- [ ] Obtain explicit approval and typed confirmation before migration apply.
- [ ] Apply migrations through the governed runner and verify migration-ledger/schema/readback evidence.
- [ ] Collect at least 100 shadow samples with 100% audit coverage and acceptable mismatch/p95/p99 metrics.
- [ ] Promote exactly one read-only canary after readiness approval.
- [ ] Retire remaining legacy bypasses only after adoption evidence and same-cycle readback.
