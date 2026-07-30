# Feature Specification: Unified Effective Authority Control Plane

**Feature Key:** `011-unified-effective-authority-control-plane`  
**Status:** specification complete; implementation pending  
**Delivery Mode:** multi-PR, additive, shadow-first  
**Primary Scope:** Admin and Tenant authority, projection, and execution readiness

## 1. Problem statement

The platform exposes several legitimate but differently computed views of authority: registry inventory, authorization visibility, installation state, operational readiness, tool exports, dynamic tabs, dashboards, and runtime dispatch. When each surface applies local filters or local meanings for `active`, `connected`, or `authorized`, one snapshot can produce contradictory results.

A representative failure is a platform administrator whose session declares `platform_admin_all` while the dynamic authorization envelope reports zero visible connected systems, even though the registry contains active connectors. This is authority-projection drift, not merely a display defect.

## 2. Goal

Create one platform-wide decision plane that resolves effective authority for Admin, Tenant, service-principal, agent, support, agency, and delegated contexts. All projections and execution gates consume the same typed decision evidence.

## 3. Non-goals

- Selecting a third-party policy-engine vendor.
- Replacing the SQL-primary registry.
- Enabling provider writes, publishing, deployment, or destructive mutations.
- Removing legacy paths before measured parity and explicit cutover.
- Treating UI visibility, tool registration, installation, or provider availability as authority.
- Returning credentials, tokens, or secret payloads.

## 4. Normative architecture

The platform MUST implement a Unified Effective Authority Control Plane with:

1. Principal Resolver.
2. Subject Scope Resolver.
3. Resource Graph Resolver.
4. Semantic Capability Resolver.
5. Policy Information Point (PIP).
6. Policy Decision Point (PDP).
7. Projection Compiler.
8. Policy Enforcement Points (PEPs).
9. No-secret Decision Ledger.
10. Invalidation and Reconciliation Plane.

## 5. Unified Admin and Tenant rule

Admin and Tenant requests MUST use the same resolver and decision state machine. Differences MUST be explicit inputs: principal type, signed/platform scope grants, target subject scope, allowed operations, delegation mode, risk, and approval policy.

The platform MUST NOT implement a general `admin_bypass`, rely on a zero tenant identifier as proof of global authority, or maintain independent Admin and Tenant authorization algorithms. Global administrative visibility MUST NOT imply global mutation authority.

## 6. Actor, subject, and scope

Every decision MUST preserve:

- **Actor:** authenticated initiating principal.
- **Subject:** tenant, workspace, brand, user, agent, or resource scope evaluated.
- **Scope mode:** signed membership, platform global, explicit tenant diagnostic, delegated support, agency assignment, service assignment, or approved break-glass.

Admin diagnostics against a tenant MUST retain both actor and subject. Impersonation MUST be explicit, time-bound, reason-bound, operation-bound, revocable, and audited. Tenant callers MUST NOT expand signed identity or scope through request parameters.

## 7. Effective Authority Manifest

The PDP MUST return a typed, no-secret manifest containing:

- decision ID and state;
- actor and normalized subject scope;
- semantic capability and operation;
- resolved resource;
- authority-layer readiness vector;
- safe provider binding, connection, and endpoint references when applicable;
- projection eligibility;
- typed gaps and exclusion reasons;
- policy, registry, graph, grant, connection, endpoint, certification, and projection versions;
- evaluated/expiry timestamps and evidence references;
- `secretsIncluded: false`.

States: `ready`, `shadow_ready`, `canary_ready`, `blocked`, `authorization_gated`, `degraded`, `ambiguous`, `stale`, and `not_applicable`. A Boolean `authorized=true` is insufficient for state-changing execution.

## 8. Resolution sequence

The resolver MUST:

1. authenticate principal;
2. derive immutable actor identity;
3. normalize requested subject scope;
4. validate membership, platform scope, or delegation;
5. resolve semantic capability and operation;
6. resolve resource and relationship authority;
7. evaluate policy, grants, classification, and risk;
8. resolve provider binding;
9. deterministically select a connection;
10. validate action grant;
11. resolve canonical endpoint;
12. validate runtime certification and freshness;
13. validate approval requirements;
14. produce and ledger the manifest.

Provider, tool, endpoint, and credential selection MUST NOT precede semantic capability and resource authority.

## 9. Authorization model

The model SHOULD combine RBAC for broad role templates, ABAC for context and risk, ReBAC for resource relationships, and capability authorization for the exact operation. Roles MUST NOT directly grant unrestricted provider execution.

## 10. Resource graph

The graph MUST support Platform, Tenant, Workspace, Brand, Site, Account, Connection, Agent, Workflow, Artifact, and registered resources. Inheritance is policy-driven. Tenant membership does not automatically imply access to every nested resource. Restricted, shared, agency, and cross-workspace resources require explicit policy or grants.

## 11. Connector state

Connector state MUST be multi-dimensional:

- registry status;
- authorization visibility;
- configuration completeness;
- installation status;
- credential validation;
- connectivity;
- runtime certification;
- freshness;
- execution readiness.

A registered connector without installation remains visible to authorized administrators with an explicit blocked reason. Visibility MUST NOT silently depend on installation.

## 12. Projection rules

Tool Catalog, Dynamic Tabs, Dashboard, Connector Inventory, agents, skills, recommendations, and activation summaries MUST be projections from effective authority decisions or compiled authority read models. Projection code may format, paginate, aggregate, and redact; it MUST NOT independently recalculate resource authority.

A visible tool is not execution permission. `Executable ⊆ Projected ⊆ Authorized ⊆ Registered`.

## 13. Control plane and data plane

The Control Plane owns identity, scope, graph, capability, policy, grants, bindings, certifications, projections, and decision evidence. The Data Plane executes only manifest-authorized operations and revalidates expiry, grants, connection validity, certification, approval, resource revocation, and idempotency before high-risk execution.

The Data Plane MUST NOT reconstruct authorization from raw request parameters or tool visibility.

## 14. Source of truth

SQL registry data remains dynamic runtime authority. Code retains non-configurable safety invariants:

- Tenant identity cannot be overridden.
- Equal top-ranked connections are ambiguous and block.
- Shadow bindings cannot execute.
- Expired/consumed approvals cannot be reused.
- Projections do not grant authority.
- Secrets never enter manifests or decision logs.

## 15. Caching and invalidation

Cached listings may be used only with a version vector. Manifests carry identity, membership, grant, graph, connection, policy, endpoint, certification, and projection versions. Revocation or policy changes invalidate affected decisions and projections. High-risk execution revalidates critical state even before TTL expiry.

## 16. Reconciliation

A reconciler MUST compare Registered, Authorized, Projected, Executable, and Observed sets. Violations create `AUTHORITY_PROJECTION_DRIFT` findings with affected IDs, versions, first detection, last success, and ownership.

For platform-global visibility:

`Visible = Registered - ExplicitlyPolicyHidden`.

## 17. API and errors

New contracts MUST use OpenAPI 3.1, explicit schemas, stable operation IDs, structured errors, pagination, examples, security requirements, and additive compatibility.

- `401`: missing/invalid authentication
- `403`: authenticated but forbidden
- `409`: ambiguity, revision conflict, stale/consumed decision
- `422`: invalid scope/capability semantics
- `429`: rate limiting
- `503`: required dependency unavailable

## 18. Security and privacy

Fail closed for missing authority evidence, ambiguity, stale high-risk decisions, invalid delegation, cross-tenant uncertainty, and unavailable required policy inputs. Explanations must aid remediation without leaking credentials, private cross-tenant identifiers, or sensitive policy internals.

## 19. Migration

Migration is additive and shadow-first:

1. terminology and contracts;
2. shadow resolver;
3. parity and mismatch classification;
4. read-only Admin diagnostics;
5. connector and projection reads;
6. Tool Catalog listing;
7. read-only dispatch pilots;
8. draft-only/reversible writes;
9. bounded high-risk execution;
10. measured legacy deprecation.

No legacy path may be removed before approved parity, rollback, production verification, and post-merge audit.

## 20. Success criteria

- Admin and Tenant traverse one decision pipeline.
- No zero-tenant shortcut grants global authority.
- Projections report consistent resource IDs for the same scope/snapshot.
- Every exclusion has a stable reason code.
- Cross-tenant negative tests pass.
- Revocation invalidates affected manifests and projections within approved SLOs.
- Ambiguous connection selection fails closed.
- High-risk dispatch revalidates mutable authority.
- No authority response contains secrets.
- Drift is detected before a user-reported activation failure.
