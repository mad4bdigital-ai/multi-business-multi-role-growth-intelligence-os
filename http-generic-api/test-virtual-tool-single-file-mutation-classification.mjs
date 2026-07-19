import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const correction = readFileSync(
  new URL("./migrations/20260718_virtual_tool_single_file_mutation_classification.sql", import.meta.url),
  "utf8",
);
const bindingMigration = readFileSync(
  new URL("./migrations/311_sprint69_platform_tool_dispatch_binding_integrity.sql", import.meta.url),
  "utf8",
);

for (const marker of [
  "single_file_mutation",
  "atomic_change_set",
  "THEN 'state_changing'",
  "THEN 'C'",
  "platform_plugin_capabilities",
  "platform_plugin_bindings",
  "platform_plugin_capability_exports",
  "platform_capability_readback_contracts",
  "platform_capability_debt",
  "apply_allowed=LEAST",
  "no_provider_call=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.match(correction, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(bindingMigration, /'repo_patch_apply'[\s\S]*?'github_file_patch_apply'[\s\S]*?'single_file_mutation'/);
assert.match(bindingMigration, /'repo_patch_batch_apply'[\s\S]*?'github_file_patch_apply'[\s\S]*?'atomic_change_set'/);
assert.doesNotMatch(correction, /repo_patch_(?:apply|batch_apply)|github_file_patch_apply/i);
assert.doesNotMatch(correction, /\bDROP\s+(?:TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);

console.log("virtual tool single-file mutation classification tests passed");
