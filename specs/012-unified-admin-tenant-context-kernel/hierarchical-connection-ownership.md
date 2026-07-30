# Hierarchical Provider Connection Ownership

## Status and scope

This document extends the Unified Dynamic Context Kernel with a provider-neutral ownership and resolution model for personal, company-workspace, and brand connections.

The first provider integration is Google Workspace APIs, including Drive, Docs, Gmail, Analytics, Ads, and future registered Google capabilities. The domain contract is provider-neutral and MUST NOT embed provider-specific credential material.

This amendment is specification-only. It performs no runtime change, database migration, provider call, credential mutation, deployment, or protected-branch write.

## Problem statement

The platform already has encrypted user application connections, workspace links, User JWT authentication, OAuth routes, capability grants, and readiness concepts. These pieces do not yet form one authoritative ownership and selection model.

Without a unified decision, runtime paths may:

- accept caller-supplied `user_id` or `tenant_id` instead of deriving identity and scope from authenticated evidence;
- select a connection by provider key or first row;
- share a personal credential with another workspace member;
- expose a brand connection outside its brand boundary;
- treat Google identity login as evidence of Drive or Docs consent;
- silently fall back from an invalid brand connection to a broader workspace or personal connection during a consequential write.

The Context Kernel is the source of truth for exact connection ownership and deterministic selection. Effective Capability Envelope and Effective Authority consume that decision; they do not implement competing selectors.

## Canonical ownership hierarchy

```text
Authenticated User JWT
└── Personal Workspace
    ├── Personal Provider Connection
    └── Brands
        └── Brand Provider Connection

Company Workspace
├── Company Workspace Provider Connection
└── Brands
    └── Brand Provider Connection
```

A brand belongs to exactly one workspace. A brand connection may therefore exist under either a personal workspace or a company workspace, while remaining owned by one exact brand.

## Workspace types

`workspaceType` is one of:

- `personal`: operational workspace owned by one platform user;
- `company`: shared operational workspace with independent membership, roles, grants, and administrative lifecycle.

A personal workspace is not a shared company credential boundary. Membership in a company workspace never grants access to another member's personal connection.

The lifecycle decision for automatic versus explicit personal-workspace creation remains an upstream onboarding policy. The Context Kernel MUST support both lifecycle modes and MUST require a resolved personal workspace before binding a personal connection.

## Connection ownership scopes

`ownerScopeType` is one of:

- `personal_workspace`;
- `company_workspace`;
- `brand`.

Every connection has one exact owner scope and MUST include:

- `connectionRef`;
- `providerKey`;
- `providerAccountRef` when safe to retain;
- `tenantRef`;
- `workspaceRef`;
- optional `brandRef`;
- `ownerScopeType`;
- `ownerScopeRef`;
- optional `ownerUserRef` for personal ownership;
- `connectedByUserRef`;
- `credentialScopeRef`;
- granted provider scopes;
- authorization and connection revisions;
- lifecycle status;
- readiness summary.

Credential values and refresh tokens are stored only through the credential boundary. They MUST NOT appear in Context Kernel models, API projections, logs, traces, plans, approvals, or evidence artifacts.

## Deterministic resolution precedence

For an operation with a resolved tenant, workspace, resource, and optional brand, the kernel applies:

```text
Explicit authorized connection pin
→ Exact eligible brand connection
→ Exact eligible workspace connection
→ Effective-user personal connection allowed by policy
→ interpretation_required or connection_required
```

This is eligibility precedence, not blind fallback.

### Mandatory rules

1. Tenant and workspace MUST be resolved before connection candidates are ranked.
2. A brand connection is eligible only for resources owned by that exact brand.
3. A workspace connection is eligible only inside its exact workspace and tenant.
4. A personal connection is eligible only when `ownerUserRef` equals the effective user.
5. A personal connection inside a company-workspace operation requires an explicit operation policy that permits personal inheritance.
6. Equal-ranked eligible connections produce `CONNECTION_AMBIGUOUS`; no first-row selection is allowed.
7. Revoked, expired, disabled, insufficient-scope, owner-mismatched, or stale-revision connections are ineligible.
8. Credential material is not loaded until context, ownership, authority, capability, and readiness decisions agree.
9. Consequential writes MUST NOT silently fall back from an explicitly bound or more-specific invalid connection.
10. Context pins, plans, and approvals MUST be invalidated when membership, workspace, brand, ownership, authorization, provider scopes, or connection revision changes.

## Fallback policy

Fallback is governed per capability and risk class.

Low-risk reads MAY inherit from brand to workspace or from an eligible personal connection when the operation policy explicitly allows it and all ownership and authority checks pass.

Consequential writes fail closed when:

- an explicit connection pin is invalid;
- a brand connection exists but is revoked, expired, scope-insufficient, or not ready;
- the requested resource is brand-bound and the applicable policy requires a brand-owned connection;
- the candidate would cross a user, brand, workspace, or tenant boundary.

A failure at a more-specific level is not permission to widen scope.

## Google identity and provider consent separation

Google identity login and Google provider authorization are separate security contracts.

### Google identity login

```text
Google Sign-In
→ verify identity
→ link or create platform user
→ issue User JWT
→ resolve platform contexts
```

### Google provider consent

```text
Explicit OAuth consent
→ request approved provider scopes
→ obtain refresh token when required
→ encrypt and store credential
→ create one exact owned connection
```

A valid User JWT proves platform identity. It does not contain and does not replace a Google refresh token.

The following state is valid and MUST be represented explicitly:

```text
identity_ready = true
provider_connection_ready = false
```

The public remediation code is `PROVIDER_CONSENT_REQUIRED`.

## OAuth authorization-state contract

Provider authorization state MUST be signed, expiring, nonce-bound, single-use, and context-bound. It includes:

- `stateRef`;
- `providerKey`;
- `principalRef` and `userRef`;
- `tenantRef`;
- `workspaceRef`;
- optional `brandRef`;
- `ownerScopeType` and `ownerScopeRef`;
- requested provider scopes;
- allowlisted redirect target reference;
- nonce hash;
- issue and expiry timestamps;
- consumed timestamp when completed;
- state status and signature version.

Callbacks MUST reject replay, expiry, signature failure, redirect mismatch, provider-account mismatch, and any mismatch between the signed state and live tenant, workspace, brand, membership, or ownership context.

Callbacks MUST NOT accept free `user_id`, `tenant_id`, `workspace_id`, or `brand_id` values as authority.

## API direction

The provider-neutral public contract is User-JWT protected and OpenAPI 3.1 compliant.

### Personal scope

```http
GET    /me/connections
POST   /me/connections/{providerKey}/authorizations
DELETE /me/connections/{connectionRef}
```

### Workspace scope

```http
GET    /workspaces/{workspaceRef}/connections
POST   /workspaces/{workspaceRef}/connections/{providerKey}/authorizations
DELETE /workspaces/{workspaceRef}/connections/{connectionRef}
```

### Brand scope

```http
GET    /brands/{brandRef}/connections
POST   /brands/{brandRef}/connections/{providerKey}/authorizations
DELETE /brands/{brandRef}/connections/{connectionRef}
```

### Resolution

```http
POST /connection-resolutions
GET  /connection-resolutions/{resolutionRef}
```

Contracts MUST use strict validation, stable structured errors, idempotency where applicable, bounded pagination, no-secret projections, live membership checks, same-cycle readback for mutations, and derived identity rather than caller-supplied authority.

Final route naming remains subject to OpenAPI compatibility review before runtime implementation.

## Responsibility boundaries

```text
JIT Onboarding
└── platform identity, User JWT, initial workspace lifecycle

Context Kernel
├── effective subject
├── tenant, workspace, workspace type
├── brand and resource
└── exact connection ownership and deterministic selection

Effective Capability Envelope
└── bind the exact connection decision to one capability and resource

Effective Authority
└── decide whether the actor and subject may use the selected connection

Provider Readiness
└── credential validity, granted scopes, reachability, quota, and readback

Execution Orchestrator
└── dispatch only when every decision agrees
```

## Persistence and compatibility direction

Runtime implementation requires additive, rollback-aware persistence changes around existing `user_app_connections` and `workspace_app_links` records.

The persistence phase will introduce or normalize:

- workspace type;
- exact owner scope;
- brand connection bindings;
- provider scopes;
- authorization and connection revisions;
- active/default uniqueness constraints within one exact scope;
- compatibility classification for legacy rows.

Legacy rows MUST be preserved and classified before backfill. Destructive cleanup is forbidden until parity, rollback, and support windows are complete.

No migration is applied by this specification amendment.

## Release-blocking acceptance scenarios

1. A user has a personal connection while a company workspace has a different connection.
2. Two users in one company workspace have different personal connections.
3. One user cannot use another member's personal connection.
4. A brand connection outranks a workspace connection for that exact brand.
5. A brand inside a personal workspace can own its own connection.
6. A brand inside a company workspace can own its own connection.
7. Two equal-ranked eligible connections produce ambiguity.
8. A revoked or insufficient-scope brand connection blocks a consequential write and does not silently fall back.
9. Google login without provider consent produces a connection-required remediation state.
10. Membership removal invalidates company-workspace and brand connection use.
11. Brand rebinding or connection revision invalidates pins, plans, approvals, and cached decisions.
12. A cross-tenant or cross-brand reference fails before credential materialization.
13. API, logs, context, plans, and evidence never expose credential values.
14. Legacy records continue through a compatibility adapter during additive rollout.
15. OAuth state replay, expiry, context mismatch, and redirect mismatch fail closed.

## Multi-PR implementation sequence

1. Specification amendment and compatibility ledger.
2. Persistence migration and repositories.
3. Tenant self-service provider consent lifecycle.
4. Context ownership resolver and invalidation.
5. Effective Capability Envelope and Effective Authority integration.
6. Activation readiness and typed remediation integration.
7. OpenAPI contracts and compatibility aliases.
8. Isolation, replay, ambiguity, revocation, shadow-parity, and no-secret tests.
9. Governed rollout, migration readback, production verification, and post-merge audit.

Each implementation PR requires its own CI evidence and must reconcile against open overlapping branches before modifying shared OAuth or Context Kernel runtime files.

## Open integration decisions

The following decisions remain explicit implementation inputs rather than assumptions:

- automatic versus explicit personal-workspace creation;
- classification rules for legacy connection rows;
- provider-scope matrices per capability;
- final route naming and compatibility aliases;
- merge ordering for open authority, capability-envelope, asset-federation, and OAuth callback work.

Missing or ambiguous decisions fail closed for consequential execution.
