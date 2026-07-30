import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export const GOVERNED_EXECUTION_BASELINE_SCHEMA_VERSION = 1;

export const GOVERNED_EXECUTION_BASELINE_ENTRY_POINTS = Object.freeze([
  "gpt_tool",
  "system_tool",
  "connector_plan",
  "sequential_plan",
  "agent_loop",
  "internal_worker",
  "benchmark_fixture",
  "unknown",
]);

export const GOVERNED_EXECUTION_BASELINE_STAGES = Object.freeze([
  "intent_resolution",
  "descriptor_resolution",
  "context_resolution",
  "policy_resolution",
  "approval_wait",
  "provider_dispatch",
  "readback",
  "ledger",
  "projection",
]);

export const GOVERNED_EXECUTION_BASELINE_COUNTERS = Object.freeze([
  "sql_queries",
  "provider_calls",
  "internal_http_hops",
  "model_round_trips",
  "tool_round_trips",
  "continuation_calls",
  "plan_steps",
  "ready_set_width",
  "critical_path_steps",
  "response_bytes",
  "instrumentation_errors",
  "clock_regressions",
]);

const ENTRY_POINT_SET = new Set(GOVERNED_EXECUTION_BASELINE_ENTRY_POINTS);
const STAGE_SET = new Set(GOVERNED_EXECUTION_BASELINE_STAGES);
const COUNTER_SET = new Set(GOVERNED_EXECUTION_BASELINE_COUNTERS);
const OUTCOME_SET = new Set([
  "success",
  "failure",
  "blocked",
  "awaiting_approval",
  "interpretation_required",
  "unknown_outcome",
  "cancelled",
  "running",
  "unknown",
]);

const MAX_COUNTER_VALUE = 1_000_000_000;
const MAX_IDENTIFIER_LENGTH = 191;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /Bearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|credential|authorization|cookie|session)=/iu,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
]);

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMilliseconds(value) {
  return Number(Math.max(0, safeNumber(value)).toFixed(3));
}

function boundedCounterValue(value) {
  return Math.max(0, Math.min(MAX_COUNTER_VALUE, Math.floor(safeNumber(value))));
}

function looksSecret(value) {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(String(value || "")));
}

function safeIdentifier(value, fallback = null) {
  const normalized = String(value ?? "").trim().slice(0, MAX_IDENTIFIER_LENGTH);
  if (!normalized || !SAFE_IDENTIFIER_PATTERN.test(normalized) || looksSecret(normalized)) return fallback;
  return normalized;
}

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function frozenSorted(values) {
  return Object.freeze([...values].sort());
}

function nowFrom(clock) {
  const observed = safeNumber(clock(), 0);
  return observed >= 0 ? observed : 0;
}

function normalizedEntryPoint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ENTRY_POINT_SET.has(normalized) ? normalized : "unknown";
}

function normalizedOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return OUTCOME_SET.has(normalized) ? normalized : "unknown";
}

function initialCounters() {
  return Object.fromEntries(GOVERNED_EXECUTION_BASELINE_COUNTERS.map((key) => [key, 0]));
}

function initialStageDurations() {
  return Object.fromEntries(GOVERNED_EXECUTION_BASELINE_STAGES.map((key) => [key, 0]));
}

function totalStageMilliseconds(stageDurations) {
  return roundMilliseconds(Object.values(stageDurations).reduce((total, value) => total + safeNumber(value), 0));
}

function coveragePartition(allKeys, observed) {
  const observedKeys = allKeys.filter((key) => observed.has(key));
  const unobservedKeys = allKeys.filter((key) => !observed.has(key));
  return Object.freeze({
    observed: frozenSorted(observedKeys),
    unobserved: frozenSorted(unobservedKeys),
  });
}

function validCoveragePartition(partition, allowedKeys) {
  if (!partition || !Array.isArray(partition.observed) || !Array.isArray(partition.unobserved)) return false;
  const combined = [...partition.observed, ...partition.unobserved];
  if (new Set(combined).size !== combined.length) return false;
  if (combined.some((key) => !allowedKeys.has(key))) return false;
  return combined.length === allowedKeys.size;
}

export function createGovernedExecutionBaselineTrace(input = {}, dependencies = {}) {
  const clock = typeof dependencies.clock === "function" ? dependencies.clock : () => performance.now();
  const generatedTraceId = safeIdentifier(dependencies.traceIdFactory?.()) || randomUUID();
  const traceId = safeIdentifier(input.trace_id || input.traceId, generatedTraceId);
  const requestId = safeIdentifier(input.request_id || input.requestId);
  const correlationId = safeIdentifier(
    input.correlation_id || input.correlationId,
    requestId || traceId,
  );
  const operationId = safeIdentifier(input.operation_id || input.operationId);
  const planId = safeIdentifier(input.plan_id || input.planId);
  const runId = safeIdentifier(input.run_id || input.runId);
  const stepId = safeIdentifier(input.step_id || input.stepId);
  const entryPoint = normalizedEntryPoint(input.entry_point || input.entryPoint);
  const startedAt = nowFrom(clock);
  const counters = initialCounters();
  const stageDurations = initialStageDurations();
  const observedStages = new Set();
  const observedCounters = new Set();
  const activeStages = new Map();
  let finalizedSnapshot = null;

  function recordInstrumentationError() {
    observedCounters.add("instrumentation_errors");
    counters.instrumentation_errors = boundedCounterValue(counters.instrumentation_errors + 1);
  }

  function observeCounter(counter) {
    if (finalizedSnapshot || !COUNTER_SET.has(counter)) {
      recordInstrumentationError();
      return false;
    }
    observedCounters.add(counter);
    return true;
  }

  function increment(counter, amount = 1) {
    if (!observeCounter(counter)) return false;
    counters[counter] = boundedCounterValue(counters[counter] + safeNumber(amount));
    return true;
  }

  function startStage(stage) {
    if (finalizedSnapshot || !STAGE_SET.has(stage) || activeStages.has(stage)) {
      recordInstrumentationError();
      return () => false;
    }
    observedStages.add(stage);
    const stageStartedAt = nowFrom(clock);
    activeStages.set(stage, stageStartedAt);
    let completed = false;
    return () => {
      if (completed || finalizedSnapshot) {
        recordInstrumentationError();
        return false;
      }
      completed = true;
      const observedAt = nowFrom(clock);
      const elapsed = observedAt - stageStartedAt;
      if (elapsed < 0) increment("clock_regressions");
      stageDurations[stage] = roundMilliseconds(stageDurations[stage] + Math.max(0, elapsed));
      activeStages.delete(stage);
      return true;
    };
  }

  function finalize(output = {}) {
    if (finalizedSnapshot) return finalizedSnapshot;
    const finishedAt = nowFrom(clock);
    for (const [stage, stageStartedAt] of activeStages.entries()) {
      const elapsed = finishedAt - stageStartedAt;
      if (elapsed < 0) {
        observedCounters.add("clock_regressions");
        counters.clock_regressions = boundedCounterValue(counters.clock_regressions + 1);
      }
      stageDurations[stage] = roundMilliseconds(stageDurations[stage] + Math.max(0, elapsed));
    }
    activeStages.clear();

    const totalMs = roundMilliseconds(Math.max(0, finishedAt - startedAt));
    const stagesMs = totalStageMilliseconds(stageDurations);
    const unattributedMs = roundMilliseconds(Math.max(0, totalMs - stagesMs));
    const overlapMs = roundMilliseconds(Math.max(0, stagesMs - totalMs));
    const responseBytes = output.response_bytes ?? output.responseBytes;
    if (responseBytes !== undefined) {
      observedCounters.add("response_bytes");
      counters.response_bytes = boundedCounterValue(responseBytes);
    }

    finalizedSnapshot = Object.freeze({
      schema_version: GOVERNED_EXECUTION_BASELINE_SCHEMA_VERSION,
      telemetry_kind: "governed_execution_baseline",
      trace_id: traceId,
      request_id: requestId,
      correlation_id: correlationId,
      operation_id: operationId,
      plan_id: planId,
      run_id: runId,
      step_id: stepId,
      entry_point: entryPoint,
      outcome: normalizedOutcome(output.outcome),
      result_classification: safeIdentifier(
        output.result_classification || output.resultClassification,
        "unclassified",
      ),
      stage_durations_ms: freezeRecord(stageDurations),
      total_stage_ms: stagesMs,
      total_ms: totalMs,
      unattributed_ms: unattributedMs,
      overlap_ms: overlapMs,
      counters: freezeRecord(counters),
      coverage: Object.freeze({
        stages: coveragePartition(GOVERNED_EXECUTION_BASELINE_STAGES, observedStages),
        counters: coveragePartition(GOVERNED_EXECUTION_BASELINE_COUNTERS, observedCounters),
      }),
      provider_call_made: observedCounters.has("provider_calls")
        ? counters.provider_calls > 0
        : null,
      secrets_included: false,
    });
    return finalizedSnapshot;
  }

  return Object.freeze({
    trace_id: traceId,
    request_id: requestId,
    correlation_id: correlationId,
    operation_id: operationId,
    plan_id: planId,
    run_id: runId,
    step_id: stepId,
    entry_point: entryPoint,
    increment,
    observeCounter,
    startStage,
    finalize,
    snapshot: () => finalizedSnapshot,
  });
}

export function validateGovernedExecutionBaselineSnapshot(snapshot = {}) {
  const errors = [];
  if (snapshot.schema_version !== GOVERNED_EXECUTION_BASELINE_SCHEMA_VERSION) errors.push("schema_version_invalid");
  if (snapshot.telemetry_kind !== "governed_execution_baseline") errors.push("telemetry_kind_invalid");
  if (!safeIdentifier(snapshot.trace_id)) errors.push("trace_id_invalid");
  if (!ENTRY_POINT_SET.has(snapshot.entry_point)) errors.push("entry_point_invalid");
  if (!OUTCOME_SET.has(snapshot.outcome)) errors.push("outcome_invalid");
  if (snapshot.secrets_included !== false) errors.push("secrets_included_must_be_false");

  const stageKeys = Object.keys(snapshot.stage_durations_ms || {}).sort();
  const expectedStageKeys = [...GOVERNED_EXECUTION_BASELINE_STAGES].sort();
  if (JSON.stringify(stageKeys) !== JSON.stringify(expectedStageKeys)) errors.push("stage_keys_invalid");
  for (const value of Object.values(snapshot.stage_durations_ms || {})) {
    if (!Number.isFinite(value) || value < 0) errors.push("stage_duration_invalid");
  }

  const counterKeys = Object.keys(snapshot.counters || {}).sort();
  const expectedCounterKeys = [...GOVERNED_EXECUTION_BASELINE_COUNTERS].sort();
  if (JSON.stringify(counterKeys) !== JSON.stringify(expectedCounterKeys)) errors.push("counter_keys_invalid");
  for (const value of Object.values(snapshot.counters || {})) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_COUNTER_VALUE) errors.push("counter_value_invalid");
  }

  if (!validCoveragePartition(snapshot.coverage?.stages, STAGE_SET)) errors.push("stage_coverage_invalid");
  if (!validCoveragePartition(snapshot.coverage?.counters, COUNTER_SET)) errors.push("counter_coverage_invalid");
  if (!Number.isFinite(snapshot.total_ms) || snapshot.total_ms < 0) errors.push("total_ms_invalid");
  if (!Number.isFinite(snapshot.total_stage_ms) || snapshot.total_stage_ms < 0) errors.push("total_stage_ms_invalid");
  if (!Number.isFinite(snapshot.unattributed_ms) || snapshot.unattributed_ms < 0) errors.push("unattributed_ms_invalid");
  if (!Number.isFinite(snapshot.overlap_ms) || snapshot.overlap_ms < 0) errors.push("overlap_ms_invalid");
  const reconciled = roundMilliseconds(snapshot.total_stage_ms + snapshot.unattributed_ms - snapshot.overlap_ms);
  if (Math.abs(reconciled - snapshot.total_ms) > 0.002) errors.push("timing_reconciliation_invalid");
  if (looksSecret(JSON.stringify(snapshot))) errors.push("secret_like_value_detected");

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    secrets_included: false,
  });
}

export function createInMemoryGovernedExecutionBaselineSink(options = {}) {
  const maxSamples = Math.max(1, Math.min(10_000, Math.floor(safeNumber(options.max_samples || options.maxSamples, 500))));
  const samples = [];

  return Object.freeze({
    emit(snapshot) {
      const validation = validateGovernedExecutionBaselineSnapshot(snapshot);
      if (!validation.ok) return Object.freeze({ ok: false, code: "baseline_snapshot_invalid", validation });
      samples.push(snapshot);
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
      return Object.freeze({ ok: true, stored: true, sample_count: samples.length, secrets_included: false });
    },
    read() {
      return Object.freeze([...samples]);
    },
    clear() {
      samples.length = 0;
    },
    status() {
      return Object.freeze({
        max_samples: maxSamples,
        sample_count: samples.length,
        persistence: "process_lifetime_memory",
        secrets_included: false,
      });
    },
  });
}

export async function emitGovernedExecutionBaselineSnapshot(snapshot, emitter) {
  const validation = validateGovernedExecutionBaselineSnapshot(snapshot);
  if (!validation.ok) {
    return Object.freeze({
      ok: false,
      emitted: false,
      code: "baseline_snapshot_invalid",
      validation,
      secrets_included: false,
    });
  }
  if (typeof emitter !== "function") {
    return Object.freeze({
      ok: true,
      emitted: false,
      code: "baseline_emitter_not_configured",
      secrets_included: false,
    });
  }
  try {
    await emitter(snapshot);
    return Object.freeze({
      ok: true,
      emitted: true,
      code: "baseline_snapshot_emitted",
      secrets_included: false,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      emitted: false,
      code: "baseline_emitter_failed",
      error_code: safeIdentifier(error?.code, "baseline_emitter_error"),
      secrets_included: false,
    });
  }
}
