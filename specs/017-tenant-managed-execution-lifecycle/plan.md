# Implementation Plan

## Reuse decisions

- Reuse `workflow_runs`, `step_runs`, and `approval_holds` from Migration 010.
- Reuse Context Kernel dimensions added by Migration 204.
- Reuse ticket parent/capability integrity and serialized dedupe from Migration 1042 and `supportTicketLifecycleIntegrityCreationService.js`.
- Reuse `v_workspace_resource_grant_effective` as resource authority.
- Reuse `v_platform_capabilities_effective_evidence` as capability runtime authority.
- Add a focused `managedExecutionRoutes.js` router and compose it before the preserved orchestration base so managed contracts cannot bypass lifecycle checks.

## Slice 1 — code and additive schema

1. Add a small managed-execution module set: core policy, authority resolution, persistence, run/step service, decision service, and a compatibility barrel export.
2. Add atomic managed run creation and managed task linkage.
3. Add effect-derived approval and immutable authority snapshots.
4. Add idempotent managed step requests and live grant revalidation.
5. Harden generic workflow routes against managed lifecycle bypass.
6. Add Migration 1043 tables and readiness view without applying it.
7. Add synthetic regression and E2E phase evidence.

## Later governed slices

- Authorize and apply Migration 1043 exactly once.
- Register tenant/admin tool schemas only after runtime and authority review.
- Add explicit bounded retry, reassignment, rollback, and reconciliation operations.
- Add customer/admin projections and full contradiction remediation.
- Promote through current-main Production candidate and verify exact runtime SHA.
- Complete post-merge audit and close #4449 only after runtime evidence.
