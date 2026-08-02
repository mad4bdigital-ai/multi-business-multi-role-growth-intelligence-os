# PR Recovery Operations

This slice implements T018 without introducing a new migration or invoking Runtime/Production operations.

## Reused schema

- `step_runs.attempt` stores the bounded attempt number.
- `step_runs.assigned_to` stores the current same-tenant assignee.
- `approval_holds` stores explicit supervisor escalation.
- `managed_execution_step_requests` stores rollback request idempotency.
- `managed_execution_events` stores immutable retry, reassignment, escalation, cancellation, and rollback evidence.

## Recovery contracts

- Retry is limited to three total attempts, accepts only a failed step on a paused/failed run, rejects open holds or other active steps, revalidates capability/resource authority, and deduplicates by a hashed request key.
- Reassignment accepts only pending, awaiting, or failed steps and requires one active membership in the run tenant.
- Escalation accepts only paused/failed runs with no running step and creates or reuses a supervisor approval hold.
- Cancellation skips active steps, rejects open holds, and synchronizes run, binding, task, and event state in one transaction.
- Rollback creates an idempotent `managed_op` compensation step named `__managed_rollback__`. Finalization is rejected until that exact step is completed and all other steps are inactive.
- The workflow run uses its existing `cancelled` terminal enum after successful compensation, while the binding and task lifecycle preserve the more precise `rolled_back` state.

## Explicit non-actions

- Migration 1043 is not applied.
- Runtime readiness is not invoked.
- No provider, credential, external-send, deployment, restart, or Production mutation is performed.
- T019 tenant/admin projections and contradiction reconciliation remain a separate slice.
