import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorkMaps, syncWorkMaps } from "./scripts/platform-work-map-generator.mjs";

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deep-platform-work-maps-"));
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

write("http-generic-api/migrations/001_execution.sql", `
CREATE TABLE IF NOT EXISTS \`execution_log\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`tenant_id\` VARCHAR(36),
  \`agent_id\` VARCHAR(36),
  \`workflow_id\` VARCHAR(36),
  \`connected_system_id\` VARCHAR(36)
);
ALTER TABLE \`execution_log\`
  ADD COLUMN IF NOT EXISTS \`brand_evidence_json\` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS \`business_activity_evidence_json\` LONGTEXT NULL;
CREATE OR REPLACE VIEW \`v_execution_log_evidence_readiness\` AS SELECT 1;
INSERT INTO execution_policies (policy_key) VALUES ('execution_log_evidence_policy_v1');
`);

write("http-generic-api/migrations/002_runtime.sql", `
CREATE TABLE IF NOT EXISTS \`agents\` (\`agent_id\` VARCHAR(36) PRIMARY KEY, \`name\` VARCHAR(64));
CREATE TABLE IF NOT EXISTS \`agent_skills\` (\`skill_id\` VARCHAR(36) PRIMARY KEY, \`skill_key\` VARCHAR(128));
CREATE TABLE IF NOT EXISTS \`agent_skill_grants\` (
  \`grant_id\` VARCHAR(36) PRIMARY KEY,
  \`tenant_id\` VARCHAR(36),
  \`agent_id\` VARCHAR(36),
  \`skill_id\` VARCHAR(36),
  FOREIGN KEY (\`agent_id\`) REFERENCES \`agents\` (\`agent_id\`),
  FOREIGN KEY (\`skill_id\`) REFERENCES \`agent_skills\` (\`skill_id\`)
);
CREATE TABLE IF NOT EXISTS \`workflows\` (\`workflow_id\` VARCHAR(36) PRIMARY KEY, \`workflow_key\` VARCHAR(128));
CREATE TABLE IF NOT EXISTS \`task_routes\` (
  \`task_route_id\` VARCHAR(36) PRIMARY KEY,
  \`workflow_id\` VARCHAR(36),
  FOREIGN KEY (\`workflow_id\`) REFERENCES \`workflows\` (\`workflow_id\`)
);
CREATE TABLE IF NOT EXISTS \`connected_systems\` (\`system_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`installations\` (
  \`installation_id\` VARCHAR(36) PRIMARY KEY,
  \`system_id\` VARCHAR(36),
  FOREIGN KEY (\`system_id\`) REFERENCES \`connected_systems\` (\`system_id\`)
);
CREATE TABLE IF NOT EXISTS \`permission_grants\` (
  \`permission_grant_id\` VARCHAR(36) PRIMARY KEY,
  \`installation_id\` VARCHAR(36),
  FOREIGN KEY (\`installation_id\`) REFERENCES \`installations\` (\`installation_id\`)
);
CREATE TABLE IF NOT EXISTS \`platform_resource_authority_bindings\` (\`binding_id\` VARCHAR(36) PRIMARY KEY, \`permission_grant_id\` VARCHAR(36));
INSERT INTO execution_policies (policy_key) VALUES ('platform_resource_authority_binding_policy_v1');
`);

write("http-generic-api/migrations/003_sessions.sql", `
CREATE TABLE IF NOT EXISTS \`gpt_sessions\` (\`session_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`gpt_session_turns\` (
  \`turn_id\` VARCHAR(36) PRIMARY KEY,
  \`session_id\` VARCHAR(36),
  FOREIGN KEY (\`session_id\`) REFERENCES \`gpt_sessions\` (\`session_id\`)
);
CREATE TABLE IF NOT EXISTS \`release_readiness_runs\` (\`run_id\` VARCHAR(36) PRIMARY KEY, \`status\` VARCHAR(32));
CREATE OR REPLACE VIEW \`v_release_readiness_latest\` AS SELECT 1;
`);

write("http-generic-api/migrations/004_domains.sql", `
CREATE TABLE IF NOT EXISTS \`activation_signal_inbox\` (\`signal_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`asset_equivalence_groups\` (\`group_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`commercial_profiles\` (\`profile_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`repo_source_registry\` (\`source_id\` VARCHAR(36) PRIMARY KEY, \`status\` VARCHAR(32));
CREATE TABLE IF NOT EXISTS \`platform_graph_nodes\` (\`node_id\` VARCHAR(36) PRIMARY KEY, \`resource_type_id\` VARCHAR(36));
CREATE OR REPLACE VIEW \`v_platform_capabilities_current\` AS SELECT 1;
CREATE TABLE IF NOT EXISTS \`output_artifacts\` (\`artifact_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`tickets\` (\`ticket_id\` VARCHAR(36) PRIMARY KEY, \`tenant_id\` VARCHAR(36));
CREATE TABLE IF NOT EXISTS \`data_migration_inventory\` (\`migration_id\` VARCHAR(36) PRIMARY KEY, \`status\` VARCHAR(32));
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

write(".specify/work-map-schema-classification-registry.json", JSON.stringify({
  schema_version: "1.0.0",
  rules: [],
  intentional_unclassified: [],
}, null, 2));
write(".github/workflows/ci.yml", "name: CI\non:\n  pull_request:\n  push:\n  workflow_dispatch:\n");
write(".github/workflows/docs-agent.yml", "name: Docs Agent\non:\n  pull_request:\n  push:\n");
write("prompt_router.md", "# Prompt Router\n");
write("module_loader.md", "# Module Loader\n");
write("system_bootstrap.md", "# System Bootstrap\n");
write("http-generic-api/connectorExecutor.js", "export const connectorExecutor = true;\n");
write("http-generic-api/agentRuntime.js", "export const agentRuntime = true;\n");
write("docs/work-maps/stale-generated-map.md", "> Generated text documentation. Do not edit this file manually.\n");
write("docs/work-maps/manual-notes.md", "# Manual notes\n");

const first = syncWorkMaps({ repoRoot, mode: "write" });
assert.equal(first.ok, true);
assert.equal(first.generated_count, 20);
assert.equal(first.image_assets_generated, false);
assert.equal(first.secrets_included, false);
assert.equal(first.schema_intelligence_metrics.migrations_scanned, 4);
assert.ok(first.schema_intelligence_metrics.tables_discovered >= 20);
assert.ok(first.schema_intelligence_metrics.views_discovered >= 2);
assert.ok(first.schema_intelligence_metrics.policy_keys_discovered >= 2);
assert.equal(first.schema_intelligence_metrics.memory_states_discovered, 4);
assert.equal(first.schema_intelligence_metrics.specialized_map_count, 12);
assert.equal(first.schema_intelligence_metrics.unresolved_unclassified_objects, 0);
assert.equal(first.schema_intelligence_metrics.intentional_unclassified_objects, 0);
assert.equal(
  first.schema_intelligence_metrics.total_accounted_objects,
  first.schema_intelligence_metrics.total_discovered_objects,
);
assert.equal(first.schema_intelligence_metrics.classification_coverage_percent, 100);
assert.ok(first.stale_generated_files.includes("docs/work-maps/stale-generated-map.md"));
assert.equal(fs.existsSync(path.join(repoRoot, "docs/work-maps/stale-generated-map.md")), false);
assert.equal(fs.existsSync(path.join(repoRoot, "docs/work-maps/manual-notes.md")), true);

const expected = [
  "README.md", "activation-access-map.md", "activation-onboarding-map.md", "agent-skill-plugin-map.md",
  "asset-package-map.md", "commercial-usage-map.md", "connector-provider-map.md", "data-model-domain-map.md",
  "delivery-support-map.md", "execution-log-evidence-map.md", "migration-lifecycle-map.md",
  "observability-release-map.md", "platform-resource-graph-map.md", "platform-runtime-map.md",
  "policy-authority-map.md", "repository-automation-map.md", "repository-development-map.md",
  "session-memory-map.md", "work-map-coverage-matrix.md", "workflow-task-orchestration-map.md",
];
for (const name of expected) {
  const file = path.join(repoRoot, "docs/work-maps", name);
  assert.equal(fs.existsSync(file), true, `${name} should be generated`);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /Generated text documentation|Dynamic Platform Work Maps/);
  assert.doesNotMatch(text, /password\s*=|token\s*=|private[_ -]?key\s*=/i);
}

const checks = [
  ["execution-log-evidence-map.md", /brand_evidence_json/, /execution_log_evidence_policy_v1/],
  ["agent-skill-plugin-map.md", /agent_skill_grants/, /agent_skills/],
  ["workflow-task-orchestration-map.md", /workflows/, /task_routes/],
  ["policy-authority-map.md", /platform_resource_authority_bindings/, /permission_grants/],
  ["connector-provider-map.md", /connected_systems/, /installations/],
  ["session-memory-map.md", /gpt_sessions/, /execution_logging_state/],
  ["observability-release-map.md", /execution_log/, /release_readiness_runs/],
  ["activation-onboarding-map.md", /activation_signal_inbox/],
  ["asset-package-map.md", /asset_equivalence_groups/],
  ["commercial-usage-map.md", /commercial_profiles/],
  ["repository-development-map.md", /repo_source_registry/],
  ["platform-resource-graph-map.md", /platform_graph_nodes/],
  ["delivery-support-map.md", /output_artifacts/, /tickets/],
  ["migration-lifecycle-map.md", /data_migration_inventory/],
  ["activation-access-map.md", /agent_skill_grants/, /v_activation_agent_skill_grants/],
  ["repository-automation-map.md", /Docs Agent/, /CI/],
];
for (const [file, ...patterns] of checks) {
  const content = read(`docs/work-maps/${file}`);
  for (const pattern of patterns) assert.match(content, pattern);
}

const coverage = read("docs/work-maps/work-map-coverage-matrix.md");
assert.match(coverage, /Work Map Coverage Matrix/);
assert.match(coverage, /Unresolved schema objects/);
assert.match(coverage, /Intentionally unclassified schema objects/);
assert.match(coverage, /- None\./);

const index = read("docs/work-maps/README.md");
for (const name of expected.filter((name) => name !== "README.md")) {
  assert.match(index, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const clean = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(clean.ok, true);
assert.deepEqual(clean.drift_files, []);

const beforeLineEndingConversion = Object.fromEntries(expected.map((name) => [name, read(`docs/work-maps/${name}`)]));
const { sourceFiles } = buildWorkMaps({ repoRoot });
for (const sourceFile of sourceFiles) {
  const source = fs.readFileSync(sourceFile, "utf8").replace(/\r\n?/g, "\n");
  fs.writeFileSync(sourceFile, source.replace(/\n/g, "\r\n"));
}
const crossPlatformClean = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(crossPlatformClean.ok, true, "CRLF source files must not change generated Work Maps");
assert.deepEqual(crossPlatformClean.drift_files, []);
for (const [name, content] of Object.entries(beforeLineEndingConversion)) {
  assert.equal(read(`docs/work-maps/${name}`), content, `${name} must remain byte-stable across LF and CRLF sources`);
}

write("http-generic-api/migrations/005_plugin.sql", `CREATE TABLE IF NOT EXISTS \`platform_plugin_contributions\` (\`contribution_id\` VARCHAR(36) PRIMARY KEY, \`plugin_key\` VARCHAR(128));`);
const drift = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(drift.ok, false);
for (const file of ["docs/work-maps/agent-skill-plugin-map.md", "docs/work-maps/data-model-domain-map.md", "docs/work-maps/work-map-coverage-matrix.md", "docs/work-maps/README.md"]) {
  assert.ok(drift.drift_files.includes(file), `${file} should drift`);
}

const assets = fs.readdirSync(path.join(repoRoot, "docs/work-maps"));
assert.equal(assets.some((name) => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)), false);

const workflow = fs.readFileSync(new URL("../.github/workflows/docs-agent.yml", import.meta.url), "utf8");
const maintenance = fs.readFileSync(new URL("./scripts/repo-maintenance-sync.mjs", import.meta.url), "utf8");
assert.match(workflow, /platform-work-map-generator\.mjs --write/);
assert.match(workflow, /docs\/work-maps/);
assert.match(maintenance, /platform-work-map-generator\.mjs/);

console.log("deep dynamic text platform work map generator test passed");
