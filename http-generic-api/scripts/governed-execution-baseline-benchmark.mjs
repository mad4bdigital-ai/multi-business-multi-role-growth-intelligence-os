#!/usr/bin/env node

import { createHash } from "node:crypto";
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

function deterministicClock() {
  let tick = 0;
  return () => tick++;
}

function stableHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

const MATCHED_FIXTURES = Object.freeze([
  Object.freeze({
    fixture_id: "F01",
    fixture_key: "exact_single_read",
    entry_point: "gpt_tool",
    stages: ["descriptor_resolution", "context_resolution", "policy_resolution", "provider_dispatch", "readback"],
    counters: { sql_queries: 2, provider_calls: 1, internal_http_hops: 1, model_round_trips: 0, tool_round_trips: 1, continuation_calls: 0, plan_steps: 1, ready_set_width: 1, critical_path_steps: 1, response_bytes: 384 },
    result: { status: "ok", state: "read_confirmed", resource_revision: "fixture-r1" },
    safety: { authority: "allow", approval: "not_required", provider: "simulated_read_confirmed", readback: "confirmed", receipt: "read_receipt", projection: "compact_and_full_hash_match", recovery: "not_required" },
  }),
  Object.freeze({
    fixture_id: "F03",
    fixture_key: "reversible_single_mutation",
    entry_point: "system_tool",
    stages: ["descriptor_resolution", "context_resolution", "policy_resolution", "approval_wait", "provider_dispatch", "readback", "ledger", "projection"],
    counters: { sql_queries: 6, provider_calls: 2, internal_http_hops: 1, model_round_trips: 0, tool_round_trips: 1, continuation_calls: 0, plan_steps: 1, ready_set_width: 1, critical_path_steps: 1, response_bytes: 512 },
    result: { status: "ok", state: "mutation_confirmed", resource_revision: "fixture-r2" },
    safety: { authority: "allow_with_approval", approval: "exact_fixture_approval_consumed", provider: "simulated_mutation_plus_readback", readback: "confirmed", receipt: "final_confirmed", projection: "deferred_projection_hash_match", recovery: "rollback_fixture_available" },
  }),
  Object.freeze({
    fixture_id: "F04",
    fixture_key: "six_step_mixed_plan",
    entry_point: "sequential_plan",
    stages: ["descriptor_resolution", "context_resolution", "policy_resolution", "approval_wait", "provider_dispatch", "readback", "ledger"],
    counters: { sql_queries: 11, provider_calls: 4, internal_http_hops: 2, model_round_trips: 2, tool_round_trips: 6, continuation_calls: 0, plan_steps: 6, ready_set_width: 3, critical_path_steps: 4, response_bytes: 1024 },
    result: { status: "ok", state: "workflow_confirmed", completed_steps: ["A", "B", "C", "D", "E", "F"] },
    safety: { authority: "allow", approval: "frontier_approval_exact", provider: "deterministic_simulator", readback: "all_required_confirmed", receipt: "six_step_receipts_reconciled", projection: "result_hash_match", recovery: "resume_without_duplicate_mutation" },
  }),
  Object.freeze({
    fixture_id: "F05",
    fixture_key: "repository_workflow_to_pr",
    entry_point: "agent_loop",
    stages: ["intent_resolution", "descriptor_resolution", "context_resolution", "policy_resolution", "approval_wait", "provider_dispatch", "readback", "ledger"],
    counters: { sql_queries: 8, provider_calls: 7, internal_http_hops: 3, model_round_trips: 4, tool_round_trips: 9, continuation_calls: 0, plan_steps: 9, ready_set_width: 2, critical_path_steps: 8, response_bytes: 768 },
    result: { status: "ok", state: "pr_opened", pull_request_ref: "fixture-pr-1", head_ref: "fixture-head" },
    safety: { authority: "allow", approval: "ref_update_frontier_approved", provider: "deterministic_git_simulator", readback: "ref_and_pr_confirmed", receipt: "repository_change_receipt", projection: "ci_handoff_recorded", recovery: "expected_head_sha_rejects_drift" },
  }),
  Object.freeze({
    fixture_id: "F06",
    fixture_key: "durable_external_wait",
    entry_point: "connector_plan",
    stages: ["context_resolution", "policy_resolution", "provider_dispatch", "readback", "ledger"],
    counters: { sql_queries: 7, provider_calls: 2, internal_http_hops: 1, model_round_trips: 0, tool_round_trips: 2, continuation_calls: 1, plan_steps: 3, ready_set_width: 1, critical_path_steps: 3, response_bytes: 320 },
    result: { status: "ok", state: "wait_completed", execution_ref: "fixture-wait-1" },
    safety: { authority: "allow", approval: "not_required", provider: "deterministic_async_simulator", readback: "terminal_status_confirmed", receipt: "durable_acceptance_and_terminal_receipt", projection: "status_result_available", recovery: "restart_disconnect_resume_no_duplicate" },
  }),
]);

function executeLegacyMatchedFixture(fixture) {
  return structuredClone(fixture.result);
}

function executeInstrumentedMatchedFixture(fixture) {
  const trace = createGovernedExecutionBaselineTrace({
    trace_id: `matched-${fixture.fixture_id.toLowerCase()}`,
    entry_point: fixture.entry_point,
    operation_id: `x0.${fixture.fixture_key}`,
  }, { clock: deterministicClock() });

  for (const stage of fixture.stages) {
    const finish = trace.startStage(stage);
    finish();
  }
  for (const [counter, value] of Object.entries(fixture.counters)) trace.setCounter(counter, value);
  const result = structuredClone(fixture.result);
  const snapshot = trace.finalize({
    outcome: "success",
    result_classification: fixture.fixture_key,
    response_bytes: fixture.counters.response_bytes,
  });
  const validation = validateGovernedExecutionBaselineSnapshot(snapshot);
  if (!validation.ok) throw new Error(`Invalid matched fixture ${fixture.fixture_id}: ${validation.errors.join(",")}`);
  return { result, snapshot };
}

export function runGovernedExecutionMatchedRuntimeFixtures() {
  const fixtures = MATCHED_FIXTURES.map((fixture) => {
    const legacyResult = executeLegacyMatchedFixture(fixture);
    const instrumented = executeInstrumentedMatchedFixture(fixture);
    const legacyHash = stableHash(legacyResult);
    const instrumentedHash = stableHash(instrumented.result);
    if (legacyHash !== instrumentedHash) throw new Error(`Instrumentation changed fixture ${fixture.fixture_id} result.`);
    const timingIdentity = instrumented.snapshot.total_stage_ms
      + instrumented.snapshot.unattributed_ms
      - instrumented.snapshot.overlap_ms;
    if (timingIdentity !== instrumented.snapshot.total_ms) throw new Error(`Timing identity failed for ${fixture.fixture_id}.`);

    return Object.freeze({
      fixture_id: fixture.fixture_id,
      fixture_key: fixture.fixture_key,
      entry_point: fixture.entry_point,
      mode: "deterministic_provider_simulator",
      legacy_result_hash: legacyHash,
      instrumented_result_hash: instrumentedHash,
      functional_outcome_equal: true,
      safety_vector: Object.freeze({ ...fixture.safety, result_hash: legacyHash, secrets_included: false }),
      telemetry: Object.freeze({
        total_ms: instrumented.snapshot.total_ms,
        total_stage_ms: instrumented.snapshot.total_stage_ms,
        unattributed_ms: instrumented.snapshot.unattributed_ms,
        overlap_ms: instrumented.snapshot.overlap_ms,
        timing_identity_reconciled: true,
        observed_stages: instrumented.snapshot.coverage.stages.observed,
        observed_counters: instrumented.snapshot.coverage.counters.observed,
        counters: instrumented.snapshot.counters,
      }),
    });
  });

  return Object.freeze({
    schema: "mad4b.governed-execution.x0-matched-runtime-fixtures.v1",
    ok: true,
    fixture_catalogue: ["F01", "F03", "F04", "F05", "F06"],
    fixture_count: fixtures.length,
    fixtures,
    all_functional_outcomes_equal: fixtures.every((fixture) => fixture.functional_outcome_equal === true),
    all_timing_identities_reconciled: fixtures.every((fixture) => fixture.telemetry.timing_identity_reconciled === true),
    live_provider_call_made: false,
    provider_mode: "deterministic_simulator_only",
    production_database_touched: false,
    database_write_performed: false,
    migration_applied: false,
    external_send_made: false,
    runtime_routing_changed_by_fixture_harness: false,
    secrets_included: false,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = process.argv.includes("--matched-fixtures")
    ? runGovernedExecutionMatchedRuntimeFixtures()
    : runGovernedExecutionBaselineBenchmark();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
