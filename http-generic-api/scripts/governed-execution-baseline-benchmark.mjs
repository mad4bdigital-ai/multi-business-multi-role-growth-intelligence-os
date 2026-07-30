#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import {
  createGovernedExecutionBaselineTrace,
  validateGovernedExecutionBaselineSnapshot,
} from "../governedExecutionBaselineTelemetry.js";

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number(sorted[index].toFixed(6));
}

function statistics(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    mean_ms: values.length ? Number((total / values.length).toFixed(6)) : null,
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    max_ms: values.length ? Number(Math.max(...values).toFixed(6)) : null,
  };
}

function baselineFixture(iteration) {
  let checksum = 0;
  for (let index = 0; index < 25; index += 1) checksum += (iteration + index) % 17;
  return checksum;
}

function instrumentedFixture(iteration) {
  const trace = createGovernedExecutionBaselineTrace({
    trace_id: `benchmark-${iteration}`,
    entry_point: "benchmark_fixture",
    operation_id: "x0.fixture",
  });
  const finishDescriptor = trace.startStage("descriptor_resolution");
  let checksum = 0;
  for (let index = 0; index < 10; index += 1) checksum += (iteration + index) % 17;
  finishDescriptor();

  const finishPolicy = trace.startStage("policy_resolution");
  for (let index = 10; index < 20; index += 1) checksum += (iteration + index) % 17;
  trace.increment("sql_queries", 3);
  finishPolicy();

  const finishReadback = trace.startStage("readback");
  for (let index = 20; index < 25; index += 1) checksum += (iteration + index) % 17;
  trace.increment("provider_calls", 1);
  trace.increment("plan_steps", 3);
  trace.increment("critical_path_steps", 2);
  finishReadback();

  const snapshot = trace.finalize({
    outcome: "success",
    result_classification: "benchmark_only",
    response_bytes: 256,
  });
  const validation = validateGovernedExecutionBaselineSnapshot(snapshot);
  if (!validation.ok) throw new Error(`Generated invalid benchmark snapshot: ${validation.errors.join(",")}`);
  return { checksum, snapshot };
}

export function runGovernedExecutionBaselineBenchmark(input = {}) {
  const warmup = boundedInteger(input.warmup ?? process.env.X0_BENCHMARK_WARMUP, 250, 10, 10_000);
  const iterations = boundedInteger(input.iterations ?? process.env.X0_BENCHMARK_ITERATIONS, 2_000, 100, 50_000);

  for (let index = 0; index < warmup; index += 1) {
    baselineFixture(index);
    instrumentedFixture(index);
  }

  const baselineSamples = [];
  const instrumentedSamples = [];
  let baselineChecksum = 0;
  let instrumentedChecksum = 0;
  let lastSnapshot = null;

  for (let index = 0; index < iterations; index += 1) {
    const baselineStartedAt = performance.now();
    baselineChecksum += baselineFixture(index);
    baselineSamples.push(performance.now() - baselineStartedAt);

    const instrumentedStartedAt = performance.now();
    const observed = instrumentedFixture(index);
    instrumentedChecksum += observed.checksum;
    lastSnapshot = observed.snapshot;
    instrumentedSamples.push(performance.now() - instrumentedStartedAt);
  }

  if (baselineChecksum !== instrumentedChecksum) {
    throw new Error("Instrumented benchmark changed the legacy fixture result.");
  }

  const baseline = statistics(baselineSamples);
  const instrumented = statistics(instrumentedSamples);
  const overheadMeanMs = instrumented.mean_ms === null || baseline.mean_ms === null
    ? null
    : Number((instrumented.mean_ms - baseline.mean_ms).toFixed(6));
  const overheadRatio = baseline.mean_ms > 0
    ? Number(((instrumented.mean_ms - baseline.mean_ms) / baseline.mean_ms).toFixed(6))
    : null;

  return Object.freeze({
    ok: true,
    benchmark_key: "governed_execution_x0_collector_overhead_v1",
    mode: "isolated_process_memory",
    warmup,
    iterations,
    legacy_result_unchanged: true,
    production_database_touched: false,
    provider_call_made: false,
    external_send_made: false,
    baseline,
    instrumented,
    comparison: {
      mean_overhead_ms: overheadMeanMs,
      mean_overhead_ratio: overheadRatio,
    },
    sample_contract: {
      schema_version: lastSnapshot?.schema_version || null,
      telemetry_kind: lastSnapshot?.telemetry_kind || null,
      stage_key_count: Object.keys(lastSnapshot?.stage_durations_ms || {}).length,
      counter_key_count: Object.keys(lastSnapshot?.counters || {}).length,
      secrets_included: false,
    },
    secrets_included: false,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runGovernedExecutionBaselineBenchmark();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
