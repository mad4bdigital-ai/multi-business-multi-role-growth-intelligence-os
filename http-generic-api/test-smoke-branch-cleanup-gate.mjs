import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const preflight = readFileSync("governedExecutionPreflight.js", "utf8");
const migration = readFileSync("migrations/962_sprint68_smoke_branch_cleanup_gate.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "function unmergedSmokeBranchDeleteConfirmed",
  "allow_unmerged_smoke_branch_delete",
  "unmerged_smoke_branch_delete_prefixes",
  "DELETE_UNMERGED_SMOKE_BRANCH",
  "unmerged_smoke_branch_delete_explicitly_confirmed",
  "branchTypedConfirmation",
]) {
  assert.ok(preflight.includes(expected), `preflight missing ${expected}`);
}

for (const expected of [
  "962_sprint68_smoke_branch_cleanup_gate.sql",
  "allow_unmerged_smoke_branch_delete",
  "JSON_ARRAY('gpt/smoke-')",
  "unmerged_smoke_branch_delete_requires_typed_confirmation",
  "DELETE_UNMERGED_SMOKE_BRANCH",
  "unmerged_smoke_branch_delete_direct_main_write_allowed', false",
  "unmerged_smoke_branch_delete_merge_allowed', false",
  "CREATE OR REPLACE VIEW v_smoke_branch_cleanup_gate_readback",
  "secrets_included",
]) {
  assert.ok(migration.includes(expected), `migration missing ${expected}`);
}

assert.ok(!migration.includes("unmerged_smoke_branch_delete_direct_main_write_allowed', true"), "must not allow direct main write");
assert.ok(!migration.includes("unmerged_smoke_branch_delete_merge_allowed', true"), "must not allow merges");
assert.ok(preflight.includes("return supplied === expected"), "cleanup gate must require exact typed confirmation");
assert.ok(runner.includes("962_sprint68_smoke_branch_cleanup_gate.sql"), "runner must allowlist 962");
assert.ok(manifest.includes("node test-smoke-branch-cleanup-gate.mjs"), "manifest must include cleanup gate test");

console.log("Smoke branch cleanup gate contract OK");
