# Tasks

## Completed with evidence

- [x] Define operation contract schema and registry.
  - Evidence: `http-generic-api/operationContractRegistry.js`.
- [x] Define Admin/Tenant projection and redaction contracts.
  - Evidence: `http-generic-api/operationContextService.js` and separated Admin/Tenant routes.
- [x] Implement exact intent-to-operation resolver.
  - Evidence: canonical operation keys and aliases in `operationContractRegistry.js`.
- [x] Implement unified operation context and early authority preflight.
  - Evidence: bounded projections, Tenant membership, and `platform_resource_authority_bindings` checks.
- [x] Implement Repo Change Orchestrator, server-side reconciliation, CI diagnosis, persistent state, and resume.
  - Evidence: `operationOrchestrator.js`, `repositoryAutomationControlPlane.js`, ownership service, and mounted routes.
- [x] Implement JSON-only upstream errors, time/response budgets, rate limiting, circuit breaker, and recovery.
  - Evidence: `operationRuntimeGuard.js`, `operationResilienceController.js`, and deterministic regression tests.
- [x] Implement typed catalog APIs.
  - Evidence: `typedCatalogService.js`, `typedCatalogRoutes.js`, registered tests, and `openapi/typed-catalogs.yaml`.
- [x] Implement transparent response chunk aggregation.
  - Evidence: direct operation dispatches use `collectChunkedToolResponse`; registered syntax/regression coverage passes.
- [x] Implement generated-artifact registry.
  - Evidence: metadata-only service, additive migration, Admin/Tenant reads, cursor pagination, run ownership, SHA-256 metadata, and content/secret exclusion.
- [x] Implement operation-scoped capability lifecycle.
  - Evidence: governed dry-run envelopes, explicit approval blocking, expiry, bounded retry retention, consumption, and readback coverage.
- [x] Implement Managed Ephemeral Git Worker lifecycle.
  - Evidence:
    - `http-generic-api/managedGitWorkerLifecycleService.js`
    - `http-generic-api/migrations/20260715_operation_managed_git_worker_leases.sql`
    - `http-generic-api/openapi/managed-git-workers.yaml`
    - `http-generic-api/scripts/test-managed-git-worker-lifecycle.mjs`
    - Atomic lease, branch-head pinning, Tenant isolation, virtual Git-tree checkout, cleanup, expiry, and final-head readback.
- [x] Add latency, internal-call, discovery, retry, and failure dashboards.
  - Evidence:
    - `http-generic-api/operationObservabilityService.js`
    - `http-generic-api/routes/operationObservabilityRoutes.js`
    - `http-generic-api/openapi/operation-observability.yaml`
    - `http-generic-api/scripts/test-operation-observability-service.mjs`
    - Aggregate-only MySQL-primary reads, Admin/Tenant isolation, bounded windows, and no raw payload or secret exposure.
- [x] Run shadow and Admin/Tenant pilot rollout.
  - Evidence:
    - `http-generic-api/scripts/test-operation-rollout-pilots.mjs`
    - `specs/009-platform-request-execution-hardening/evidence/rollout-pilots-2026-07-15.json`
    - Shadow preview parity, Admin preview, Tenant membership/resource authority, Admin/Tenant observability, no provider mutation, and no secret/raw-payload exposure.
- [x] Pass required CI on the rollout pilot head.
  - Evidence: commit `f33623541eac45ef8187639802f0f383f52d4cb4`; Syntax, Architecture Drift, Execution Resolver, and Unit & Integration all succeeded; base `d6656a0e521095dec050b0a3cd6add86268adb45`; `behind_by: 0`.

## Merge gate

All scoped implementation, isolation, observability, and read-only rollout tasks are complete. Merge remains conditional on a same-cycle final base-freshness check, required CI success, mergeability, and release-readiness review. No deployment or production migration is included in this PR.
