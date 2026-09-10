import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  GOVERNED_EXECUTION_BASELINE_COUNTERS,
  GOVERNED_EXECUTION_BASELINE_STAGES,
  createGovernedExecutionBaselineTrace,
  createInMemoryGovernedExecutionBaselineSink,
  emitGovernedExecutionBaselineSnapshot,
  validateGovernedExecutionBaselineSnapshot,
} from "./governedExecutionBaselineTelemetry.js";
import {
  createGovernedExecutionBaselineHttpMiddleware,
  createOptionalGovernedExecutionBaselineTrace,
  finalizeOptionalGovernedExecutionBaselineTrace,
  instrumentAgentLoopDependencies,
  observeMcpProviderDispatch,
} from "./governedExecutionBaselineRuntime.js";

function deterministicClock(values) {
  const queue = [...values];
  return () => {
    assert(queue.length > 0, "deterministic clock exhausted");
    return queue.shift();
  };
}

function response(statusCode = 200, contentLength = null) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.getHeader = (name) => String(name).toLowerCase() === "content-length" ? contentLength : undefined;
  return res;
}

{
  const trace = createGovernedExecutionBaselineTrace({
    trace_id: "trace-001",
    request_id: "request-001",
    correlation_id: "correlation-001",
    operation_id: "operation-001",
    plan_id: "plan-001",
    run_id: "run-001",
    entry_point: "connector_plan",
  }, {
    clock: deterministicClock([0, 2, 7, 8, 18, 25]),
  });

  const finishContext = trace.startStage("context_resolution");
  assert.equal(finishContext(), true);
  trace.increment("sql_queries", 4);
  const finishProvider = trace.startStage("provider_dispatch");
  assert.equal(finishProvider(), true);
  trace.increment("provider_calls");
  trace.increment("plan_steps", 6);
  trace.increment("ready_set_width", 3);
  trace.increment("critical_path_steps", 4);
  trace.observeCounter("internal_http_hops");

  const snapshot = trace.finalize({
    outcome: "success",
    result_classification: "confirmed_success",
    response_bytes: 2048,
  });

  assert.equal(snapshot.trace_id, "trace-001");
  assert.equal(snapshot.correlation_id, "correlation-001");
  assert.equal(snapshot.entry_point, "connector_plan");
  assert.equal(snapshot.outcome, "success");
  assert.equal(snapshot.result_classification, "confirmed_success");
  assert.equal(snapshot.stage_durations_ms.context_resolution, 5);
  assert.equal(snapshot.stage_durations_ms.provider_dispatch, 10);
  assert.equal(snapshot.total_stage_ms, 15);
  assert.equal(snapshot.total_ms, 25);
  assert.equal(snapshot.unattributed_ms, 10);
  assert.equal(snapshot.overlap_ms, 0);
  assert.equal(snapshot.counters.sql_queries, 4);
  assert.equal(snapshot.counters.provider_calls, 1);
  assert.equal(snapshot.counters.internal_http_hops, 0);
  assert.equal(snapshot.counters.plan_steps, 6);
  assert.equal(snapshot.counters.ready_set_width, 3);
  assert.equal(snapshot.counters.critical_path_steps, 4);
  assert.equal(snapshot.counters.response_bytes, 2048);
  assert.equal(snapshot.provider_call_made, true);
  assert.deepEqual(snapshot.coverage.stages.observed, ["context_resolution", "provider_dispatch"]);
  assert(snapshot.coverage.stages.unobserved.includes("readback"));
  assert(snapshot.coverage.counters.observed.includes("internal_http_hops"));
  assert(snapshot.coverage.counters.observed.includes("response_bytes"));
  assert(snapshot.coverage.counters.unobserved.includes("model_round_trips"));
  assert.equal(snapshot.secrets_included, false);
  assert(Object.isFrozen(snapshot));
  assert(Object.isFrozen(snapshot.stage_durations_ms));
  assert(Object.isFrozen(snapshot.counters));
  assert(Object.isFrozen(snapshot.coverage));
  assert.deepEqual(Object.keys(snapshot.stage_durations_ms).sort(), [...GOVERNED_EXECUTION_BASELINE_STAGES].sort());
  assert.deepEqual(Object.keys(snapshot.counters).sort(), [...GOVERNED_EXECUTION_BASELINE_COUNTERS].sort());
  assert.deepEqual(validateGovernedExecutionBaselineSnapshot(snapshot), {
    ok: true,
    errors: [],
    secrets_included: false,
  });
  assert.equal(trace.finalize({ outcome: "failure" }), snapshot, "finalization must be idempotent");
}

{
  const trace = createGovernedExecutionBaselineTrace({
    trace_id: "trace-overlap",
    entry_point: "sequential_plan",
  }, {
    clock: deterministicClock([0, 1, 2, 8, 10, 10]),
  });
  const finishContext = trace.startStage("context_resolution");
  const finishPolicy = trace.startStage("policy_resolution");
  finishContext();
  finishPolicy();
  const snapshot = trace.finalize({ outcome: "success" });
  assert.equal(snapshot.stage_durations_ms.context_resolution, 7);
  assert.equal(snapshot.stage_durations_ms.policy_resolution, 8);
  assert.equal(snapshot.total_stage_ms, 15);
  assert.equal(snapshot.total_ms, 10);
  assert.equal(snapshot.unattributed_ms, 0);
  assert.equal(snapshot.overlap_ms, 5);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshot).ok, true);
}

{
  const trace = createGovernedExecutionBaselineTrace({
    trace_id: "Bearer secret-token",
    request_id: "eyJabc.def.ghi",
    correlation_id: "valid-correlation",
    entry_point: "unsupported-entry",
  }, {
    traceIdFactory: () => "generated-trace",
    clock: deterministicClock([10, 10]),
  });
  const snapshot = trace.finalize({ outcome: "unsupported-outcome" });
  assert.equal(snapshot.trace_id, "generated-trace");
  assert.equal(snapshot.request_id, null);
  assert.equal(snapshot.correlation_id, "valid-correlation");
  assert.equal(snapshot.entry_point, "unknown");
  assert.equal(snapshot.outcome, "unknown");
  assert.equal(snapshot.provider_call_made, null, "unobserved counters must not be interpreted as zero");
  assert.equal(snapshot.secrets_included, false);
  assert.equal(JSON.stringify(snapshot).includes("secret-token"), false);
  assert.equal(JSON.stringify(snapshot).includes("eyJabc"), false);
}

{
  const trace = createGovernedExecutionBaselineTrace({ entry_point: "system_tool" }, {
    traceIdFactory: () => "trace-errors",
    clock: deterministicClock([20, 21, 20, 22]),
  });
  const finish = trace.startStage("policy_resolution");
  assert.equal(finish(), true);
  assert.equal(finish(), false, "stage finish must be idempotent and non-throwing");
  assert.equal(trace.startStage("not-a-stage")(), false);
  assert.equal(trace.increment("not-a-counter"), false);
  const snapshot = trace.finalize({ outcome: "blocked" });
  assert(snapshot.counters.instrumentation_errors >= 3);
  assert.equal(snapshot.counters.clock_regressions, 1);
  assert.equal(snapshot.stage_durations_ms.policy_resolution, 0);
  assert(snapshot.coverage.counters.observed.includes("instrumentation_errors"));
  assert(snapshot.coverage.counters.observed.includes("clock_regressions"));
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshot).ok, true);
}

{
  const sink = createInMemoryGovernedExecutionBaselineSink({ max_samples: 2 });
  for (let index = 1; index <= 3; index += 1) {
    const trace = createGovernedExecutionBaselineTrace({
      trace_id: `trace-${index}`,
      entry_point: "benchmark_fixture",
    }, {
      clock: deterministicClock([index, index + 1]),
    });
    const snapshot = trace.finalize({ outcome: "success" });
    assert.equal(sink.emit(snapshot).ok, true);
  }
  assert.deepEqual(sink.read().map((snapshot) => snapshot.trace_id), ["trace-2", "trace-3"]);
  assert.deepEqual(sink.status(), {
    max_samples: 2,
    sample_count: 2,
    persistence: "process_lifetime_memory",
    secrets_included: false,
  });
  sink.clear();
  assert.equal(sink.status().sample_count, 0);
}

{
  const trace = createGovernedExecutionBaselineTrace({ entry_point: "gpt_tool" }, {
    traceIdFactory: () => "trace-emitter",
    clock: deterministicClock([1, 2]),
  });
  const snapshot = trace.finalize({ outcome: "success" });
  const noEmitter = await emitGovernedExecutionBaselineSnapshot(snapshot);
  assert.equal(noEmitter.ok, true);
  assert.equal(noEmitter.emitted, false);

  let emitted = null;
  const success = await emitGovernedExecutionBaselineSnapshot(snapshot, async (value) => {
    emitted = value;
  });
  assert.equal(success.ok, true);
  assert.equal(success.emitted, true);
  assert.equal(emitted, snapshot);

  const failed = await emitGovernedExecutionBaselineSnapshot(snapshot, async () => {
    const error = new Error("Bearer should-never-leak");
    error.code = "sink_unavailable";
    throw error;
  });
  assert.deepEqual(failed, {
    ok: false,
    emitted: false,
    code: "baseline_emitter_failed",
    error_code: "sink_unavailable",
    secrets_included: false,
  });
  assert.equal(JSON.stringify(failed).includes("should-never-leak"), false);
}

{
  const invalid = {
    schema_version: 1,
    telemetry_kind: "governed_execution_baseline",
    trace_id: "trace-invalid",
    entry_point: "gpt_tool",
    outcome: "success",
    stage_durations_ms: {},
    counters: {},
    coverage: {},
    total_ms: -1,
    total_stage_ms: 2,
    unattributed_ms: 0,
    overlap_ms: 0,
    secrets_included: true,
  };
  const validation = validateGovernedExecutionBaselineSnapshot(invalid);
  assert.equal(validation.ok, false);
  assert(validation.errors.includes("secrets_included_must_be_false"));
  assert(validation.errors.includes("stage_keys_invalid"));
  assert(validation.errors.includes("counter_keys_invalid"));
  assert(validation.errors.includes("stage_coverage_invalid"));
  assert(validation.errors.includes("counter_coverage_invalid"));
  assert(validation.errors.includes("total_ms_invalid"));
}

// X0 runtime-entrypoint adapters: disabled instrumentation is transparent.
{
  let nextCalls = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware();
  middleware({ method: "POST", path: "/gpt/tools/call", body: { name: "demo" } }, response(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
}

// GPT tool boundary: only bounded identifiers/counters are captured; arguments are never copied.
{
  const snapshots = [];
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async (snapshot) => snapshots.push(snapshot) });
  const res = response(200, "123");
  middleware({
    method: "POST",
    path: "/gpt/tools/call",
    headers: { "x-request-id": "req-x0-1", "x-correlation-id": "corr-x0-1" },
    body: { name: "response_chunk_read", arguments: { secret: "must-not-appear" } },
  }, res, () => {});
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot.entry_point, "gpt_tool");
  assert.equal(snapshot.request_id, "req-x0-1");
  assert.equal(snapshot.correlation_id, "corr-x0-1");
  assert.equal(snapshot.counters.tool_round_trips, 1);
  assert.equal(snapshot.counters.continuation_calls, 1);
  assert.equal(snapshot.counters.response_bytes, 123);
  assert.equal(snapshot.provider_call_made, null);
  assert.equal(JSON.stringify(snapshot).includes("must-not-appear"), false);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshot).ok, true);
}

// System tool boundary preserves explicit partial coverage rather than inventing zeroes.
{
  const snapshots = [];
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async (snapshot) => snapshots.push(snapshot) });
  const res = response(403, null);
  middleware({ method: "POST", path: "/system/tools/call", body: { name: "system_tool_get" } }, res, () => {});
  res.emit("close");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].entry_point, "system_tool");
  assert.equal(snapshots[0].outcome, "failure");
  assert.equal(snapshots[0].coverage.counters.observed.includes("response_bytes"), false);
  assert.equal(snapshots[0].coverage.stages.observed.length, 0);
}

// Unrelated routes and emitter failures remain behavior-neutral.
{
  let emitted = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async () => { emitted += 1; } });
  const res = response();
  middleware({ method: "GET", path: "/gpt/tools/call" }, res, () => {});
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted, 0);
}

{
  let nextCalls = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async () => { throw Object.assign(new Error("sink unavailable"), { code: "sink_unavailable" }); } });
  const res = response(200, "10");
  middleware({ method: "POST", path: "/admin/system/tools/call", body: { name: "system_tool_get" } }, res, () => { nextCalls += 1; });
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextCalls, 1);
}

// Agent-loop wrappers count only actual model/tool calls and preserve outputs.
{
  const snapshots = [];
  const callCounts = { model: 0, tool: 0 };
  const handle = createOptionalGovernedExecutionBaselineTrace({
    entry_point: "agent_loop",
    run_id: "run-x0-agent",
    plan_id: "plan-x0-agent",
  }, { emitter: async (snapshot) => snapshots.push(snapshot) });
  assert.ok(handle);
  const deps = instrumentAgentLoopDependencies({
    callModel: async (value) => { callCounts.model += 1; return { value }; },
    getCallModelForClass: () => async (value) => { callCounts.model += 1; return { class_value: value }; },
    engineExecutorRegistry: {
      marker: "preserved",
      dispatch: async (name, args) => { callCounts.tool += 1; return { ok: true, name, args }; },
    },
  }, handle.trace);
  assert.deepEqual(await deps.callModel("one"), { value: "one" });
  assert.deepEqual(await deps.getCallModelForClass("standard")("two"), { class_value: "two" });
  assert.deepEqual(await deps.engineExecutorRegistry.dispatch("engine.demo", { x: 1 }), { ok: true, name: "engine.demo", args: { x: 1 } });
  assert.equal(deps.engineExecutorRegistry.marker, "preserved");
  assert.equal(callCounts.model, 2);
  assert.equal(callCounts.tool, 1);
  await finalizeOptionalGovernedExecutionBaselineTrace(handle, { outcome: "success", result_classification: "agent_loop_fixture" });
  assert.equal(snapshots[0].counters.model_round_trips, 2);
  assert.equal(snapshots[0].counters.tool_round_trips, 1);
  assert.equal(snapshots[0].provider_call_made, null);
}

// MCP is the currently provable connector provider boundary: one dispatch == one provider call.
{
  const snapshots = [];
  const handle = createOptionalGovernedExecutionBaselineTrace({ entry_point: "connector_plan", plan_id: "plan-x0-mcp" }, { emitter: async (snapshot) => snapshots.push(snapshot) });
  observeMcpProviderDispatch(handle.trace);
  await finalizeOptionalGovernedExecutionBaselineTrace(handle, { outcome: "success", result_classification: "mcp_connector" });
  assert.equal(snapshots[0].counters.provider_calls, 1);
  assert.equal(snapshots[0].provider_call_made, true);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshots[0]).ok, true);
}

console.log("governed execution baseline telemetry tests passed");
