import assert from "node:assert/strict";
import {
  GOVERNED_EXECUTION_BASELINE_COUNTERS,
  GOVERNED_EXECUTION_BASELINE_STAGES,
  createGovernedExecutionBaselineTrace,
  createInMemoryGovernedExecutionBaselineSink,
  emitGovernedExecutionBaselineSnapshot,
  validateGovernedExecutionBaselineSnapshot,
} from "./governedExecutionBaselineTelemetry.js";

function deterministicClock(values) {
  const queue = [...values];
  return () => {
    assert(queue.length > 0, "deterministic clock exhausted");
    return queue.shift();
  };
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
  assert.equal(snapshot.instrumentation_overhead_ms, 10);
  assert.equal(snapshot.counters.sql_queries, 4);
  assert.equal(snapshot.counters.provider_calls, 1);
  assert.equal(snapshot.counters.plan_steps, 6);
  assert.equal(snapshot.counters.ready_set_width, 3);
  assert.equal(snapshot.counters.critical_path_steps, 4);
  assert.equal(snapshot.counters.response_bytes, 2048);
  assert.equal(snapshot.provider_call_made, true);
  assert.equal(snapshot.secrets_included, false);
  assert(Object.isFrozen(snapshot));
  assert(Object.isFrozen(snapshot.stage_durations_ms));
  assert(Object.isFrozen(snapshot.counters));
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
    total_ms: -1,
    total_stage_ms: 2,
    secrets_included: true,
  };
  const validation = validateGovernedExecutionBaselineSnapshot(invalid);
  assert.equal(validation.ok, false);
  assert(validation.errors.includes("secrets_included_must_be_false"));
  assert(validation.errors.includes("stage_keys_invalid"));
  assert(validation.errors.includes("counter_keys_invalid"));
  assert(validation.errors.includes("total_ms_invalid"));
}

console.log("governed execution baseline telemetry tests passed");
