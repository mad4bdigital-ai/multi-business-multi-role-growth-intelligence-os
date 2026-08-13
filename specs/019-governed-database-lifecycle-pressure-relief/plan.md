# Plan — Spec 019 Governed Database Lifecycle and Pressure Relief

## Delivery Boundary

This plan is deliberately multi-PR. The current Spec Kit PR is PR-A: specification, contracts, threat model, test matrix, Work Map integration, and E2E contract only. It contains no runtime cleanup executor, no SQL mutation, no migration apply, no deployment, and no Production database access.

## Current-State Baseline

`main` at the baseline SHA recorded in `docs/issue-execution/spec019-lifecycle-gap-assessment-20260813.txt` contains database lifecycle registry, reporting views, snapshot scheduling, scheduler binding/approval metadata, operational status, incident bridging, and read-only retention planning. `databaseTableLifecycle.js` and `databaseLifecycleDailyRuntime.js` explicitly preserve `dry_run`, `no_delete`, `no_archive_execution`, and `no_compaction_execution` behavior. The missing slice is the governed domain-aware cleanup and reclaim execution path.

## Workstreams

| Workstream | Scope | Mutation allowed in workstream |
|---|---|---|
| A — Spec and contracts | This PR: requirements, data model, operations, schemas, threat model, checklists, E2E and Work Map | No |
| B — Read-only pressure intelligence | Inspect pressure, classify resources, resolve policies, generate estimates and immutable plans | No |
| C — Authority and durable readiness | Exact database-table authority, registered recipe allowlist, mutation receipt readiness, execution bindings | No |
| D — Response-chunk pilot | TTL adapter, immutable cutoff, bounded batches, receipt, readback, retry/reconciliation | Only after B/C gates and non-production approval |
| E — Repo-audit adapter | Supersession planner and latest-observation preservation | Only after D evidence |
| F — JobRunner | Reuse registered recipes, leases, receipts, backoff, and readback | Policy-bound only |
| G — Autopilot | Low-risk policy-bound scheduling after observation period | No default activation |
| H — Engine-run archive/thin | Archive contract, lineage preservation, checksums, restore/readback | Separate approval |
| I — Physical reclaim | Assessment first; high-risk apply separately | Disabled by default |

## Sequencing and Gates

B cannot start until A is merged and Work Map readiness is green. C cannot authorize mutation until the target environment has readback evidence for `execution_plan_mutation_receipts` and the governed migration/authorization ledger. D requires a non-production resource authority binding, typed approval, bounded batch policy, and failure/reconciliation tests. E requires proof that the latest observation per file and all parent lineage invariants survive. F and G require an observation period with no unexplained readback mismatch. H and I are independent projects and are not prerequisites for the read-only planner.

## Safety Decisions

The engine must fail closed when policy, authority, receipt persistence, or preservation invariants are missing. The executor must be intentionally simple: it verifies the frozen plan and executes only a registered internal operation. It must not generate SQL or reinterpret domain semantics. Emergency pressure changes observation priority, not retention semantics.

## Rollback Strategy

PR-A rollback is a revert of documentation/contracts only. B/C rollback is feature disablement and read-only fallback. D/E rollback disables the recipe and preserves receipts/readback; it does not restore deleted rows without an approved archive/recovery contract. I requires a maintenance-window rollback plan and separate owner approval. Unknown outcomes remain in reconciliation and are never blindly retried.

## Evidence Required Before Production

Evidence must include deterministic contract tests, unit and integration tests, negative authority/policy tests, staging execution or dry-run readback, non-production pilot evidence, performance/lock-duration measurements, migration status/readback, rollback verification, security review, and same-cycle CI/merge evidence. Credentials and Production mutations are outside PR-A.
