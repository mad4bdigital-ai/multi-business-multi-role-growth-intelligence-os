# Failure, Retry, Reconciliation, and Compensation Semantics

## 1. Purpose

This document defines how the composed runtime classifies failures, decides whether work may be retried, reconciles unknown outcomes, resumes after process or transport interruption, and applies compensation without duplicating provider effects.

The primary safety rule is:

> A transport, process, or storage failure is not evidence that a provider mutation failed.

## 2. Failure dimensions

Every failure is classified across these dimensions:

- stage;
- whether provider dispatch began;
- whether mutation was possible;
- whether provider-native idempotency exists;
- whether internal idempotency reservation exists;
- whether outcome is confirmed;
- whether same-cycle readback exists;
- whether retry is safe;
- whether reconciliation is required;
- whether compensation is declared and authorized;
- whether the error is user-actionable, automatically repairable, or terminal.

## 3. Failure stages

```text
request_validation
intent_resolution
descriptor_resolution
context_resolution
plan_compilation
governance_compilation
approval_validation
mutation_frontier_validation
idempotency_reservation
resource_lock_acquisition
provider_dispatch
provider_wait
readback
ledger_commit
result_projection
outbox_delivery
compensation
reconciliation
```

Each error envelope includes one stage.

## 4. Pre-dispatch failures

Examples:

- invalid request schema;
- ambiguous intent;
- descriptor absent/hidden;
- descriptor/runtime mismatch;
- context unresolved/expired;
- authority/capability denied;
- approval missing/expired;
- expected SHA/version drift;
- idempotency conflict;
- lock conflict;
- plan invalid/cyclic;
- lane policy violation.

Properties:

- provider mutation did not occur;
- no unknown outcome exists;
- retry may be safe after the declared blocker is resolved;
- the same operation may resume if the state machine permits and bound inputs remain unchanged;
- a changed intent/target/input creates a new operation or plan revision according to contract.

## 5. Dispatch-not-started failures

A provider adapter may fail before sending bytes or before invoking the provider SDK.

Required evidence:

- `dispatch_classification=not_dispatched`;
- pending receipt exists;
- provider request identity not issued;
- adapter proves no invocation occurred.

Safe action:

- retry within existing idempotency scope if retry budget and dynamic validation pass.

The adapter must not use `not_dispatched` when it cannot prove that no provider call occurred.

## 6. Confirmed provider rejection before mutation

Examples:

- schema validation rejected by provider;
- authentication rejected before action;
- precondition/ETag/SHA conflict;
- provider policy denial;
- explicit rate limit before execution.

Required classification:

- `request_rejected_before_mutation` or `confirmed_provider_failure`;
- provider status/code;
- `possible_mutation=false` only when provider semantics prove it.

Retry depends on code:

- schema/policy errors: no automatic retry;
- authentication/connection repair: retry only after authority/connection refresh;
- precondition drift: recompile/reapprove where required;
- rate limit: bounded retry with server-declared or policy backoff.

## 7. Confirmed provider success

A provider response alone may not satisfy operation success.

The runtime still requires:

- receipt finalization;
- declared same-cycle readback;
- expected postcondition match;
- ledger/result commit;
- operation/step state transition.

If readback or final ledger commit fails after provider success, the operation becomes `reconciliation_required`, not a fresh retry candidate.

## 8. Unknown outcome

Unknown outcome exists when mutation may have occurred but cannot be confirmed.

Triggers include:

- connection reset after request transmission;
- HTTP 502/503/504 with provider semantics that do not prove rejection;
- client/process timeout after dispatch;
- worker crash during provider call;
- response parsing failure after possible acceptance;
- provider accepted asynchronous request but operation reference was not durably recorded;
- database commit result unknown after receipt finalization attempt.

Required behavior:

1. Persist `unknown_outcome`/`reconciliation_required`.
2. Block provider mutation retry.
3. Preserve idempotency reservation.
4. Preserve or replace scheduling lock with a logical mutation guard.
5. Persist provider request hash and any safe correlation/reference.
6. Schedule or expose reconciliation as canonical next action.
7. Return structured outcome to caller.

## 9. Reconciliation algorithm

Inputs:

- operation/step/attempt/receipt identity;
- exact target and connection;
- provider request hash/reference;
- expected precondition and postcondition;
- dispatch time window;
- provider-native idempotency evidence;
- internal ledger state;
- prior readback evidence.

Algorithm:

1. Validate current capsule/context and exact target; do not select a replacement.
2. Read internal receipt/idempotency/attempt state.
3. Query provider using the strongest available exact reference.
4. If provider operation reference exists, read its state.
5. Otherwise read the exact resource and compare pre/postcondition fingerprints.
6. Compare with internal expected state and any repository/schema/deployment evidence.
7. Classify:
   - `reconciled_success`;
   - `confirmed_absent_retry_allowed`;
   - `reconciled_failure`;
   - `still_unknown_manual_action`.
8. Persist readback and transition atomically.
9. Release mutation guard only when classification permits.
10. Retry only under the original or explicitly renewed governed contract.

## 10. Retry policy model

Each step declares:

- maximum attempts;
- retryable codes;
- non-retryable codes;
- backoff strategy and maximum delay;
- jitter policy;
- total retry deadline;
- provider quota/rate-limit behavior;
- whether provider-native idempotency is required;
- whether dynamic authority/approval must be refreshed;
- whether a new attempt or new operation is required.

No `retry all 5xx` rule is permitted for mutations.

## 11. Retry matrix

| Failure class | Read | Mutation before dispatch | Mutation possible | Automatic retry |
|---|---:|---:|---:|---|
| request schema invalid | no | no | no | no |
| context/authority blocked | no | no | no | after explicit repair/revalidation |
| lock busy | yes | yes | no | bounded reschedule |
| provider 429 before mutation | yes | yes | no if proven | bounded backoff |
| timeout before adapter invocation | yes | yes | no | bounded retry |
| connection reset after send | yes | no | yes | reads: policy; mutations: reconcile first |
| provider confirmed failure | policy | policy | classified | only declared codes |
| provider success/readback missing | read again | n/a | yes | reconcile/readback, not mutate |
| ledger commit unknown | read ledger | read ledger | possibly | ledger readback first |
| projection delivery failed | projection only | projection only | provider already classified | retry projection only |

## 12. Backoff and rate limiting

Backoff must be bounded and cancellation-aware.

Recommended logical policy:

- honor provider `Retry-After` within platform maximum;
- exponential backoff with jitter for transient confirmed non-mutation failures;
- no busy loop;
- per-provider and per-tenant concurrency/rate budgets;
- stop when operation deadline, approval expiry, capsule expiry, or retry budget is reached;
- refresh dynamic evidence before a delayed mutation retry.

## 13. Process crash recovery

On worker restart or lease expiry:

1. Find claimed/running attempts with expired leases.
2. Fence prior worker token.
3. Inspect whether provider dispatch was impossible, not started, started, or unknown.
4. If no dispatch occurred, reschedule under same attempt/retry policy.
5. If dispatch may have occurred, move to reconciliation.
6. If confirmed provider success exists, complete readback/finalization.
7. If external wait exists, restore polling/subscription state.
8. Do not create a second operation solely because the process restarted.

## 14. HTTP disconnect and client retry

A durable operation continues independently of the client connection.

Client behavior:

- retry acceptance call with same idempotency key;
- server returns existing operation/result or typed conflict;
- poll/read status by authorized operation reference;
- do not repeat provider-level tool calls manually.

For fast operations, if the client disconnects after possible mutation, the internal operation/receipt remains authoritative and subsequent idempotent request returns/reconciles existing state.

## 15. Cancellation

Cancellation is evaluated by current stage.

### Before dispatch

- release unused claim/lock/idempotency according to policy;
- mark future steps cancelled/skipped;
- terminally cancel if no committed effect exists.

### During read/preparation

- interrupt if handler supports cancellation;
- otherwise ignore late result using fencing/state version;
- cancel downstream steps.

### During possible mutation

- do not assume cancellation stopped provider action;
- wait for classification or reconcile;
- determine compensation requirement.

### During external wait

- cancel polling/subscription if safe;
- cancellation of observation does not cancel provider work unless provider contract explicitly supports it.

### After committed effect

- cancellation becomes compensation evaluation, not rollback assertion.

## 16. Compensation

Compensation is explicit, operation-specific governed work.

A compensation contract declares:

- triggering committed effects;
- compensation operation key;
- authority and approval requirements;
- exact target and version expectations;
- idempotency scope;
- dependency ordering;
- partial compensation behavior;
- readback and evidence requirements;
- cases where compensation is impossible or manual.

Compensation may fail or have unknown outcome and therefore uses the same receipt/reconciliation model.

## 17. Saga-style multi-step mutation

For a plan with multiple committed mutations:

- each mutation has its own receipt/readback;
- plan records committed-effect order;
- compensation order is explicitly declared, usually reverse dependency order;
- one failed later step does not erase earlier success;
- operation state reflects partial completion and compensation requirement;
- user-facing result lists confirmed effects, uncompensated effects, and next action.

## 18. Readback failure classes

- `readback_temporarily_unavailable`: bounded retry/read wait;
- `readback_auth_failed`: connection/authority repair, no mutation retry;
- `readback_target_not_found`: may indicate confirmed absence or delayed consistency; contract decides;
- `readback_mismatch`: reconciliation or failure;
- `readback_schema_drift`: stop and diagnose;
- `readback_cross_target`: security failure and hard block;
- `readback_integrity_failure`: result invalid, hard block/reconciliation.

## 19. Eventual consistency

Some providers do not expose immediate consistent readback.

The operation contract must declare:

- expected consistency model;
- maximum convergence window;
- polling cadence;
- acceptable intermediate states;
- final success predicate;
- timeout classification;
- whether operation remains running/waiting or enters reconciliation.

The platform cannot mark completed merely because a write request was accepted.

## 20. Projection failure and recovery

Projection failures are separate from provider failures.

Rules:

- retry only the failed destination delivery;
- preserve event ordering key;
- verify payload/result hash each attempt;
- dead-letter after bounded attempts/deadline;
- expose `projection_status` and repair action;
- allow manual or automated replay from authoritative outbox/result;
- never reconstruct result from an incomplete projection when authoritative state exists;
- never replay provider mutation to repair a projection.

## 21. Error evidence bounds

Persist/return:

- stable error code;
- stage;
- retryable flag;
- possible-mutation flag;
- operation/step/receipt references;
- bounded provider status/reason code;
- next action;
- trace ID.

Do not persist/return:

- raw credentials/tokens;
- request authorization headers;
- full provider bodies by default;
- SQL statements with sensitive values;
- unbounded logs or stack traces;
- cross-tenant identifiers not already authorized.

## 22. Canonical next-action mapping

| State/error | Primary next action |
|---|---|
| interpretation required | provide interpretation |
| approval missing | provide approval |
| approval/context expired | refresh/re-resolve |
| lock busy | wait |
| confirmed transient pre-dispatch failure | retry safe step |
| unknown outcome | reconcile |
| readback temporarily unavailable | wait/resume readback |
| projection failed | repair projection |
| compensation required | run/approve compensation |
| terminal confirmed failure | inspect failure/start new operation |
| completed compact result | retrieve full result if needed |

## 23. Fault-injection suite

Required deterministic injection points:

- before/after reservation transaction;
- before adapter invocation;
- after bytes/request sent;
- after provider acceptance before response persistence;
- during response parse;
- before/after readback;
- before/after final ledger transaction;
- after terminal commit before response;
- worker crash with active lease;
- stale fencing-token commit;
- approval revoked between preparation and mutation;
- branch/resource version drift at mutation frontier;
- provider 429/500/502/503/504;
- eventual-consistency delay;
- Drive/JSONL/search outage;
- outbox worker crash/duplicate delivery;
- compensation success/failure/unknown outcome.

For every injected failure, tests assert mutation count, receipt state, next action, retry prohibition/permission, tenant isolation, and final reconciliation.