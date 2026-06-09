import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS,
  PLATFORM_RESOURCE_RECIPE_TOOL_NAMES,
  resolveResourceRefInput,
} from "./platformResourceRecipeCapability.js";

const migrationPath = "migrations/246_sprint68_platform_resource_recipe_capability.sql";
const migration = readFileSync(migrationPath, "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");
const systemLayerRoutes = readFileSync("routes/systemLayerRoutes.js", "utf8");
const runtimeModule = readFileSync("platformResourceRecipeCapability.js", "utf8");

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} must include ${value}`);
  }
}

includesAll(migration, [
  "CREATE TABLE IF NOT EXISTS `platform_resource_types`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_adapters`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_recipes`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_recipe_steps`",
], "resource recipe foundation migration");

for (const forbidden of [
  "CREATE TABLE IF NOT EXISTS `resource_graph_nodes`",
  "CREATE TABLE IF NOT EXISTS `resource_graph_edges`",
  "CREATE TABLE IF NOT EXISTS `platform_plugin_resource_recipes`",
  "CREATE TABLE IF NOT EXISTS `platform_plugin_operation_runs`",
  "CREATE TABLE IF NOT EXISTS `resource_operation_runs`",
  "execute_any_endpoint",
  "generic_endpoint_executor",
]) {
  assert(!migration.includes(forbidden), `migration must not introduce ${forbidden}`);
  assert(!runtimeModule.includes(forbidden), `runtime module must not introduce ${forbidden}`);
}

includesAll(migration, [
  "`platform_graph_taxonomy`",
  "platform_graph_nodes",
  "platform_graph_edges",
  "platform_graph_edge_evidence",
  "platform_resource_authority_requirements",
  "capability_resolution_envelope_ledger",
  "platform_engine_execution_runs",
  "execution_log",
  "audit_payload_evidence",
], "resource recipe integration policy");

includesAll(migration, [
  "google_drive.folder.inspect_tree",
  "google_drive.session_folder.reconcile_artifacts_exports",
  "github.branch.reconcile_with_base",
  "platform_plugin.contribution.inspect_runtime_readiness",
  "platform_plugin.smoke_certification.inspect_status",
], "seeded resource recipes");

includesAll(migration, [
  "google_drive_folder_inspect",
  "admin_branch_reconcile",
  "platform_plugin_contributions",
  "platform_plugin_smoke_certifications",
  "platform_plugin_smoke_recertification_policies",
], "installed adapters and existing source tables");

includesAll(migration, [
  "'v1_read_only_or_diagnostic_only', true",
  "'raw_endpoint_executor_allowed', false",
  "'writes_require_capability_envelope', true",
  "'secrets_included', false",
], "resource recipe governance policy");

assert(
  manifest.includes("node test-platform-resource-recipe-capability.mjs"),
  "test manifest must include platform resource recipe capability test"
);

assert.deepEqual(PLATFORM_RESOURCE_RECIPE_TOOL_NAMES, [
  "governed_resource_resolve",
  "governed_resource_catalog",
  "governed_resource_plan",
  "governed_resource_run",
]);

assert.equal(PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS.length, 4, "four system-layer resource recipe tools are exposed");
for (const toolName of PLATFORM_RESOURCE_RECIPE_TOOL_NAMES) {
  const tool = PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS.find((entry) => entry.name === toolName);
  assert(tool, `${toolName} must be present in exported system tools`);
  assert.equal(tool.requires_admin, true, `${toolName} must remain admin-only in v1`);
  assert(systemLayerRoutes.includes(`case "${toolName}":`), `systemLayerRoutes must dispatch ${toolName}`);
}

includesAll(systemLayerRoutes, [
  "PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS",
  "catalogGovernedResources",
  "planGovernedResource",
  "resolveGovernedResource",
  "runGovernedResource",
], "system layer runtime wiring");

includesAll(runtimeModule, [
  "provider_calls_made: 0",
  "execution_allowed: false",
  "apply_allowed: false",
  "dispatch_allowed: false",
  "resource_recipe_runtime_execution_not_enabled_v1",
], "runtime v1 execution blocks");

const driveResolved = resolveResourceRefInput({ input: "https://drive.google.com/drive/folders/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES" });
assert.equal(driveResolved.resource_type, "drive_folder");
assert.equal(driveResolved.resource_ref.folder_id, "1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");
assert.equal(driveResolved.resource_uri, "gdrive://folder/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");

const driveResolvedWithRecipeTypeHint = resolveResourceRefInput({
  input: "https://drive.google.com/drive/folders/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES",
  resource_type: "drive_folder",
});
assert.equal(driveResolvedWithRecipeTypeHint.resource_type, "drive_folder");
assert.equal(driveResolvedWithRecipeTypeHint.resource_ref.folder_id, "1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");
assert.equal(driveResolvedWithRecipeTypeHint.resource_uri, "gdrive://folder/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");

const githubResolved = resolveResourceRefInput({ input: "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/tree/gpt/example" });
assert.equal(githubResolved.resource_type, "github_branch");
assert.equal(githubResolved.resource_ref.owner, "mad4bdigital-ai");
assert.equal(githubResolved.resource_ref.repo, "multi-business-multi-role-growth-intelligence-os");
assert.equal(githubResolved.resource_ref.branch, "gpt/example");

const pluginResolved = resolveResourceRefInput({ resource_ref: { contribution_id: "ppc_test" } });
assert.equal(pluginResolved.resource_type, "platform_plugin_contribution");
assert.equal(pluginResolved.resource_uri, "platform-plugin-contribution://ppc_test");

console.log("platform resource recipe capability migration and runtime contract ok");
