# ADR-004: Dynamic Tenant Resolution Authorization Policy

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / Auth / API / Resolution Runtime  
**Resolves**: Q-003

## Context

Tenant Resolution is part of the same user journey and protected-resource boundary as Tenant Activation. Current and planned Resolution operations range from read-only problem cards and case inspection to diagnostics, previews, internal transitions, repair application, and approval decisions. Treating all operations as equivalent would violate least privilege. Creating a separate OAuth client or protected resource for every new capability would create configuration and token-management scale that conflicts with the public unified Tenant GPT model.

The platform must support long-term growth: new Resolution operation families, tenant roles, capabilities, approval classes, and risk tiers should be added without repeatedly redesigning OAuth or hardcoding route-specific authorization across middleware and controllers.

## Decision

Keep Tenant Activation and Tenant Resolution under the same protected resource and unified OAuth client:

- `client_id = mad4b-tenant-gpt`;
- `aud = https://activation.mad4b.com`;
- `resource = https://activation.mad4b.com`.

Use five stable, coarse-grained Resolution scopes:

1. `https://auth.mad4b.com/scopes/tenant.resolution.read`
2. `https://auth.mad4b.com/scopes/tenant.resolution.manage`
3. `https://auth.mad4b.com/scopes/tenant.resolution.diagnose`
4. `https://auth.mad4b.com/scopes/tenant.resolution.repair`
5. `https://auth.mad4b.com/scopes/tenant.resolution.approve`

The scopes describe broad user consent/authorization classes. They do not directly encode every route or action. Runtime authorization is resolved dynamically from a governed SQL policy registry that maps each operation to its complete authorization requirements.

## Dynamic authorization policy model

Each protected Resolution operation must resolve a versioned active policy record containing at least:

- `policy_key` and version;
- public `operation_id`;
- registered `parent_action_key` and `endpoint_key` where applicable;
- HTTP method and normalized route pattern;
- protected resource;
- one or more required scopes;
- eligible tenant roles or role policy;
- required capabilities;
- object-level authority rule;
- workspace/Brand/app constraints;
- risk tier;
- approval class;
- typed-confirmation requirement;
- idempotency requirement and scope;
- readback/reconciliation contract;
- rate/retry policy;
- effective and expiry timestamps;
- active/deprecated/disabled status.

The registry is runtime authority. OpenAPI documents the expected scopes and contract but does not replace runtime authorization policy.

## Scope semantics

### `tenant.resolution.read`

Permits requesting read-only Resolution data such as problem cards, case lists/details, approval status, and bounded evidence. Object-level tenant/workspace/case authority remains mandatory.

### `tenant.resolution.manage`

Permits creating cases and requesting allowed internal lifecycle transitions. State-machine rules, tenant ownership, optimistic concurrency, and idempotency remain mandatory.

### `tenant.resolution.diagnose`

Permits diagnostics, repair preview, verification, and other non-mutating or safely bounded analysis operations. Provider access and data visibility remain constrained by app/resource policy.

### `tenant.resolution.repair`

Permits entering the authorization pipeline for repair application. It does not itself authorize execution. A repair may additionally require capability authority, a plan-bound approval, typed confirmation, idempotency, dependency readiness, and authoritative readback.

### `tenant.resolution.approve`

Permits requesting approval decisions. The decision still requires object-level authority, eligible role/policy, valid lifecycle state, non-reused approval, audit, and idempotency.

## Authorization evaluation order

For each protected operation:

1. Verify bearer token signature, issuer, expiry, purpose, single audience, and resource.
2. Resolve verified `tenant_id` and `user_id` from the token.
3. Revalidate active membership and workspace context.
4. Resolve the active operation policy from SQL registry by registered operation/endpoint identity.
5. Require the token to contain the policy's broad required scope set.
6. Evaluate current tenant role, capabilities, app/Brand/workspace constraints, and object ownership.
7. Evaluate state-machine, risk, approval, typed-confirmation, idempotency, dependency, and readback requirements.
8. Dispatch only through the registered governed action/endpoint.
9. Persist authorization decision, policy version, operation identity, and no-secret evidence.

Failure at token validation returns `401`. Failure after valid authentication returns `403`, `409`, or another stage-specific structured error as appropriate.

## Long-term growth model

### Adding a new low/medium-risk Resolution operation

- Define the public operation and contract.
- Register the action/endpoint and dynamic policy.
- Map it to one or more existing coarse scopes.
- Add object-level authority and tests.
- Update canonical OpenAPI and generated artifacts.
- No new OAuth client or protected resource is required.

### Adding a new role or tenant package

- Map the role/package to allowed capabilities and scope grants in governed registries.
- Do not introduce role-specific OAuth clients.
- Token issuance grants only the scopes authorized for the selected tenant/user context.
- Runtime membership and policy revalidation can narrow access immediately.

### Adding a new high-risk operation family

Use the same resource and scopes initially only when layered capability/approval/readback controls provide sufficient isolation. A separate protected resource or step-up token becomes necessary only when a documented risk boundary, independently operated service, external write domain, regulatory boundary, or materially different credential/incident domain justifies it. Such escalation requires a new ADR and migration plan.

## Scope stability and explosion control

- The five scopes are stable product-level categories, not per-route permissions.
- New routes normally reuse an existing scope plus dynamic capabilities/policy.
- A new scope requires a distinct user-understandable consent category, not merely a new endpoint.
- Roles and capabilities remain server-side dynamic policy; they are not expanded into hundreds of token scopes.
- Optional policy/profile version claims may support diagnostics but are not runtime authority.
- Short token lifetimes and active membership/policy readback prevent stale token claims from overriding current restrictions.

## Object-level authorization

Scopes never replace object ownership. Every case, problem card, repair plan, approval, evidence item, or operation must resolve to the verified tenant and permitted workspace/Brand/app context. Caller-supplied tenant or ownership identifiers cannot widen access.

## Sensitive operations

For `repair` and `approve` operations:

- scope permits only entry into the authorization pipeline;
- capability and object authority are mandatory;
- plan-bound approval cannot be reused across unrelated operations;
- typed confirmation is required where the active policy declares it;
- unsafe retries require idempotency and reconciliation;
- transport success does not equal execution success;
- authoritative readback is required before reporting completion.

## Consequences

### Positive

- Preserves one public Tenant GPT, one OAuth client, one secret-governance path, and one protected-resource host.
- Provides least privilege without creating a scope per endpoint.
- Allows new operations, roles, packages, and risk policies through governed registry evolution.
- Centralizes authorization policy and reduces route/controller hardcoding.
- Supports immediate server-side narrowing after membership or policy changes.
- Keeps public API contracts stable while internal capabilities evolve.

### Costs and risks

- The policy registry becomes security-critical and requires schema validation, review, versioning, audit, cache-freshness controls, and fail-closed behavior.
- OpenAPI, route policy, registry policy, and application enforcement can drift unless CI parity checks are added.
- Coarse scopes may appear broad; layered capability/object/approval controls must be consistently enforced.
- Policy cache staleness could temporarily preserve old authorization unless critical changes invalidate or bypass cache.

## Rejected alternatives

### One Activation/Resolution scope for all operations

Rejected because it prevents meaningful least privilege and creates excessive impact from route authorization defects.

### Separate Resolution resource immediately

Rejected because current Resolution is part of the same Tenant GPT journey and shares host, principal, session, workspace, and operational context. A separate resource would add token and deployment complexity before a distinct risk boundary is proven.

### One scope per route or action

Rejected because it creates scope explosion, unstable consent, token bloat, and excessive OAuth migration as the platform grows.

### Hardcoded route-to-scope middleware

Rejected because it duplicates policy across routes, OpenAPI, gateway, and application code and becomes difficult to govern at scale.

## Implementation constraints

- SQL registry is authoritative; missing, invalid, expired, or ambiguous policy fails closed.
- Public contracts use stable operation IDs and document required broad scopes.
- Runtime dispatch uses registered action/endpoint keys and never invents keys.
- Policy changes are versioned, audited, and tested before activation.
- Critical authorization changes invalidate/bypass stale caches.
- The implementation must include parity checks across canonical OpenAPI, gateway allowlist, registered endpoint, dynamic policy, and application authorization.
- No registry change alone can bypass capability, approval, idempotency, readback, or tenant-object authority required by the policy.

## Verification

Required tests include:

- each existing Resolution route maps to exactly one active policy;
- read-only tokens cannot manage, diagnose, repair, or approve;
- manage/diagnose scopes cannot apply repair or approve unless separately granted;
- repair/approve scopes still fail without required capability, object authority, approval, confirmation, idempotency, and readback;
- cross-tenant and cross-workspace object access fails closed;
- disabled/expired/missing/ambiguous policies fail closed;
- policy version updates narrow access immediately;
- OpenAPI/route/registry/application parity is enforced in CI;
- new operations can reuse the stable scope taxonomy without OAuth client/resource changes;
- high-risk resource separation can be introduced later without breaking existing low-risk operations.
