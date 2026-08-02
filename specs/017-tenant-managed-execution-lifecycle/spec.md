# Feature Specification: Tenant Managed Execution Lifecycle

**Branch**: `gpt/017-tenant-managed-execution-foundation-20260802`  
**Created**: 2026-08-02  
**Status**: In progress  
**Delivery**: multi_pr  
**Issue**: #4449

## Problem

The generic workflow orchestration routes can create a run from only `tenant_id` and `workflow_key`. They do not require a parent task ticket, capability, resource, effective resource grant, immutable grant evidence, or an effect-derived approval. Generic step creation can therefore occur without proving that the requester still holds the relevant resource grant.

## Objective

Provide one fail-closed lifecycle connecting:

`parent ticket → managed task ticket → capability/resource authority → approval hold → workflow run → idempotent step request → lifecycle evidence`.

The first implementation slice establishes code and schema contracts only. It does not apply Migration 1043, deploy Production, execute provider actions, or close #4449.

## Functional requirements

- FR-001: Managed execution creation requires tenant, requester, parent ticket, workflow, capability, resource type/ref, effect class, and idempotency key.
- FR-002: Capability authority is resolved from `v_platform_capabilities_effective_evidence` and must be active and dispatchable.
- FR-003: Any non-read-only effect requires `apply_allowed=true`.
- FR-004: Effective resource authority is resolved from `v_workspace_resource_grant_effective` for the exact resource or the tenant workspace.
- FR-005: Permission floors are effect-derived: view, edit, operate, or manage.
- FR-006: Capability and resource-grant evidence is stored in an immutable SHA-256 fingerprinted snapshot.
- FR-007: A managed task ticket is created or related atomically to the parent ticket.
- FR-008: Approval holds are derived from effect class and access policy, not a caller-selected boolean.
- FR-009: Approval expiry, rejection, escalation, and approval synchronize hold, run, binding, task ticket, and evidence states.
- FR-010: Step creation rechecks live capability and resource authority; revoked or changed authority fails closed.
- FR-011: Managed step requests require an idempotency key and reuse the existing step when repeated.
- FR-012: Generic run, step, status, and approval routes cannot bypass managed lifecycle enforcement.
- FR-013: Payloads reject secret-bearing keys and recognizable secret values.
- FR-014: Tenant-safe readback reports approval state, next action, and contradictory linked states without exposing credentials or raw internal evidence.

## Safety boundaries

- No Migration 1043 Apply in this implementation PR.
- No direct SQL outside repository migration and runtime parameterized queries.
- No provider call, credential read, external send, deployment, restart, Production branch mutation, or force push.
- No issue closure before migration ledger, exact deployed SHA, runtime readback, and post-merge audit evidence.

## Acceptance for this implementation slice

- Service and routes fail closed for missing capability/resource authority.
- Grant revocation or authority drift prevents new steps.
- Approval-gated execution cannot create a step before an approved hold.
- Step and run retries are idempotent at their request boundaries.
- Regression tests exercise authority, approval, transition, projection, no-secret, and idempotency contracts.
- Migration remains additive and unapplied.
