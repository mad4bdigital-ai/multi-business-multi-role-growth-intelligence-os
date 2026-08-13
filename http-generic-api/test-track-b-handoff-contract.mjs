import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(relative) {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const handoff = readJson("../docs/agent-tracks/track-b-handoff.json");
const migration = readJson("../docs/agent-tracks/track-b-migration-checksum-readback-manifest.json");
const dryRun = readJson("../docs/agent-tracks/track-b-dry-run-evidence.json");
const rollback = readJson("../docs/agent-tracks/track-b-rollback-matrix.json");
const completion018 = readJson("../specs/018-environment-promotion-runtime-integrity/completion.json");
const completion019 = readJson("../specs/019-governed-database-lifecycle-pressure-relief/completion.json");

assert.equal(handoff.track, "B");
assert.equal(handoff.branch, "agent/track-b-db-lifecycle-readiness");
assert.equal(handoff.implementation.policy_engine_added, false);
assert.equal(handoff.implementation.connection_selector_added, false);
assert.equal(handoff.implementation.tenant_authority_added, false);
assert.equal(handoff.implementation.authority_resolver_modified, false);
assert.equal(handoff.implementation.openapi_or_mcp_modified, false);
assert.equal(handoff.implementation.frontend_or_catalog_modified, false);
assert.equal(handoff.implementation.repository_wide_generated_artifact_modified, false);

for (const state of [handoff.explicit_safety_state, migration, dryRun, rollback]) {
  assert.equal(state.migration_applied, false);
  assert.equal(state.database_mutated, false);
  assert.equal(state.provider_called, false);
  assert.equal(state.production_mutated, false);
}
assert.equal(handoff.explicit_safety_state.runtime_consumer_enabled, false);
assert.equal(migration.runtime_consumers_enabled, false);
assert.equal(dryRun.runtime_consumer_enabled, false);
assert.equal(rollback.runtime_consumer_enabled, false);

assert.equal(migration.entries.length, 2);
assert.ok(migration.entries.every((entry) => entry.requires_separate_authorization === true));
assert.ok(migration.entries.every((entry) => entry.same_cycle_readback_complete === false));
assert.equal(dryRun.database_lifecycle_019.ttl_pilot.live_non_production_mutation_executed, false);
assert.equal(dryRun.break_glass_018.runtime_transition_activation, false);
assert.equal(dryRun.break_glass_018.production_promotion_executed, false);
assert.equal(completion018.evidence.implementation.break_glass_d07_d13_runtime_transition_activation, false);
assert.equal(completion018.evidence.implementation.database_mutated, false);
assert.equal(completion019.evidence.implementation.mutation_execution_enabled, false);
assert.equal(completion019.evidence.implementation.database_mutated, false);
assert.equal(completion019.evidence.implementation.job_runner_enabled, false);
assert.equal(completion019.evidence.implementation.autopilot_enabled, false);
assert.equal(completion019.evidence.implementation.physical_reclaim_execution_enabled, false);

console.log("Track B handoff contract tests passed");
