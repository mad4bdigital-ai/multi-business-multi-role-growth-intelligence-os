# Implementation Plan

## Reuse decisions

- Reuse `workflow_runs`, `step_runs`, and `approval_holds` from Migration 010.
- Reuse Context Kernel dimensions from Migration 204.
- Reuse ticket parent/capability integrity and serialized dedupe from Migration 1042 and `supportTicketLifecycleIntegrityCreationService.js`.
- Reuse `v_workspace_resource_grant_effective` for resource authority.
- Reuse `v_platform_capabilities_effective_evidence` for capability runtime authority.
- Keep all existing route declarations in `workflowOrchestrationRoutes.js`; add managed handlers and interception inline so route-generation evidence remains complete.

## Slice 1 — code and additive schema

1. Add managed execution envelope, effect policy, transitions, secret rejection, and projection helpers.
2. Resolve capability and resource authority and create immutable fingerprinted snapshots.
3. Create or reuse linked task, run, approval hold, binding, and lifecycle event atomically.
4. Revalidate current authority before an idempotent managed step request.
5. Enforce approver-role hierarchy and synchronize approval decisions.
6. Intercept generic workflow routes when a managed contract is present and reject managed fields on the generic create route.
7. Add Migration 1043 tables and readiness view without applying it.
8. Add regression test, OpenAPI contract, and E2E phase contract.

## Later governed slices

- Obtain checksum-bound readiness authorization and apply Migration 1043 exactly once.
- Verify migration ledger and readiness view.
- Add bounded retry, cancellation, reassignment, escalation, rollback, and reconciliation operations.
- Add complete tenant/admin monitoring projections.
- Promote through a current-main Production candidate and verify exact runtime SHA.
- Complete post-merge audit and close #4449 only after runtime evidence.
