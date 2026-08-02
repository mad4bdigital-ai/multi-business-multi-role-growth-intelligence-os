# Feature Specification: Tenant Managed Execution Lifecycle

**Branch**: `gpt/017-tenant-managed-execution-foundation-v3-20260802`  
**Created**: 2026-08-02  
**Status**: In progress  
**Delivery**: multi_pr  
**Issue**: #4449

## Problem

Generic workflow orchestration can create a run without proving a parent task ticket, capability authority, resource grant, immutable grant evidence, or an effect-derived approval. A later step can therefore execute after authority has changed or through a route that bypasses the managed lifecycle.

## Objective

Create one fail-closed lifecycle:

`parent ticket → managed task ticket → capability/resource authority → approval hold → workflow run → idempotent step request → lifecycle evidence`.

This slice establishes code and additive schema contracts only. It does not apply Migration 1043, deploy Production, execute provider operations, or close #4449.

## Functional requirements

- FR-001: Run creation requires tenant, requester, parent ticket, workflow, capability, resource type/ref, effect class, and idempotency key.
- FR-002: Capability authority is resolved from `v_platform_capabilities_effective_evidence` and must be active and dispatchable.
- FR-003: Non-read-only effects require `apply_allowed=true`.
- FR-004: Resource authority is resolved from `v_workspace_resource_grant_effective` for the exact resource or tenant workspace.
- FR-005: Required permission is derived from effect class: view, edit, operate, or manage.
- FR-006: Capability and grant evidence is stored in an immutable SHA-256 fingerprinted snapshot.
- FR-007: A managed task ticket is created or related atomically to its parent ticket and run.
- FR-008: Approval holds are derived from effect and access policy, not a caller-provided boolean.
- FR-008A: Approval decisions require an authenticated admin or a principal whose verified role meets or exceeds the hold `required_role`.
- FR-009: Approval expiry, rejection, escalation, and approval synchronize hold, run, binding, task, and evidence states.
- FR-010: Live capability and resource authority is revalidated before every managed step.
- FR-011: Run and step requests are idempotent and reuse the existing binding or step request.
- FR-012: Generic run, step, status, and approval routes cannot bypass managed lifecycle enforcement.
- FR-013: Secret-bearing keys and recognizable secret values are rejected before persistence.
- FR-014: Tenant-safe readback reports state, blockers, next action, and contradictions without credentials or raw internal evidence.

## Safety boundaries

- No Migration 1043 Apply in this PR.
- No direct SQL outside repository migration and parameterized runtime queries.
- No provider call, credential read, external send, deployment, restart, Production branch mutation, or force push.
- No issue closure before migration ledger, exact deployed SHA, runtime readback, and post-merge audit evidence.

## Acceptance for this slice

- Missing or inactive capability authority fails closed.
- Insufficient, revoked, expired, or changed resource authority blocks step creation.
- Approval-gated execution cannot create a step before approved evidence exists.
- An approver below the required role is rejected.
- Repeated run and step requests reuse the existing objects.
- Migration 1043 is additive, unapplied, and exposes a readiness view.
- Regression and E2E phase tests cover authority, approval, idempotency, secret rejection, route hardening, and contradiction projection.
