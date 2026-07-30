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
- silently fall back from an invalid brand connection to a broader workspace or personal connection during a consequential write;
- reconnect an existing connection with a different provider account;
- roll back to an earlier selector that does not enforce exact ownership.

The Context Kernel is the source of truth for exact connection ownership and deterministic selection. Effective Capability Envelope and Effective Authority consume that immutable decision; they do not implement competing selectors or reconstruct ownership from mutable rows.

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

## Workspace ownership types

`workspaceOwnershipType` is one of:

- `personal`: operational workspace owned by one platform user;
- `company`: shared operational workspace with independent membership, roles, grants, and administrative lifecycle.

This ownership dimension is separate from the existing operational `workspaceType` classification. Current operational values such as `brand`, `project`, `campaign`, and `sandbox` remain valid and MUST NOT be renamed, overwritten, or reinterpreted as personal/company ownership.

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

A resolved connection decision MUST carry the selected connection reference, exact owner scope type, exact owner scope reference, and connection revision together. Downstream consumers MUST use this immutable owner-scope evidence rather than re-fetch mutable ownership metadata.

An unresolved decision that has not selected one exact connection MUST omit selected connection and owner-scope fields. It represents candidates and their revisions separately and MUST NOT invent an owner scope for `interpretation_required` or `connection_required`.

Credential values and refresh tokens are stored only through the credential boundary. They MUST NOT appear in Context Kernel models, API projections, logs, traces, plans, approvals, readiness evidence, or support artifacts.

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

1. Tenant, workspace, operational workspace type, and workspace ownership type MUST be resolved before connection candidates are ranked.
2. A brand connection is eligible only for resources owned by that exact brand.
3. A workspace connection is eligible only inside its exact workspace and tenant.
4. A personal connection is eligible only when `ownerUserRef` equals the effective user.
5. A personal connection inside a company-workspace operation requires an explicit operation policy that permits personal inheritance.
6. Equal-ranked eligible connections produce `CONNECTION_AMBIGUOUS`; no first-row selection is allowed.
7. Revoked, expired, disabled, insufficient-scope, owner-mismatched, or stale-revision connections are ineligible.
8. Candidate discovery and pre-credential readiness MUST remain secret-free.
9. After one exact connection, owner scope, capability, authority path, exact execution plan, approval state, and non-secret readiness decision agree, the guarded credential boundary MAY materialize that connection's credential for credential-dependent provider readiness and dispatch only.
10. Consequential writes MUST NOT silently fall back from an explicitly bound or more-specific invalid connection.
11. Context pins, plans, and approvals MUST be invalidated when membership, workspace ownership, brand, connection ownership, authorization, provider account, provider scopes, or connection revision changes.

## Two-stage readiness and credential boundary

Readiness is evaluated in two phases.

### Pre-credential readiness

```text
Exact context
+ exact owner scope
+ exact connection metadata
+ capability binding
+ authority path
+ exact execution plan
+ approval state
+ non-secret configuration and policy
= credential materialization eligible
```

No secret is loaded during candidate discovery, ambiguity resolution, ownership validation, capability resolution, authority validation, or plan compilation. The exact plan MUST bind the operation, target, selected connection, owner scope, connection revision, and readback contract before credential materialization, even when the operation requires no human approval.

### Credential-dependent provider readiness

After pre-credential readiness passes for one exact selected connection:

```text
Guarded credential materialization
→ credential validity
→ granted provider scopes
→ provider account match
→ reachability
→ quota and schema readiness
→ readback capability
→ dispatch eligibility
```

The materialized credential is passed directly to the provider-readiness or dispatch adapter and never enters context decisions, plans, logs, evidence, API projections, or customer-visible errors.

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
- `flowType`: authorize or reconnect;
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
- optional claimed timestamp;
- claim revision;
- internal non-exportable claim-token hash;
- consumed timestamp when completed;
- completion revision;
- state status and signature version.

The state lifecycle is normative:

```text
issued
→ atomic revision-bound claim
→ claimed by exactly one callback
→ provider exchange and guarded connection mutation
→ atomic completion
→ consumed
```

Before any authorization-code exchange, provider call, credential lookup, or credential mutation, the callback MUST atomically claim the state through a compare-and-set from `issued` to `claimed`, conditioned on the state revision, expiry, nonce, context binding, and unconsumed status. Exactly one concurrent callback receives the internal claim token and may continue. Concurrent losers fail with `OAUTH_STATE_CLAIM_CONFLICT`; later callbacks against a consumed state fail with `OAUTH_STATE_REPLAYED`. Neither case may exchange a code or mutate credentials.

The claim token is short-lived, state-specific, internal, and non-exportable. A failed exchange may move the state only through a governed terminal or recoverable transition and MUST NOT make the same state freely claimable again.

Reconnect state additionally includes:

- target `connectionRef`;
- expected connection revision;
- expected provider account reference when safe, or a privacy-preserving provider-account binding hash.

Callbacks MUST reject replay, expiry, signature failure, redirect mismatch, provider-account mismatch, connection-revision mismatch, and any mismatch between signed state and live tenant, workspace, brand, membership, ownership, or target-connection context.

A reconnect callback MUST reject a different provider account before replacing credentials for the existing connection. Credential replacement itself MUST use a compare-and-set conditioned on the signed expected connection revision, the live target connection revision, the current claimed-state revision, and the valid claim token. The encrypted credential replacement, target connection revision increment, and transition of the same authorization state from `claimed` to `consumed` MUST commit through one governed atomic completion boundary. If any revision moved, no credential replacement becomes visible and a new authorization attempt is required.

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

These are planned surfaces and remain unexposed until the OpenAPI and implementation PR passes its contract gates. Final route naming remains subject to compatibility review.

## Responsibility boundaries

```text
JIT Onboarding
└── platform identity, User JWT, initial workspace lifecycle

Context Kernel
├── effective subject
├── tenant and workspace
├── operational workspace type and workspace ownership type
├── brand and resource
└── exact connection ownership and deterministic selection

Effective Capability Envelope
└── bind the immutable exact connection and owner-scope decision to one capability and resource

Effective Authority
└── decide whether the actor and subject may use the selected connection and owner scope

Provider Readiness
├── pre-credential non-secret readiness
└── guarded credential-dependent validity, scopes, reachability, quota, schema, and readback

Execution Orchestrator
└── dispatch only when every decision agrees
```

## Persistence and compatibility direction

Runtime implementation requires additive, rollback-aware persistence changes around existing `workspace_registry`, `user_app_connections`, and `workspace_app_links` records.

The persistence phase will introduce or normalize:

- additive `workspace_ownership_type` and personal owner metadata;
- exact connection owner scope;
- brand connection bindings;
- provider scopes;
- authorization and connection revisions;
- reconnect target/account binding state;
- active/default uniqueness constraints within one exact scope;
- compatibility classification for legacy rows.

The existing `workspace_registry.workspace_type` operational classification remains unchanged. The migration MUST NOT convert its values to `personal` or `company`.

Legacy rows MUST be preserved and classified before backfill. Destructive cleanup is forbidden until parity, rollback, and support windows are complete.

No migration is applied by this specification amendment. Future additive migrations require separate governed authorization, dry-run validation, ledger evidence, and same-cycle schema/data readback. Their readback MUST succeed before any production shadow, read, OAuth, or write path depends on the new persistence fields.

## Rollback safety

Rollback after hierarchical routing is enabled MUST retain exact-owner isolation independently of ranking or feature flags.

The platform MUST NOT restore a prior selector that can choose a connection using tenant and provider alone. If the exact-owner guard or its required persistence is unavailable, affected provider operations are disabled or fail closed. Rollback preserves audit, OAuth-state, migration, execution, and reconciliation evidence.

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
13. API, logs, context, plans, readiness evidence, and support artifacts never expose credential values.
14. Legacy records continue through a compatibility adapter during additive rollout.
15. OAuth state replay, expiry, context mismatch, redirect mismatch, reconnect account mismatch, and connection-revision mismatch fail closed.
16. Existing operational workspace types remain unchanged while personal/company ownership is stored and resolved independently.
17. Credential-dependent readiness runs only after one exact selected owner scope, an exact execution plan, and all applicable approval gates pass.
18. Every resolved selected-connection decision carries immutable owner-scope evidence, while unresolved decisions omit selected owner scope.
19. Migration ledger and same-cycle readback are verified before dependent shadow/read rollout.
20. Rollback retains exact-owner isolation or disables affected provider operations.
21. Concurrent callbacks using one issued state yield exactly one atomic claim and no losing provider exchange or credential mutation.
22. Reconnect credential replacement is rejected without visible mutation when the target connection revision moves after callback validation.
23. Reconnect credential replacement and authorization-state consumption complete atomically or both remain unapplied.
24. Operations requiring no human approval still compile and bind an exact execution plan before credential materialization.

## Multi-PR implementation sequence

1. Specification amendment and compatibility ledger.
2. Persistence migration artifact, repositories, dry-run, and tests.
3. Separately authorized migration application and same-cycle readback.
4. Tenant self-service provider consent lifecycle with reconnect account binding.
5. Context ownership resolver, two-stage readiness, and invalidation.
6. Effective Capability Envelope and Effective Authority integration.
7. Activation readiness and typed remediation integration.
8. OpenAPI contracts and compatibility aliases.
9. Isolation, replay, reconnect, ambiguity, revocation, shadow-parity, rollback, and no-secret tests.
10. Governed shadow/read/write rollout, production verification, and post-merge audit.

Each implementation PR requires its own CI evidence and must reconcile against open overlapping branches before modifying shared OAuth or Context Kernel runtime files.

## Open integration decisions

The following decisions remain explicit implementation inputs rather than assumptions:

- automatic versus explicit personal-workspace creation;
- classification rules for legacy connection rows;
- provider-scope matrices per capability;
- final route naming and compatibility aliases;
- merge ordering for open authority, capability-envelope, asset-federation, and OAuth callback work.

Missing or ambiguous decisions fail closed for consequential execution.