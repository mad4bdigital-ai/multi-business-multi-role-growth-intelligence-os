import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const surfaceDir = new URL("./activation-surfaces/", import.meta.url);
const manifests = readdirSync(surfaceDir).filter((file) => file.endsWith(".json")).sort();
const auditScript = readFileSync(new URL("./scripts/activation-surface-db-coverage-audit.mjs", import.meta.url), "utf8");
const coverageScript = readFileSync(new URL("./scripts/activation-surface-coverage-check.mjs", import.meta.url), "utf8");
const syncScript = readFileSync(new URL("./scripts/activation-authorized-surface-registry-sync.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

const requiredCoveredTables = new Set([
  "agents",
  "agent_skills",
  "agent_skill_grants",
  "agent_tool_index",
  "agent_tool_bindings",
  "agent_workflow_bindings",
  "agent_logic_pack_bindings",
  "workflows",
  "workflow_runtime_bindings",
  "task_routes",
  "platform_pending_tasks",
  "app_integrations",
  "user_app_connections",
  "app_action_grants",
  "app_integration_action_bindings",
  "app_integration_tool_bindings",
  "tenant_integration_policies",
  "tenant_platform_endpoint_tools",
  "platform_plugin_contributions",
  "platform_orchestration_plugins",
  "skill_manifests",
  "skill_packages",
  "logic_packs",
  "local_gateway_tools",
]);

const covered = new Set();
for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(new URL(file, surfaceDir), "utf8"));
  if (String(manifest.source_table || "").startsWith("v_activation_")) {
    assert(Array.isArray(manifest.covered_source_tables) && manifest.covered_source_tables.length > 0, `${file} must declare covered_source_tables`);
  }
  for (const table of manifest.covered_source_tables || []) covered.add(table);
}
for (const table of requiredCoveredTables) {
  assert(covered.has(table), `${table} must be covered by an activation manifest`);
}

assert.match(coverageScript, /covered_source_tables/);
assert.match(coverageScript, /Activation view manifest/);
assert.match(syncScript, /covered_source_tables/);
assert.match(auditScript, /activation_source_table_coverage/);
assert.match(auditScript, /CORE_LOADER/);
assert.match(auditScript, /INFORMATION_SCHEMA\.TABLES/);
assert.match(auditScript, /external_provider_called: false/);
assert.match(auditScript, /secrets_included: false/);
assert.doesNotMatch(auditScript, /SELECT \*/i);
assert.doesNotMatch(auditScript, /fetch\(|axios|http\.request|https\.request/);
assert.match(adminCli, /activation_source_table_coverage_audit/);
assert.match(adminCli, /activation-surface-db-coverage-audit\.mjs/);
assert.match(adminCli, /allow_extra_args: false/);

console.log("Activation source table coverage audit guard passed");
