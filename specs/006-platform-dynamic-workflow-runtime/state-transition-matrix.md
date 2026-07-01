# State Transition Matrix

All transitions use compare-and-set with `expectedState` and `expectedVersion`. Transition, append-only ledger row, idempotency result, and outbox event commit atomically.

## Workflow version lifecycle

| From | To | Preconditions |
|---|---|---|
| `draft` | `compiled` | Graph/schema compilation succeeds |
| `compiled` | `draft` | Author creates a new revision before publication |
| `compiled` | `validated` | Policy, capability, adapter-class, and data-contract checks pass |
| `validated` | `awaiting_approval` | Activation policy requires approval |
| `validated` | `active` | No approval required and activation authority passes |
| `awaiting_approval` | `active` | Approval matches definition/plan/policy hashes |
| `active` | `deprecated` | Replacement or retirement window declared |
| `deprecated` | `retired` | No new execution allowed; retained runs remain readable |

Published states are immutable. Changes create another draft version.

## Run transitions

| From | Allowed targets | Key conditions |
|---|---|---|
| `draft` | `compiled`, `cancelled`, `blocked` | Exact active workflow version and target resource resolved |
| `compiled` | `validated`, `blocked`, `cancelled` | Compiled-plan hash persisted |
| `validated` | `awaiting_approval`, `ready`, `blocked`, `cancelled` | Authority/settings/adapter decisions persisted |
| `awaiting_approval` | `ready`, `cancelled`, `blocked` | Approval matches all material hashes and is unexpired |
| `ready` | `claimed`, `cancelled`, `blocked` | Outbox/claim readiness passes |
| `claimed` | `running`, `ready`, `cancelled`, `blocked` | Valid lease; release to ready only before external dispatch |
| `running` | `awaiting_external_callback`, `verifying`, `retry_scheduled`, `compensating`, `failed`, `cancelled`, `blocked` | Adapter receipt and transition evidence required |
| `awaiting_external_callback` | `verifying`, `retry_scheduled`, `failed`, `cancelled`, `blocked` | Signed bound callback or timeout/reconciliation decision |
| `verifying` | `completed`, `completed_with_warnings`, `retry_scheduled`, `compensating`, `failed`, `blocked` | Required readback and output normalization |
| `retry_scheduled` | `ready`, `cancelled`, `blocked`, `failed` | Backoff elapsed, retry budget remains, outcome safe to retry |
| `paused` | `ready`, `cancelled`, `blocked` | Resume authority and compatibility revalidation |
| `compensating` | `completed_with_warnings`, `failed`, `blocked` | Compensation evidence persisted |
| terminal states | none | New work requires a new run |

Terminal states: `completed`, `completed_with_warnings`, `cancelled`, `failed`, `blocked`.

## Step transitions

| From | Allowed targets |
|---|---|
| `pending` | `ready`, `skipped`, `blocked`, `cancelled` |
| `ready` | `claimed`, `skipped`, `cancelled`, `blocked` |
| `claimed` | `running`, `ready`, `cancelled`, `blocked` |
| `running` | `awaiting_callback`, `verifying`, `succeeded`, `retry_scheduled`, `failed`, `compensating`, `cancelled`, `blocked` |
| `awaiting_callback` | `verifying`, `retry_scheduled`, `failed`, `cancelled`, `blocked` |
| `verifying` | `succeeded`, `succeeded_with_warnings`, `retry_scheduled`, `failed`, `blocked` |
| `retry_scheduled` | `ready`, `failed`, `cancelled`, `blocked` |
| `compensating` | `compensated`, `compensation_failed`, `blocked` |

## Transition guards

Every transition may require:

- authenticated principal and fresh authority decision;
- exact run/step version;
- active worker lease;
- unchanged workflow, compiled-plan, settings, and adapter hashes;
- approval hold matching target transition;
- adapter receipt or callback evidence;
- retry budget and retryable classification;
- readback evidence;
- compensation capability;
- cancellation policy.

## Unknown external outcome

A transport timeout after request transmission moves to `verifying` or a dedicated reconciliation path, never directly to `retry_scheduled`. The system inspects provider receipt/readback first. Redispatch is allowed only when the operation is proven absent or provider idempotency proves safety.

## Cancellation

Cancellation records intent immediately. External cancellation may be best effort. Canonical state becomes:

- `cancelled` when no unverified effect remains;
- `verifying` when external outcome is uncertain;
- `completed_with_warnings` when intended cancellation followed an already-completed effect;
- `compensating` when an effect must be reversed.

## Completion aggregation

A run reaches:

- `completed` when all required terminal steps succeed and required readback passes;
- `completed_with_warnings` when allowed optional steps fail/skip or compensation resolves a partial effect;
- `failed` when required work cannot complete and no successful compensation state satisfies policy;
- `blocked` for policy, authority, certification, data-integrity, or operator-recovery conditions.
