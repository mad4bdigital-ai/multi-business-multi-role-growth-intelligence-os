import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/960_sprint68_remaining_resource_capability_completion_gates.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

function includesAll(text, needles, label) {
  for (const needle of needles) {
    assert.ok(text.includes(needle), `${label} missing ${needle}`);
  }
}

includesAll(migration, [
  "960_sprint68_remaining_resource_capability_completion_gates.sql",
  "github.file.patch_apply_after_review",
  "github.pull_request.create_after_review",
  "mysql.resource.governance_report",
  "tenant.workspace.policy_overlay_report",
  "dynamic.capability.tool_bus.readiness_report",
  "platform.plugin.productization.readiness_report",
  "resource.recertification.scheduler_readiness",
  "governed.response_chunk.persistence_readiness",
  "github_file_patch_apply_after_review_v1",
  "github_pull_request_create_after_review_v1",
  "mysql_resource_governance_apply_block_v1",
  "tenant_workspace_overlay_apply_block_v1",
  "dynamic_capability_tool_bus_apply_block_v1",
  "platform_plugin_productization_apply_block_v1",
  "resource_recertification_scheduler_apply_block_v1",
  "governed_response_chunk_persistence_apply_block_v1",
  "CREATE TABLE IF NOT EXISTS governed_tool_response_chunks",
  "CREATE OR REPLACE VIEW v_remaining_resource_capability_completion_readiness",
  "remaining_f5_to_l_completion_gates_v1",
  "secrets_included",
], "remaining completion gates migration");

includesAll(migration, [
  "direct_main_write_allowed',false",
  "apply remains blocked",
  "dispatch remains blocked",
  "destructive_changes_allowed',false",
  "tenant_cross_scope_blocked',true",
  "collision_audit_required',true",
  "tenant_exposure_requires_grant',true",
  "mutation_blocked_by_default',true",
  "runtime_read_fallback_pending',true",
], "safety invariants");

assert.ok(!migration.includes("direct_main_write_allowed',true"), "migration must not enable direct main writes");
assert.ok(!migration.includes("destructive_changes_allowed',true"), "migration must not enable destructive MySQL changes");
assert.ok(!migration.includes("raw_secret_response_allowed',true"), "migration must not allow raw secret responses");
assert.ok(!migration.includes("DROP TABLE"), "migration must not drop tables");
assert.ok(!migration.includes("TRUNCATE TABLE"), "migration must not truncate tables");
assert.ok(runner.includes("960_sprint68_remaining_resource_capability_completion_gates.sql"), "runner allowlist must include migration 960");
assert.ok(manifest.includes("node test-remaining-resource-capability-completion-gates.mjs"), "test manifest must include remaining completion gates test");

console.log("Remaining F5-L resource capability completion gates contract OK");
