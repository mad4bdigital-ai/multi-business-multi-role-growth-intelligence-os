# Use Cases

## UC-01: Platform Admin global inventory

All registered resources are visible except explicitly policy-hidden resources. Each item exposes readiness dimensions. Global visibility does not enable mutation.

## UC-02: Admin diagnoses one Tenant

Admin opens an explicit diagnostic delegation with tenant, reason, ticket, allowed read/diagnose operations, and expiry. Audit preserves actor and subject. Writes remain blocked unless separately approved.

## UC-03: Tenant lists authorized tools

Signed identity and active membership define scope. Tool Catalog projects allowed capabilities and reachable resources. A visible tool may show `setup_required` or `approval_required` without becoming executable.

## UC-04: Tenant executes a read capability

The PDP resolves capability, resource, connection, endpoint, and certification. A short-lived manifest is issued. The PEP revalidates scope and connection before dispatch.

## UC-05: Tenant requests high-risk write

Decision is ready except for typed approval. Approval binds actor, subject, capability, resource, request hash, revisions, and expiry. Execution consumes it once and performs readback.

## UC-06: Agency operator manages several Tenants

The operator has separate agency-to-tenant assignments. Switching tenant changes subject scope, never actor identity. Resources from two tenants cannot share one decision unless a policy explicitly allows aggregate read.

## UC-07: Platform connector offered to Tenant

The connector is visible to Admin globally. Tenant use requires an explicit resource link, capability allowance, quota/disclosure policy, and action grant. Platform ownership alone grants nothing.

## UC-08: Active connector without installation

It remains registered and visible to authorized Admin users. Readiness reports `installation:not_installed` and `execution:blocked` rather than silently hiding it.

## UC-09: Dedicated Tenant connector

The Tenant-owned connection is selected when policy and resource ownership match. Platform fallback is forbidden unless explicitly allowed and disclosed.

## UC-10: Ambiguous connections

Two connections share the top deterministic rank. Decision returns `ambiguous`; no arbitrary row is selected.

## UC-11: Membership revoked after listing

A user lists tools, then membership is revoked. Invalidation advances the membership version. Cached listings refresh; execution fails revalidation immediately.

## UC-12: Certification revoked

Endpoint certification is revoked after manifest creation. Final PEP revalidation rejects execution as stale or blocked.

## UC-13: Agent acting for workspace

The agent has an assignment relation and bounded capabilities. The triggering human/service actor remains in lineage. The agent cannot exceed assignment scope.

## UC-14: Support impersonation attempt

Support cannot set arbitrary `tenant_id`. A governed delegation is required. Missing, expired, or operation-mismatched delegation fails closed.

## UC-15: Tool exists but action not granted

The export may be discoverable, but execution eligibility is false with `GRANT_ACTION_REQUIRED`. Visibility is not permission.

## UC-16: Shadow rollout

The new PDP computes beside legacy behavior. No provider call is caused by shadow output. Differences are classified by resource ID and reason.

## UC-17: Canary rollout

A read-only capability and bounded cohort use the new PEP. Canary policy, revisions, rollback, and telemetry are explicit.

## UC-18: Projection drift

Registry and authorized sets report 27 systems while Tool Catalog reports 0. Reconciler raises `AUTHORITY_PROJECTION_DRIFT`, identifies missing IDs and projection version, and blocks false active classification.

## UC-19: Partial dependency outage

Required policy data is unavailable. Safe reads may return explicitly incomplete degraded results. State-changing execution is blocked; no local bypass is attempted.

## UC-20: Break-glass

Break-glass is a distinct scope mode with resource binding, reason, typed confirmation, short TTL, independent approval, enhanced logging, and mandatory post-action review. It is never `is_admin=true`.
