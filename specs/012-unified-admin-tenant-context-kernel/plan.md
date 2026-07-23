# Implementation Plan: Unified Admin and Tenant Context Kernel

## Status

Specification delivery is in progress. This plan defines the implementation sequence and release gates; it does not authorize production execution, deployment, migration, or provider writes.

## Objective

Implement one shared, registry-driven context kernel for administrators, tenant users, service principals, delegated agents, and future registered principal types. The implementation must preserve tenant isolation, require an explicit effective subject for tenant-scoped mutations, and bind every governed execution to one tenant, one workspace, one target resource, one exact connection, and one authority path.

## Architectural boundaries

- API and interface adapters authenticate, validate, and project responses.
- Application services orchestrate context resolution, planning, approval, dispatch, readback, and reconciliation.
- Domain policies implement candidate eligibility, deterministic ranking, ambiguity handling, context invalidation, isolation, and retry safety.
- Infrastructure adapters isolate SQL registries, provider transports, repository operations, credentials, audit storage, and observability.
- Shared domain and application code must not contain customer-specific tenant, user, workspace, brand, resource, connection, or provider-account identifiers.

## Delivery sequence

### Phase 1: Inventory and static guardrails

1. Inventory current context, membership, resource, connection, capability, and authority resolvers.
2. Identify first-result selection, default-customer fallbacks, and customer-specific routing branches.
3. Add a report-only scanner for fixed production customer identifiers and unsafe selection patterns.
4. Establish baseline telemetry for current and shadow resolution outcomes.

### Phase 2: Domain kernel

1. Add principal, effective subject, authorized scope, context candidate, context decision, context pin, authority path, execution context, execution plan, and outcome types.
2. Implement deterministic precedence and explicit ambiguity handling.
3. Implement context hashing and the tenant/workspace/resource invalidation graph.
4. Implement cross-tenant eligibility predicates and high-risk fallback prohibition.
5. Add unit and property tests.

### Phase 3: Registry and infrastructure adapters

1. Add authorized-scope and membership repositories.
2. Add tenant-safe resource graph and exact connection repositories.
3. Add capability, readiness, authority, context-pin, and execution-ledger repositories.
4. Keep SQL table names and provider SDK details outside domain policy code.
5. Add structured error translation and redacted observability.

### Phase 4: Application use cases and API contracts

1. Implement context resolution, context switching, context pinning, plan compilation, validation, dispatch, readback, and unknown-outcome reconciliation.
2. Implement customer-safe Admin and Tenant projections from the same kernel result.
3. Validate the OpenAPI 3.1 contract and structured error envelopes.
4. Add idempotency and optimistic-concurrency contracts for retryable unsafe operations.

### Phase 5: Shadow and read-only rollout

1. Run the new resolver beside current routing without changing dispatch.
2. Compare decisions and investigate every cross-tenant or ambiguity discrepancy.
3. Enable bounded low-risk reads after parity and isolation gates pass.
4. Preserve route-level kill switches that cannot weaken authority checks.

### Phase 6: Governed writes

1. Enable tenant writes with exact resource and connection binding, idempotency, approval where required, and same-cycle readback.
2. Enable Admin tenant-scoped writes only after effective-subject and isolation evidence passes.
3. Require reconciliation before retry when provider or repository outcomes are unknown.
4. Remove legacy customer defaults and first-result routing after compatibility evidence is complete.

## Validation strategy

- Unit tests for ranking, ambiguity, hashing, invalidation, and outcome transitions.
- Property tests for order independence and tenant isolation invariants.
- Integration tests for Admin and Tenant multi-scope resolution, context switching, exact connection binding, authority expiry, and unknown outcomes.
- Security tests for direct-object references, implicit impersonation, connection substitution, replay, and projection leakage.
- Contract validation for OpenAPI 3.1, strict input, stable errors, idempotency, and pagination.
- Static checks for hardcoded customer identifiers and unsafe first-result selection.

## Release gates

- Spec Kit completion governance passes.
- OpenAPI validation passes.
- Hardcoded-customer-identifier scanner passes.
- Cross-tenant isolation tests pass.
- Critical integration and security tests pass.
- Backward compatibility and rollout risks are reviewed.
- CI passes on the implementation changes.
- Production deployment, migrations, provider writes, and protected-branch mutations require separate governed approval.

## Rollback and continuity

Rollout remains additive and feature-flagged. Rollback returns traffic to the prior routing implementation while preserving execution, approval, audit, and reconciliation evidence. Operations with unknown outcomes remain in reconciliation and are never blindly retried.
