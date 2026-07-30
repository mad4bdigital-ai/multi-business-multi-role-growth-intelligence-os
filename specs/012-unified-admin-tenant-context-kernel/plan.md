# Implementation Plan: Unified Admin and Tenant Context Kernel

## Status

Specification delivery is in progress. This plan defines the implementation sequence and release gates; it does not authorize production execution, deployment, migration, provider writes, credential mutation, or protected-branch writes.

## Objective

Implement one shared, registry-driven context kernel for administrators, tenant users, service principals, delegated agents, and future registered principal types. The implementation must preserve tenant isolation, require an explicit effective subject for tenant-scoped mutations, and bind every governed execution to one tenant, one workspace, one target resource, one exact connection, and one authority path.

The connection extension must support personal-workspace, company-workspace, and brand ownership while preventing cross-user, cross-brand, cross-workspace, and cross-tenant credential use.

## Architectural boundaries

- API and interface adapters authenticate, validate, and project responses.
- Application services orchestrate context resolution, planning, approval, dispatch, readback, and reconciliation.
- Domain policies implement candidate eligibility, deterministic ranking, ambiguity handling, connection ownership, context invalidation, isolation, and retry safety.
- Infrastructure adapters isolate SQL registries, provider transports, repository operations, credentials, audit storage, and observability.
- Shared domain and application code must not contain customer-specific tenant, user, workspace, brand, resource, connection, or provider-account identifiers.
- The Context Kernel selects one exact owned connection; Effective Capability Envelope and Effective Authority consume that decision and must not implement competing selectors.
- Provider identity login and provider API consent remain separate contracts.

## Delivery sequence

### Phase 1: Inventory and static guardrails

1. Inventory current context, membership, resource, connection, capability, authority, OAuth, and credential resolvers.
2. Identify first-result selection, provider-key-only selection, default-customer fallbacks, caller-supplied identity authority, and customer-specific routing branches.
3. Add or extend report-only scanners for fixed production customer identifiers and unsafe selection patterns.
4. Establish baseline telemetry for current and shadow resolution outcomes.
5. Build a compatibility ledger for `user_app_connections`, `workspace_app_links`, OAuth callbacks, and open overlapping PRs.

### Phase 2: Domain kernel

1. Add principal, effective subject, authorized scope, workspace context, connection ownership scope, context candidate, context decision, context pin, authority path, execution context, execution plan, and outcome types.
2. Implement deterministic connection precedence: explicit authorized pin, exact brand, exact workspace, then effective-user personal connection when policy permits.
3. Implement explicit ambiguity handling and prohibit first-row selection.
4. Implement context hashing and tenant/workspace/brand/resource/connection invalidation graphs.
5. Implement cross-tenant, cross-user, and cross-brand eligibility predicates and high-risk fallback prohibition.
6. Add unit and property tests.

### Phase 3: Persistence and infrastructure adapters

1. Add authorized-scope and membership repositories.
2. Add workspace-type and exact connection-ownership repositories.
3. Add tenant-safe resource graph, brand connection binding, capability, readiness, authority, context-pin, and execution-ledger repositories.
4. Add signed, expiring, nonce-bound, single-use provider authorization-state persistence.
5. Preserve and classify legacy rows before additive backfill.
6. Keep SQL table names, credential values, and provider SDK details outside domain policy code.
7. Add structured error translation and redacted observability.

### Phase 4: Tenant provider consent lifecycle

1. Implement User-JWT-protected personal, workspace, and brand connection list, authorize, reconnect, and revoke use cases.
2. Derive user and tenant identity from authenticated context rather than free request fields.
3. Validate live workspace membership and brand-management authority.
4. Bind OAuth state to the exact owner scope, provider scopes, nonce, expiry, and allowlisted redirect target.
5. Encrypt refresh tokens through the credential boundary and return no secret material.
6. Reconcile runtime OAuth work with open callback PRs before editing shared routes.

### Phase 5: Application use cases and API contracts

1. Implement context resolution, connection resolution, context switching, context pinning, plan compilation, validation, dispatch, readback, and unknown-outcome reconciliation.
2. Implement customer-safe Admin and Tenant projections from the same kernel result.
3. Validate OpenAPI 3.1 contracts and structured error envelopes for personal, workspace, brand, and resolution surfaces.
4. Add idempotency and optimistic-concurrency contracts for retryable unsafe operations.
5. Represent identity readiness and provider-connection readiness independently.

### Phase 6: Authority, capability, and activation integration

1. Bind the exact Context Kernel connection decision into Effective Capability Envelope.
2. Require Effective Authority to approve the actor, subject, resource, capability, and selected connection.
3. Add provider readiness checks for credential validity, granted scopes, reachability, quota, and readback.
4. Expose typed connection remediation through Tenant Activation without moving ownership selection into the activation lifecycle.
5. Invalidate plans and approvals when authority, membership, brand, provider scopes, or connection revisions change.

### Phase 7: Shadow and read-only rollout

1. Run the new resolver beside current routing without changing dispatch.
2. Compare decisions and investigate every cross-tenant, cross-user, cross-brand, ambiguity, or fallback discrepancy.
3. Enable bounded low-risk reads only after parity and isolation gates pass.
4. Preserve route-level kill switches that cannot weaken authority checks.
5. Keep legacy adapters active until support and rollback windows are complete.

### Phase 8: Governed writes

1. Enable tenant writes with exact resource and connection binding, idempotency, approval where required, and same-cycle readback.
2. Enable Admin tenant-scoped writes only after effective-subject and isolation evidence passes.
3. Forbid silent fallback from invalid explicit or more-specific connections.
4. Require reconciliation before retry when provider or repository outcomes are unknown.
5. Remove legacy customer defaults and first-result routing only after compatibility evidence is complete.

### Phase 9: Rollout and closeout

1. Apply additive migrations through governed dry-run, checksum, ledger, and same-cycle readback procedures.
2. Verify production deployment against the expected commit SHA.
3. Run post-merge isolation, no-secret, OAuth replay, connection selection, and provider-readiness audits.
4. Record every implementation PR and closeout evidence in `completion.json`.

## Validation strategy

- Unit tests for ranking, ownership eligibility, ambiguity, hashing, invalidation, and outcome transitions.
- Property tests for order independence and tenant, user, workspace, and brand isolation invariants.
- Integration tests for Admin and Tenant multi-scope resolution, context switching, exact connection binding, authority expiry, membership removal, scope reduction, and unknown outcomes.
- Security tests for direct-object references, implicit impersonation, cross-user connection use, cross-brand substitution, OAuth replay, redirect mismatch, connection substitution, and projection leakage.
- Contract validation for OpenAPI 3.1, strict input, stable errors, idempotency, and pagination.
- Static checks for hardcoded customer identifiers, caller-supplied authority, provider-key-only selection, and unsafe first-result selection.
- Compatibility tests for legacy connection records through the additive adapter.

## Release gates

- Spec Kit completion governance passes.
- OpenAPI validation passes for implementation PRs that change public contracts.
- Hardcoded-customer-identifier scanner passes.
- Cross-tenant, cross-user, and cross-brand isolation tests pass.
- OAuth state replay and context-mismatch tests pass.
- Ambiguity and no-silent-fallback tests pass.
- No-secret API, log, context, plan, and evidence tests pass.
- Critical integration and security tests pass.
- Backward compatibility and rollout risks are reviewed.
- CI passes on every implementation change.
- Production deployment, migrations, provider writes, credential mutations, and protected-branch mutations require separate governed approval.

## Rollback and continuity

Rollout remains additive and feature-flagged. Rollback returns traffic to the prior routing implementation while preserving execution, approval, audit, OAuth-state, and reconciliation evidence. Legacy records are not destructively removed during the compatibility window. Operations with unknown outcomes remain in reconciliation and are never blindly retried.
