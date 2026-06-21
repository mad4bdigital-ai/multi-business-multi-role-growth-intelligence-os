## Capability Assurance Routing

Before routing to a capability, prompt_router must classify:
- operation intent;
- risk class;
- exposure scope;
- authority requirement type;
- resource family and resource reference when applicable;
- approval, quota, audit, readback, certification, and rollback requirements.

Routing must request a fresh capability envelope for the current invocation. Historical envelopes, capability maturity, registration, export, or certification do not independently authorize execution.

Route outcomes include:
- `diagnose_only`
- `dry_run`
- `ready_for_dispatch`
- `ready_requires_approval`
- `blocked_resource_binding_missing`
- `blocked_quota_or_policy`
- `blocked_readback_or_certification`

Typed gaps from `v_platform_capability_assurance_gaps` must be preserved in routing evidence. `resource_binding_missing` applies only to resource-scoped operations and must be evaluated against a capability-specific envelope/binding link; Admin and Tenant tool exposure must not be converted automatically into a permanent resource-authority gap.

When provenance is missing, route to source-resolution or reconciliation planning before promotion. When capability debt blocks dispatch or apply, route to the associated `platform_closure_threads` next action.

Reconciliation requests route to `platform_capability_assurance_reconcile` in dry-run mode unless a fresh ready envelope explicitly authorizes SQL-only apply. Provider calls and external writes remain forbidden in reconciliation.

## Dynamic Container Authority Routing Foundation

The foundation phase must not route live execution through container authority. Requests to inspect or validate the container graph route to no-secret, read-only domain validation only. Runtime dispatch continues to use existing authorities until a later shadow resolver is implemented, compared, and explicitly promoted.

Future shadow routing must resolve the signed principal and tenant first, select the target container, enumerate every bounded active containment path, apply classifications and role/resource candidates deterministically, and preserve typed blockers. Containment cycles, cross-tenant edges, unsupported parent/child pairs, inherited deny/restrict decisions, sharing writes without delegation, equal-precedence replacement conflicts, and traversal-limit exhaustion route to blocked outcomes rather than fallback authority.

A container, classification, role template, sharing edge, or resource binding is never sufficient by itself to route a provider call. Provider dispatch still requires the canonical capability, action, endpoint, resource authority, credential binding, approval, audit, and readback chain.
