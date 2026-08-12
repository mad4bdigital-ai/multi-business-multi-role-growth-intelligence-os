# DFR-006 — Deterministic Durable Workflow and Effect Commit Protocol

## Dev Orchestrator durable-effect overlay

The Dev Orchestrator design must treat observe/propose/delegate/act/authority modes as workflow states, not direct model privileges. Any future act or authority runtime must route through durable Workflow, Activity, Effect, approval, idempotency, reconciliation, compensation, and readback contracts. Model fallback is forbidden after visible output, tool calls, provider dispatch, external send, or any committed Effect unless the checkpoint proves remaining work only. Partial or unknown effects must enter governed recovery rather than silent retry.

## Status

**Approved design. Implementation is not authorized.**

The platform adopts a **fully registry-driven Deterministic Durable Workflow and Effect Commit Protocol**.

Long-running, asynchronous, multi-step, resumable, approval-gated, commercially reserved, model-driven, or externally effectful work is represented as a durable Workflow whose decisions are reconstructed from an immutable event history. Side effects execute only through separately registered Activities and Effect Contracts with stable identity, scoped idempotency, attempt history, deadlines, cancellation, verification, reconciliation, and compensation semantics.

The platform does not claim exactly-once physical execution across queues, databases, models, humans, or external providers. It provides:

```text
exactly-once logical Workflow decisions where deterministic replay is valid
+ at-least-once Activity delivery
+ exactly-once logical Effects where idempotency or reconciliation can prove them
+ explicit outcome_unknown/recovery_required otherwise
```

No runtime engine change, schema migration, queue mutation, provider/model call, credential read, commercial reservation, replay, compensation, external write, or production enforcement is authorized by this document.

## 1. Authoritative runtime sequence

```text
operation request
→ registered Workflow type/policy resolution
→ manifest, authority, data, model, commercial, and readiness validation
→ durable Workflow creation
→ deterministic Workflow decision
→ timer/signal/dependency handling
→ Activity scheduling
→ lease/fencing claim
→ Effect preparation and dispatch
→ acknowledgement/verification or reconciliation
→ Workflow history append
→ next deterministic decision
→ completion, compensation, or governed recovery
```

A Worker executes a registered Activity handler. It does not decide ad hoc whether to retry, compensate, fallback, complete, or ignore uncertainty. Those decisions resolve from the Workflow history and registered policies.

## 2. Database-driven dynamic authorities

The design is database-authoritative through typed, versioned registries and scoped policy records.

Initial registries include:

```text
runtime_workflow_type_registry
runtime_workflow_definition_versions
runtime_workflow_state_registry
runtime_workflow_event_type_registry
runtime_workflow_transition_registry
runtime_workflow_signal_type_registry
runtime_workflow_timer_type_registry
runtime_activity_type_registry
runtime_activity_handler_registry
runtime_activity_policy_versions
runtime_effect_type_registry
runtime_effect_contract_versions
runtime_effect_commit_state_registry
runtime_effect_verification_policy_registry
runtime_effect_reconciliation_policy_registry
runtime_retry_class_registry
runtime_retry_policy_versions
runtime_error_class_registry
runtime_cancellation_policy_registry
runtime_compensation_policy_registry
runtime_checkpoint_policy_registry
runtime_replay_policy_registry
runtime_recovery_reason_registry
runtime_queue_service_class_registry
runtime_concurrency_policy_registry
runtime_fairness_policy_registry
runtime_dead_letter_reason_registry
runtime_operation_reason_code_registry
runtime_governance_epoch_sources
```

Each row is typed, versioned, effective-dated, status controlled, schema bounded, checksum protected, and compatible only with explicitly registered handler semantics.

Database rows may select allowlisted Workflow/Activity/Effect handler keys and bounded policy parameters. They cannot execute arbitrary SQL, JavaScript, shell, URLs, headers, model code, provider code, or credential values.

New semantic behavior requires a reviewed allowlisted handler capability. Data-defined configuration cannot invent executable behavior unsupported by the runtime engine.

## 3. Workflow, Activity, and Effect separation

### 3.1 Workflow

A Workflow contains deterministic decision logic over immutable history. It may:

- inspect prior registered events and current bounded versioned evidence;
- schedule Activities;
- set durable timers;
- wait for registered signals, approvals, dependencies, or reconciliation;
- select registered retry, cancellation, compensation, replay, and recovery transitions;
- emit a new immutable decision event.

A Workflow must not call providers, read credentials, mutate external state, generate random unrecorded values, read wall-clock time without a recorded event, or depend on mutable unversioned configuration during replay.

### 3.2 Activity

An Activity is an execution unit handled by one allowlisted Activity handler. It may perform bounded computation, provider/model/tool calls, internal mutations, verification, reconciliation, or compensation according to its registered type and Effect Contract.

Activities may execute at least once. Every attempt is separately recorded.

### 3.3 Effect

An Effect is a potentially committed internal, external, human-visible, commercial, or irreversible result of an Activity.

Effect identity is stable across retries and includes:

```text
effect_id
workflow_id
activity_id
effect_type_key/version
target resource/provider
logical effect key
expected effect checksum
provider idempotency key where supported
```

The Effect Ledger, not an HTTP response alone, determines whether an effect is unstarted, uncertain, committed, verified, compensated, or requires recovery.

## 4. Workflow and operation identity

Every durable execution records:

```text
workflow_id
root_workflow_id
parent_workflow_id
operation_id
tenant_id
principal_id
context target
workflow_type_key/version
manifest_id/version
idempotency scope/key
request checksum
priority and service class
absolute deadline
cancellation policy
retry policy
compensation policy
concurrency key
commercial reservation refs
model/data/commercial/runtime governance epochs
```

Child Workflows inherit or tighten authority, data, model, commercial, deadline, cancellation, and risk boundaries. They cannot broaden scope or extend the parent deadline without an explicit separately authorized parent decision.

## 5. Deterministic history and replay

The Workflow history is append-only and contains ordered immutable events such as:

```text
WorkflowRequested
WorkflowValidated
WorkflowAdmitted
TimerScheduled
SignalReceived
ActivityScheduled
ActivityClaimed
EffectDispatchStarted
ProviderReferenceObserved
EffectVerified
ActivityCompleted
CancellationRequested
CompensationScheduled
RecoveryRequired
WorkflowCompleted
```

Each event records sequence, schema version, source, payload checksum, contributing policy/version vector, timestamp evidence, and causation/correlation identifiers.

Workflow replay recomputes decisions from history using the exact Workflow definition version and compatible registered semantics. Replay must produce the same logical commands. A nondeterminism mismatch blocks with recovery evidence rather than silently accepting a different state.

Snapshots are rebuildable accelerators, not the source of truth. History remains authoritative.

## 6. Workflow state and outcome model

Lifecycle, outcome, effect, and verification are separate dimensions.

Representative lifecycle states:

```text
requested
validated
admitted
reserved
running
waiting_timer
waiting_signal
waiting_dependency
awaiting_approval
backpressured
cancel_requested
reconciling
compensating
recovery_required
completed
```

Representative outcome classes:

```text
success
success_with_warnings
partial_success
failure_no_effect
failure_with_effects
cancelled_no_effect
cancelled_with_effects
compensated
compensation_failed
indeterminate
expired
```

Representative effect states:

```text
not_started
prepared
dispatching
accepted
committed
verified
confirmed_no_effect
outcome_unknown
compensating
compensated
compensation_failed
```

A single generic `failed` or `cancelled` status is insufficient when effects may have occurred.

## 7. Activity attempts, leases, and fencing

Every Activity attempt records:

```text
attempt_id
activity_id
attempt_number
queue/service class
lease owner
lease issued/expires/heartbeat times
monotonic fencing token
attempt deadline
retry classification
start/dispatch/ack/verify timestamps
result/error checksum
```

Workers claim Activities with bounded leases. Every state-changing commit includes the current monotonic fencing token. A Worker with a stale token cannot commit after lease loss or reassignment.

This prevents a delayed Worker from overwriting the result of a newer owner.

Heartbeat extends only an active valid lease and cannot extend the Workflow deadline, commercial reservation, authority, or governance epoch.

## 8. Scoped idempotency

Idempotency identity resolves from:

```text
tenant/account scope
+ workflow/activity/effect type
+ target resource
+ caller idempotency key or deterministic derived key
```

The authority stores:

```text
idempotency key
request checksum
first workflow/activity/effect IDs
current/final outcome
committed effect references
retention/expiry policy
```

Rules:

- same key and same checksum return the original logical operation and outcome;
- same key with a different checksum blocks with `WORKFLOW_IDEMPOTENCY_CONFLICT`;
- Step/Activity/Effect keys are deterministically derived from root Workflow, step key, and logical effect key;
- provider idempotency keys remain stable across attempts;
- idempotency evidence is retained through the maximum replay, dispute, retention, and provider uncertainty window;
- a new replay creates a new Workflow identity linked to the prior Workflow rather than mutating history.

## 9. Effect classification and commit protocol

Registered Effect classes include:

```text
read_only
internal_transactional
external_idempotent
external_reconcilable
external_non_idempotent
human_visible
commercial
irreversible
```

Each Effect Contract defines:

```text
preconditions
preparation step
provider/internal dispatch semantics
idempotency support
commit boundary
provider reference format
verification rule
reconciliation rule
safe retry class
cancellation behavior
compensation handler
retention and evidence requirements
```

Representative commit states:

```text
before_dispatch
request_transmission_started
provider_accepted
provider_reference_received
internally_committed
readback_verified
human_confirmed
```

A successful transport response does not alone prove business success. The Effect Contract defines required verification.

## 10. Retry classification

Retry is selected from a registered class, not inferred only from HTTP status.

```text
never_retry
safe_immediate_retry
safe_backoff_retry
retry_after_dependency
retry_after_approval
reconcile_before_retry
manual_recovery_only
```

Automatic retry is forbidden for permanent validation, authorization, policy, region, data, model, commercial, idempotency-conflict, or unsupported-operation failures.

Automatic retry is generally safe only when no effect was dispatched or when the Effect Contract proves idempotent repeatability.

Timeout, connection reset, or 5xx after transmission starts may mean the effect occurred. Such cases move to reconciliation before any retry unless the provider contract proves otherwise.

Registered retry policies define maximum attempts, maximum elapsed time, full-jitter backoff, `Retry-After`, absolute deadline, retry budget, circuit-breaker interaction, reservation limits, and recovery action.

No retry may exceed the Workflow deadline, authority validity, cost reservation, quota, or governance epochs.

## 11. Durable timers, signals, approvals, and dependencies

Timers are durable history-backed resources, not process-local `setTimeout` calls.

Examples:

```text
retry timer
approval expiry
reservation expiry
reconciliation delay
scheduled execution
provider polling interval
retention/recovery review
```

Signals are typed, versioned, scoped, idempotent inputs such as cancellation requests, approvals, human responses, provider callbacks, or dependency completion.

Duplicate signals do not create duplicate logical transitions. Unknown or stale signal versions block or enter recovery according to policy.

Dependencies are explicit Workflow/Activity relationships with registered success, failure, optional, quorum, and timeout semantics.

## 12. Deadlines and cancellation

Each Workflow and Activity uses absolute timestamps and bounded durations:

```text
requested_at
start_not_before
deadline_at
retry_until
approval_deadline_at
reservation_expires_at
lease_expires_at
```

A local attempt timeout is not the Workflow deadline.

Child deadlines cannot exceed parent deadlines. A new attempt is not started unless sufficient time remains for dispatch and required verification/reconciliation.

Cancellation is a durable signal and cooperative policy, not an assumption of rollback.

Registered cancellation classes include:

```text
cancel_before_dispatch
cooperative_safe_boundary
cancel_and_compensate
non_cancellable_after_commit
manual_cancellation_only
```

Cancellation blocks new dispatch, propagates to children, requests adapter abort where supported, releases unused reservations, and schedules compensation where required. Committed or irreversible effects remain explicitly visible.

## 13. Transactional Outbox and Inbox

Workflow state/event changes and Outbox insertion occur in the same local transaction:

```text
append Workflow event
update projection/pointer
insert Outbox record
commit
```

Outbox delivery is at least once. Every event has stable identity, schema version, payload checksum, availability, attempt, lease/fencing, and delivery state.

Consumers use an Inbox keyed by consumer + event ID. Applying the internal effect and marking Inbox completion occur in one transaction where possible.

Duplicate delivery returns the original logical result. Payload checksum mismatch blocks as conflict.

Transport dead letters remain distinct from business Workflow recovery.

## 14. Concurrency, backpressure, and fairness

Registered concurrency policies may bind:

```text
Tenant
billing account
resource
provider/endpoint
workflow/activity/effect type
service class
concurrency key
```

Service classes may include:

```text
interactive
standard
batch
recovery
system_critical
```

Fairness policies define bounded weights, priority aging, per-Tenant/resource/provider limits, reserved recovery capacity, queue-age behavior, admission control, and backpressure.

Priority cannot bypass authority, policy, approval, model/data governance, commercial reservation, or safety controls.

Backpressure is an explicit state with retry/admission evidence, not silent work loss.

## 15. Compensation and Sagas

Multi-effect business work is represented by a versioned Saga definition or Workflow graph.

Each step declares:

```text
forward Activity
Effect Contract
idempotency key derivation
verification rule
commit boundary
dependencies/criticality
retry class
compensation Activity
compensation deadline
safe cancellation boundary
```

On failure, the Workflow identifies committed effects and schedules only applicable compensation Activities in registered dependency-safe order.

Compensation is a new idempotent, verified Effect. It is not a distributed database rollback and does not erase the original history.

Compensation failure moves the Workflow to `recovery_required` with explicit unresolved effects.

## 16. Partial success and recovery

Partial success records:

```text
required steps succeeded
optional steps succeeded
failed steps
committed effects
verified effects
compensated effects
uncompensated effects
outcome-unknown effects
manual actions required
```

Business Workflows do not use `dead_lettered` as the primary terminal state. They enter `recovery_required` with registered reasons such as:

```text
retry_exhausted
outcome_unknown
compensation_failed
schema_incompatible
authority_changed
manifest_stale
manual_decision_required
```

Dead letters remain for transport artifacts such as Outbox/Inbox messages, queue tasks, callbacks, or notifications.

Recovery cases record owner, severity, evidence, effect state, reconciliation results, prior attempts, recommended allowed actions, review time, expiry, and checksum without secrets.

## 17. Reconciliation

Reconciliation is mandatory before retry when an external effect may have occurred but acknowledgement is uncertain.

A Reconciliation Activity may use stable effect ID, provider idempotency key, provider reference, target resource lookup, readback checksum, delivery receipt, or human confirmation.

Outcomes include:

```text
confirmed_effect
confirmed_no_effect
still_unknown
conflicting_evidence
manual_review_required
```

Only `confirmed_no_effect` or a contract-proven idempotent effect may permit retry. `confirmed_effect` proceeds to verification/completion. Unknown or conflicting evidence remains recovery-bound.

## 18. Replay, resume, and checkpoints

Replay does not mutate the original Workflow. It creates a new Workflow linked through `replay_of_workflow_id` and records reason, source checkpoint, new idempotency identity, current manifest, and current policy/governance evidence.

A checkpoint contains only verified durable state and references to committed effects. It does not contain credentials, hidden prompts beyond authorized scope, unverified mutable process memory, or uncommitted outputs.

Resume/replay requires preview, current authority, valid manifest, known prior effects, compatible policies, valid commercial reservation, and safe remaining Activities.

## 19. Model fallback after partial output or tool effects

Before any output or Effect is committed, an eligible DFR-005 fallback candidate may be used after revalidation and new candidate-specific estimate/reservation.

Generated output not exposed or otherwise committed may be discarded according to policy.

Once streaming content becomes user-visible, it is a committed `user_visible_output` Effect. Runtime cannot silently switch models and continue as one uninterrupted response. It must finish partially, create a new Restart Workflow, or publish an explicit superseding/correction artifact.

Once a Tool or external Effect is committed, fallback receives only a verified authorized checkpoint and remaining work. It cannot repeat the committed Tool call or receive credentials/hidden context outside its manifest.

DFR-005 determines candidate eligibility. DFR-006 determines safe restart/resume/effect boundaries.

## 20. Proposed runtime authorities

```text
runtime_workflows
runtime_workflow_events
runtime_workflow_snapshots
runtime_workflow_timers
runtime_workflow_signals
runtime_workflow_dependencies
runtime_activities
runtime_activity_attempts
runtime_activity_leases
runtime_activity_results
runtime_effects
runtime_effect_dispatches
runtime_effect_verification_runs
runtime_effect_reconciliation_runs
runtime_effect_compensation_runs
runtime_checkpoints
runtime_outbox
runtime_inbox
runtime_transport_dead_letters
runtime_recovery_cases
runtime_manual_interventions
runtime_replay_runs
runtime_task_queues
runtime_queue_assignments
runtime_rate_limit_buckets
runtime_concurrency_leases
runtime_governance_epochs
```

Existing `jobs`, job repository/queue, `execution_plans`, `execution_plan_steps`, `execution_plan_events`, workflow/step runs, approval holds, surface-specific Outboxes, execution logs, and adapter retry policies remain compatibility inputs until certified migration.

## 21. API direction

Tenant/resource surfaces:

```text
POST /tenant/runtime-workflows
GET  /tenant/runtime-workflows/{workflowId}
GET  /tenant/runtime-workflows/{workflowId}/history
GET  /tenant/runtime-workflows/{workflowId}/activities
GET  /tenant/runtime-workflows/{workflowId}/effects
GET  /tenant/runtime-workflows/{workflowId}/checkpoints
POST /tenant/runtime-workflows/{workflowId}/signals
POST /tenant/runtime-workflows/{workflowId}/cancel
POST /tenant/runtime-workflows/{workflowId}/resume-preview
POST /tenant/runtime-workflows/{workflowId}/resume
POST /tenant/runtime-workflows/{workflowId}/replay-preview
POST /tenant/runtime-workflows/{workflowId}/replays
```

Admin/recovery surfaces:

```text
GET  /admin/runtime-recovery-cases
GET  /admin/runtime-recovery-cases/{caseId}
POST /admin/runtime-recovery-cases/{caseId}/action-preview
POST /admin/runtime-recovery-cases/{caseId}/reconcile
POST /admin/runtime-recovery-cases/{caseId}/replay
POST /admin/runtime-recovery-cases/{caseId}/resolve
GET  /admin/runtime-transport-dead-letters
POST /admin/runtime-transport-dead-letters/{deadLetterId}/redrive-preview
POST /admin/runtime-transport-dead-letters/{deadLetterId}/redrive
GET  /admin/runtime-workflows/{workflowId}/determinism
GET  /admin/runtime-queues/health
```

Retry is not an unrestricted client mutation. The Workflow engine schedules retries from registered policy. Client resume/replay/recovery requests require preview, exact authority, idempotency, approvals where needed, audit, and readback.

Preview performs no Activity execution, provider/model/tool call, credential read, queue publish, commercial reservation, compensation, replay, or external write.

## 22. Stable blocking conditions

```text
WORKFLOW_TYPE_NOT_REGISTERED
WORKFLOW_DEFINITION_VERSION_MISSING
WORKFLOW_NONDETERMINISTIC_REPLAY
WORKFLOW_IDEMPOTENCY_KEY_REQUIRED
WORKFLOW_IDEMPOTENCY_CONFLICT
WORKFLOW_ALREADY_TERMINAL
WORKFLOW_DEADLINE_EXCEEDED
WORKFLOW_MANIFEST_STALE
WORKFLOW_GOVERNANCE_EPOCH_CHANGED
ACTIVITY_TYPE_NOT_REGISTERED
ACTIVITY_HANDLER_NOT_ALLOWED
ACTIVITY_LEASE_LOST
ACTIVITY_FENCING_TOKEN_STALE
ACTIVITY_RETRY_NOT_ALLOWED
ACTIVITY_RETRY_BUDGET_EXHAUSTED
ACTIVITY_DEADLINE_INSUFFICIENT
EFFECT_CONTRACT_MISSING
EFFECT_IDEMPOTENCY_CONFLICT
EFFECT_OUTCOME_UNKNOWN
EFFECT_RECONCILIATION_REQUIRED
EFFECT_VERIFICATION_FAILED
EFFECT_COMPENSATION_REQUIRED
EFFECT_COMPENSATION_FAILED
CANCELLATION_NOT_ALLOWED
CANCELLATION_TOO_LATE
CHECKPOINT_STALE
RESUME_NOT_ALLOWED
REPLAY_NOT_ALLOWED
RECOVERY_REQUIRED
OUTBOX_DELIVERY_FAILED
INBOX_EVENT_CONFLICT
TRANSPORT_DEAD_LETTERED
CONCURRENCY_LIMIT_REACHED
QUEUE_BACKPRESSURED
COMMERCIAL_RESERVATION_REQUIRED
MODEL_FALLBACK_UNSAFE_AFTER_EFFECT
```

## 23. Hard invariants

- Workflow decisions are reconstructed from immutable history and versioned deterministic semantics.
- All executable handlers/adapters are allowlisted code; database configuration cannot introduce arbitrary execution.
- Activities may execute at least once; logical effects require stable identity and idempotency or reconciliation.
- Unknown external outcomes are reconciled before retry.
- Lifecycle, outcome, effect, and verification states remain separately explainable.
- Every state-changing Activity commit uses a valid lease and current fencing token.
- Durable timers/signals/dependencies survive Worker or deployment restart.
- Child Workflows cannot broaden authority, scope, deadline, cost, or governance bounds.
- Cancellation is cooperative and cannot erase committed effects.
- Compensation is a new verified effect and never rewrites history.
- Business recovery is distinct from transport dead letters.
- Replay creates a new linked Workflow and never mutates the original.
- Model fallback cannot repeat committed output, Tool calls, or external effects.
- Retry, cancellation, compensation, reconciliation, replay, concurrency, fairness, and recovery semantics resolve from versioned registries.
- Missing, stale, conflicting, unsupported, or ambiguous mandatory runtime evidence fails closed.

## 24. Acceptance examples

- Same idempotency key and checksum returns the original Workflow; a changed payload returns conflict.
- A Worker loses its lease and later attempts to commit with an older fencing token; the commit is rejected.
- Provider timeout occurs before request transmission; policy permits bounded retry.
- Provider timeout occurs after transmission started; Workflow schedules reconciliation rather than blind retry.
- Reconciliation confirms the effect exists; Workflow verifies and completes without repeating it.
- Reconciliation confirms no effect; a registered retry policy may schedule a new attempt.
- Cancellation before dispatch completes with no effect and releases unused reservations.
- Cancellation after a user-visible message records `cancelled_with_effects` or schedules compensation where possible.
- A multi-step Saga fails after two committed effects; only registered reversible effects are compensated in dependency-safe order.
- Compensation failure creates a recovery case with unresolved effects and owner.
- Duplicate Outbox delivery is deduplicated by Inbox and does not repeat the consumer effect.
- A business Workflow with retry exhaustion enters `recovery_required`; only its transport message may be dead-lettered.
- Workflow replay after policy change requires a new manifest and does not alter historical events.
- Model A times out before output; eligible Model B is used only after new estimate/reservation.
- Model A streamed visible output; Model B cannot silently continue the same response.
- A committed Tool call appears in the checkpoint; fallback receives remaining work and does not repeat the Tool call.
- Registry attempts to bind an arbitrary executable handler or provider URL; validation blocks without publication.
- Preview returns history-derived state, effects, recovery options, and policy evidence without executing work.

## 25. Migration and cutover

Migration is additive and family-based:

```text
inventory jobs/plans/runs/outboxes/retry behavior
→ classify Workflow, Activity, and Effect types
→ register deterministic definitions and policies
→ project existing execution evidence into read-only durable views
→ shadow Workflow decisions and effect classifications
→ enable Outbox/Inbox and fencing for selected low-risk families
→ certify reconciliation/compensation/recovery
→ canary by operation/effect family
→ cut over with compatibility fallback and rollback
```

Current queues, job runner, sequential plans, workflow/step runs, approval holds, and surface Outboxes remain active until family-specific parity, determinism replay, idempotency, uncertainty, cancellation, compensation, recovery, observability, and rollback tests pass.

Zero-tolerance cutover failures include duplicate irreversible effect, stale-lease commit, silent outcome uncertainty, unregistered handler execution, lost committed history, fallback repeating a committed effect, cross-Tenant replay, missing commercial reservation, or unreconstructable Workflow decision.

## 26. Final decision

> **DFR-006 — Fully Dynamic Deterministic Durable Workflow and Effect Commit Protocol.** The platform represents long-running and effectful work as deterministic durable Workflows reconstructed from append-only history. Versioned database registries define Workflow, Activity, Effect, retry, timer, signal, cancellation, compensation, reconciliation, replay, concurrency, fairness, and recovery semantics, while executable handlers and provider adapters remain allowlisted code. Activities execute at least once under leased fenced ownership; logical Effects use stable idempotency and verification or enter reconciliation before retry. Sagas compensate committed reversible effects, business uncertainty enters governed recovery rather than transport dead letter, and model fallback cannot repeat committed output or Tool effects. Missing, stale, conflicting, unsupported, or ambiguous mandatory evidence fails closed.
