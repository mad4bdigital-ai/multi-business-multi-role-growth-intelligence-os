# ADR-001: Hybrid Authorization, Execution, and Reconciliation Architecture

**Status**: Proposed  
**Date**: 2026-06-28

## Context

The platform spans tenants, workspaces, brands, agents, users, devices, providers, tools, routes, workflows, and external resources. A flat grant table cannot fully express structural relationships. Attribute-only policy cannot efficiently represent inherited ownership. Route-specific authorization duplicates logic. A single capability service that decides, approves, executes, and reconciles would create excessive coupling and failure radius.

## Decision

Adopt four cooperating planes:

1. **Relationship Authority Plane** — resolves subject-resource relationships and revision evidence.
2. **Policy Decision Plane** — evaluates subject, action, resource, context, relationships, grants, policy, and obligations without side effects.
3. **Execution Orchestration Plane** — selects certified adapters, enforces envelopes, performs idempotent dispatch, and coordinates compensation.
4. **Evidence and Reconciliation Plane** — verifies effects, records evidence, detects drift, and invalidates stale readiness.

Use relationship-based authority for ownership, membership, delegation, supervision, and containment; attribute-based policy for risk and runtime context; and explicit grants for capability availability and bounded exceptions.

Use a typed internal decision contract based on `subject`, `action`, `resource`, and `context`. A policy engine may be adopted separately, but the platform MUST NOT grow an unbounded ad-hoc JSON policy language.

## Consequences

Positive consequences are stable capabilities, explicit relationship inheritance, enforcement near every execution boundary, independent auditability, and post-request drift handling.

Costs include more domain objects, shadow comparison, policy test tooling, adapter certification, and additional observability.

## Rejected alternatives

- Route-specific permissions.
- Boolean `requires_approval` only.
- Pure RBAC.
- Pure ABAC.
- One central capability service.
- Immediate replacement rollout.

## Guardrails

- No provider mutation in shadow mode.
- No authorization from discovery or UI exposure.
- No caller-controlled tenant authority.
- No reusable approval after request evidence changes.
- No production cutover without parity, security, readback, rollback, and release evidence.
