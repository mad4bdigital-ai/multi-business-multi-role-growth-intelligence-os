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
