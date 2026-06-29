# ADR-001: Hybrid Authorization, Execution, and Reconciliation Architecture

**Status**: Proposed  
**Date**: 2026-06-27

## Context

The platform spans tenants, workspaces, brands, agents, users, devices, providers, tools, routes, workflows, and external resources. A flat grant table cannot fully express structural relationships. Attribute-only policy cannot efficiently represent inherited ownership. Route-specific authorization duplicates logic. A single capability service that decides, approves, executes, and reconciles would become a high-risk god service.

## Decision

Adopt four cooperating planes:

1. **Relationship Authority Plane** — stores and resolves subject-resource relationships and revisions.
2. **Policy Decision Plane** — evaluates subject, action, resource, context, relationships, grants, policy, and obligations without side effects.
3. **Execution Orchestration Plane** — selects certified adapters, enforces envelopes, performs idempotent dispatch, and coordinates compensation.
4. **Evidence and Reconciliation Plane** — verifies effects, records evidence, detects drift, and invalidates stale readiness.

Use a hybrid authorization model:

- relationship-based authority for ownership, membership, delegation, supervision, and containment;
- attribute-based policy for risk, time, environment, operation class, connection state, and service mode;
- explicit grants for opt-in capability availability and bounded exceptions.

Use a typed internal decision contract based on `subject`, `action`, `resource`, and `context`. The implementation may use a governed policy engine, but MUST NOT create an unbounded ad-hoc JSON policy language.

## Consequences

### Positive

- Capabilities remain stable when routes or providers change.
- Relationship inheritance and context constraints are modeled explicitly.
- Enforcement remains close to every execution boundary.
- Approval and execution evidence can be audited independently.
- Reconciliation handles state changes after the initial request.

### Costs

- More explicit domain objects and revisions.
- Shadow comparison and migration complexity.
- Need for policy test tooling and adapter certification.
- Additional operational observability.

## Rejected alternatives

- **Route-specific permissions**: incomplete and expensive to evolve.
- **Boolean `requires_approval` only**: cannot express scope, approver, TTL, reuse, or invalidation.
- **Pure RBAC**: insufficient for resource relationships and contextual restrictions.
- **Pure ABAC**: difficult to represent inherited graph relationships consistently.
- **One central capability service**: excessive coupling and failure radius.
- **Immediate replacement rollout**: unacceptable regression and security risk.

## Guardrails

- No provider mutation in shadow mode.
- No authorization from discovery or UI exposure.
- No caller-controlled tenant authority.
- No reusable approval across changed request evidence.
- No production cutover without parity, security, readback, rollback, and release evidence.
