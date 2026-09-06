import assert from "node:assert/strict";
import {
  runGovernedExecutionBaselineBenchmark,
  runGovernedExecutionMatchedRuntimeFixtures,
} from "./scripts/governed-execution-baseline-benchmark.mjs";

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

const matched = runGovernedExecutionMatchedRuntimeFixtures();
assert.equal(matched.ok, true);
assert.equal(matched.schema, "mad4b.governed-execution.x0-matched-runtime-fixtures.v1");
assert.deepEqual(matched.fixture_catalogue, ["F01", "F03", "F04", "F05", "F06"]);
assert.equal(matched.fixture_count, 5);
assert.equal(matched.all_functional_outcomes_equal, true);
assert.equal(matched.all_timing_identities_reconciled, true);
assert.equal(matched.live_provider_call_made, false);
assert.equal(matched.provider_mode, "deterministic_simulator_only");
assert.equal(matched.production_database_touched, false);
assert.equal(matched.database_write_performed, false);
assert.equal(matched.migration_applied, false);
assert.equal(matched.external_send_made, false);
assert.equal(matched.runtime_routing_changed_by_fixture_harness, false);
assert.equal(matched.secrets_included, false);

for (const fixture of matched.fixtures) {
  assert.equal(fixture.functional_outcome_equal, true, `${fixture.fixture_id} legacy/instrumented result mismatch`);
  assert.equal(fixture.legacy_result_hash, fixture.instrumented_result_hash);
  assert.match(fixture.legacy_result_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fixture.safety_vector.result_hash, fixture.legacy_result_hash);
  assert.equal(fixture.safety_vector.secrets_included, false);
  assert.equal(fixture.telemetry.timing_identity_reconciled, true);
  assert.equal(
    fixture.telemetry.total_stage_ms + fixture.telemetry.unattributed_ms - fixture.telemetry.overlap_ms,
    fixture.telemetry.total_ms,
  );
  assert.ok(fixture.telemetry.observed_stages.length > 0);
  assert.ok(fixture.telemetry.observed_counters.length > 0);
}

console.log("governed execution baseline benchmark tests passed");