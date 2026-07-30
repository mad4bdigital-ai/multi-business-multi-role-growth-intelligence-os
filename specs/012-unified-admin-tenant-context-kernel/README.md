# Unified Admin and Tenant Context Kernel

Status: Implementation in progress — governed multi-PR delivery

## Current delivery state

The specification and several bounded implementation slices are merged, but the complete runtime rollout is not finished.

Merged and directly evidenced slices:

- PR #3178 — Phase 5 API and projection contracts; public router remains unmounted and runtime authority was not enabled. Merge SHA: `af9192c5962daa806bfdee2c58af4b50f22aa45f`.
- PR #3204 — default-off Resource API shadow integration for selected tenant GET routes. Merge SHA: `a2b779eb5bf37d6e740d933b5a0ee048b33d4c93`.
- PR #3228 — release-blocking cross-tenant isolation evidence and changed-file hardcoding ratchet. Merge SHA: `4c7f00b93b90e6ae79c9677c081afcecadc0bb5a`.
- PR #3329 — retired the automatic `main` trigger for the intentionally removed `dev.mad4b.com` staging verifier while preserving manual dispatch. Merge SHA: `345193fdccda961b7b7f9f3fab2136e1846efefd`.
- PR #3348 — EC0 Execution Capsule core contract and standalone contract tests. Runtime integration, route exposure, provider execution, and the repository-wide test-manifest follow-up remain pending. Merge SHA: `66d4e5c6c014e124970421f9e3c877a647d2c04e`.

The hierarchical provider-connection ownership amendment is specification authority only. Its persistence, migration, OAuth, exact-owner resolution, readiness, runtime activation, production verification, and post-merge audit remain governed future work.

No merged slice listed above enabled production context-kernel reads or writes, provider dispatch, credential mutation, database migration, or deployment.

## Purpose

Define one dynamic context-resolution and governed-execution kernel for administrators, tenant users, service principals, delegated agents, and future registry-defined principal types. The kernel MUST use the same domain rules for every principal. Differences between principal types are limited to authorized visibility, candidate enumeration, approval policy, and execution authority.

## Core invariant

Production code and shared configuration MUST NOT contain fixed tenant, user, workspace, brand, resource, connection, provider-account, or customer identifiers. Runtime context is resolved from authenticated principal evidence, SQL registries, resource relationships, active authority grants, and request-scoped intent.

Static identifiers are allowed only in isolated test fixtures, migration examples, or documentation samples that are explicitly synthetic and cannot match production identities.

## Canonical resolution pipeline

Authenticated Principal → Authorized Scope Enumeration → Effective Subject Resolution → Tenant Resolution → Workspace Resolution → Brand or Resource Resolution → Exact Connection Resolution → Authority Resolution → Capability Resolution → Execution Plan Compilation → Approval → Dispatch → Readback and Reconciliation

No later stage may silently repair, infer, or replace a missing earlier stage.

## Public API boundary

The public v0.1.0 OpenAPI contract covers context resolution, context pinning, execution-context compilation, and context validation. Provider dispatch, provider readback, unknown-outcome reconciliation, credential materialization, and planned hierarchical connection surfaces remain internal or contract-pending. Exposing any of them publicly requires a later additive contract amendment with explicit authorization, idempotency, error, migration, and readback semantics.

## Scope

This Spec Kit covers:

- one shared context kernel for Admin and Tenant surfaces;
- separation of authenticated principal, effective subject, target resource, and authority path;
- dynamic multi-tenant and multi-workspace discovery;
- deterministic candidate ranking and explicit ambiguity handling;
- conversation and workflow context pinning with revisions and expiry;
- independent operational workspace type and workspace ownership type;
- hierarchical personal-workspace, company-workspace, and Brand connection ownership;
- brand-optional and resource-first operations;
- exact connection binding and credential-scope matching;
- visibility, candidate, and execution-set separation;
- fail-closed high-risk execution;
- approval, idempotency, optimistic concurrency, and context hashes;
- unknown-outcome reconciliation after transport failures;
- cross-tenant, cross-user, and cross-brand isolation;
- observability, migration, compatibility, rollout, rollback, and support continuity;
- automated detection of hardcoded customer identifiers;
- revision-bound Execution Capsules that never grant execution authority by themselves.

## Current safety boundaries

- no production deployment is authorized by this Spec Kit state;
- no provider or credential write is authorized by documentation status;
- no database migration may be applied without separate governed authorization and same-cycle readback;
- no runtime authority expansion is implied by merged contracts or tests;
- no implicit Admin impersonation;
- no automatic verification against retired `dev.mad4b.com`;
- no planned v0.2 connection surface is exposed until OpenAPI and implementation evidence are merged.

## Artifacts

- `README.md`
- `spec.md`
- `architecture.md`
- `end-to-end-flows.md`
- `data-model.md`
- `hierarchical-connection-ownership.md`
- `hardcoding-policy.md`
- `error-catalog.md`
- `threat-model.md`
- `testing-strategy.md`
- `rollout.md`
- `api/openapi.yaml`
- `traceability.md`
- `tasks.md`
- `acceptance-matrix.md`
- `plan.md`
- `completion.json`
- `checklists/specification-readiness.md`
- `execution-capsule-runtime-addendum.md`
- `execution-capsule-runtime-extension.manifest.json`
- `ec0-execution-capsule-contract.md`
- `ec0-execution-capsule-contract.manifest.json`
- `manifest.json`

## Acceptance gates

1. The same resolver contract works for Admin, Tenant user, and service principal requests.
2. An Admin may have broad visibility but cannot execute a tenant-scoped mutation without a pinned effective subject and exact resource authority.
3. Multiple valid tenants, workspaces, brands, resources, or connections produce `interpretation_required` unless a deterministic explicit binding exists.
4. Changing tenant, workspace, ownership, owner scope, connection, or governed revision invalidates dependent context, plans, approvals, and execution envelopes.
5. High-risk operations never select a fallback source or connection silently.
6. Transport uncertainty enters reconciliation and never triggers an immediate blind retry.
7. CI rejects fixed production customer identifiers and unsafe first-result selection.
8. All exposed public contracts use OpenAPI 3.1 and structured actionable errors.
9. Migration readback precedes dependent OAuth, shadow, read, and write rollout.
10. Exact-owner isolation remains active during rollback or affected provider operations fail closed.
