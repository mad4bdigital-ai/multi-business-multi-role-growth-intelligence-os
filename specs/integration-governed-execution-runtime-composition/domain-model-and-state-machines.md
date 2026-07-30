# Governed Execution Domain Model and State Machines

## 1. Purpose

This document defines the canonical domain objects, identities, hashes, lifecycle states, legal transitions, and terminal semantics shared across Specs 011, 012, and 013.

The objective is to prevent different runtime paths from inventing incompatible meanings for operation, plan, step, approval, receipt, result, cancellation, or projection state.

## 2. Domain object catalogue

### 2.1 ResolvedOperationRequest

Owned by Spec 013.

Represents either:

- an exact stable operation key; or
- one bounded, unambiguous intent interpretation.

Required properties:

- request ID;
- principal-visible descriptor key and version;
- normalized operation input;
- declared constraints;
- requested completion mode;
- requested response mode;
- idempotency key reference or requirement;
- interpretation evidence if intent-based;
- no execution authority.

### 2.2 ExecutionCapsule

Owned by Spec 012.

Immutable reference to the selected execution set:

- principal and effective subject;
- tenant/workspace/brand;
- exact resource and connection;
- authority-path reference;
- capability readiness reference;
- context hash and revision vector;
- expiry and invalidation dependencies.

The capsule is context evidence, not standalone authority.

### 2.3 OperationDescriptor

Owned by Spec 013 catalog authority.

Defines:

- stable operation key;
- descriptor version and catalog snapshot;
- input/output schemas;
- operation kind;
- consequence and risk class;
- supported lanes;
- synchronous budget;
- durable support;
- idempotency and approval requirements;
- readback and result projection contracts;
- runtime handler identity;
- compatibility adapter identity.

### 2.4 GovernanceDecision

Owned by Spec 011.

Immutable compiled decision containing:

- decision ID and hash;
- allowed, denied, blocked, or approval-required disposition;
- principal and context bindings;
- policy/capability/authority revision references;
- risk and consequence classification;
- required approval/delegation mode;
- mutation and cost ceilings;
- required readback, audit, and evidence contracts;
- retry and reconciliation rules;
- expiry and dynamic-refresh requirements.

### 2.5 GovernedPlan

Owned by Spec 011.

Immutable plan revision containing:

- plan ID;
- plan revision;
- plan hash;
- operation ID;
- capsule reference and context hash;
- descriptor key/version;
- governance decision hash;
- step graph;
- lane policy;
- approval groups;
- result aggregation contract;
- cancellation and compensation policy;
- created and expiry times.

Changing plan content creates a new plan revision and invalidates approval, lane, idempotency, and execution decisions that bind the old plan hash.

### 2.6 PlanStep

Immutable step definition containing:

- step ID and stable step key;
- dependency step IDs;
- operation key/kind;
- exact input projection;
- output schema and success condition;
- consequence/risk class;
- resource lock key;
- idempotency policy;
- retry policy;
- approval group;
- timeout/external wait contract;
- readback and evidence contract;
- result aggregation key.

### 2.7 ExecutionOperation

Durable mutable lifecycle record for one accepted operation.

Contains:

- operation ID;
- current state and state version;
- current plan ID/revision;
- principal/context/descriptor/governance references;
- lane;
- blocker and canonical next action;
- cancellation and compensation state;
- authoritative result and projection references;
- timestamps and terminal classification.

### 2.8 StepAttempt

Durable lifecycle record for one attempt of one plan step.

Contains:

- operation, plan, step, and attempt IDs;
- claim token and fencing token;
- lease owner and expiry;
- input hash;
- idempotency reservation;
- provider dispatch classification;
- result/readback hashes;
- state and retry classification;
- failure code and bounded evidence.

### 2.9 ApprovalBundle

Plan-bound authority artifact containing:

- approval ID and version;
- plan and context hashes;
- exact operation and step set;
- exact resources and lock domains;
- expected versions/SHAs;
- risk, consequence, mutation, and cost ceilings;
- readback obligations;
- principal/approver/grant evidence;
- issued, expiry, revoke, and consume state;
- approval hash.

### 2.10 IdempotencyReservation

Durable reservation containing:

- scope type and scope key;
- hashed external idempotency key;
- operation/step/attempt binding;
- input and target hashes;
- reservation state;
- provider idempotency support;
- receipt and result references;
- conflict and replay classification.

### 2.11 ResourceLockLease

Durable lease containing:

- lock key;
- operation/step/attempt owner;
- fencing token;
- acquisition and expiry times;
- state;
- last heartbeat;
- release reason.

A lease grants scheduling exclusivity only. It does not prove provider mutation absence after lease expiry.

### 2.12 MutationReceipt

Authoritative mutation evidence containing:

- receipt ID;
- operation/step/attempt;
- provider and exact target;
- provider request identity/hash;
- dispatch start/end classification;
- external request or operation reference where safe;
- expected precondition;
- observed postcondition;
- provider outcome classification;
- same-cycle readback reference/hash;
- result hash;
- reconciliation state;
- no-secret flag.

### 2.13 ReadbackEvidence

Bounded evidence containing:

- readback ID;
- operation/step/receipt binding;
- expected state hash;
- observed state hash;
- comparison status;
- observed provider version/SHA;
- schema/deployment evidence where applicable;
- mismatch classification;
- collected time and source authority.

### 2.14 ExecutionResult

Authoritative canonical result containing:

- operation state and terminal classification;
- changed resource references;
- step outputs or references;
- mutation receipts;
- readbacks;
- blockers and next action;
- projection obligations;
- canonical result hash and serialization version.

### 2.15 ResultProjection

Transport-facing bounded projection containing:

- compact or full projection ID;
- operation and result hash;
- principal/tenant visibility scope;
- expiry and pagination/chunk metadata;
- redaction policy;
- integrity hash;
- storage reference, never a raw unrestricted URL.

### 2.16 ProjectionDelivery

Outbox delivery record containing:

- event ID;
- projection type and destination identity;
- ordering key;
- payload hash;
- state and attempt count;
- claim lease;
- next retry time;
- terminal/dead-letter reason;
- reconciliation state.

## 3. Identity and hash hierarchy

```text
request_id
  -> operation_id
       -> plan_id + plan_revision + plan_hash
            -> step_id
                 -> attempt_id
                      -> receipt_id
                      -> readback_id
       -> result_id + result_hash
       -> projection_id
```

Additional immutable hashes:

- context hash;
- descriptor snapshot/version hash;
- governance decision hash;
- approval hash;
- input hash;
- target hash;
- provider request hash;
- readback hash;
- payload/projection hash.

## 4. Canonical hashing rules

All authority-bearing hashes MUST use:

- a declared canonical serialization version;
- stable field ordering;
- normalized Unicode and identifier representation;
- explicit null handling;
- no volatile timestamps unless the timestamp is an authority field;
- no secret values;
- no raw provider payloads;
- sorted sets and deterministic array ordering where semantic order is not material;
- explicit schema/version domain separation.

Example domain-separated input:

```text
GEK:plan:v1\n{canonical-json}
GEK:context:v1\n{canonical-json}
GEK:approval:v1\n{canonical-json}
```

## 5. Operation lifecycle

### 5.1 Operation states

```text
received
resolving
interpretation_required
blocked
awaiting_approval
ready
running
waiting_external
reconciliation_required
compensation_required
cancelling
completed
failed
cancelled
compensated
```

### 5.2 Legal transitions

| From | To | Conditions |
|---|---|---|
| received | resolving | request accepted and authenticated |
| resolving | interpretation_required | multiple materially valid interpretations remain |
| resolving | blocked | context, descriptor, authority, capability, policy, or schema denies execution |
| resolving | awaiting_approval | plan compiled and exact approval is missing |
| resolving | ready | plan compiled, allowed, and no blocker remains |
| interpretation_required | resolving | caller supplies bounded clarification under same request lineage |
| awaiting_approval | ready | exact approval becomes valid and dynamic validation passes |
| awaiting_approval | blocked | approval denied, revoked, expired, or required binding drifts |
| ready | running | fast executor or durable scheduler acquires execution claim |
| running | waiting_external | declared external wait or polling condition begins |
| waiting_external | running | external condition is satisfied and claim resumes |
| running | awaiting_approval | a later declared approval frontier is reached |
| running | reconciliation_required | provider outcome cannot be confirmed |
| running | compensation_required | failure occurs after a compensatable committed effect |
| running | completed | all required steps and readbacks succeed and result is committed |
| running | failed | non-repairable failure with no unresolved mutation outcome |
| any non-terminal | cancelling | valid cancellation request accepted |
| cancelling | cancelled | no compensation required and all execution claims are closed |
| cancelling | compensation_required | committed effect requires declared compensation |
| compensation_required | compensated | compensation and readback succeed |
| compensation_required | failed | compensation definitively fails and no safe automatic action remains |
| reconciliation_required | running | reconciliation proves safe continuation or idempotent retry |
| reconciliation_required | completed | reconciliation confirms successful outcome and required readback |
| reconciliation_required | failed | reconciliation confirms failure/absence and no retry is allowed |

### 5.3 Terminal states

Terminal:

- completed;
- failed;
- cancelled;
- compensated.

A terminal operation cannot return to execution. A new request creates a new operation and may reference the prior operation for retry, repair, or continuation lineage.

### 5.4 Operation invariants

- `completed` requires all mandatory readbacks and an authoritative result hash.
- `failed` cannot conceal an unknown provider outcome.
- `cancelled` cannot imply compensation occurred.
- `compensated` requires compensation readback.
- one operation has one active plan revision at a time.
- plan revision changes invalidate prior approval and lane decisions.
- provider mutation count is never inferred from operation state alone; receipts and reconciliation are authoritative.

## 6. Step lifecycle

### 6.1 Step states

```text
pending
ready
blocked
claimed
running
waiting_external
awaiting_approval
reconciliation_required
retry_scheduled
succeeded
failed
cancelled
skipped
compensation_required
compensated
```

### 6.2 Legal transitions

| From | To | Conditions |
|---|---|---|
| pending | ready | all dependencies satisfied |
| pending | blocked | dependency failed or policy/context invalidated |
| ready | claimed | atomic claim and resource lock succeeds |
| claimed | running | worker starts under valid lease/fencing token |
| running | waiting_external | declared external wait |
| waiting_external | running | wait condition met |
| running | awaiting_approval | step-specific declared frontier reached |
| running | reconciliation_required | outcome unknown after possible dispatch |
| running | retry_scheduled | confirmed retryable failure and retry budget remains |
| retry_scheduled | ready | backoff elapsed and dynamic validation passes |
| running | succeeded | success contract and required readback pass |
| running | failed | confirmed non-retryable failure |
| any non-terminal | cancelled | cancellation valid and no unresolved outcome |
| pending/ready | skipped | conditional branch not selected by deterministic plan rule |
| running | compensation_required | partial committed effect requires compensation |
| compensation_required | compensated | compensation readback passes |

### 6.3 Step invariants

- one active claim per step revision;
- each attempt has a unique claim and fencing token;
- a late worker with an expired fencing token cannot commit terminal output;
- `succeeded` requires the declared success and readback contracts;
- retry after unknown outcome is forbidden until reconciliation permits it;
- skipped steps cannot supply outputs unless the plan defines an explicit default;
- dependency satisfaction is based on declared terminal outcomes, not only process completion.

## 7. Approval lifecycle

### 7.1 Approval states

```text
draft
pending
approved
partially_consumed
consumed
rejected
revoked
expired
invalidated
```

### 7.2 Rules

- draft approval has no authority;
- pending approval may be presented to an authorized approver;
- approved authority is limited to exact bound fields;
- partially consumed records exact steps already used;
- consumed cannot be reused;
- rejected, revoked, expired, or invalidated approvals cannot authorize dispatch;
- plan/context/risk/resource/provider/SHA/readback drift invalidates approval before mutation;
- renewal cannot widen scope;
- a plan may define separate approval groups for different consequence classes;
- high-risk exclusions remain controlled by existing Spec 011 policy.

## 8. Idempotency lifecycle

States:

```text
reserved
dispatching
confirmed_success
confirmed_failure
unknown_outcome
released
conflict
```

Rules:

- reservation occurs before unsafe dispatch;
- same key with different input/target hash is a conflict;
- same key with confirmed success returns/references prior result;
- unknown outcome blocks blind replay;
- release is allowed only when no dispatch occurred or absence is proven;
- provider-native idempotency does not replace internal reservation and receipt evidence.

## 9. Resource lock lifecycle

States:

```text
requested
held
renewing
released
expired
fenced
```

Rules:

- lock acquisition is atomic;
- each acquisition increments or obtains a unique fencing token;
- heartbeat may extend a valid lease within policy limits;
- expired lock owner is fenced from commit;
- expiration does not prove provider mutation absence;
- reconciliation state may retain a logical mutation guard after the scheduling lease expires.

## 10. Receipt lifecycle

States:

```text
reserved
pending_dispatch
dispatched
confirmed_success
confirmed_failure
unknown_outcome
reconciliation_required
reconciled_success
reconciled_failure
```

A receipt is append-only in evidence terms; lifecycle updates add classification and references rather than erasing prior dispatch evidence.

## 11. Readback lifecycle

States:

```text
required
collecting
matched
mismatched
unavailable
reconciliation_required
```

`unavailable` after mutation does not produce `completed`. It results in waiting, failure, or reconciliation according to the operation contract.

## 12. Projection lifecycle

States:

```text
pending
claimed
processing
completed
retry_scheduled
failed
dead_letter
reconciling
reconciled
superseded
```

Rules:

- provider/operation success is independent of normal projection completion;
- strong projection mode may keep operation response pending until declared projection obligations complete;
- ordering key prevents out-of-order session or resource projections;
- duplicate delivery is safe through event/destination idempotency;
- superseded projections preserve history and point to replacement evidence;
- dead-letter state is visible and actionable.

## 13. Cancellation and compensation semantics

Cancellation is a request to stop future work. It cannot undo completed provider effects.

Cancellation evaluation:

1. stop claiming new steps;
2. signal cancellable active reads/preparations;
3. allow unsafe in-flight mutation to reach a classifiable outcome;
4. reconcile unknown outcomes;
5. determine whether compensation is required;
6. execute compensation only when explicitly declared and authorized;
7. perform compensation readback;
8. terminally classify operation.

Compensation is a new governed mutation inside the same operation lineage or a declared child compensation operation when isolation is required. It requires its own authority, idempotency, receipt, and readback contracts.

## 14. Canonical next actions

Allowed next-action classes include:

```text
none
provide_interpretation
provide_approval
renew_authority
refresh_context
repair_connection
wait
resume
reconcile
retry_safe_step
run_compensation
inspect_failure
retrieve_full_result
repair_projection
start_new_operation
```

Only one canonical next action is returned as primary. Additional diagnostic alternatives may be included as non-authoritative suggestions.

## 15. State versioning and optimistic concurrency

Every mutable lifecycle record MUST include a state version.

Updates require:

- exact operation/step identity;
- expected current state/version;
- allowed transition;
- current claim/fencing token where applicable;
- tenant/resource scope;
- transition event in the same transaction.

A stale update returns a typed conflict and must re-read authoritative state.

## 16. Event model

Every transition emits a bounded event with:

- event ID;
- operation/plan/step/attempt IDs;
- previous and next state;
- transition reason code;
- actor/principal class;
- policy/approval references;
- receipt/readback references;
- occurred time;
- trace ID;
- no-secret marker.

Events are append-only or lifecycle-governed and support reconstruction, audit, diagnostics, and benchmark correlation.

## 17. Cross-object invariants

1. Plan context hash equals the capsule context hash.
2. Approval plan/context hashes equal the active plan/capsule hashes.
3. Step target remains inside capsule target set.
4. Receipt target equals the step target.
5. Readback binds the same receipt/target.
6. Result hash covers the terminal receipts and readbacks required by the plan.
7. Projection payload hash covers the authoritative result projection version.
8. A compatibility call and exact-operation call use the same descriptor and execution semantics for certified adapters.
9. No object contains raw credentials, JWTs, or unrestricted provider payloads.
10. Terminal operation state and terminal result classification cannot disagree.

## 18. Required model-based tests

- all illegal operation transitions rejected;
- all illegal step transitions rejected;
- terminal states cannot re-enter execution;
- approval invalidation on every bound-field drift;
- fencing token blocks late worker commit;
- unknown outcome blocks retry;
- duplicate idempotency key with changed input conflicts;
- cancellation during read, preparation, pre-dispatch, in-flight mutation, post-dispatch readback, and projection;
- compensation success/failure/unknown outcome;
- projection retry, ordering, dead-letter, and reconciliation;
- optimistic concurrency conflicts;
- canonical next action for every non-terminal state;
- no-secret serialization for every domain object.