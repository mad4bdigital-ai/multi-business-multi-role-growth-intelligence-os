import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const output = execFileSync(process.execPath, ["scripts/runtime-data-lifecycle-guard.mjs"], { cwd: new URL(".", import.meta.url), encoding: "utf8" });
const report = JSON.parse(output);
const selfTest = JSON.parse(execFileSync(process.execPath, ["scripts/runtime-data-lifecycle-guard.mjs", "--self-test"], { cwd: new URL(".", import.meta.url), encoding: "utf8" }));
const contract = JSON.parse(fs.readFileSync(new URL("config/runtime-data-lifecycle-contract.json", import.meta.url), "utf8"));

assert.equal(report.ok, true);
assert.equal(report.selection.mode, "git_diff");
assert.equal(selfTest.numeric_and_dated_migrations_selected, true);
assert.equal(selfTest.cte_mutation_classified, true);
assert.equal(selfTest.truncate_mutation_classified, true);
assert.equal(selfTest.mixed_table_fail_closed, true);
assert.equal(selfTest.mixed_table_comment_token_bypass_rejected, true);
assert.equal(selfTest.mixed_table_wrong_file_canonical_rejected, true);
assert.equal(selfTest.mixed_table_broad_selector_rejected, true);
assert.equal(selfTest.zero_base_sha_rejected, true);
assert.equal(selfTest.migration_deletion_is_blocking, true);
assert.equal(selfTest.runtime_state_migration_mutation_forbidden, true);
assert.equal(selfTest.destructive_runtime_mutation_forbidden, true);
assert.equal(report.safety.database_connection_performed, false);
assert.equal(report.safety.database_mutation_performed, false);
assert.equal(report.safety.provider_access_performed, false);
assert.equal(report.safety.production_access_performed, false);
assert.equal(
  contract.datasets.workspace_registry.canonical_rows[0].seed_file,
  "20260920_platform_admin_workspace_canonical_seed.sql",
);
if (report.selection.files.includes("20260920_platform_admin_workspace_canonical_seed.sql")) {
  assert.ok(
    report.inventory.some(
      (item) => item.file === "20260920_platform_admin_workspace_canonical_seed.sql" && item.table === "workspace_registry",
    ),
  );
}
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].cardinality, "exactly_one");
assert.equal(contract.datasets.memberships.reseed_forbidden, true);
assert.equal(contract.table_families[0].zero_rows_allowed, true);
assert.equal(contract.table_families[0].completeness_policy, "explicit_dataset_declarations_only");
assert.equal(contract.table_families[0].unregistered_family_member_policy, "fail_closed");
assert.equal(contract.enforcement.legacy_exclusions.length, 0);
assert.equal(contract.datasets.remote_runtime_command_allowlists.canonical_rows[0].cardinality, "exactly_one");
assert.equal(contract.datasets.execution_policies.canonical_rows[0].cardinality, "exactly_one");
assert.equal(contract.datasets.remote_runtime_command_allowlists.known_replay_gap, false);
assert.equal(contract.datasets.execution_policies.known_replay_gap, false);
assert.equal(contract.datasets.remote_runtime_command_allowlists.replay_strategy, "disposable_git_semantic_snapshot");
assert.equal(contract.datasets.execution_policies.replay_strategy, "disposable_git_semantic_snapshot");
assert.equal(report.known_replay_gaps.includes("remote_runtime_command_allowlists"), false);
assert.equal(report.known_replay_gaps.includes("execution_policies"), false);
assert.equal(contract.enforcement.mixed_table_mutation_requires_resolution, true);
assert.equal(contract.enforcement.operational_state_migration_mutation_forbidden, true);
assert.equal(contract.enforcement.environment_state_migration_mutation_forbidden, true);
assert.equal(contract.enforcement.destructive_mutation_fail_closed, true);
assert.equal(contract.enforcement.mixed_canonical_seed_file_and_selector_required, true);
assert.equal(contract.datasets.workspace_registry.mixed_mutation_policy, "canonical_seed_file_and_exact_selector_or_environment_annotation");
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].mutation_selector.mode, "seed_file_and_exact_selector");
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].resolver_cardinality.cardinality, "exactly_one");
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].resolver_cardinality.require_ready, true);
assert.equal(contract.datasets.workspace_registry.canonical_rows[0].resolver_cardinality.readback_token, "resolver-equivalent canonical Platform Admin workspace candidates");
assert.equal(report.semantic_durability_status, "declared_contract_complete");
assert.equal(report.fresh_rebuild_semantic_complete, true);
assert.deepEqual(report.known_replay_gaps, []);
assert.deepEqual(report.known_replay_gap_datasets, []);
assert.deepEqual(report.known_replay_gap_families, []);

console.log("runtime data lifecycle guard tests passed");
