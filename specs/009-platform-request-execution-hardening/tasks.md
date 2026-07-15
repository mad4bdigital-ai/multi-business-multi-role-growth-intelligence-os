# Tasks

## Completed with evidence

- [x] Define operation contract schema and registry.
  - Evidence: `http-generic-api/operationContractRegistry.js`.
- [x] Define Admin/Tenant projection and redaction contracts.
  - Evidence: `http-generic-api/operationContextService.js` and separated Admin/Tenant routes.
- [x] Implement exact intent-to-operation resolver.
  - Evidence: canonical operation keys and aliases in `operationContractRegistry.js`.
- [x] Implement unified operation context.
  - Evidence: bounded `summary`, `relevant`, and `full` projections.
- [x] Implement early authority preflight.
  - Evidence: tenant membership and `platform_resource_authority_bindings` checks.
- [x] Implement Repo Change Orchestrator.
  - Evidence: `operationOrchestrator.js` and mounted operation routes.
- [x] Implement server-side reconciliation without file-count limits.
  - Evidence: `repo.branch.reconcile` delegates to the repository automation control plane.
- [x] Implement CI diagnosis.
  - Evidence: `repo.ci.diagnose` and `/operations/ci-diagnose`.
- [x] Implement JSON-only upstream error adapter.
  - Evidence: stable route envelopes with `secrets_included: false`.
- [x] Implement persistent operation state and resume.
  - Evidence: `repository_automation_runs`, `operation.status.get`, and `operation.resume`.
- [x] Add Admin/Tenant isolation and authorization tests.
  - Evidence: `test-operation-run-ownership.mjs`.
- [x] Add OpenAPI 3.1 operation contracts and examples.
  - Evidence: `contracts/operation-orchestrator.openapi.yaml`.
- [x] Enforce operation time and response-size budgets.
  - Evidence: `operationRuntimeGuard.js`; timeout and response-explosion tests.
- [x] Add rate limiting with retry guidance.
  - Evidence: `operationResilienceController.js`; `429` and `Retry-After`.
- [x] Add operation circuit breaker and recovery behavior.
  - Evidence: Redis-backed state with bounded local fallback and open/half-open/closed tests.
- [x] Add timeout, response explosion, dependency outage, and rate-limit tests.
  - Evidence: `test-operation-runtime-guard.mjs` and `test-operation-resilience-controller.mjs`.
- [x] Add typed catalog APIs.
  - Evidence:
    - `http-generic-api/typedCatalogService.js`
    - `http-generic-api/routes/typedCatalogRoutes.js`
    - `http-generic-api/scripts/test-typed-catalog-service.mjs`
    - `http-generic-api/openapi/typed-catalogs.yaml`
- [x] Implement transparent response chunk aggregation for all direct operation dispatches.
  - Evidence: `operationOrchestratorRoutes.js` wraps direct dispatch with `collectChunkedToolResponse`; registered regression coverage is in `test-gpt-tools-route-syntax-regression.mjs`.
- [x] Implement generated-artifact registry.
  - Evidence:
    - `http-generic-api/operationGeneratedArtifactService.js`
    - `http-generic-api/migrations/20260714_operation_generated_artifacts.sql`
    - `http-generic-api/openapi/operation-artifacts.yaml`
    - Admin/Tenant metadata reads, cursor pagination, run ownership enforcement, SHA-256 metadata, and secret/content exclusion.
- [x] Implement operation-scoped capability lifecycle.
  - Evidence:
    - `http-generic-api/operationCapabilityLifecycleService.js`
    - `http-generic-api/routes/operationOrchestratorRoutes.js`
    - `http-generic-api/openapi/operation-capability-lifecycle.yaml`
    - `http-generic-api/test-gpt-tools-route-syntax-regression.mjs`
    - Existing valid envelopes are reused; expired envelopes are marked expired; fresh envelopes are created from governed dry-run; approval is never granted automatically; successful mutations consume their envelope; bounded retries retain it.
- [x] Pass required CI on the capability-lifecycle commit.
  - Evidence: commit `6036e8df729c40fc2dc209db25e0df60166a60b6`; Syntax, Architecture Drift, Execution Resolver, and Unit & Integration all succeeded; the branch was current with base `c734cfab028265db8ff55ce1e31364b08793dbe7`.

## Partially implemented

- [ ] Implement Managed Ephemeral Git Worker.
  - Existing managed repository automation primitives are reused; explicit checkout lease, isolation, lifecycle, cleanup, and readback evidence remain required.

## Remaining

- [ ] Add latency, internal-call, discovery, retry, and failure dashboards.
- [ ] Run shadow and Admin/Tenant pilot rollout.

## Merge gate

The PR must not merge until each remaining task is completed with same-cycle evidence or explicitly split into approved, bounded follow-up PRs with no hidden runtime dependency.
