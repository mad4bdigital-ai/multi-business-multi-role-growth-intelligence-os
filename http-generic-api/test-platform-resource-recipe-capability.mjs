import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationPath = "migrations/246_sprint68_platform_resource_recipe_capability.sql";
const migration = readFileSync(migrationPath, "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

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

console.log("platform resource recipe capability migration contract ok");
