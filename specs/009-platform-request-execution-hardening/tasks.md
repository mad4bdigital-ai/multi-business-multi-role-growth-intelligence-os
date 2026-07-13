# Tasks

## Completed with evidence

- [x] Define operation contract schema and registry.
  - Evidence: `http-generic-api/operationContractRegistry.js`.
- [x] Define Admin/Tenant projection and redaction contracts.
  - Evidence: `http-generic-api/operationContextService.js` and Admin/Tenant route separation.
- [x] Implement exact intent-to-operation resolver.
  - Evidence: canonical operation keys and aliases in `operationContractRegistry.js`.
- [x] Implement unified operation context.
  - Evidence: bounded `summary`, `relevant`, and `full` projections in `operationContextService.js`.
- [x] Implement early authority preflight.
  - Evidence: tenant membership and `platform_resource_authority_bindings` checks before execution.
- [x] Implement Repo Change Orchestrator.
  - Evidence: `operationOrchestrator.js` and mounted Admin/Tenant operation routes.
- [x] Implement server-side reconciliation without file-count limits.
  - Evidence: `repo.branch.reconcile` delegates to the existing repository automation control plane.
- [x] Implement CI diagnosis.
  - Evidence: `repo.ci.diagnose` and `/operations/ci-diagnose`.
- [x] Implement JSON-only upstream error adapter.
  - Evidence: structured route error envelopes with stable codes and `secrets_included: false`.
- [x] Implement persistent operation state and resume.
  - Evidence: `repository_automation_runs`, `operation.status.get`, and `operation.resume`.
- [x] Add Admin/Tenant isolation and authorization tests.
  - Evidence: `test-operation-run-ownership.mjs`; Tenant A cannot read or resume Tenant B runs.
- [x] Add OpenAPI 3.1 contracts and examples.
  - Evidence: `contracts/operation-orchestrator.openapi.yaml` synchronized with implemented routes.

## Partially implemented

- [ ] Implement Managed Ephemeral Git Worker.
  - Existing managed repository automation primitives are reused, but explicit worker lifecycle evidence remains required.
- [ ] Implement operation-scoped capability lifecycle.
  - Capability envelopes are required by mutation contracts; automatic renewal and expiry handling remain.
- [ ] Implement execution budgets and circuit breakers.
  - Per-operation budgets are registered; runtime enforcement and circuit-breaker telemetry remain.

## Remaining

- [ ] Implement generated-artifact registry.
- [ ] Implement transparent response chunk aggregation.
- [ ] Add typed catalog APIs.
- [ ] Add timeout, response explosion, rate-limit, and 503 tests.
- [ ] Add latency, internal-call, discovery, retry, and failure dashboards.
- [ ] Run shadow and pilot rollout.

## Merge gate

The PR must not merge until every remaining task is either completed with same-cycle evidence or explicitly split into approved follow-up PRs with bounded rollout and no hidden runtime dependency.
