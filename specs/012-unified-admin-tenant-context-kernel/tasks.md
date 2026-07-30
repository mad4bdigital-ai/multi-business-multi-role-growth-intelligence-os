# Implementation Tasks

## Phase 1: Inventory and guardrails

- [ ] Inventory all current context, tenant, workspace, brand, resource, connection, capability, authority, OAuth, and credential resolvers.
- [ ] Inventory hardcoded identifiers, default-customer fallbacks, caller-supplied identity authority, provider-key-only selection, and first-row selection.
- [ ] Add static scanner coverage in report-only mode where missing.
- [ ] Document current Admin, Tenant, personal, workspace, brand, and OAuth entry points.
- [ ] Create a compatibility ledger for `user_app_connections`, `workspace_app_links`, legacy ownership, and overlapping PRs.

## Phase 2: Domain kernel

- [ ] Add principal, effective subject, workspace context, candidate, decision, pin, connection ownership, authority path, execution context, and outcome types.
- [ ] Implement deterministic connection precedence and ambiguity policy.
- [ ] Implement personal-owner, workspace, brand, and tenant eligibility predicates.
- [ ] Implement context hash and tenant/workspace/brand/resource/connection invalidation graph.
- [ ] Implement high-risk and consequential-write fallback prohibition.
- [ ] Add unit and property tests.

## Phase 3: Persistence and registry adapters

- [ ] Add authorized-scope and membership repositories.
- [ ] Add workspace-type repository.
- [ ] Add exact connection-ownership repository.
- [ ] Add brand connection binding repository.
- [ ] Add provider authorization-state repository with single-use semantics.
- [ ] Add capability, readiness, context pin, and execution ledger repositories.
- [ ] Classify legacy rows before additive backfill.
- [ ] Avoid exposing SQL table names or credential values outside infrastructure.

## Phase 4: Tenant provider consent

- [ ] Implement User-JWT-protected personal connection list, authorize, reconnect, and revoke use cases.
- [ ] Implement company-workspace connection list, authorize, reconnect, and revoke use cases.
- [ ] Implement brand connection list, authorize, reconnect, and revoke use cases.
- [ ] Derive user and tenant identity from authenticated context.
- [ ] Validate live workspace membership and brand-management authority.
- [ ] Implement signed, expiring, nonce-bound, single-use, redirect-allowlisted OAuth state.
- [ ] Keep Google identity login separate from Google provider consent.
- [ ] Reconcile shared OAuth route changes with open callback PRs before runtime edits.

## Phase 5: Application use cases

- [ ] Implement context resolution.
- [ ] Implement exact connection resolution.
- [ ] Implement context pin create, read, and invalidate.
- [ ] Implement context switching.
- [ ] Implement plan compilation and validation.
- [ ] Implement unknown-outcome reconciliation.
- [ ] Represent identity readiness and provider-connection readiness independently.

## Phase 6: API and projection

- [ ] Add OpenAPI 3.1 personal connection routes and schemas.
- [ ] Add OpenAPI 3.1 workspace connection routes and schemas.
- [ ] Add OpenAPI 3.1 brand connection routes and schemas.
- [ ] Add OpenAPI 3.1 connection-resolution routes and schemas.
- [ ] Add structured error mapping.
- [ ] Add safe Admin and Tenant projections.
- [ ] Add bounded pagination, idempotency, concurrency, and no-secret contracts.

## Phase 7: Integration

- [ ] Integrate low-risk read routes in shadow mode.
- [ ] Integrate resource-first flows.
- [ ] Integrate brand-scoped flows.
- [ ] Integrate exact provider connection selection.
- [ ] Integrate Effective Capability Envelope as a consumer of the exact connection decision.
- [ ] Integrate Effective Authority as a consumer of the exact connection decision.
- [ ] Integrate Tenant Activation readiness and typed remediation.
- [ ] Integrate repository branch bootstrap and continuation where applicable.

## Phase 8: Security and rollout

- [ ] Keep cross-tenant isolation tests release blocking.
- [ ] Add release-blocking cross-user and cross-brand connection isolation tests.
- [ ] Add release-blocking OAuth replay, expiry, redirect, and context-mismatch tests.
- [ ] Add release-blocking ambiguity and no-silent-fallback tests.
- [ ] Add no-secret API, log, plan, context, and evidence tests.
- [ ] Promote relevant scanners from report-only to blocking after baseline review.
- [ ] Enable bounded low-risk reads after parity.
- [ ] Enable tenant writes through governed approval.
- [ ] Enable Admin writes after effective-subject evidence passes.
- [ ] Remove legacy first-result and customer-default paths after compatibility evidence.

## Phase 9: Governed migration and closeout

- [ ] Prepare additive migration and dry-run contract.
- [ ] Apply migration only through separate governed authorization.
- [ ] Record checksum, statement count, ledger run, and same-cycle readback.
- [ ] Verify production deployment against expected commit SHA.
- [ ] Run post-merge isolation, no-secret, OAuth, readiness, and compatibility audit.
- [ ] Record all implementation PRs and closeout evidence in `completion.json`.

## Definition of done

- [ ] All acceptance scenarios pass.
- [ ] OpenAPI validates.
- [ ] No production hardcoding or unsafe selection findings remain.
- [ ] Cross-tenant, cross-user, and cross-brand isolation gates pass.
- [ ] OAuth state and no-silent-fallback gates pass.
- [ ] CI and security review pass.
- [ ] Migration, production verification, and post-merge audit evidence are recorded.
- [ ] Rollback and support runbooks are complete.
- [ ] No merge, migration, deployment, provider write, or credential mutation occurs without separate approval.
