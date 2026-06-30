# Implementation Plan

## Objective

Close Tenant GPT control-plane/execution-plane gaps without provider writes, schema changes, route changes, or changes to active PR-owned execution-preflight files.

## Architecture checks

- Reuse `tenantEffectiveCapabilityResolver` rather than duplicating policy.
- Source tenant, user, and workspace only from signed request context.
- Fail closed when capability, connection, grant, resource, endpoint, certification, or export evidence is missing.
- Keep dashboard projection in `tenantGrowthDashboardService.js` and awareness aggregation in `activationAwarenessService.js`.
- Keep public changes additive and backward-compatible.
- Perform read-only SQL and resolver evaluation only.

## Delivery phases

1. Review active branches and file ownership.
2. Create an isolated branch from pinned `main`.
3. Reconcile drift without force.
4. Make action readiness tenant-effective.
5. Make connector counts installation-aware and nullable when unavailable.
6. Derive blocked surfaces and authorization visibility from evidence.
7. Add focused regression tests.
8. Run required CI checks.
9. Complete release checklists and merge through governed PR finalization.

## Approved runtime scope

- `http-generic-api/tenantGrowthDashboardService.js`
- `http-generic-api/activationAwarenessService.js`
- `http-generic-api/test-tenant-growth-dashboard.mjs`
- `http-generic-api/test-activation-awareness-completeness.mjs`

## Exclusions

Provider dispatch, credential mutation, database migrations, OpenAPI or route changes, deployment mutation, and files owned by active PRs 1879 and 1881.
