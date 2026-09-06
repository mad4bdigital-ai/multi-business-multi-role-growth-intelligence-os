import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createGovernedExecutionBaselineHttpMiddleware,
  createOptionalGovernedExecutionBaselineTrace,
  finalizeOptionalGovernedExecutionBaselineTrace,
  instrumentAgentLoopDependencies,
  observeMcpProviderDispatch,
} from "./governedExecutionBaselineRuntime.js";
import { validateGovernedExecutionBaselineSnapshot } from "./governedExecutionBaselineTelemetry.js";

function response(statusCode = 200, contentLength = null) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.getHeader = (name) => String(name).toLowerCase() === "content-length" ? contentLength : undefined;
  return res;
}

{
  let nextCalls = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware();
  middleware({ method: "POST", path: "/gpt/tools/call", body: { name: "demo" } }, response(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1, "disabled instrumentation must be transparent");
}

{
  const snapshots = [];
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async (snapshot) => snapshots.push(snapshot) });
  const res = response(200, "123");
  let nextCalls = 0;
  middleware({
    method: "POST",
    path: "/gpt/tools/call",
    headers: { "x-request-id": "req-x0-1", "x-correlation-id": "corr-x0-1" },
    body: { name: "response_chunk_read", arguments: { secret: "must-not-appear" } },
  }, res, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
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
  assert.equal(snapshot.secrets_included, false);
  assert.equal(JSON.stringify(snapshot).includes("must-not-appear"), false);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshot).ok, true);
}

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

{
  let emitted = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async () => { emitted += 1; } });
  const res = response();
  middleware({ method: "GET", path: "/gpt/tools/call" }, res, () => {});
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted, 0, "unrelated routes must not emit X0 samples");
}

{
  let nextCalls = 0;
  const middleware = createGovernedExecutionBaselineHttpMiddleware({ emitter: async () => { throw Object.assign(new Error("sink unavailable"), { code: "sink_unavailable" }); } });
  const res = response(200, "10");
  middleware({ method: "POST", path: "/admin/system/tools/call", body: { name: "system_tool_get" } }, res, () => { nextCalls += 1; });
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nextCalls, 1, "emitter failure must not fail the measured request");
}

{
  const snapshots = [];
  let modelCalls = 0;
  let toolCalls = 0;
  const handle = createOptionalGovernedExecutionBaselineTrace({
    entry_point: "agent_loop",
    run_id: "run-x0-agent",
    plan_id: "plan-x0-agent",
  }, { emitter: async (snapshot) => snapshots.push(snapshot) });
  assert.ok(handle);

  const deps = instrumentAgentLoopDependencies({
    callModel: async (value) => { modelCalls += 1; return { value }; },
    getCallModelForClass: () => async (value) => { modelCalls += 1; return { class_value: value }; },
    engineExecutorRegistry: {
      marker: "preserved",
      dispatch: async (name, args) => { toolCalls += 1; return { ok: true, name, args }; },
    },
  }, handle.trace);

  assert.deepEqual(await deps.callModel("one"), { value: "one" });
  assert.deepEqual(await deps.getCallModelForClass("standard")("two"), { class_value: "two" });
  assert.deepEqual(await deps.engineExecutorRegistry.dispatch("engine.demo", { x: 1 }), { ok: true, name: "engine.demo", args: { x: 1 } });
  assert.equal(deps.engineExecutorRegistry.marker, "preserved");
  assert.equal(modelCalls, 2);
  assert.equal(toolCalls, 1);

  await finalizeOptionalGovernedExecutionBaselineTrace(handle, { outcome: "success", result_classification: "agent_loop_fixture" });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].entry_point, "agent_loop");
  assert.equal(snapshots[0].counters.model_round_trips, 2);
  assert.equal(snapshots[0].counters.tool_round_trips, 1);
  assert.equal(snapshots[0].provider_call_made, null);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshots[0]).ok, true);
}

{
  const snapshots = [];
  const handle = createOptionalGovernedExecutionBaselineTrace({ entry_point: "connector_plan", plan_id: "plan-x0-mcp" }, { emitter: async (snapshot) => snapshots.push(snapshot) });
  observeMcpProviderDispatch(handle.trace);
  await finalizeOptionalGovernedExecutionBaselineTrace(handle, { outcome: "success", result_classification: "mcp_connector" });
  assert.equal(snapshots[0].counters.provider_calls, 1);
  assert.equal(snapshots[0].provider_call_made, true);
  assert.equal(validateGovernedExecutionBaselineSnapshot(snapshots[0]).ok, true);
}

console.log(JSON.stringify({
  ok: true,
  test: "governed-execution-x0-runtime-entrypoints",
  passive_when_disabled: true,
  gpt_tool_boundary: true,
  system_tool_boundary: true,
  agent_loop_exact_round_trip_counts: true,
  mcp_provider_call_exact_count: true,
  secrets_included: false,
}, null, 2));
