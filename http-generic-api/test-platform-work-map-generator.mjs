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
ALTER TABLE \`execution_log\`
  ADD COLUMN IF NOT EXISTS \`brand_evidence_json\` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS \`business_activity_evidence_json\` LONGTEXT NULL;
CREATE OR REPLACE VIEW \`v_execution_log_evidence_readiness\` AS SELECT 1;
INSERT INTO execution_policies (policy_key) VALUES ('execution_log_evidence_policy_v1');
`);
write("http-generic-api/activation-surfaces/agent_skill_grants.json", JSON.stringify({
  surface_key: "agent_skill_grants",
  source_table: "v_activation_agent_skill_grants",
  include_for_admin: true,
  include_for_tenant: true,
  status: "active",
  result_columns: ["grant_id", "tenant_id", "agent_id", "skill_id"],
}, null, 2));
write(".github/workflows/ci.yml", `name: CI\non:\n  pull_request:\n  push:\n  workflow_dispatch:\n`);
write(".github/workflows/docs-agent.yml", `name: Docs Agent\non:\n  pull_request:\n  push:\n`);
write("prompt_router.md", "# Prompt Router\n");
write("module_loader.md", "# Module Loader\n");
write("system_bootstrap.md", "# System Bootstrap\n");
write("http-generic-api/connectorExecutor.js", "export const connectorExecutor = true;\n");
write("http-generic-api/agentRuntime.js", "export const agentRuntime = true;\n");

const first = syncWorkMaps({ repoRoot, mode: "write" });
assert.equal(first.ok, true);
assert.equal(first.generated_count, 5);
assert.equal(first.image_assets_generated, false);
assert.equal(first.secrets_included, false);

const expected = [
  "README.md",
  "activation-access-map.md",
  "execution-log-evidence-map.md",
  "platform-runtime-map.md",
  "repository-automation-map.md",
];
for (const name of expected) {
  const file = path.join(repoRoot, "docs/work-maps", name);
  assert.equal(fs.existsSync(file), true, `${name} should be generated`);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /Generated text documentation|Dynamic Platform Work Maps/);
  assert.doesNotMatch(text, /password\s*=|token\s*=|private[_ -]?key\s*=/i);
}

const execution = fs.readFileSync(path.join(repoRoot, "docs/work-maps/execution-log-evidence-map.md"), "utf8");
assert.match(execution, /```mermaid/);
assert.match(execution, /writeExecutionEvidence/);
assert.match(execution, /brand_evidence_json/);
assert.match(execution, /business_activity_evidence_json/);
assert.match(execution, /execution_log_evidence_policy_v1/);

const activation = fs.readFileSync(path.join(repoRoot, "docs/work-maps/activation-access-map.md"), "utf8");
assert.match(activation, /agent_skill_grants/);
assert.match(activation, /v_activation_agent_skill_grants/);

const automation = fs.readFileSync(path.join(repoRoot, "docs/work-maps/repository-automation-map.md"), "utf8");
assert.match(automation, /Docs Agent/);
assert.match(automation, /CI/);

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
const drift = syncWorkMaps({ repoRoot, mode: "check" });
assert.equal(drift.ok, false);
assert.ok(drift.drift_files.includes("docs/work-maps/activation-access-map.md"));
assert.ok(drift.drift_files.includes("docs/work-maps/README.md"));

const generatedAssets = fs.readdirSync(path.join(repoRoot, "docs/work-maps"));
assert.equal(generatedAssets.some((name) => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name)), false);

const workflow = fs.readFileSync(new URL("../.github/workflows/docs-agent.yml", import.meta.url), "utf8");
const maintenance = fs.readFileSync(new URL("./scripts/repo-maintenance-sync.mjs", import.meta.url), "utf8");
assert.match(workflow, /platform-work-map-generator\.mjs --write/);
assert.match(workflow, /docs\/work-maps/);
assert.match(maintenance, /platform-work-map-generator\.mjs/);

console.log("dynamic text platform work map generator test passed");
