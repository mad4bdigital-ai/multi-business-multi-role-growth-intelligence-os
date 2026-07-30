# ADR-001: Unified Effective Authority Control Plane

## Status

Proposed and specification-approved; implementation requires phased PR approval.

## Context

The platform supports administrators, tenant owners and members, agencies, agents, service principals, shared and dedicated integrations, dynamic tools, dashboards, and governed execution. Authority is evidenced across several registries and runtime surfaces. Independent local projection logic can produce contradictory visibility and readiness outcomes.

A local Admin filter fix corrects one symptom while preserving architectural drift. Separate Admin and Tenant resolvers duplicate sensitive rules and eventually diverge.

## Decision

Adopt one Unified Effective Authority Control Plane (UEACP).

All principal types use one typed resolver. Admin and Tenant behavior differs through explicit principal type, subject scope, resource relationships, grants, policy attributes, and operation risk. The PDP emits one Effective Authority Manifest. Tool Catalog, Dynamic Tabs, Dashboard, Connector Inventory, recommendations, and execution readiness are projections or enforcement outcomes derived from that manifest.

The architecture uses:

- SQL-primary dynamic authority;
- code-level non-configurable safety invariants;
- actor/subject separation;
- RBAC + ABAC + ReBAC + capability authorization;
- PDP/PIP/PAP/PEP separation;
- a versioned Resource Graph;
- a no-secret decision ledger;
- event-driven invalidation;
- continuous projection reconciliation;
- shadow-first migration.

## Consequences

### Positive

- One semantics path for Admin and Tenant.
- Consistent IDs across activation, tools, tabs, dashboards, and connectors.
- Explicit diagnostics and exclusion reasons.
- Stronger cross-tenant isolation.
- Provider/tool changes do not redefine user authority.
- New roles and agency relationships do not require new engines.
- Visibility, readiness, and execution become independently observable.

### Negative

- The PDP becomes critical infrastructure.
- Migration touches multiple surfaces and cannot be one PR.
- Resource graph and versioning add complexity.
- Decision evidence and reconciliation increase telemetry volume.
- Policy governance requires disciplined ownership.

## Alternatives rejected

1. Patch Admin SQL filters only.
2. Separate Admin and Tenant engines.
3. Role-only authorization.
4. Tool visibility as authority.
5. Provider-specific authorization.
6. Big-bang replacement.

## Non-negotiable constraints

- No implicit impersonation.
- No global Admin mutation bypass.
- No Tenant scope expansion from request parameters.
- No secrets in manifests or ledgers.
- No automatic selection under equal-ranked ambiguity.
- No high-risk execution without same-cycle revalidation.
- No legacy removal before measured parity and explicit cutover.
