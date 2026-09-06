# Spec 011 — X0 Governed Execution Evidence Baseline

## Status

`candidate_implementation_complete_external_ci_pending`

This is the X0 evidence-baseline slice of the governed execution runtime composition program. It implements the canonical instrumentation contract, isolated benchmark evidence, passive legacy entry-point adapters, precise Connector/Agent counters where the runtime boundary is provable, and a reproducible matched-fixture baseline.

It does not change routing decisions, context selection, authority, approval decisions, provider dispatch behavior, retries, readback semantics, persistence authority, deployment, or Production behavior.

External exact-head CI and live Staging certification remain evidence gates; the candidate tree does not self-attest them.

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
- trace/request/correlation/plan references supplied through `baselineTraceInput`.

Provider timing is intentionally stricter:

- the default Sequential executor automatically records `provider_dispatch` only around workflow steps it owns;
- a custom executor does not receive an automatic provider-stage claim;
- a custom caller may set `baselineProviderDispatch=true` only when the whole custom workflow executor is a verified provider boundary;
- `baselineTrace` is passed into the custom executor context so a more precise nested provider boundary can be recorded directly;
- `provider_calls` is never inferred from stage timing and remains unobserved until a precise provider-call counter is connected.

The same slice removes three legacy first-candidate assumptions in the modified runtime file:

- compiled-plan identity lookup reads at most two rows and fails closed on ambiguity;
- plan claim identity lookup reads at most two rows and fails closed on ambiguity;
- claimed-step lookup reads at most two rows and fails closed on ambiguity.

A shared tested helper returns `null` for no row, returns the only row for an exact match, and raises a stable `409` ambiguity error for multiple rows.

### Passive GPT/System entry-point adapters

`http-generic-api/governedExecutionBaselineRuntime.js`

`http-generic-api/routes/index.js`

The HTTP adapter is registered ahead of the existing route tree but is a no-op unless `deps.governedExecutionBaselineEmitter` is a function. It does not add a new route or alter an OpenAPI contract.

When enabled it observes only the exact legacy entry points:

- `POST /gpt/tools/call` → `gpt_tool`;
- `POST /system/tools/call` → `system_tool`;
- `POST /admin/system/tools/call` → `system_tool`.

The adapter records only bounded request/correlation identifiers, one public tool-call round trip, an explicit continuation count for `response_chunk_read`, response byte count only when `Content-Length` is available, and HTTP outcome classification. It does not copy request arguments, headers, credentials, result bodies, provider payloads, or arbitrary error text.

Unobserved SQL/provider/internal-stage counters remain explicitly unobserved rather than being fabricated as zero.

### Connector Plan and Agent Loop adapters

`http-generic-api/connectorExecutor.js`

Connector Plan creates a trace only when an emitter is explicitly injected. The adapter observes existing context, policy, provider-dispatch, and ledger boundaries without adding a provider call or changing dispatch selection.

Precise provider-call counting is connected only at the currently provable Make MCP fetch boundary: one attempted MCP dispatch records one provider call immediately before the existing `fetch`. Other connector/provider counts remain unobserved rather than inferred.

Content workflows wrap the existing Agent Loop dependencies without changing their outputs:

- every actual `callModel` invocation increments `model_round_trips` once;
- every actual model callable returned by `getCallModelForClass` increments `model_round_trips` once when invoked;
- every actual `engineExecutorRegistry.dispatch` increments `tool_round_trips` once;
- wrapper exceptions preserve the original exception path;
- trace emission is fire-and-forget and failure-isolated.

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
- invalid snapshot rejection;
- disabled GPT/System instrumentation remains transparent;
- GPT/System bounded partial coverage and no-argument capture;
- emitter failure cannot fail the measured HTTP path;
- Agent Loop model/tool wrappers preserve outputs and count only actual calls;
- the MCP provider boundary records one precise provider call.

`test-governed-execution-baseline-benchmark.mjs` certifies the isolated benchmark contract, proves the instrumented fixture preserves the legacy fixture result, regenerates the matched X0 fixture catalogue, and binds the regenerated functional/safety hashes to the published baseline artifact.

`test-sequential-plan-orchestrator.mjs` certifies:

- the existing Sequential Plan response shape and plan-state transitions remain unchanged;
- telemetry is emitted only when explicitly configured;
- observed and unobserved coverage is accurate;
- provider timing for a custom executor requires an explicit boundary declaration;
- no provider-call count is claimed without precise coverage;
- plan and claim identity ambiguity fails closed;
- raw claim tokens remain excluded from evidence.

All three tests remain registered in the complete platform test manifest without removing existing commands.

### Benchmark

`scripts/governed-execution-baseline-benchmark.mjs`

The collector-overhead benchmark:

- uses an in-process deterministic workload;
- performs warmup and bounded iterations;
- compares the same checksum with and without telemetry;
- reports mean, p50, p95, and maximum durations;
- reports collector overhead without claiming production acceleration;
- performs no database access, provider call, external send, or runtime route call;
- emits no secret-bearing data.

The same registered executable also exposes `--matched-fixtures`. It uses the protocol-approved deterministic provider-simulator mode to reproduce F01, F03, F04, F05, and F06 with identical legacy/instrumented functional results and explicit safety vectors.

### Published matched fixture baseline

`x0-matched-runtime-fixtures.json`

The artifact records, for each selected fixture:

- canonical fixture and entry-point identity;
- legacy and instrumented SHA-256 result hashes;
- authority and approval disposition;
- provider-simulator outcome;
- readback and receipt outcome;
- projection outcome;
- recovery outcome.

CI regenerates the fixture results and timing identity and rejects drift from the published hashes or safety vector. The fixture harness performs no live provider call, database write, migration, external send, deployment, or Production mutation.

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

## Candidate implementation closure

Implemented in the candidate tree:

- legacy GPT Tool entry instrumentation with explicit partial coverage;
- legacy System Tool entry instrumentation with explicit partial coverage;
- Connector Plan instrumentation with precise Make MCP provider-call coverage and explicit unobserved semantics elsewhere;
- Agent Loop instrumentation with precise model/tool round-trip coverage;
- matched runtime-fixture artifact for F01/F03/F04/F05/F06;
- deterministic CI regeneration of functional result hashes, safety vectors, and timing identity.

Still external and intentionally not self-attested by the candidate tree:

- exact-head GitHub Actions certification;
- required live Staging certification for this runtime-impacting source change.

X1 contract-composition shadow must not begin until both external X0 gates pass.

## Safety boundaries

- no provider call added;
- no database write or migration;
- no external send added;
- no route or OpenAPI contract change;
- no authority, approval, or context decision change;
- no new retry behavior;
- no deployment or Production synchronization performed by this slice;
- no protected-branch mutation;
- no secret-bearing telemetry;
- collector and emitter failures cannot fail the measured operation;
- candidate-tree files cannot self-attest exact-head CI or live Staging certification.
