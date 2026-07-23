# Implementation Tasks

## Phase 1: Inventory and guardrails

- [ ] Inventory all current context, tenant, workspace, brand, resource, connection, and capability resolvers.
- [ ] Inventory hardcoded identifiers and default-customer fallbacks.
- [ ] Add static scanner in report-only mode.
- [ ] Document current Admin and Tenant entry points.

## Phase 2: Domain kernel

- [ ] Add principal, effective subject, candidate, decision, pin, authority path, execution context, and outcome types.
- [ ] Implement deterministic ranking and ambiguity policy.
- [ ] Implement context hash and invalidation graph.
- [ ] Implement high-risk fallback prohibition.
- [ ] Add unit and property tests.

## Phase 3: Registry adapters

- [ ] Add authorized-scope repository.
- [ ] Add resource graph repository with tenant predicates.
- [ ] Add exact connection repository.
- [ ] Add capability and readiness repository.
- [ ] Add context pin and execution ledger repositories.
- [ ] Avoid exposing SQL table names outside infrastructure.

## Phase 4: Application use cases

- [ ] Implement context resolution.
- [ ] Implement context pin create, read, and invalidate.
- [ ] Implement context switching.
- [ ] Implement plan compilation and validation.
- [ ] Implement unknown-outcome reconciliation.

## Phase 5: API and projection

- [ ] Add OpenAPI 3.1 routes and schemas.
- [ ] Add structured error mapping.
- [ ] Add safe Admin and Tenant projections.
- [ ] Add pagination and candidate limits.

## Phase 6: Integration

- [ ] Integrate low-risk read routes in shadow mode.
- [ ] Integrate resource-first flows.
- [ ] Integrate brand-scoped flows.
- [ ] Integrate exact provider connection selection.
- [ ] Integrate repository branch bootstrap and continuation.

## Phase 7: Security and rollout

- [ ] Make cross-tenant isolation tests release blocking.
- [ ] Promote hardcoding scanner from report-only to blocking.
- [ ] Enable low-risk reads.
- [ ] Enable tenant writes.
- [ ] Enable Admin writes after effective-subject evidence passes.
- [ ] Remove legacy first-result and customer-default paths.

## Definition of done

- [ ] All acceptance scenarios pass.
- [ ] OpenAPI validates.
- [ ] No production hardcoding findings remain.
- [ ] CI and security review pass.
- [ ] Rollback and support runbooks are complete.
- [ ] No merge or deployment occurs without separate approval.
