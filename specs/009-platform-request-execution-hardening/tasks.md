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
  - Evidence: `repo.branch.reconcile` delegates to repository automation control plane.
- [x] Implement CI diagnosis.
  - Evidence: `repo.ci.diagnose` and `/operations/ci-diagnose`.
- [x] Implement JSON-only upstream error adapter.
  - Evidence: stable route envelopes with `secrets_included: false`.
- [x] Implement persistent operation state and resume.
  - Evidence: `repository_automation_runs`, `operation.status.get`, and `operation.resume`.
- [x] Add Admin/Tenant isolation and authorization tests.
  - Evidence: `test-operation-run-ownership.mjs`.
- [x] Add OpenAPI 3.1 contracts and examples.
  - Evidence: `contracts/operation-orchestrator.openapi.yaml`.
- [x] Enforce operation time and response-size budgets.
  - Evidence: `operationRuntimeGuard.js`; timeout and response-explosion tests.
- [x] Add rate limiting with retry guidance.
  - Evidence: `operationResilienceController.js`; `429`, `Retry-After`, and deterministic tests.
- [x] Add operation circuit breaker and recovery behavior.
  - Evidence: Redis-backed state with bounded local fallback, open/half-open/closed tests.
- [x] Add timeout, response explosion, dependency outage, and rate-limit tests.
  - Evidence: `test-operation-runtime-guard.mjs` and `test-operation-resilience-controller.mjs`.
- [x] Pass required CI on the resilience head.
  - Evidence: head `528f9af72ef0ca4635d8f019c15853edf197b2f3`; Syntax, Architecture Drift, Execution Resolver, and Unit & Integration all succeeded.

## Partially implemented

- [ ] Implement Managed Ephemeral Git Worker.
  - Existing managed repository automation primitives are reused; explicit worker lifecycle evidence remains required.
- [ ] Implement operation-scoped capability lifecycle.
  - Capability envelopes are required by mutation contracts; automatic renewal and expiry handling remain.

## Remaining

- [ ] Implement generated-artifact registry.
- [ ] Implement transparent response chunk aggregation.
- [ ] Add typed catalog APIs.
- [ ] Add latency, internal-call, discovery, retry, and failure dashboards.
- [ ] Run shadow and pilot rollout.

## Merge gate

The PR must not merge until each remaining task is completed with same-cycle evidence or explicitly split into approved, bounded follow-up PRs with no hidden runtime dependency.
