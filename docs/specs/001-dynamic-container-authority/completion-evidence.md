# Dynamic Container Authority Completion Evidence

## Scope

This evidence applies to branch `gpt/dynamic-container-authority-foundation-20260619` and covers the Dynamic Container Authority specification, Workspace/Brand team-management additions, SQL migrations 319 and 320, OpenAPI contracts, rollout safety, query-plan verification, and branch-level release gates.

Branch completion does **not** authorize production migration apply, enforcement enablement, provider writes, credential payload reads, live canary promotion, or bypass retirement. Those remain post-merge operational gates.

## Safety invariants

- SQL remains additive: no `DROP TABLE`, `TRUNCATE TABLE`, or broad `DELETE FROM` in migrations 319/320.
- Preview and shadow resolution perform no provider calls, credential payload reads, raw-secret returns, external sends, or external writes.
- Runtime enforcement is disabled by default.
- Platform Graph rows are projection-only/context-only and are never authorization authority.
- `platform_owner` does not bypass normal resolution or explicit override governance.
- Workspace and Brand team routes require User JWT and object-level authorization.
- All responses and generated evidence declare `secretsIncluded=false` or `secrets_included=false`.

## Specification and design evidence

- Specification and lifecycle: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `inheritance-matrix.md`, `resolution-algorithm.md`, `quickstart.md`, and `contracts/`.
- Security model: `threat-model.md` and `checklists/requirements.md`.
- Architecture boundaries: routes call application services; authority rules remain in resolver/domain services; SQL, cache, and query-plan access stay in repository/infrastructure modules.
- Canonical implementation notes: `docs/dynamic-container-authority-foundation.md`.
- API contracts: `http-generic-api/openapi.yaml` and `http-generic-api/openapi/container-authority.yaml`.

## Implementation evidence matrix

| Area | Evidence |
|---|---|
| Auth lifecycle | `dynamicContainerAuthorityResolver.js`, `test-dynamic-container-authority-runtime.mjs`; request validation occurs before state loading, provider execution is absent, and secret-like metadata is rejected. |
| Container foundation | Migration 319; `dynamicContainerAuthority.js`; cycle checks, bounded path enumeration, closure rows, authority epochs, relationship issue/readiness views, and required indexes. |
| Classifications, roles, bindings | Migration 319 plus resolver/repository tests; managed role composition, classification merge, deny-first bindings, operation matching, sharing/delegation, and over-delegation blocking. |
| Identity and projection | `dynamicContainerProjectionService.js`; Platform/Tenant/Workspace/Brand/Activity/Workflow projection, ambiguous workspace-brand hold records, and Platform Graph `projection_only`/`context_only` rows with `runtime_enforced=0`. |
| Resolver | `dynamicContainerAuthorityResolver.js`, `test-dynamic-container-authority-runtime.mjs`; bounded multi-parent resolution, typed errors, epoch retry/block, immutable evidence, cache invalidation, and shadow comparison. |
| Overrides | `dynamicContainerOverrideService.js`, migration 320, runtime tests; exact scope binding, 15/60-minute caps, distinct approver rules, one-time consumption, stale/expiry/readback evidence. |
| Team management | `dynamicContainerTeamService.js`, `routes/dynamicContainerTeamRoutes.js`, `test-dynamic-container-team-management.mjs`; Co-workspaces, Workspace/Brand teams, add/update/remove, pagination, idempotency, epoch concurrency, and last-admin protection. |
| API | OpenAPI 3.1 contracts for resolution, relationships, roles, bindings, overrides, Co-workspaces, and Workspace/Brand team resources; structured errors, request IDs, User JWT security, and cursor pagination. |
| Rollout safety | `dynamicContainerRolloutSafety.js`, migration 320 readiness views, `test-dynamic-container-rollout-safety.mjs`, and `scripts/dynamic-container-rollout-benchmark.mjs`. |
| Query plans | `dynamicContainerQueryPlanPreflight.js` executes four post-migration `EXPLAIN` checks and fails when expected indexes are not selected. |
| Migration governance | `scripts/governed-migration-runner.mjs`, `test-governed-migration-runner-dynamic-authorization.mjs`, and `test-dynamic-container-migration-preflight.mjs`. |

## Migration preflight evidence

Branch-safe preflight uses the same `assessMigrationSqlPreflight`, readiness extraction, and SQL statement splitter used by the governed runner.

| Migration | Result | Statement parity | Risk count | Destructive count |
|---|---:|---:|---:|---:|
| `319_sprint69_dynamic_container_authority_foundation.sql` | pass | 22 / 22 | 0 | 0 |
| `320_sprint69_dynamic_container_authority_runtime_contracts.sql` | pass | 25 / 25 | 0 | 0 |

Both migrations are bootstrap-authorized in the governed runner and self-authorize future governed dry-run/apply through `governed_migration_authorization_registry`.

The local governed runner fails closed without DB environment variables and therefore performs no SQL. Server release readiness for the current production baseline is 70/70 pass with no actionable migration drift or checksum mismatch. Because migrations 319/320 are branch-only until merge, their exact governed server dry-run must be repeated after merge and before any apply.

## Query-plan evidence

`dynamicContainerQueryPlanPreflight.js` runs `EXPLAIN` against the four critical post-migration access paths and requires these selected indexes:

- `idx_cr_tenant_from_status`
- `idx_cra_principal_status`
- `idx_crb_tenant_resource_status`
- `idx_crps_mode_created`

The test suite proves both pass and fail-closed behavior (`key=null`, full scan) without applying SQL.

## Performance evidence

Synthetic resolver benchmark uses 200 cold-cache and 1,000 warm-cache preview resolutions with no provider calls, credential reads, or external writes.

Latest observed local result:

| Mode | p95 | p99 | Budget |
|---|---:|---:|---:|
| Cold preview | 0.323 ms | 0.719 ms | 150 / 400 ms |
| Warm preview | 0.029 ms | 0.079 ms | 150 / 400 ms |

The CI benchmark fails when either p95 or p99 exceeds policy.

## Rollout and rollback evidence

- Policy thresholds: mismatch <= 0.5%, critical mismatch count = 0, p95 <= 150 ms, p99 <= 400 ms, audit coverage = 100%, minimum samples = 100.
- Selected canary candidates remain in `shadow`: `createContainerContextResolution` and `getContainerAuthorityRolloutReadiness`.
- `v_container_resolution_performance_summary`, `v_container_audit_coverage`, and `v_container_rollout_readiness` enforce readiness order.
- Rollback drill verifies dry-run, typed confirmation, transaction begin/commit, failed-confirmation rollback, policy readback, and return to `shadow` without schema destruction.
- Canary promotion requires `ready_for_review`, read-only operation class, typed confirmation, transaction lock, exact-row update, and readback; another active canary blocks promotion.
- Bypass retirement requires enforced mode, complete adoption, stable readiness windows, 100% audit coverage, zero mismatch, and zero active overrides.
- No live canary promotion or bypass retirement is performed by this branch.

## Automated validation

- Dynamic Container foundation tests: pass.
- Dynamic Container runtime tests: pass.
- Team-management tests: pass.
- Rollout safety, rollback, single-canary, bypass-retirement, query-plan, and graph projection tests: pass.
- Migration preflight and governed authorization contracts: pass.
- Activation surface coverage: 18 candidates, 18 explicit internal exclusions, 0 missing.
- Full repository manifest: **514 / 514 passed**.
- Architecture validation: **173 / 173 passed**.
- Requirements quality checklist: complete.
- Task checklist: complete.
- Maintenance artifacts are regenerated from the final branch state and must pass deterministic check mode before PR merge.

## Post-merge operational gates

These are deliberately not executed by the branch implementation:

1. Run governed migration dry-run for migrations 319 and 320 on production code after merge.
2. Review migration ledger/schema/readback evidence and obtain explicit apply approval.
3. Apply migrations only through the governed runner with typed confirmation.
4. Collect at least 100 shadow samples with 100% audit coverage and acceptable mismatch/p95/p99 metrics.
5. Promote exactly one read-only canary capability after readiness approval.
6. Retire legacy bypasses only after enforced adoption evidence, stable readiness windows, zero active overrides, and same-cycle readback.

No post-merge gate is implicitly authorized by this document.
