# Implementation Plan

## Reuse decisions

- Reuse `workflow_runs`, `step_runs`, and `approval_holds` from Migration 010.
- Reuse `step_runs.attempt` for bounded retry and `step_runs.assigned_to` for reassignment; no new recovery schema is required.
- Reuse Context Kernel dimensions added by Migration 204.
- Reuse ticket parent/capability integrity and serialized dedupe from Migration 1042 and `supportTicketLifecycleIntegrityCreationService.js`.
- Reuse `v_workspace_resource_grant_effective` as resource authority.
- Reuse `v_platform_capabilities_effective_evidence` as capability runtime authority.
- Reuse `managed_execution_step_requests` and `managed_execution_events` for rollback request idempotency, reconciliation evidence, and immutable intervention history.
- Preserve the existing workflow orchestration implementation byte-for-byte as `workflowOrchestrationLegacyRoutes.js`.
- Keep `workflowOrchestrationRoutes.js` as a small composite that mounts managed enforcement before the legacy router and carries an uninvoked source-discovery bridge because the generator scans only builders imported directly by `routes/index.js`.

## Slice 1 — code and additive schema

1. Add a small managed-execution module set: core policy, authority resolution, persistence, run/step service, decision service, and a compatibility barrel export.
2. Bind non-admin tenant/requester scope to the authenticated principal before service dispatch.
3. Add atomic managed run creation and managed task linkage.
4. Add effect-derived approval and immutable authority snapshots.
5. Require active same-tenant membership and the hold's required role, an explicitly higher role, or tenant owner/admin authority, for non-admin approval decisions.
6. Add idempotent managed step requests and live grant revalidation.
7. Harden generic workflow routes against managed lifecycle bypass while preserving legacy route discovery.
8. Add Migration 1043 tables and readiness view without applying it.
9. Add synthetic regression and E2E phase evidence.

## Slice 2 — resilient recovery operations

1. Add explicit managed step-status transitions rather than allowing generic status mutation to infer recovery behavior.
2. Bound retries to three total attempts, require a failed step, reject concurrent active steps or approval holds, revalidate live authority, and deduplicate retry requests through hashed event evidence.
3. Require active same-tenant membership before reassignment and limit reassignment to pending, awaiting, or failed steps.
4. Escalate paused or failed runs through a supervisor approval hold while preventing duplicate or conflicting holds.
5. Cancel eligible runs atomically by skipping active steps, rejecting open holds, and synchronizing run, binding, task, and event state.
6. Model rollback as an idempotent managed compensation step followed by explicit finalization only after the compensation step completes and all other steps are inactive.
7. Preserve all recovery evidence in `managed_execution_events`; do not call providers, read credentials, or create external writes.

## Slice 3 — safe projections and contradiction reconciliation

1. Replace the raw managed-run read response with a role-aware projection so tenant users never receive execution context, authority snapshots, raw inputs/outputs/errors, idempotency keys, or unfiltered event evidence.
2. Provide a tenant projection with progress, approval need, blocker, requested input, next action, and terminal result status only.
3. Provide an admin projection with safe run/binding/task/parent/step/hold summaries, authority metadata, evidence hashes, allowlisted intervention details, and a linked-state matrix.
4. Detect structural contradictions across run, binding, task, parent, hold, and step records, including tenant/link mismatches, multiple open holds, terminal runs with active steps, invalid rollback evidence, and approval-state conflicts.
5. Derive one canonical state from approval evidence, completed rollback compensation, or the workflow run status using the same state mappings as the existing decision service.
6. Generate deterministic repair actions only for run/binding/task status drift. Structural or ambiguous contradictions are never auto-repaired.
7. Bind every reconciliation plan to a SHA-256 fingerprint and require `RECONCILE_MANAGED_EXECUTION:<run_id>:<fingerprint>` before Apply.
8. Restrict reconciliation Apply to platform admins, execute it in one transaction, append immutable reconciliation evidence, and reject the transaction if final readback still contains any contradiction.
9. Keep dry-run read-only and expose the exact blocking contradiction codes and required confirmation.

## Later governed slices

- Obtain the exact checksum-bound Runtime Readiness authorization and run the no-Apply readiness workflow.
- Add and review a separate Migration 1043 Apply contract only after successful readiness evidence.
- Apply Migration 1043 exactly once, verify its ledger/readiness view, and separately synchronize the activation registry.
- Promote through a current-main Production candidate and verify exact runtime SHA and protected tenant/admin paths.
- Complete post-merge audit and close #4449 only after runtime evidence.
