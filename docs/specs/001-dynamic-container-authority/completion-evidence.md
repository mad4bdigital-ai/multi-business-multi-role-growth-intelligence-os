# Dynamic Container Authority Completion Evidence

## Scope

This evidence applies to branch `gpt/dynamic-container-authority-foundation-20260619` and covers the Dynamic Container Authority specification, Workspace/Brand team-management additions, SQL migrations 319 and 320, OpenAPI contracts, rollout safety, and branch-level release gates.

Branch completion does **not** authorize production migration apply, enforcement enablement, provider writes, credential payload reads, or bypass retirement. Those remain post-merge operational gates.

## Safety invariants

- SQL remains additive: no `DROP TABLE`, `TRUNCATE TABLE`, or broad `DELETE FROM` in migrations 319/320.
- Preview and shadow resolution perform no provider calls, credential payload reads, raw-secret returns, external sends, or external writes.
- Runtime enforcement is disabled by default.
- Platform Graph rows are projection-only/context-only and are never authorization authority.
- `platform_owner` does not bypass normal resolution or explicit override governance.
- Workspace and Brand team routes require User JWT and object-level authorization.
- All responses and generated evidence declare `secretsIncluded=false` or `secrets_included=false`.

## Specification and design evidence

- Specification and lifecycle: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`.
- Architecture boundaries: routes call application services; authority rules remain in resolver/domain services; SQL and cache access stay in repository/infrastructure modules.
- Canonical implementation notes: `docs/dynamic-container-authority-foundation.md`.
- API contracts: `http-generic-api/openapi.yaml` and `http-generic-api/openapi/container-authority.yaml`.

## Implementation evidence matrix

| Area | Evidence |
|---|---|
| Auth lifecycle | `dynamicContainerAuthorityResolver.js`, `test-dynamic-container-authority-runtime.mjs`; request validation occurs before state loading, provider execution is absent, and secret-like metadata is rejected. |
| Container foundation | Migration 319; `dynamicContainerAuthority.js`; cycle checks, bounded path enumeration, closure rows, authority epochs, relationship issue/readiness views, and required indexes. |
| Classifications, roles, bindings | Migration 319 plus resolver/repository tests; managed role composition, classification merge, deny-first bindings, operation matching, sharing/delegation, and over-delegation blocking. |
| Identity and projection | `dynamicContainerProjectionService.js`; Platform/Tenant/Workspace/Brand/Activity/Workflow projection, ambiguous workspace-brand hold records, and Platform Graph `projection_only`/`context_only` rows. |
| Resolver | `dynamicContainerAuthorityResolver.js`, `test-dynamic-container-authority-runtime.mjs`; bounded multi-parent resolution, typed errors, epoch retry/block, immutable evidence, cache invalidation, shadow comparison. |
| Overrides | `dynamicContainerOverrideService.js`, migration 320, runtime tests; exact scope binding, 15/60-minute caps, distinct approver rules, one-time consumption, stale/expiry/readback evidence. |
| Team management | `dynamicContainerTeamService.js`, `routes/dynamicContainerTeamRoutes.js`, `test-dynamic-container-team-management.mjs`; Co-workspaces, Workspace/Brand teams, add/update/remove, pagination, idempotency, epoch concurrency, last-admin protection. |
| API | OpenAPI 3.1 contracts for resolution, relationships, roles, bindings, overrides, Co-workspaces, and Workspace/Brand team resources; structured error envelopes and User JWT security. |
| Rollout safety | `dynamicContainerRolloutSafety.js`, migration 320 readiness views, `test-dynamic-container-rollout-safety.mjs`, and `scripts/dynamic-container-rollout-benchmark.mjs`. |
| Migration governance | `scripts/governed-migration-runner.mjs`, `test-governed-migration-runner-dynamic-authorization.mjs`, and `test-dynamic-container-migration-preflight.mjs`. |

## Migration preflight evidence

Branch-safe preflight uses the same `assessMigrationSqlPreflight`, readiness extraction, and SQL statement splitter used by the governed runner.

| Migration | Result | Statement parity | Risk count |
|---|---:|---:|---:|
| `319_sprint69_dynamic_container_authority_foundation.sql` | pass | 22 / 22 | 0 |
| `320_sprint69_dynamic_container_authority_runtime_contracts.sql` | pass | 25 / 25 | 0 |

Both migrations are bootstrap-authorized in the governed runner and self-authorize future governed dry-run/apply through `governed_migration_authorization_registry`.

A live server-side governed dry-run before merge returns `migration_not_authorized_in_db_registry` because production runs the default branch and cannot authorize branch-only migration files. This is a correct fail-closed result. The live governed dry-run must be repeated after merge and before any apply.

## Performance evidence

Synthetic resolver benchmark uses 200 cold-cache and 1,000 warm-cache preview resolutions with no provider calls, credential reads, or external writes.

Latest observed local result:

| Mode | p95 | p99 | Budget |
|---|---:|---:|---:|
| Cold preview | 0.279 ms | 0.830 ms | 150 / 400 ms |
| Warm preview | 0.025 ms | 0.076 ms | 150 / 400 ms |

The CI benchmark fails when either p95 or p99 exceeds policy.

## Rollout and rollback evidence

- Policy thresholds: mismatch <= 0.5%, critical mismatch count = 0, p95 <= 150 ms, p99 <= 400 ms, audit coverage = 100%, minimum samples = 100.
- Selected canaries remain in `shadow`: `createContainerContextResolution` and `getContainerAuthorityRolloutReadiness`.
- `v_container_resolution_performance_summary`, `v_container_audit_coverage`, and `v_container_rollout_readiness` enforce readiness order.
- Rollback drill verifies dry-run, typed confirmation, transaction begin/commit, failed-confirmation rollback, policy readback, and return to `shadow` without schema destruction.
- Promotion metadata requires readiness and allows one capability to be promoted at a time; no live promotion is performed on this branch.

## Automated validation

- Dynamic Container foundation tests: pass.
- Dynamic Container runtime tests: pass.
- Team-management tests: pass.
- Rollout safety, rollback, query-index, and graph projection tests: pass.
- Migration preflight contracts: pass.
- Activation surface coverage: 18 candidates, 18 explicit internal exclusions, 0 missing.
- Full manifest before the final preflight-test registration: 513 / 513 pass.
- Architecture validation: 173 / 173 pass.
- Final full manifest and generated-maintenance check must run again after all evidence/generated files are committed.

## Post-merge operational gates

These are deliberately not executed by the branch implementation:

1. Run governed migration dry-run for migrations 319 and 320 on production code after merge.
2. Review migration ledger/schema/readback evidence and obtain explicit apply approval.
3. Apply migrations only through the governed runner with typed confirmation.
4. Collect at least 100 shadow samples with 100% audit coverage and acceptable mismatch/p95/p99 metrics.
5. Promote exactly one read-only canary capability after readiness approval.
6. Retire legacy bypasses only after adoption evidence and same-cycle readback.

No post-merge gate is implicitly authorized by this document.
