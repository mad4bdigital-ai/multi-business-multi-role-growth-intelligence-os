# Spec 011 — X0 Governed Execution Evidence Baseline

## Status

`in_progress`

This is PR A of the governed execution runtime composition program. It implements the canonical instrumentation contract, isolated benchmark evidence, and the first optional legacy adapter for Sequential Plan execution.

It does not change routing, context selection, authority, approval decisions, provider dispatch behavior, retries, readback, persistence authority, deployment, or Production behavior.

## Objective

Create a canonical, no-secret, failure-isolated baseline telemetry contract before optimizing the execution path.

The baseline must distinguish:

- measurements that were actually observed;
- counters or stages that are not yet instrumented;
- wall-clock duration;
- summed stage duration;
- unattributed time;
- concurrent-stage overlap;
- instrumentation or clock anomalies.

A zero value must never be interpreted as proof that an event did not occur when its counter was not observed.

## Current slice

### Canonical collector

`http-generic-api/governedExecutionBaselineTelemetry.js`

Provides:

- bounded entry-point, stage, counter, outcome, and result-classification contracts;
- trace, request, correlation, operation, plan, run, and step references;
- monotonic stage timing;
- repeated non-overlapping observations of the same stage;
- explicit coverage partitions for observed and unobserved stages/counters;
- wall time, summed stage time, unattributed time, and overlap time;
- increment, set, and maximum counter operations;
- secret-like identifier rejection;
- immutable finalized snapshots;
- snapshot validation;
- bounded process-lifetime in-memory sink;
- non-throwing optional emitter behavior.

### Sequential Plan legacy adapter

`http-generic-api/sequentialPlanOrchestrator.js`

The adapter is inactive unless the caller provides `baselineEmitter`. When no emitter is provided, no trace is created and the existing execution path and result shape remain unchanged.

When enabled, the adapter records only bounded metadata:

- `plan_steps` as the observed plan-size gauge;
- maximum observed `ready_set_width`;
- executed `critical_path_steps`;
- ledger time around claim and finalization boundaries;
- `provider_dispatch` stage time only for workflow steps;
- trace/request/correlation/plan references supplied through `baselineTraceInput`.

It does not infer provider-call counts. `provider_calls` remains unobserved and `provider_call_made` remains `null` until a precise provider boundary is instrumented.

The same change also removes two legacy first-candidate assumptions in the modified runtime file:

- plan identity lookup reads at most two rows and fails closed on ambiguity;
- claimed-step lookup reads at most two rows and fails closed on ambiguity.

A shared tested helper returns `null` for no row, returns the only row for an exact match, and raises a stable `409` ambiguity error for multiple rows.

### Tests

`test-governed-execution-baseline-telemetry.mjs` certifies:

- deterministic stage and total timing;
- timing reconciliation;
- overlapping-stage accounting;
- observed/unobserved coverage;
- no-secret identifier handling;
- immutable snapshots;
- clock regression classification;
- duplicate finish and invalid-label isolation;
- bounded sink retention;
- emitter failure isolation;
- invalid snapshot rejection.

`test-governed-execution-baseline-benchmark.mjs` certifies the isolated benchmark contract and proves the instrumented fixture preserves the legacy fixture result.

`test-sequential-plan-orchestrator.mjs` certifies:

- the existing Sequential Plan response shape and plan-state transitions remain unchanged;
- telemetry is emitted only when explicitly configured;
- observed and unobserved coverage is accurate;
- no provider-call claim is made without coverage;
- plan and claim identity ambiguity fails closed;
- raw claim tokens remain excluded from evidence.

All three tests are registered in the complete platform test manifest without removing existing commands.

### Benchmark

`scripts/governed-execution-baseline-benchmark.mjs`

The benchmark:

- uses an in-process deterministic workload;
- performs warmup and bounded iterations;
- compares the same checksum with and without telemetry;
- reports mean, p50, p95, and maximum durations;
- reports collector overhead without claiming production acceleration;
- performs no database access, provider call, external send, or runtime route call;
- emits no secret-bearing data.

## Canonical stage names

- `intent_resolution`
- `descriptor_resolution`
- `context_resolution`
- `policy_resolution`
- `approval_wait`
- `provider_dispatch`
- `readback`
- `ledger`
- `projection`

## Canonical counters

- `sql_queries`
- `provider_calls`
- `internal_http_hops`
- `model_round_trips`
- `tool_round_trips`
- `continuation_calls`
- `plan_steps`
- `ready_set_width`
- `critical_path_steps`
- `response_bytes`
- `instrumentation_errors`
- `clock_regressions`

## Coverage semantics

Every finalized snapshot contains two complete partitions:

```text
coverage.stages.observed
coverage.stages.unobserved
coverage.counters.observed
coverage.counters.unobserved
```

The union of observed and unobserved values must exactly equal the published stage or counter registry. The two sets must not overlap.

`provider_call_made` is:

- `true` when `provider_calls` was observed and greater than zero;
- `false` when it was observed and remained zero;
- `null` when provider-call coverage was not instrumented.

## Timing semantics

```text
total_stage_ms + unattributed_ms - overlap_ms = total_ms
```

- `total_ms` is wall-clock duration.
- `total_stage_ms` is the sum of observed stage durations.
- `unattributed_ms` is wall time not covered by observed stages.
- `overlap_ms` is the amount by which concurrent stage sums exceed wall time.

The baseline does not label unattributed time as instrumentation overhead. Production instrumentation overhead must be estimated through matched benchmark fixtures, not inferred from one trace.

## Persistence decision

No migration or automatic SQL persistence is introduced in this slice.

The repository already has `telemetry_spans`, but current generic span intake accepts broad attributes. X0 first establishes a bounded schema and a failure-isolated emitter. A later PR may add a governed projection adapter after schema, retention, sampling, tenant isolation, and query-cost evidence are approved.

## Remaining X0 work

- instrument the legacy GPT Tool entry point with explicit partial coverage;
- instrument the legacy System Tool entry point with explicit partial coverage;
- instrument the Connector Plan entry point with precise provider-call coverage;
- instrument the Agent Loop entry point with precise model/tool round-trip coverage;
- publish matched runtime-fixture evidence for the selected entry points;
- update exact-head CI evidence without claiming the broader X0 program complete.

## Safety boundaries

- no provider call added;
- no database write or migration;
- no external send;
- no route or OpenAPI change;
- no authority, approval, or context change;
- no new retry behavior;
- no deployment or Production synchronization;
- no protected-branch mutation;
- no secret-bearing telemetry;
- collector and emitter failures cannot fail the measured operation.
