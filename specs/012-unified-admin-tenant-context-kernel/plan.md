# Implementation Plan: Unified Admin and Tenant Context Kernel

## Status

Specification delivery is in progress. This plan defines the implementation sequence and release gates; it does not authorize production execution, deployment, migration, provider writes, credential mutation, or protected-branch writes.

## Objective

Implement one shared, registry-driven context kernel for administrators, tenant users, service principals, delegated agents, and future registered principal types. The implementation must preserve tenant isolation, require an explicit effective subject for tenant-scoped mutations, and bind every governed execution to one tenant, one workspace, one target resource, one exact connection, and one authority path.

The connection extension must support personal-workspace, company-workspace, and brand ownership while preventing cross-user, cross-brand, cross-workspace, and cross-tenant credential use.

The existing operational `workspaceType` classification remains unchanged. Personal versus company ownership is represented separately as `workspaceOwnershipType` and persisted through an additive `workspace_ownership_type` field.

## Architectural boundaries

- API and interface adapters authenticate, validate, and project responses.
- Application services orchestrate context resolution, planning, approval, dispatch, readback, and reconciliation.
- Domain policies implement candidate eligibility, deterministic ranking, ambiguity handling, connection ownership, context invalidation, isolation, and retry safety.
- Infrastructure adapters isolate SQL registries, provider transports, repository operations, credentials, audit storage, and observability.
- Shared domain and application code must not contain customer-specific tenant, user, workspace, brand, resource, connection, or provider-account identifiers.
- The Context Kernel selects one exact owned connection; Effective Capability Envelope and Effective Authority consume that immutable connection and owner-scope decision and must not implement competing selectors.
- Provider identity login and provider API consent remain separate contracts.
- Operational workspace classification and workspace ownership classification must not be overloaded into one field.
- Readiness is two-stage: pre-credential gates run without secrets; credential materialization then permits credential-dependent provider readiness for one exact selected connection.

## Delivery sequence

### Phase 1: Inventory and static guardrails

1. Inventory current context, membership, resource, connection, capability, authority, OAuth, credential, fallback, and rollback resolvers.
2. Identify first-result selection, provider-key-only selection, default-customer fallbacks, caller-supplied identity authority, and customer-specific routing branches.
3. Add or extend report-only scanners for fixed production customer identifiers and unsafe selection patterns.
4. Establish baseline telemetry for current and shadow resolution outcomes.
5. Build a compatibility ledger for `workspace_registry.workspace_type`, `user_app_connections`, `workspace_app_links`, OAuth callbacks, rollback paths, and open overlapping PRs.

### Phase 2: Domain kernel

1. Add principal, effective subject, authorized scope, workspace context, connection ownership scope, context candidate, context decision, context pin, authority path, execution context, execution plan, readiness decision, and outcome types.
2. Implement deterministic connection precedence: explicit authorized pin, exact brand, exact workspace, then effective-user personal connection when policy permits.
3. Implement explicit ambiguity handling and prohibit first-row selection.
4. Implement context hashing and tenant/workspace/brand/resource/connection invalidation graphs.
5. Implement cross-tenant, cross-user, and cross-brand eligibility predicates and high-risk fallback prohibition.
6. Require a resolved connection decision to carry immutable exact owner-scope evidence.
7. Add unit and property tests.

### Phase 3: Persistence and infrastructure adapters

1. Add authorized-scope and membership repositories.
2. Add a workspace-ownership-type repository while preserving existing operational workspace-type semantics.
3. Add exact connection-ownership and brand connection-binding repositories.
4. Add tenant-safe resource graph, capability, readiness, authority, context-pin, and execution-ledger repositories.
5. Add signed, expiring, nonce-bound, single-use provider authorization-state persistence, including reconnect target connection, revision, and expected provider-account binding.
6. Prepare additive migrations, dry-run checks, compatibility classification, and same-cycle readback contracts.
7. Preserve and classify legacy rows before additive backfill.
8. Keep SQL table names, credential values, and provider SDK details outside domain policy code.
9. Add structured error translation and redacted observability.

### Phase 4: Governed migration and persistence readiness

1. Obtain separate governed authorization for the additive ownership and provider-authorization-state migrations.
2. Run non-mutating preflight and dry-run validation.
3. Apply the migration only after base, checksum, statement count, compatibility, and rollback evidence pass.
4. Record migration ledger evidence and perform same-cycle schema and data readback.
5. Block every shadow, read, OAuth, and write rollout that depends on the new fields until migration readback is verified.
6. Preserve legacy compatibility adapters and prohibit destructive cleanup.

### Phase 5: Tenant provider consent lifecycle

1. Implement User-JWT-protected personal, workspace, and brand connection list, authorize, reconnect, and revoke use cases.
2. Derive user and tenant identity from authenticated context rather than free request fields.
3. Validate live workspace membership and brand-management authority.
4. Bind OAuth state to the exact owner scope, provider scopes, nonce, expiry, and allowlisted redirect target.
5. For reconnect, bind the target connection, expected connection revision, and expected provider account reference or binding hash; reject mismatch before replacing credentials.
6. Encrypt refresh tokens through the credential boundary and return no secret material.
7. Reconcile runtime OAuth work with open callback PRs before editing shared routes.

### Phase 6: Application use cases and API contracts

1. Implement context resolution, connection resolution, context switching, context pinning, plan compilation, validation, dispatch, readback, and unknown-outcome reconciliation.
2. Implement customer-safe Admin and Tenant projections from the same kernel result.
3. Validate OpenAPI 3.1 contracts and structured error envelopes for personal, workspace, brand, and resolution surfaces.
4. Add idempotency and optimistic-concurrency contracts for retryable unsafe operations.
5. Represent identity readiness, pre-credential readiness, credential materialization eligibility, and provider readiness independently.

### Phase 7: Authority, capability, readiness, and activation integration

1. Bind the exact Context Kernel connection and owner-scope decision into Effective Capability Envelope.
2. Require Effective Authority to approve the actor, subject, resource, capability, selected connection, and exact owner scope.
3. Run configuration, ownership, capability, authority, approval, and non-secret readiness before credential materialization.
4. Materialize the credential only for the exact selected connection, then run credential validity, granted-scope, reachability, quota, schema, and readback readiness checks.
5. Expose typed connection remediation through Tenant Activation without moving ownership selection into the activation lifecycle.
6. Invalidate plans and approvals when authority, membership, brand, provider scopes, provider account, or connection revisions change.

### Phase 8: Shadow and read-only rollout

1. Require verified Phase 4 migration readback before enabling the new resolver in any production shadow or read path.
2. Run the new resolver beside current routing without changing dispatch.
3. Compare decisions and investigate every cross-tenant, cross-user, cross-brand, ambiguity, fallback, or owner-scope discrepancy.
4. Enable bounded low-risk reads only after parity, migration, readiness, and isolation gates pass.
5. Preserve route-level kill switches that cannot weaken exact-owner authority checks.
6. Keep legacy adapters active only behind the exact-owner isolation guard until support and rollback windows are complete.

### Phase 9: Governed writes and closeout

1. Enable tenant writes with exact resource, connection, and owner-scope binding, idempotency, approval where required, and same-cycle readback.
2. Enable Admin tenant-scoped writes only after effective-subject and isolation evidence passes.
3. Forbid silent fallback from invalid explicit or more-specific connections.
4. Require reconciliation before retry when provider or repository outcomes are unknown.
5. Remove legacy customer defaults and first-result routing only after compatibility evidence is complete.
6. Verify production deployment against the expected commit SHA.
7. Run post-merge isolation, no-secret, OAuth replay, reconnect-account, connection-selection, provider-readiness, migration, and rollback audits.
8. Record every implementation PR and closeout evidence in `completion.json`.

## Validation strategy

- Unit tests for ranking, ownership eligibility, ambiguity, hashing, invalidation, readiness phases, and outcome transitions.
- Property tests for order independence and tenant, user, workspace, and brand isolation invariants.
- Integration tests for Admin and Tenant multi-scope resolution, context switching, exact connection and owner-scope binding, authority expiry, membership removal, scope reduction, reconnect account mismatch, and unknown outcomes.
- Security tests for direct-object references, implicit impersonation, cross-user connection use, cross-brand substitution, OAuth replay, redirect mismatch, reconnect account substitution, connection substitution, and projection leakage.
- Contract validation for OpenAPI 3.1, strict input, stable errors, idempotency, and pagination.
- Static checks for hardcoded customer identifiers, caller-supplied authority, provider-key-only selection, unsafe first-result selection, and owner-unsafe rollback selectors.
- Compatibility tests proving `workspace_registry.workspace_type` keeps its operational values while `workspace_ownership_type` carries personal/company ownership.
- Compatibility tests for legacy connection records through the additive adapter.
- Migration tests proving verified schema/data readback occurs before shadow/read rollout.
- Rollback tests proving exact-owner isolation remains active or affected provider operations fail closed.

## Release gates

- Spec Kit completion governance passes.
- OpenAPI validation passes for implementation PRs that change public contracts.
- Hardcoded-customer-identifier scanner passes.
- Cross-tenant, cross-user, and cross-brand isolation tests pass.
- OAuth state replay, context-mismatch, reconnect-account, and revision-binding tests pass.
- Ambiguity and no-silent-fallback tests pass.
- No-secret API, log, context, plan, readiness, and evidence tests pass.
- Operational workspace-type compatibility tests pass.
- Additive migration authorization, ledger evidence, and same-cycle readback pass before runtime rollout.
- Rollback retains exact-owner isolation or disables affected provider operations.
- Critical integration and security tests pass.
- Backward compatibility and rollout risks are reviewed.
- CI passes on every implementation change.
- Production deployment, migrations, provider writes, credential mutations, and protected-branch mutations require separate governed approval.

## Rollback and continuity

Rollout remains additive and feature-flagged. Rollback MUST NOT return traffic to an owner-unsafe selector. The exact-owner isolation guard remains active independently of the new ranking implementation; when that guard or its required persistence is unavailable, affected provider operations are disabled or fail closed. Rollback preserves execution, approval, audit, OAuth-state, migration, and reconciliation evidence. Legacy records are not destructively removed during the compatibility window. Existing operational workspace classifications remain unchanged. Operations with unknown outcomes remain in reconciliation and are never blindly retried.
