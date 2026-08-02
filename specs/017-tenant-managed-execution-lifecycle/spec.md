# Feature Specification: Tenant Managed Execution Lifecycle

**Branch**: `gpt/017-tenant-managed-execution-current-main-v4-20260802`  
**Created**: 2026-08-02  
**Status**: In progress  
**Delivery**: multi_pr  
**Issue**: #4449

## Problem

The generic workflow orchestration routes can create a run from only `tenant_id` and `workflow_key`. They do not require a parent task ticket, capability, resource, effective resource grant, immutable grant evidence, or an effect-derived approval. Generic step creation can therefore occur without proving that the requester still holds the relevant resource grant.

The existing authenticated route boundary also does not make request-body tenant and requester identifiers authoritative. A signed-in user must not be able to select another tenant or impersonate another requester. Approval authentication alone is also insufficient: the decision maker must be authorized for the hold's tenant and required role.

Long-running managed work also requires explicit recovery semantics. A failed step must not be retried without a bound, live authority, and idempotent request; cancellation must synchronize active steps and open holds; reassignment must prove same-tenant membership; and rollback must be represented by an auditable compensation step rather than by silently rewriting a terminal status.

The read surface must also not expose raw workflow payloads or authority snapshots to tenant users. Run, binding, ticket, hold, and step state can drift after partial failure or older runtime behavior; the platform needs one deterministic, auditable reconciliation boundary that repairs only unambiguous status drift and leaves structural conflicts blocked for investigation.

## Objective

Provide one fail-closed lifecycle connecting:

`authenticated principal → parent ticket → managed task ticket → capability/resource authority → authorized approval hold → workflow run → idempotent step request → bounded recovery operation → role-safe projection → fingerprinted reconciliation evidence`.

The implementation slices establish code and schema contracts. They do not apply Migration 1043, deploy Production, execute provider actions, or close #4449.

## Functional requirements

- FR-001: Managed execution creation requires tenant, requester, parent ticket, workflow, capability, resource type/ref, effect class, and idempotency key.
- FR-002: For non-admin callers, authenticated tenant and user claims are authoritative and request-body identifiers must match them.
- FR-003: Managed run read, step, status, and recovery operations must remain within the authenticated tenant/requester scope unless performed by an authorized platform admin.
- FR-004: Capability authority is resolved from `v_platform_capabilities_effective_evidence` and must be active and dispatchable.
- FR-005: Any non-read-only effect requires `apply_allowed=true`.
- FR-006: Effective resource authority is resolved from `v_workspace_resource_grant_effective` for the exact resource or the tenant workspace.
- FR-007: Permission floors are effect-derived: view, edit, operate, or manage.
- FR-008: Capability and resource-grant evidence is stored in an immutable SHA-256 fingerprinted snapshot.
- FR-009: A managed task ticket is created or related atomically to the parent ticket.
- FR-010: Approval holds are derived from effect class and access policy, not a caller-selected boolean.
- FR-011: A non-admin approval decision requires active membership in the hold tenant and the hold's required role, an explicitly higher role, or tenant owner/admin authority.
- FR-012: Approval expiry, rejection, escalation, and approval synchronize hold, run, binding, task ticket, and evidence states.
- FR-013: Step creation and recovery operations recheck live capability and resource authority when they resume or create executable work; revoked or changed authority fails closed.
- FR-014: Managed step requests require an idempotency key and reuse the existing step when repeated.
- FR-015: Generic run, step, status, and approval routes cannot bypass managed lifecycle enforcement.
- FR-016: Payloads reject secret-bearing keys and recognizable secret values.
- FR-017: Tenant-safe readback reports approval state, progress, blocker, requested input, next action, and final status without exposing execution context, authority snapshots, raw inputs/outputs/errors, idempotency keys, or raw internal evidence.
- FR-018: Preserved legacy workflow routes remain discoverable by repository route/OpenAPI generators through an explicit non-runtime discovery bridge after managed enforcement is composed before them.
- FR-019: A failed step may be retried only while its run is paused or failed, with no open hold or other active step, and no more than three total attempts.
- FR-020: Retry requests are idempotent and store only a SHA-256 hash of the request key in immutable recovery evidence.
- FR-021: Step reassignment requires an active membership in the run tenant and is limited to pending, awaiting, or failed steps.
- FR-022: Cancellation atomically skips active steps, rejects open holds, and synchronizes run, binding, task ticket, and event state.
- FR-023: A paused or failed run may be escalated only through an explicit supervisor approval hold, with duplicate and conflicting holds rejected or reused safely.
- FR-024: Rollback is an idempotent managed compensation step; the lifecycle reaches `rolled_back` only after that compensation step is completed and all other linked steps are inactive.
- FR-025: Admin readback exposes safe state summaries, authority metadata, evidence hashes, allowlisted intervention fields, linked-state matrix, contradiction details, and reconciliation plan without raw secret-bearing payloads.
- FR-026: Contradiction detection covers missing/ambiguous bindings or tickets, tenant/link mismatch, multiple open holds, terminal runs with active or failed steps, approval-state conflicts, invalid rollback evidence, and run/binding/task status drift.
- FR-027: Canonical state is derived deterministically from completed compensation rollback, open or decided approval evidence, or the existing workflow run status using the same lifecycle mapping as the decision service.
- FR-028: Automatic reconciliation may update only workflow run status, binding lifecycle/customer/hold link, and task status/lifecycle/customer fields when no structural or ambiguous contradiction exists.
- FR-029: Reconciliation dry-run is read-only and returns the exact actions, blocking contradiction codes, SHA-256 plan fingerprint, and required confirmation.
- FR-030: Reconciliation Apply requires platform-admin authority and exact confirmation `RECONCILE_MANAGED_EXECUTION:<run_id>:<plan_fingerprint>` recalculated under row locks.
- FR-031: Apply executes in one transaction, records immutable reconciliation evidence, and rolls back if post-write readback contains any contradiction.

## Safety boundaries

- No Migration 1043 Apply in these implementation PRs.
- No direct SQL outside repository migration and runtime parameterized queries.
- No provider call, credential read, external send, deployment, restart, Production branch mutation, or force push.
- Recovery and reconciliation operations create only repository-defined database state and immutable managed-execution events.
- Reconciliation never changes approval-hold decisions, step statuses, ticket relationships, tenant identifiers, authority evidence, or resource grants.
- No issue closure before migration ledger, exact deployed SHA, runtime readback, and post-merge audit evidence.

## Acceptance for the implementation slices

- Service and routes fail closed for missing capability/resource authority.
- User JWT callers cannot override tenant/requester scope or access another user's managed run.
- Tenant readback contains no raw execution context, authority snapshot, payload, raw idempotency key, or unfiltered intervention evidence.
- Admin readback provides evidence hashes and allowlisted intervention summaries without secret-bearing values.
- Approval decisions require platform-admin authority or active same-tenant membership with the required role, an explicitly higher role, or tenant owner/admin authority.
- Grant revocation or authority drift prevents new or resumed executable work.
- Approval-gated execution cannot create or resume a step before an approved hold.
- Step and run request boundaries are idempotent.
- Failed-step retries stop at the third total attempt and reject concurrent active work.
- Reassignment rejects inactive or cross-tenant principals.
- Cancellation synchronizes active steps and open holds in one transaction.
- Escalation creates or safely reuses a supervisor approval hold.
- Rollback requires a completed managed compensation step before the run is finalized as rolled back.
- Structural contradictions prevent reconciliation Apply and return exact investigation codes.
- Repairable status drift produces a deterministic plan and requires the exact SHA-256-bound confirmation.
- Reconciliation Apply is Admin-only, transactional, evidence-bearing, and validated by contradiction-free readback.
- Legacy workflow routes remain present in generated route/OpenAPI evidence.
- Regression tests exercise identity binding, approval authorization, authority, transition, projection, no-secret, idempotency, route composition, retry, reassignment, escalation, cancellation, rollback, contradiction detection, dry-run, confirmation, Apply, and readback contracts.
- Migration remains additive and unapplied.
