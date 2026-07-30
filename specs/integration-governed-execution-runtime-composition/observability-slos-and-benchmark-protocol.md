# Observability, SLOs, and Benchmark Protocol

## 1. Purpose

This document defines how the platform proves that runtime composition improves speed and interaction efficiency without weakening authorization, tenant isolation, approval, idempotency, readback, reconciliation, result integrity, audit, or recovery.

No acceleration claim is accepted from code inspection alone. Measurements require a reproducible baseline, identical fixtures, safety-outcome equality, and statistically meaningful warm and cold runs.

## 2. Observability principles

- one trace spans entry adapter, Spec 013 resolution, Spec 012 context, Spec 011 compilation/execution, provider, readback, ledger, and projections;
- stage timing is measured at application boundaries, not inferred from one total timer;
- metrics are bounded-cardinality and contain no raw intent, payload, credentials, JWT, result body, or arbitrary provider URL;
- audit evidence and performance telemetry are separate but correlated by safe trace/operation references;
- sampling cannot hide mutations, unknown outcomes, cross-tenant blocks, duplicate mutation, or missing readback;
- benchmark instrumentation overhead is measured and reported;
- legacy and composed paths use the same fixtures and provider simulators or live-safe target conditions.

## 3. Correlation model

Required identifiers:

- `request_id`: one transport request;
- `trace_id`: one distributed/application trace;
- `correlation_id`: related request lineage;
- `operation_id`: durable governed operation;
- `plan_id` and revision;
- `step_id` and attempt;
- `receipt_id`;
- `result_id`;
- `projection_event_id`.

Metrics may label safe operation/risk/lane/provider classes but should avoid raw operation IDs except in logs/traces with controlled retention.

## 4. Stage timing model

Required durations:

```text
request_validation_ms
intent_resolution_ms
descriptor_resolution_ms
context_resolution_ms
context_validation_ms
governance_compilation_ms
plan_compilation_ms
lane_selection_ms
approval_wait_ms
mutation_frontier_validation_ms
idempotency_reservation_ms
resource_lock_wait_ms
scheduler_queue_ms
provider_dispatch_ms
provider_wait_ms
readback_ms
ledger_commit_ms
result_projection_ms
outbox_enqueue_ms
synchronous_projection_ms
response_serialization_ms
total_acceptance_ms
total_execution_ms
time_to_first_authoritative_outcome_ms
time_to_compact_result_ms
time_to_full_projection_ms
```

Stage totals need not equal wall-clock total when stages overlap through graph concurrency. The trace records both individual spans and critical-path duration.

## 5. Count and topology metrics

Required counters per operation/fixture:

- model round trips;
- public tool/API calls;
- compatibility adapter calls;
- internal HTTP hops;
- application dispatch calls;
- SQL query count by stage/read/write;
- registry/context/policy cache hits and revision misses;
- provider calls by read/mutation/readback;
- plan step/edge/depth count;
- ready-set width;
- maximum observed concurrency;
- resource lock wait/conflict count;
- approval requests and approved step count;
- retry attempts by classification;
- unknown outcomes and reconciliation attempts;
- response continuation/chunk calls;
- projection deliveries/retries/dead letters;
- payload bytes for compact/full/projected forms.

## 6. Safety metrics

Must be complete, not sampled away:

- authority deny/allow/approval-required dispositions;
- cross-tenant blocks;
- context/target/connection substitution blocks;
- descriptor/runtime/consequence mismatches;
- stale capsule/approval/envelope/SHA/version rejections;
- idempotency conflicts;
- provider mutation count;
- duplicate mutation detection;
- unknown outcome age and resolution;
- missing/mismatched readback;
- result-hash mismatch;
- stale fencing-token commit attempts;
- unauthorized result lookup;
- secret scanner findings;
- projection scope/hash/order mismatch;
- rollback/fallback activation.

## 7. Metric naming blueprint

Example logical metrics:

```text
governed_execution_requests_total
governed_execution_stage_duration_seconds
governed_execution_operations_active
governed_execution_operations_terminal_total
governed_execution_model_round_trips_total
governed_execution_internal_http_hops_total
governed_execution_sql_queries_total
governed_execution_provider_calls_total
governed_execution_ready_set_width
governed_execution_resource_lock_wait_seconds
governed_execution_approval_requests_total
governed_execution_unknown_outcomes_total
governed_execution_reconciliation_age_seconds
governed_execution_duplicate_mutations_total
governed_execution_readback_mismatches_total
governed_execution_projection_delivery_total
governed_execution_result_bytes
governed_execution_safety_mismatches_total
```

Allowed bounded labels include:

- entry surface;
- operation class/key from controlled registry;
- risk/consequence class;
- lane;
- stage;
- provider family;
- result state;
- retry/failure class;
- rollout cohort;
- legacy/composed/shadow path.

Disallowed labels:

- raw intent;
- user email/name;
- token/key;
- arbitrary tenant/resource ID at global metric scale;
- raw URL/path if user controlled;
- provider response text;
- stack/error message.

## 8. Trace span blueprint

Parent-child spans:

```text
request
  spec013.resolve_operation
  spec012.resolve_or_validate_capsule
  spec011.compile_governance
  spec011.compile_plan
  spec011.select_lane
  spec011.accept_operation
    scheduler.claim_ready_set
      step.execute
        mutation_frontier.validate
        idempotency.reserve
        resource_lock.acquire
        provider.dispatch
        provider.readback
        ledger.finalize
    result.project_compact
    outbox.deliver_destination
```

Each span records safe status and reason code, not raw payload.

## 9. Service-level objectives

Initial SLOs are rollout targets and are refined after X0 baseline.

### 9.1 Safety and correctness SLOs

- 100% governed mutations have durable pending/final receipt evidence;
- 100% completed mutations satisfy declared readback;
- 0 automatic retries after unknown outcome before reconciliation;
- 0 cross-tenant successful access;
- 0 stale approval/capsule/envelope accepted at mutation frontier;
- 0 duplicate provider mutation in certified fault tests and rollout cohorts;
- 100% terminal results have canonical result hash;
- 100% projection failures retain authoritative execution result;
- 100% state-changing operation resolutions expose correct consequence/approval metadata.

### 9.2 Availability/recovery SLOs

- durable accepted operations survive process restart and client disconnect;
- operation/status/result read remains available from authoritative ledger when projection destinations fail;
- projection dead letters are visible and reconcilable;
- rollback can return selected traffic to legacy path without losing accepted operation identity or receipts.

### 9.3 Performance SLO targets

After baseline:

- selected in-process read path: zero internal HTTP hops;
- repeated unchanged context resolution: at least 40% lower median stage duration;
- representative 3–6-step workflow: at least 60% fewer caller/model round trips;
- representative repository workstream: at least 80% fewer Agent tool calls;
- provider-complete mutation where projections leave critical path: at least 20% lower median post-provider completion duration;
- single-step read p95 regression no greater than 10% after warm-up;
- no safety metric regression.

## 10. Benchmark fixture catalogue

### F01 — Exact single read

Purpose:

- descriptor direct lookup;
- capsule reuse;
- in-process dispatch;
- compact/full result parity.

Measurements:

- latency cold/warm;
- SQL queries;
- internal HTTP hops;
- result bytes/hash;
- authorization parity.

### F02 — Intent single read

Purpose:

- principal-visible intent resolution;
- unique interpretation;
- no authority from ranking.

Includes ambiguous negative case with zero provider calls.

### F03 — Reversible single mutation

Purpose:

- exact approval;
- dynamic frontier validation;
- idempotency reservation;
- provider dispatch/readback/receipt;
- projection deferral.

Faults:

- stale approval;
- expected version drift;
- transport disconnect;
- readback outage;
- projection outage.

### F04 — Six-step mixed plan

Example graph:

```text
A inspect resource ----+
B read policy ---------+--> D prepare change --> E approval --> F mutate/readback
C read related state --+
```

Purpose:

- three-way ready-set concurrency;
- deterministic merge;
- approval frontier;
- model round-trip reduction.

### F05 — Repository workflow to PR

Steps:

- inspect branch/files;
- resolve overlap/current SHA;
- prepare change set;
- generate/validate artifacts;
- approval frontier;
- atomic tree/commit/ref;
- readback;
- open PR;
- CI/status handoff.

Measures active interaction time and wall-clock separately.

### F06 — Durable external wait

Examples:

- CI completion;
- deployment observation;
- provider asynchronous operation.

Purpose:

- acceptance latency;
- restart/disconnect recovery;
- status/resume/cancel;
- no duplicate mutation.

### F07 — Projection-heavy session

Purpose:

- Drive/JSONL/search projection critical-path impact;
- outbox retries;
- payload/order/hash parity;
- dead-letter/reconciliation.

### F08 — Cross-tenant/security negatives

Purpose:

- verify no performance path weakens security;
- hidden result/descriptor behavior;
- context/connection substitution block;
- no-secret evidence.

## 11. Baseline modes

Measure:

- legacy cold;
- legacy warm;
- composed shadow with no dispatch;
- composed cold;
- composed warm;
- composed with projection outage;
- composed after process restart;
- rollback legacy after composed operation history exists.

## 12. Experimental controls

- same code/base fixture for compared path except controlled feature flag;
- same principal, tenant, workspace, resource, connection, operation input, expected version, provider fixture, approval, and readback contract;
- fixed provider simulation latency/error distribution for deterministic runs;
- live-safe runs separated from simulated runs;
- warm-up iterations excluded and reported;
- concurrency and rate limits held constant unless the experiment explicitly measures them;
- instrumentation version recorded;
- system load and environment metadata recorded;
- no production mutation benchmark without exact governed pilot approval.

## 13. Sample size and statistics

For deterministic unit/integration benchmarks:

- enough iterations to expose variance and warm-up behavior;
- report median, p90, p95, minimum, maximum, and standard deviation or robust spread;
- retain raw bounded timing series artifact where allowed.

For canary production telemetry:

- compare matched cohorts by operation/risk/provider class;
- avoid mixing cold rollout and mature traffic;
- report confidence interval or practical effect range;
- require minimum sample threshold before declaring improvement;
- safety failures override statistical speed improvement.

## 14. Derived measures

- end-to-end speedup = legacy median total / composed median total;
- critical-path speedup = legacy critical path / composed critical path;
- interaction reduction = 1 - composed caller round trips / legacy caller round trips;
- SQL reduction = 1 - composed SQL queries / legacy SQL queries;
- projection critical-path reduction = legacy synchronous projection time - composed synchronous projection time;
- concurrency efficiency = sum step durations / critical-path duration, interpreted with ready-set width;
- approval consolidation = approved mutation steps / approval requests;
- recovery correctness = recovered operations without duplicate mutation / all injected recoveries.

Report raw values alongside ratios.

## 15. Safety equality vector

Every compared run records:

```text
principal identity class/reference hash
selected tenant/workspace/resource/connection hashes
descriptor key/version/consequence
context hash/revision vector
authority/capability/policy dispositions
approval requirement and binding hash
plan hash and step set
idempotency scope hash
provider request hash
provider mutation count
readback status/hash
receipt outcome/hash
unknown-outcome/reconciliation classification
terminal operation/result state/hash
audit event types/count
projection obligations and hashes
secret/tenant-isolation checks
```

The benchmark is invalid if vectors differ without an explained stricter composed-path result.

## 16. Performance regression gates

Block rollout expansion when:

- any safety-vector mismatch is unexplained;
- p95 read latency regresses beyond declared threshold;
- scheduler queue/lock wait grows without throughput benefit;
- SQL/provider calls increase unexpectedly;
- compact result causes extra retries or missing next-action discovery;
- unknown-outcome or reconciliation age increases;
- projection backlog/dead-letter exceeds threshold;
- rollback drill fails;
- telemetry is incomplete or contains secrets.

## 17. Dashboards

Required views:

### Runtime overview

- traffic by surface/path/lane/state;
- total and stage latency;
- operations active/terminal;
- caller round trips/tool calls;
- provider/readback outcomes.

### Safety

- cross-tenant/context/approval/idempotency blocks;
- unknown outcomes and age;
- duplicate mutation/readback mismatch;
- descriptor/runtime/consequence mismatch;
- unauthorized result access;
- secret findings.

### Scheduler

- ready-set width;
- active claims;
- lease expiry/recovery;
- lock wait/conflicts;
- step retries and critical path.

### Projections

- pending/retrying/dead-letter deliveries;
- destination latency;
- ordering/hash mismatches;
- backlog age;
- reconciliation success.

### Migration/rollout

- cohort percentage;
- legacy/composed/shadow counts;
- mismatch rate;
- fallback/rollback count;
- legacy adapter usage.

## 18. Benchmark artifacts

Each benchmark run publishes a bounded no-secret artifact containing:

- code/base/head SHA;
- configuration and flags;
- schema/descriptor/context/policy revisions;
- fixture IDs;
- environment/provider simulator metadata;
- run counts and warm-up;
- raw/aggregate timings;
- count metrics;
- safety vectors and equality result;
- injected faults;
- anomalies;
- pass/fail decision;
- reviewer/approval references where required.

## 19. Closeout evidence

Final performance closeout requires:

- X0 baseline artifact;
- per-phase benchmark artifacts;
- canary matched-cohort report;
- safety equality report;
- fault-injection recovery report;
- rollback drill report;
- projection outage/reconciliation report;
- legacy usage/retirement report;
- exact merged/deployed SHAs and relevant migration evidence.