import assert from "node:assert/strict";
import { runGovernedExecutionBaselineBenchmark } from "./scripts/governed-execution-baseline-benchmark.mjs";

const report = runGovernedExecutionBaselineBenchmark({
  warmup: 20,
  iterations: 150,
});

assert.equal(report.ok, true);
assert.equal(report.benchmark_key, "governed_execution_x0_collector_overhead_v1");
assert.equal(report.mode, "isolated_process_memory");
assert.equal(report.legacy_result_unchanged, true);
assert.equal(report.production_database_touched, false);
assert.equal(report.provider_call_made, false);
assert.equal(report.external_send_made, false);
assert.equal(report.baseline.samples, 150);
assert.equal(report.instrumented.samples, 150);
assert(Number.isFinite(report.baseline.mean_ms));
assert(Number.isFinite(report.instrumented.mean_ms));
assert(Number.isFinite(report.comparison.mean_overhead_ms));
assert.equal(report.sample_contract.schema_version, 1);
assert.equal(report.sample_contract.telemetry_kind, "governed_execution_baseline");
assert.equal(report.sample_contract.stage_key_count, 9);
assert.equal(report.sample_contract.counter_key_count, 12);
assert.equal(report.sample_contract.secrets_included, false);
assert.equal(report.secrets_included, false);

console.log("governed execution baseline benchmark tests passed");
