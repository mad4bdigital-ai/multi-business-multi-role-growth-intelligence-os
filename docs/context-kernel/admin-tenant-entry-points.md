# Admin and Tenant Context Entry Points

Status: preliminary Phase 1 map  
Purpose: identify where the shared context kernel will later attach without changing current routing.

## Shared request flow

Authenticated principal → authorized scope enumeration → effective subject → tenant → workspace → optional brand or required resource → exact connection → authority → capability → execution plan → approval → dispatch → readback or reconciliation.

Phase 1 does not insert this pipeline into production. It records the current attachment points.

## Tenant-facing entry points

| Stage | Current family | Current evidence | Kernel integration requirement |
|---|---|---|---|
| Authentication | Central user JWT guard and tenant routes | CI runs `user-jwt-auth-governance.mjs`; tenant requests enter with authenticated user evidence. | Preserve centralized authentication and pass normalized principal evidence to the shared kernel. |
| Session context | Activation session lifecycle | `activationSessionLifecycleService.js` creates or reuses session context. | Represent missing tenant scope explicitly; do not create an operational sentinel tenant. |
| Brand/workspace selection | Brand/workspace resolver | `brandWorkspaceContextResolver.js` builds authorized candidate catalogs and returns ambiguity in supported cases. | Reuse candidate enumeration concepts, but move ranking and context revision into shared domain policy. |
| Connection selection | Application connection resolver | `appConnectionResolver.js` queries candidate connections and applies current fallback behavior. | Require exact connection binding, deterministic ambiguity handling, and structured dependency failures. |
| Execution | Connector and workflow executors | Connector execution selects a connected system before provider transport. | Accept only a validated execution context and authority path from the kernel. |

## Admin-facing entry points

| Stage | Current family | Current evidence | Kernel integration requirement |
|---|---|---|---|
| Admin transport | Governed Admin routes and `admin_control` surfaces | Admin operations use separate governed endpoints and mutation controls. | Treat Admin as a principal with wider visibility, not as a separate resolver implementation. |
| Scope override | Brand/workspace resolver Admin inputs | Admin resolution can enumerate a broader catalog and accept explicit tenant scope. | Require an explicit effective subject before tenant-scoped mutation planning. |
| Repository and provider mutations | Capability envelopes, resource authority, and readback policies | Existing mutation surfaces require typed confirmation, expected revisions, and readback. | Bind approvals and idempotency to the resolved context hash and invalidate them when context changes. |
| Audit projection | Dynamic audit runtime | Audit context currently has a shared default scope. | Project customer-safe audit context from the validated execution context. |

## Current cross-cutting risks

1. A missing scope can be converted into a sentinel instead of a blocked state.
2. A single-row query can hide ambiguity when uniqueness is not enforced by a stable key.
3. A resolver dependency failure can look like an empty candidate set.
4. A permissive default can expand authority when configuration is incomplete.
5. Admin visibility can be mistaken for tenant mutation authority.
6. Exact connection identity can be weakened by fuzzy lookup.

## Planned attachment sequence

1. Keep authentication and transport adapters unchanged.
2. Introduce framework-independent principal, candidate, decision, context, and error types.
3. Add registry adapters behind application interfaces.
4. Run the new resolver in shadow mode beside current routing.
5. Compare outcomes and block any cross-tenant or ambiguity discrepancy.
6. Enable read-only consumers before governed writes.
7. Remove legacy defaults only after compatibility evidence and rollback readiness exist.
