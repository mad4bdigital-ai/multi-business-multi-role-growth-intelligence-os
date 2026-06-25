import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hasDeclaredMutationPolicy } from "./governedExecutionPreflight.js";

const routes = await readFile(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const migration = await readFile(new URL("./migrations/20260625_repository_mutation_descriptor_policy_recovery.sql", import.meta.url), "utf8");

const repoPatchStart = routes.indexOf('name: "repo_patch_apply"');
assert.ok(repoPatchStart >= 0, "repo_patch_apply virtual descriptor must exist");
const repoPatchBlock = routes.slice(repoPatchStart, routes.indexOf("inputSchema:", repoPatchStart));
for (const tag of ["mutation", "capability_envelope", "readback", "no_secrets"]) {
  assert.match(repoPatchBlock, new RegExp(`\\"${tag}\\"`), `repo_patch_apply must declare ${tag}`);
}
assert.equal(hasDeclaredMutationPolicy({ tags: ["repo", "mutation", "capability_envelope", "readback", "no_secrets"] }), true);

for (const expected of [
  "Repository Mutation Descriptor Recovery Contract",
  "source_regression_pull_request",
  "sql_registry_descriptor_and_execution_policy_alignment",
  "generic_admin_control_bypass_forbidden",
  "fail_closed_guard_remains_enabled",
  "capability_resolution_envelope_create",
  "capability_resolution_envelope_approve",
  "repo_patch_apply",
  "repo_patch_batch_apply",
  "v_repository_mutation_descriptor_policy_readiness",
  "ON DUPLICATE KEY UPDATE",
  "CREATE OR REPLACE VIEW",
]) {
  assert.ok(migration.includes(expected), `recovery migration missing ${expected}`);
}

assert.match(migration, /`active`\s*=\s*'TRUE'/);
assert.match(migration, /`blocking`\s*=\s*'TRUE'/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /UPDATE\s+`admin_platform_endpoint_tools`[\s\S]*WHERE\s+`tool_key`\s+NOT\s+IN/i);

console.log("repository mutation descriptor policy recovery tests passed");
