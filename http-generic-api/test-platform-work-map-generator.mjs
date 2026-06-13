import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncWorkMaps } from "./scripts/platform-work-map-generator.mjs";

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "platform-work-maps-"));
const write = (rel, content) => {
  const file = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

write("http-generic-api/executionEvidenceLogger.js", `
export async function writeExecutionEvidence({
  tenantId = null,
  workspaceId = null,
  userId = null,
  roleKeys = null,
  policyKeys = null,
  brandKey = null,
  businessActivityTypeKey = null,
  agentEvidence = null,
  workflowEvidence = null,
} = {}) { return { ok: true }; }
`);

write("http-generic-api/migrations/001_execution_log_evidence.sql", `
CREATE TABLE IF NOT EXISTS \`execution_log\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NULL,
  \`agent_id\` VARCHAR(36) NULL,
  \`workflow_id\` VARCHAR(36) NULL,
  \`connected_system_id\` VARCHAR(36) NULL
);
ALTER TABLE \`execution_log\`
  ADD COLUMN IF NOT EXISTS \`brand_evidence_json\` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS \`business_activity_evidence_json\` LONGTEXT NULL;
CREATE OR REPLACE VIEW \`v_execution_log_evidence_readiness\` AS SELECT 1;
INSERT INTO execution_policies (policy_key) VALUES ('execution_log_evidence_policy_v1');
`);

write("http-generic-api/migrations/002_agent_workflow_connector.sql", `
CREATE TABLE IF NOT EXISTS \`agents\` (
  \`agent_id\` VARCHAR(36) PRIMARY KEY,
  \`name\` VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS \`agent_skills\` (
  \`skill_id\` VARCHAR(36) PRIMARY KEY,
  \`skill_key\` VARCHAR(128) NOT NULL
);
CREATE TABLE IF NOT EXISTS \`agent_skill_grants\` (
  \`grant_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NOT NULL,
  \`agent_id\` VARCHAR(36) NOT NULL,
  \`skill_id\` VARCHAR(36) NOT NULL,
  FOREIGN KEY (\`agent_id\`) REFERENCES \`agents\` (\`agent_id\`),
  FOREIGN KEY (\`skill_id\`) REFERENCES \`agent_skills\` (\`skill_id\`)
);
CREATE TABLE IF NOT EXISTS \`workflows\` (
  \`workflow_id\` VARCHAR(36) PRIMARY KEY,
  \`workflow_key\` VARCHAR(128) NOT NULL
);
CREATE TABLE IF NOT EXISTS \`task_routes\` (
  \`task_route_id\` VARCHAR(36) PRIMARY KEY,
  \`workflow_id\` VARCHAR(36) NULL,
  FOREIGN KEY (\`workflow_id\`) REFERENCES \`workflows\` (\`workflow_id\`)
);
CREATE TABLE IF NOT EXISTS \`connected_systems\` (
  \`system_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NOT NULL
);
CREATE TABLE IF NOT EXISTS \`installations\` (
  \`installation_id\` VARCHAR(36) PRIMARY KEY,
  \`system_id\` VARCHAR(36) NOT NULL,
  FOREIGN KEY (\`system_id\`) REFERENCES \`connected_systems\` (\`system_id\`)
);
CREATE TABLE IF NOT EXISTS \`permission_grants\` (
  \`permission_grant_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NOT NULL,
  \`installation_id\` VARCHAR(36) NOT NULL,
  FOREIGN KEY (\`installation_id\`) REFERENCES \`installations\` (\`installation_id\`)
);
CREATE TABLE IF NOT EXISTS \`platform_resource_authority_bindings\` (
  \`binding_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NOT NULL,
  \`permission_grant_id\` VARCHAR(36) NULL
);
INSERT INTO execution_policies (policy_key) VALUES ('platform_resource_authority_binding_policy_v1');
`);

write("http-generic-api/migrations/003_sessions_observability.sql", `
CREATE TABLE IF NOT EXISTS \`gpt_sessions\` (
  \`session_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36) NULL,
  \`user_id\` VARCHAR(36) NULL
);
CREATE TABLE IF NOT EXISTS \`gpt_session_turns\` (
  \`turn_id\` VARCHAR(36) PRIMARY KEY,
  \`session_id\` VARCHAR(36) NOT NULL,
  FOREIGN KEY (\`session_id\`) REFERENCES \`gpt_sessions\` (\`session_id\`)
);
CREATE TABLE IF NOT EXISTS \`release_readiness_runs\` (
  \`run_id\` VARCHAR(36) PRIMARY KEY,
  \`status\` VARCHAR(32) NOT NULL
);
CREATE OR REPLACE VIEW \`v_release_readiness_latest\` AS SELECT 1;
`);

write("http-generic-api/activation-surfaces/agent_skill_grants.json", JSON.stringify({
  surface_key: "agent_skill_grants",
  source_table: "v_activation_agent_skill_grants",
  include_for_admin: true,
  include_for_tenant: true,
  status: "active",
  result_columns: ["grant_id", "tenant_id", "agent_id", "skill_id"],
}, null, 2));

write("memory_schema.json", JSON.stringify({
  required: ["execution_logging_state", "agent_chain_state", "local_connector_governance_state"],
  properties: {
    execution_logging_state: { properties: { authority: { const: "execution_evidence" }, table: { const: "execution_log" } } },
    agent_chain_state: { properties: { authority: { const: "agent_event_bus" }, table: { const: "agent_chain_events" } } },
    local_connector_governance_state: { properties: { authority: { const: "governed_dispatch_layer" }, route_surface: { const: "task_routes" } } },
    activation_state: { "$ref": "schemas/execution.schema.json#/$defs/activation_state" },
  },
}, null, 2));

write(".github/workflows/ci.yml", `name: CI\non:\n  pull_request:\n  push:\n  workflow_dispatch:\n`);
write(".github/workflows/docs-agent.yml", `name: Docs Agent\non:\n  pull_request:\n  push:\n`);
write("prompt_router.md", "# Prompt Router\n");
write("module_loader.md", "# Module Loader\n");
write("system_bootstrap.md", "# System Bootstrap\n");
write("http-generic-api/connectorExecutor.js", "export const connectorExecutor = true;\n");
write("http-generic-api/agentRuntime.js", "export const agentRuntime = true;\n");

write("docs/work-maps/stale-generated-map.md", "> Generated text documentation. Do not edit this file manually.\n");
write("docs/work-maps/manual-notes.md", "# Manual notes\nThis file must survive generated-map cleanup.\n");

const first = syncWorkMaps({ repoRoot, mode: "write" });
assert.equal(first.ok, true);
assert.equal(first.generated_count, 20);
assert.equal(first.image_assets_generated, false);
assert.equal(first.secrets_included, false);
assert.equal(first.schema_intelligence_metrics.migrations_scanned, 3);
assert.ok(first.schema_intelligence_metrics.tables_discovered >= 12);
assert.ok(first.schema_intelligence_metrics.views_discovered >= 2);
assert.ok(first.schema_intelligence_metrics.policy_keys_discovered >= 2);
assert.equal(first.schema_intelligence_metrics.memory_states_discovered, 4);
assert.equal(first.schema_intelligence_metrics.specialized_map_count, 12);
assert.ok(first.schema_intelligence_metrics.domain_count >= 6);
assert.equal(first.schema_intelligence_metrics.uncategorized_objects, 0);
assert.ok(first.schema_intelligence_metrics.classified_objects >= 14);
assert.ok(first.stale_generated_files.includes("docs/work-maps/stale-generated-map.md"));
assert.equal(fs.existsSync(path.join(repoRoot, "docs/work-maps/stale-generated-map.md")), false);
assert.equal(fs.existsSync(path.join(repoRoot, "docs/work-maps/manual-notes.md")), true);

const expected = [
  "README.md",
  "activation-access-map.md",
  "activation-onboarding-map.md",
  "agent-skill-plugin-map.md",
  "asset-package-map.md",
  "commercial-usage-map.md",
  "connector-provider-map.md",
  "data-model-domain-map.md",
  "delivery-support-map.md",
  "execution-log-evidence-map.md",
  "migration-lifecycle-map.md",
  "observability-release-map.md",
  "platform-resource-graph-map.md",
  "platform-runtime-map.md",
  "policy-authority-map.md",
  "repository-automation-map.md",
  "repository-development-map.md",
  "session-memory-map.md",
  "work-map-coverage-matrix.md",
  "workflow-task-orchestration-map.md",
];
for (const name of expected) {
  const file = path.join(repoRoot, "docs/work-maps", name);
  assert.equal(fs.existsSync(file), true, `${name} should be generated`);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /Generated text documentation|Dynamic Platform Work Maps/);
  assert.doesNotMatch(text, /password\s*=|token\s*=|private[_ -]?key\s*=/i);
}

const execution = read("docs/work-maps/execution-log-evidence-map.md");
assert.match(execution, /```mermaid/);
assert.match(execution, /writeExecutionEvidence/);
assert.match(execution, /brand_evidence_json/);
assert.match(execution, /business_activity_evidence_json/);
assert.match(execution, /execution_log_evidence_policy_v1/);

const dataModel = read("docs/work-maps/data-model-domain-map.md");
assert.match(dataModel, /Platform Data Model Domain Map/);
assert.match(dataModel, /agents/);
assert.match(dataModel, /workflows/);
assert.match(dataModel, /connected_systems/);
assert.match(dataModel, /permission_grants/);
assert.match(dataModel, /gpt_sessions/);
assert.match(dataModel, /release_readiness_runs/);
assert.match(dataModel, /Tables discovered/);

const agentMap = read("docs/work-maps/agent-skill-plugin-map.md");
assert.match(agentMap, /Agent, Skill, Plugin, and Intelligence Map/);
assert.match(agentMap, /agent_skill_grants/);
assert.match(agentMap, /agent_skills/);

const workflowMap = read("docs/work-maps/workflow-task-orchestration-map.md");
assert.match(workflowMap, /workflows/);
assert.match(workflowMap, /task_routes/);

const authorityMap = read("docs/work-maps/policy-authority-map.md");
assert.match(authorityMap, /platform_resource_authority_bindings/);
assert.match(authorityMap, /platform_resource_authority_binding_policy_v1/);
assert.match(authorityMap, /permission_grants/);

const connectorMap = read("docs/work-maps/connector-provider-map.md");
assert.match(connectorMap, /connected_systems/);
assert.match(connectorMap, /installations/);

const sessionMap = read("docs/work-maps/session-memory-map.md");
assert.match(sessionMap, /gpt_sessions/);
assert.match(sessionMap, /execution_logging_state/);
assert.match(sessionMap, /agent_chain_state/);

const observabilityMap = read("docs/work-maps/observability-release-map.md");
assert.match(observabilityMap, /execution_log/);
assert.match(observabilityMap, /release_readiness_runs/);

const coverage = read("docs/work-maps/work-map-coverage-matrix.md");
assert.match(coverage, /Work Map Coverage Matrix/);
assert.match(coverage, /data-model-domain-map\.md/);
assert.match(coverage, /Uncategorized schema objects/);

const activation = read("docs/work-maps/activation-access-map.md");
assert.match(activation, /agent_skill_grants/);
assert.match(activation, /v_activation_agent_skill_grants/);

const automation = read("docs/work-maps/repository-automation-map.md");
assert.match(automation, /Docs Agent/);
assert.match(automation, /CI/);

const index = read("docs/work-maps/README.md");
for (const name of expected.filter((name) => name !== "README.md")) assert.match(index, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const check = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(check.ok, true);
assert.deepEqual(check.drift_files, []);

write("http-generic-api/activation-surfaces/workflow_catalog.json", JSON.stringify({
  surface_key: "workflow_catalog",
  source_table: "v_activation_workflow_catalog",
  include_for_admin: true,
  include_for_tenant: true,
  status: "active",
  result_columns: ["workflow_key"],
}, null, 2));
write("http-generic-api/migrations/004_new_plugin.sql", `
CREATE TABLE IF NOT EXISTS \`platform_plugin_contributions\` (
  \`contribution_id\` VARCHAR(36) PRIMARY KEY,
  \`plugin_key\` VARCHAR(128) NOT NULL,
  \`tenant_id\` VARCHAR(36) NULL
);
`);
const drift = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(drift.ok, false);
for (const expectedDrift of [
  "docs/work-maps/activation-access-map.md",
  "docs/work-maps/agent-skill-plugin-map.md",
  "docs/work-maps/data-model-domain-map.md",
  "docs/work-maps/work-map-coverage-matrix.md",
  "docs/work-maps/README.md",
]) assert.ok(drift.drift_files.includes(expectedDrift), `${expectedDrift} should drift`);

const generatedAssets = fs.readdirSync(path.join(repoRoot, "docs/work-maps"));
assert.equal(generatedAssets.some((name) => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)), false);

const workflow = fs.readFileSync(new URL("../.github/workflows/docs-agent.yml", import.meta.url), "utf8");
const maintenance = fs.readFileSync(new URL("./scripts/repo-maintenance-sync.mjs", import.meta.url), "utf8");
assert.match(workflow, /platform-work-map-generator\.mjs --write/);
assert.match(workflow, /docs\/work-maps/);
assert.match(maintenance, /platform-work-map-generator\.mjs/);

console.log("deep dynamic text platform work map generator test passed");
