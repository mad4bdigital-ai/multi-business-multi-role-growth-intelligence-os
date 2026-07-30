# Rollout, Migration, Compatibility, and Rollback Strategy

## 1. Purpose

This document defines how the composed runtime is introduced without a big-bang cutover, feature loss, authority weakening, split-brain state, or irreversible dependency on new persistence.

The rollout sequence is instrumentation, shadow composition, read-only convergence, graph preparation, approval consolidation, ledger/projection separation, low-risk mutation, durable workflow, public execution surface, percentage rollout, and measured legacy retirement.

## 2. Rollout principles

- additive before substitutive;
- default-off feature flags;
- no provider dispatch from shadow mode;
- shared authoritative identities before traffic cutover;
- reads before mutations;
- one reversible low-risk mutation before broad mutation classes;
- exact per-operation/risk/tenant cohorts;
- rollback tested before expansion;
- no removal of legacy surfaces until usage reaches a declared threshold and parity is proven;
- persistence migrations remain backward compatible until rollback window closes;
- production state is read back after every migration/deployment/cutover operation.

## 3. Dependency order

```text
Spec contracts and CI guards
 -> X0 telemetry baseline
 -> Spec 012 capsule contract/shadow
 -> Spec 013 descriptor execution metadata
 -> Spec 011 governed execution input shadow
 -> unified read dispatcher
 -> graph scheduler read/preparation pilot
 -> approval frontier
 -> ledger/outbox projection shadow
 -> fast-lane mutation pilot
 -> durable-lane pilot
 -> public executeOperation/executeIntent pilot
 -> percentage rollout
 -> duplicate code and legacy retirement
```

A later stage cannot be enabled when an earlier gate is incomplete.

## 4. Feature-flag model

Logical flags:

```text
GEK_INSTRUMENTATION_ENABLED
GEK_SHADOW_COMPOSITION_ENABLED
GEK_CAPSULE_SHADOW_ENABLED
GEK_IN_PROCESS_READ_ENABLED
GEK_GRAPH_SCHEDULER_ENABLED
GEK_APPROVAL_FRONTIER_ENABLED
GEK_LEDGER_OUTBOX_SHADOW_ENABLED
GEK_PROJECTION_ASYNC_ENABLED
GEK_FAST_MUTATION_ENABLED
GEK_DURABLE_EXECUTION_ENABLED
GEK_EXECUTE_OPERATION_ENABLED
GEK_EXECUTE_INTENT_ENABLED
GEK_LEGACY_ADAPTER_ENABLED
GEK_GLOBAL_KILL_SWITCH
```

Selectors may include:

- exact operation keys;
- principal type;
- tenant/workspace cohort;
- risk/consequence class;
- provider family;
- percentage bucket;
- environment.

Flags route behavior but never create authority.

## 5. Phase R0 — Specification and contract guards

Deliverables:

- Spec 011/012/013 addenda;
- integration architecture, domain model, contracts, threat model, persistence, observability, acceptance, and rollout artifacts;
- cross-spec ownership CI guard;
- schema/version/identifier conventions.

No runtime, database, provider, deployment, or public API change.

Exit gate:

- ownership accepted;
- no duplicate functional authority;
- implementation PR slicing agreed;
- open parent Spec/PR dependencies identified.

## 6. Phase R1 — Instrumentation only

Changes:

- add correlation/operation-safe stage telemetry to legacy path;
- count SQL/provider/internal HTTP/model/continuation operations;
- record safety vectors and result/readback hashes;
- publish X0 fixture baseline.

Safety:

- no routing change;
- no shadow resolver that can dispatch;
- no new persistence authority beyond bounded telemetry.

Rollback:

- disable instrumentation flag;
- retain generated baseline artifact;
- verify no behavior drift.

## 7. Phase R2 — Shadow composition

Changes:

- build Spec 013 resolved descriptor metadata;
- build Spec 012 Execution Capsule beside legacy resolution;
- compile Spec 011 governance/plan input without provider dispatch;
- compare target, authority, consequence, approval, readback, and lane decisions.

Mismatch classes:

- descriptor;
- context target;
- connection;
- authority;
- capability;
- policy;
- consequence/risk;
- approval;
- idempotency/readback;
- result projection.

Rules:

- legacy remains authoritative;
- shadow cannot call provider or reserve mutation authority;
- unexplained authority/target mismatch blocks next phase;
- mismatch repair goes to the owning Spec, not the integration kit.

Rollback:

- disable shadow flag; no external state effect.

## 8. Phase R3 — Unified read path

Pilot selection criteria:

- read-only;
- deterministic result;
- exact tenant/resource authorization;
- stable handler;
- no secret/raw provider result exposure;
- comparable legacy result hash;
- low provider cost/latency.

Changes:

- one Admin, Tenant, and Custom GPT route adapt to `DispatchGovernedOperation`;
- direct in-process handler replaces loopback where local;
- capsule/revision-bound static decisions reused;
- legacy path remains fallback.

Canary progression:

```text
internal synthetic -> internal principal -> 1% -> 5% -> 25% -> 50% -> 100% selected operation
```

Expansion requires minimum sample and zero safety mismatch.

Rollback:

- route new acceptance to legacy;
- status/results for already accepted operations remain readable from shared authority;
- no persistence downgrade needed.

## 9. Phase R4 — Graph read/preparation pilot

Changes:

- ready-set scheduling;
- bounded concurrency;
- deterministic output merge;
- resource lock model present but mutation disabled or synthetic;
- ordinary steps remain in parent plan;
- cancellation/lease recovery tests.

Pilot uses independent reads and non-mutating preparation.

Rollback:

- disable graph scheduler for new operations;
- existing durable read plans finish or are safely cancelled;
- fallback sequential execution reads same plan/result contracts.

## 10. Phase R5 — Approval frontier

Changes:

- safe preparation before approval;
- exact approval bundle compiler;
- approval consumption/state guard;
- drift matrix;
- server-side continuation for approved compatible steps.

Initially exercised with dry-run/synthetic mutations or repository preparation without protected writes.

Rollback:

- revert to per-step approval behavior for new plans;
- existing approvals retain historical evidence but are not broadened;
- no approved mutation is executed under a plan hash not supported by active runtime.

## 11. Phase R6 — Persistence and projection shadow

Prerequisites:

- schema inventory and reuse map;
- migration contract and engine-native dry-run if schema changes are required;
- transaction/failure-window tests;
- outbox destination adapters;
- payload/order/hash comparison.

Changes:

- authoritative result/receipt/outbox protocol added;
- current synchronous projection remains active;
- new outbox projections run in shadow or duplicate-safe comparison mode;
- no provider response critical-path removal yet.

Parity window:

- compare payload schema/hash;
- ordering;
- destination identity;
- retry/dead-letter behavior;
- reconstruction/reconciliation.

Rollback:

- disable new delivery workers;
- legacy projection remains active;
- preserve shadow rows/events for diagnosis;
- additive schema remains harmless.

## 12. Phase R7 — Asynchronous verified projections

After 100% parity and outage tests:

- provider success response depends on ledger/readback, not normal Drive/JSONL/search completion;
- declared strong projection mode may still wait;
- projection status visible in compact result;
- dead-letter/reconciliation operational runbooks active.

Canary by projection destination, then operation.

Rollback:

- re-enable synchronous projection wait for new operations;
- continue processing committed outbox events;
- do not replay provider mutation;
- avoid duplicate destination writes via idempotency.

## 13. Phase R8 — Fast-lane low-risk mutation

Pilot requirements:

- reversible low-risk mutation;
- deterministic exact target;
- exact approval/delegation policy;
- provider or internal idempotency;
- same-cycle readback;
- compensation/recovery documented;
- no protected branch, deployment, migration, credential, billing, destructive, or external-send action.

Traffic progression:

```text
synthetic/fake provider -> non-production target -> internal tenant -> 1% eligible -> 5% -> 25% -> selected 100%
```

Each expansion requires:

- zero duplicate mutation;
- zero missing readback;
- unknown-outcome fault tests;
- rollback drill;
- safety-vector parity;
- performance gate.

Rollback:

- disable composed mutation acceptance;
- existing operation/receipt/reconciliation continues under compatible worker;
- legacy callers return prior result through shared idempotency authority;
- no destructive schema rollback while active rows exist.

## 14. Phase R9 — Durable-lane pilot

Select one long-running repository, CI, deployment-observation, or external-wait workflow.

Requirements:

- durable operation accepted before execution;
- status/result authorization;
- process restart recovery;
- cancel/resume semantics;
- approval pause;
- no duplicate mutation;
- provider/external wait readback;
- terminal state model tests.

Rollback:

- disable new durable acceptance for operation cohort;
- drain existing operations;
- retain status/result reads;
- migrate none to legacy mid-flight unless an explicit compatibility protocol exists.

## 15. Phase R10 — Public execution surface

Publish additive operations:

- `executeOperation` first;
- `getExecution` and `getExecutionResult`;
- `cancelExecution` and `resumeExecution`;
- `executeIntent` after ambiguity and descriptor coverage gates.

OpenAPI steps:

1. schema-only specification artifact;
2. route disabled/not served;
3. internal service authentication pilot;
4. Admin/Tenant exact operation pilot;
5. Custom GPT operation-budget and consequential metadata review;
6. percent rollout;
7. public compatibility documentation.

Rollback:

- disable route flags;
- keep status/result access for accepted operations;
- Custom GPT falls back to legacy adapters;
- no deletion of schemas in same release.

## 16. Legacy compatibility model

Legacy classes:

- catalog list/browse;
- direct tool lookup;
- generic `callTool`;
- GPT-specific tool dispatch;
- chunk continuation;
- sequential plan paths;
- synchronous projection paths.

Compatibility states per tool/operation:

```text
legacy_only
shadow_compatible
certified_adapter
composed_preferred
legacy_fallback_only
retirement_candidate
retired_versioned
```

A certified adapter maps exact legacy input to exact operation input and proves equivalence for:

- descriptor/consequence;
- context/authority;
- approval;
- idempotency;
- provider request;
- mutation count;
- readback;
- receipt/result hash;
- errors/next action.

Uncertified tools remain legacy-only.

## 17. Legacy retirement gate

Retirement requires:

- zero or declared negligible usage for a full observation window;
- all known clients migrated;
- certified adapter or explicit end-of-life decision;
- no unresolved parity mismatch;
- rollback/fallback plan;
- updated OpenAPI/docs/tests;
- separately reviewed versioned change;
- production readback after removal.

Do not retire list/call discovery merely because the new intent surface exists; diagnostic and long-tail needs may remain.

## 18. Database migration compatibility

Schema changes are additive during rollout:

- new nullable/defaulted columns;
- new tables/views/indexes;
- compatibility reads/writes;
- no destructive rename/drop until old code usage is zero;
- forward/backward-compatible enum handling;
- migration checksum and engine-native validation;
- production ledger/schema readback.

Application deployment order generally follows expand/migrate/contract:

1. expand schema;
2. deploy code that reads old/new and writes compatible form;
3. shadow/backfill;
4. switch authority;
5. observe;
6. remove obsolete path in later reviewed release.

## 19. Rollback levels

### Level 0 — Disable optimization

Disable cache/reuse/concurrency/projection deferral while keeping composed contracts.

### Level 1 — Route new requests to legacy

New requests use legacy path; accepted composed operations continue under durable authority.

### Level 2 — Disable operation cohort

Disable one operation/provider/risk/tenant cohort through kill switch.

### Level 3 — Disable public execution surface

Keep status/result access; Custom GPT/API clients use legacy calls.

### Level 4 — Worker/dispatcher rollback

Deploy previous compatible runtime that understands existing operation/receipt state.

### Level 5 — Data/schema recovery

Use governed migration rollback/recovery only after proving no incompatible active rows and preserving audit/receipt evidence.

## 20. Split-brain prevention

- one operation acceptance authority per operation cohort;
- shared operation/idempotency/result ledger;
- flags evaluated before acceptance and recorded in operation evidence;
- no mid-operation silent path switching;
- status/result reads route by operation version/authority;
- projection workers consume versioned events;
- rollback compatibility tested with operations accepted by both versions;
- deployment SHA and schema version captured in operation/benchmark evidence where useful.

## 21. Operational rollout checklist

Before enabling a phase:

- exact branch/main SHA fresh;
- required PRs merged and CI green;
- migration state and schema readiness verified;
- flags default off and kill switch tested;
- dashboards/alerts active;
- runbook and on-call action documented;
- synthetic/shadow evidence green;
- security/fault/rollback tests pass;
- no stale approvals/envelopes used;
- production target/cohort bounded.

After enabling:

- read back flag/configuration;
- verify traffic and path counters;
- inspect safety mismatch and unknown outcome;
- compare latency/round trips/SQL/provider calls;
- verify receipts/readbacks/results/projections;
- retain exact enablement evidence;
- halt/rollback on gate violation.

## 22. Closeout

The integration rollout closes only when:

- selected composed path is authoritative in production;
- all X/R phase evidence is recorded;
- rollback drills pass;
- legacy usage is measured;
- no safety regression exists;
- benchmark targets are reported honestly;
- Spec 011/012/013 tasks/traceability/completion artifacts are updated;
- this integration kit records final merged/deployed/migrated/readback references.