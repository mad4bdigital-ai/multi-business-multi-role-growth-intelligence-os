# Unified Admin and Tenant Context Kernel

Status: Specification draft

## Purpose

Define one dynamic context-resolution and governed-execution kernel for administrators, tenant users, service principals, and future principal types. The kernel MUST use the same domain rules for every principal. Differences between principal types are limited to authorized visibility, candidate enumeration, approval policy, and execution authority.

## Core invariant

Production code and shared configuration MUST NOT contain fixed tenant, user, workspace, brand, resource, connection, provider-account, or customer identifiers. Runtime context is resolved from authenticated principal evidence, SQL registries, resource relationships, active authority grants, and request-scoped intent.

Static identifiers are allowed only in isolated test fixtures, migration examples, or documentation samples that are explicitly synthetic and cannot match production identities.

## Canonical resolution pipeline

Authenticated Principal
→ Authorized Scope Enumeration
→ Effective Subject Resolution
→ Tenant Resolution
→ Workspace Resolution
→ Brand or Resource Resolution
→ Exact Connection Resolution
→ Authority Resolution
→ Capability Resolution
→ Execution Plan Compilation
→ Approval
→ Dispatch
→ Readback and Reconciliation

No later stage may silently repair, infer, or replace a missing earlier stage.

## Scope

This Spec Kit covers:

- one shared context kernel for Admin and Tenant surfaces;
- separation of authenticated principal, effective subject, target resource, and authority path;
- dynamic multi-tenant and multi-workspace discovery;
- deterministic candidate ranking and explicit ambiguity handling;
- conversation and workflow context pinning with revisions and expiry;
- brand-optional and resource-first operations;
- exact connection binding and credential-scope matching;
- visibility, candidate, and execution-set separation;
- fail-closed high-risk execution;
- approval, idempotency, optimistic concurrency, and context hashes;
- unknown-outcome reconciliation after transport failures;
- cross-tenant isolation and customer-safe projections;
- observability, migration, compatibility, rollout, rollback, and support continuity;
- automated detection of hardcoded customer identifiers.

## Non-goals for this specification branch

- no production deployment;
- no provider write;
- no database migration apply;
- no protected-branch mutation;
- no runtime authority expansion;
- no implicit Admin impersonation.

## Planned artifacts

- `spec.md`
- `architecture.md`
- `end-to-end-flows.md`
- `data-model.md`
- `api/openapi.yaml`
- `threat-model.md`
- `testing-strategy.md`
- `rollout.md`
- `traceability.md`
- `tasks.md`
- `acceptance-matrix.md`
- `manifest.json`

## Acceptance gates

1. The same resolver contract works for Admin, Tenant user, and service principal requests.
2. An Admin may have broad visibility but cannot execute a tenant-scoped mutation without a pinned effective subject and exact resource authority.
3. Multiple valid tenants, workspaces, brands, resources, or connections produce `interpretation_required` unless a deterministic explicit binding exists.
4. Changing tenant or workspace invalidates dependent context, plans, approvals, and execution envelopes.
5. High-risk operations never select a fallback source or connection silently.
6. Transport uncertainty enters reconciliation and never triggers an immediate blind retry.
7. CI rejects fixed production customer identifiers and unsafe first-result selection.
8. All public contracts use OpenAPI 3.1 and structured actionable errors.
