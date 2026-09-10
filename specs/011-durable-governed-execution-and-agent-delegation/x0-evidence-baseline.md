# Spec 011 — X0 Governed Execution Evidence Baseline

## Status

`candidate_implementation_complete_external_ci_pending`

X0 establishes passive, no-secret evidence instrumentation for the existing governed execution runtime before any X1 shadow composition or later optimization. The candidate is implemented in source, but Gate X0 remains externally open until exact-head CI and required live Staging certification both pass.

The candidate does not change routing decisions, context selection, authority, approval, provider selection, retries, readback semantics, operation outcomes, database persistence authority, or Production rollout.

## Objective

Measure the legacy path truthfully enough to compare later composed execution without turning missing observations into fabricated zeroes.

Every snapshot distinguishes:

- observed versus unobserved stages and counters;
- wall-clock duration versus summed stage time;
- unattributed time versus concurrent-stage overlap;
- instrumentation and clock anomalies;
- provider-call evidence only where a provider boundary is actually observed.

## Canonical collector

`http-generic-api/governedExecutionBaselineTelemetry.js`

The collector provides bounded entry points, stages, counters, outcomes, safe correlation identifiers, immutable snapshots, timing reconciliation, no-secret validation, a bounded process-lifetime memory sink, and non-throwing emission.

No X0 sample contains raw arguments, prompts, headers, JWTs, credentials, provider payloads, result bodies, or arbitrary error messages.

## Runtime activation model

`http-generic-api/governedExecutionBaselineRuntime.js`

The runtime adapter supports two emitter modes:

1. an explicit injected emitter for deterministic tests or bounded integrations;
2. a shared bounded process-memory emitter only when `GOVERNED_EXECUTION_BASELINE_ENABLED=true`.

Default behavior remains disabled. If the flag is absent or false, optional traces return no handle and the measured execution continues unchanged.

Staging enables X0 explicitly in `http-generic-api/docker-compose.staging.yml`:

```text
GOVERNED_EXECUTION_BASELINE_ENABLED=true
GOVERNED_EXECUTION_BASELINE_MAX_SAMPLES=500
```

The base/Production-capable Compose contract does not enable X0. The process sink is bounded to 500 samples in Staging, is lost on process restart, writes no SQL, performs no external send, and is not an execution/audit authority.

This activation is intentionally sufficient for X0 measurement but not suitable as durable governance evidence. Durable telemetry or projection storage requires a separate later review covering schema, retention, sampling, isolation, and query cost.

## Legacy entry points

### GPT Tool and System Tool

`http-generic-api/routes/index.js` mounts the passive middleware ahead of the existing route tree. It adds no route and changes no OpenAPI contract.

Observed legacy shells:

- `POST /gpt/tools/call` → `gpt_tool`;
- `POST /system/tools/call` → `system_tool`;
- `POST /admin/system/tools/call` → `system_tool`.

The HTTP shell records a bounded request/correlation identity, one public tool round trip, explicit continuation count for `response_chunk_read`, response bytes only when `Content-Length` is available, and HTTP outcome classification.

It does not infer SQL count, provider count, internal stages, or provider success from the transport response.

### Connector Plan

`http-generic-api/connectorExecutor.js` creates a `connector_plan` trace through the runtime emitter resolver. Therefore normal callers do not need to be rewritten solely to pass telemetry dependencies when Staging has enabled X0.

Observed boundaries include:

- context resolution;
- policy/preflight and capability/skill gating;
- plan claim/final ledger work;
- the existing provider-dispatch interval;
- plan step count where available.

`provider_dispatch` timing is not itself treated as proof of a provider call.

The precise provider-call counter is currently wired only to the proven Make MCP network boundary, immediately before the existing Make MCP `fetch`. Other provider counts remain unobserved rather than inferred.

### Agent Loop

Content-workflow dispatch creates an `agent_loop` trace and wraps existing dependencies without changing their outputs:

- each actual `callModel` call increments `model_round_trips`;
- each selected model callable increments the same counter when actually invoked;
- each actual `engineExecutorRegistry.dispatch` increments `tool_round_trips`;
- original exceptions and return values are preserved;
- final telemetry emission is failure-isolated.

### Sequential Plan

The pre-existing Sequential Plan adapter remains explicit-caller opt-in through its own `baselineEmitter` contract. It records plan size, ready-set width, critical-path steps, ledger boundaries and explicitly declared provider timing without claiming provider-call counts it cannot prove.

Its existing ambiguity hardening also remains fail-closed for compiled-plan, plan-claim and claimed-step identity selection.

## Matched X0 fixtures

`http-generic-api/scripts/governed-execution-baseline-benchmark.mjs --matched-fixtures`

The registered deterministic harness reproduces:

- F01 — exact single read;
- F03 — reversible single mutation;
- F04 — six-step mixed plan;
- F05 — repository workflow to PR;
- F06 — durable external wait.

These are deterministic provider simulators, not live provider certification.

For each fixture the published artifact records:

- legacy and instrumented SHA-256 result hashes;
- authority disposition;
- approval state;
- provider-simulator result;
- readback;
- receipt;
- projection;
- recovery behavior.

The legacy and instrumented functional hashes must match. Timing identity is regenerated in CI:

```text
total_stage_ms + unattributed_ms - overlap_ms = total_ms
```

The fixture harness performs no live provider call, Production database access, database write, migration, external send, deployment, or Production mutation.

Published artifact:

`specs/011-durable-governed-execution-and-agent-delegation/x0-matched-runtime-fixtures.json`

Its recorded base-main provenance is the exact current-main base used by the candidate and must equal the X0 manifest base SHA.

## Registered tests

`test-governed-execution-baseline-telemetry.mjs` verifies collector semantics, secret rejection, immutable snapshots, timing/coverage, emitter failure isolation, GPT/System partial coverage, Agent model/tool counting, and exact MCP provider-call observation.

`test-governed-execution-baseline-benchmark.mjs` verifies collector overhead measurement, F01/F03/F04/F05/F06 functional and safety parity, artifact provenance, process-emitter disabled/enabled behavior, bounded in-memory runtime reachability, actual GPT/System route ownership, Connector/Agent wiring, Staging activation, and the absence of implicit activation in the base Compose file.

`test-sequential-plan-orchestrator.mjs` verifies the existing Sequential Plan behavior and explicit instrumentation boundary.

These tests remain in the existing platform test authority; X0 does not introduce a parallel test runner.

## Canonical stages

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

A zero value is meaningful only when that counter appears in `coverage.counters.observed`. Otherwise the value must be treated as unobserved.

## X0 implementation closure

Implemented in the candidate tree:

- X001 — GPT/System entry-point instrumentation and correlation;
- X002 — bounded counters with explicit observed/unobserved semantics and precise provider/model/tool counts where proven;
- X003 — representative F01/F03/F04/F05/F06 fixtures;
- X004 — matched authority/approval/provider/readback/receipt/projection/recovery evidence;
- X005 — no-secret published baseline artifact;
- process-local bounded emitter reachable without rewriting every `dispatchPlan` caller;
- Staging-only activation with base/Production-capable Compose disabled by default;
- runtime wiring and activation regression tests.

Still external and intentionally not self-attested by source:

- exact-head GitHub Actions certification;
- live Staging certification on the exact candidate.

X1 contract-composition shadow must not begin until both external Gate X0 conditions pass.

## Safety boundaries

- no new provider call;
- no database write or migration;
- no external send;
- no route or OpenAPI contract change;
- no authority, approval, target, context, or connection decision change;
- no new retry behavior;
- no Production activation or runtime cutover;
- no protected-branch mutation;
- no durable telemetry persistence;
- no secret-bearing telemetry;
- collector/emitter failure cannot fail the measured operation;
- deterministic provider fixtures are never represented as live provider certification;
- source files never self-attest exact-head CI or live Staging success.
