# PR Tenant/Admin Projections and Reconciliation

This slice implements T019 without applying Migration 1043 or invoking the Runtime Readiness workflow.

## Read projections

- `GET /managed-execution-runs/:id` no longer returns raw workflow or binding rows.
- Tenant users receive progress, approval need, blocker, requested input, next action, and terminal status only.
- Tenant output excludes execution context, authority snapshots, raw input/output/error payloads, raw idempotency keys, and raw intervention evidence.
- Platform admins receive safe run, binding, task, parent, hold, step, authority, and intervention summaries.
- Admin intervention evidence is allowlisted and accompanied by a SHA-256 digest; unrecognized payload keys are not returned.

## Contradiction detection

The state matrix detects:

- missing or ambiguous binding, managed task, or parent ticket;
- run/binding/task/parent/hold/step tenant mismatch;
- task or parent relationship mismatch;
- multiple open approval holds or rollback compensation steps;
- open approval evidence conflicting with active/terminal run state;
- terminal runs with active steps or completed runs with failed steps;
- awaiting-approval state without approval evidence;
- rollback lifecycle without the required completed compensation step;
- deterministic run/binding/task/hold-link status drift.

Structural or ambiguous contradictions are blocking and never auto-repaired.

## Reconciliation boundary

- `POST /managed-execution-runs/:id/reconcile` is platform-admin only.
- The default `dry_run` mode performs no writes and returns contradiction codes, canonical state, exact actions, plan fingerprint, and required confirmation.
- Apply requires `RECONCILE_MANAGED_EXECUTION:<run_id>:<plan_fingerprint>`.
- The plan is recalculated under row locks before writes, preventing stale confirmation reuse.
- Apply may update only workflow run status, binding lifecycle/customer/approval-hold link, and task status/lifecycle/customer fields.
- Hold decisions, step states, tenant identifiers, ticket relationships, authority snapshots, resource grants, and external systems are never changed by reconciliation.
- Apply appends a `managed_execution_reconciled` event with plan and action digests.
- Final readback must contain zero contradictions or the transaction rolls back.

## Explicit non-actions

- Migration 1043 Apply: not executed.
- Runtime Readiness workflow: not invoked.
- Activation registry synchronization: not executed.
- Provider call, credential access, external send, deployment, restart, and Production mutation: not executed.
