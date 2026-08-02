# Feature Specification: Tenant Managed Execution Lifecycle

**Branch**: `gpt/017-tenant-managed-execution-foundation-v3-20260802`  
**Created**: 2026-08-02  
**Status**: In progress  
**Delivery**: multi_pr  
**Issue**: #4449

## Problem

The generic workflow orchestration routes can create a run from only `tenant_id` and `workflow_key`. They do not require a parent task ticket, capability, resource, effective resource grant, immutable grant evidence, or an effect-derived approval. Generic step creation can therefore occur without proving that the requester still holds the relevant resource grant.

The existing authenticated route boundary also does not make request-body tenant and requester identifiers authoritative. A signed-in user must not be able to select another tenant or impersonate another requester. Approval authentication alone is also insufficient: the decision maker must be authorized for the hold's tenant and required role.

## Objective

Provide one fail-closed lifecycle connecting:

`authenticated principal → parent ticket → managed task ticket → capability/resource authority → authorized approval hold → workflow run → idempotent step request → lifecycle evidence`.

The first implementation slice establishes code and schema contracts only. It does not apply Migration 1043, deploy Production, execute provider actions, or close #4449.

## Functional requirements

- FR-001: Managed execution creation requires tenant, requester, parent ticket, workflow, capability, resource type/ref, effect class, and idempotency key.
- FR-002: For non-admin callers, authenticated tenant and user claims are authoritative and request-body identifiers must match them.
- FR-003: Managed run read, step, and status operations must remain within the authenticated tenant/requester scope unless performed by an authorized platform admin.
- FR-004: Capability authority is resolved from `v_platform_capabilities_effective_evidence` and must be active and dispatchable.
- FR-005: Any non-read-only effect requires `apply_allowed=true`.
- FR-006: Effective resource authority is resolved from `v_workspace_resource_grant_effective` for the exact resource or the tenant workspace.
- FR-007: Permission floors are effect-derived: view, edit, operate, or manage.
- FR-008: Capability and resource-grant evidence is stored in an immutable SHA-256 fingerprinted snapshot.
- FR-009: A managed task ticket is created or related atomically to the parent ticket.
- FR-010: Approval holds are derived from effect class and access policy, not a caller-selected boolean.
- FR-011: A non-admin approval decision requires active membership in the hold tenant and the hold's required role, or tenant owner/admin authority.
- FR-012: Approval expiry, rejection, escalation, and approval synchronize hold, run, binding, task ticket, and evidence states.
- FR-013: Step creation rechecks live capability and resource authority; revoked or changed authority fails closed.
- FR-014: Managed step requests require an idempotency key and reuse the existing step when repeated.
- FR-015: Generic run, step, status, and approval routes cannot bypass managed lifecycle enforcement.
- FR-016: Payloads reject secret-bearing keys and recognizable secret values.
- FR-017: Tenant-safe readback reports approval state, next action, and contradictory linked states without exposing credentials or raw internal evidence.
- FR-018: Preserved legacy workflow routes remain discoverable by repository route/OpenAPI generators through an explicit non-runtime discovery bridge after managed enforcement is composed before them.

## Safety boundaries

- No Migration 1043 Apply in this implementation PR.
- No direct SQL outside repository migration and runtime parameterized queries.
- No provider call, credential read, external send, deployment, restart, Production branch mutation, or force push.
- No issue closure before migration ledger, exact deployed SHA, runtime readback, and post-merge audit evidence.

## Acceptance for this implementation slice

- Service and routes fail closed for missing capability/resource authority.
- User JWT callers cannot override tenant/requester scope or access another user's managed run.
- Approval decisions require platform-admin authority or active same-tenant membership with the required role or tenant owner/admin authority.
- Grant revocation or authority drift prevents new steps.
- Approval-gated execution cannot create a step before an approved hold.
- Step and run retries are idempotent at their request boundaries.
- Legacy workflow routes remain present in generated route/OpenAPI evidence.
- Regression tests exercise identity binding, approval authorization, authority, transition, projection, no-secret, idempotency, and route-composition contracts.
- Migration remains additive and unapplied.
