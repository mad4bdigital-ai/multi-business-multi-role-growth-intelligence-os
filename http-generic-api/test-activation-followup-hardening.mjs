import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const config = readFileSync(new URL("./config.js", import.meta.url), "utf8");
const systemLayerRoutes = readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");
const credentialIntakeRoutes = readFileSync(new URL("./routes/credentialIntakeRoutes.js", import.meta.url), "utf8");
const followupDoc = readFileSync(new URL("../docs/activation-followup-hardening-2026-06-07.md", import.meta.url), "utf8");
const repoRoot = new URL("..", import.meta.url);
const apiRoot = new URL(".", import.meta.url);

assert.ok(config.includes("ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID"));
assert.ok(config.includes("process.env.ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID"));
assert.ok(config.includes("process.env.ACTIVATION_PROVIDER_PROBE_SPREADSHEET_ID"));
assert.ok(config.includes("process.env.ACTIVATION_BOOTSTRAP_SPREADSHEET_ID"));
assert.ok(config.includes("Deprecated compatibility alias"));
assert.ok(config.includes("export const ACTIVATION_BOOTSTRAP_SPREADSHEET_ID = ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID"));
assert.ok(systemLayerRoutes.includes('getGoogleClients({ action_key: "google_drive_api" })'));
assert.ok(!systemLayerRoutes.includes("getGoogleClientsForSpreadsheet("));
assert.ok(!systemLayerRoutes.includes("ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID"));
assert.ok(!systemLayerRoutes.includes("ACTIVATION_BOOTSTRAP_SPREADSHEET_ID"));
assert.ok(activationRoutes.includes("activation_bootstrap_authority: \"db_runtime\""));
assert.ok(activationRoutes.includes("legacy_activation_bootstrap_spreadsheet_id_alias"));

assert.ok(systemLayerRoutes.includes('fetchToolsForCaller("tenant")'));
assert.ok(systemLayerRoutes.includes("listTenantEndpointRegistryToolsForPrincipal"));
assert.ok(systemLayerRoutes.includes("toolsForPrincipalWithPlatformEndpoints"));
assert.ok(systemLayerRoutes.includes("tool.requires_admin !== true"));
assert.ok(systemLayerRoutes.includes("admin_system_tool_required"));
assert.ok(!systemLayerRoutes.includes("admin_backend_api_key_required"));

assert.ok(credentialIntakeRoutes.includes("writeCredentialIntakeContinuationTask"));
assert.ok(credentialIntakeRoutes.includes("platform_pending_tasks"));
assert.ok(credentialIntakeRoutes.includes("credential_intake.continuation_task_created"));
assert.ok(credentialIntakeRoutes.includes("enqueueCredentialIntakeCompletedWebhook"));
assert.ok(credentialIntakeRoutes.includes("credential_intake.webhook_enqueue_failed"));
assert.ok(credentialIntakeRoutes.includes("no_user_done_message_required: true"));
assert.ok(credentialIntakeRoutes.includes("secrets_included: false"));

assert.ok(followupDoc.includes("DB-native"));
assert.ok(followupDoc.includes("ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID"));
assert.ok(followupDoc.includes("deprecated compatibility alias"));
assert.ok(followupDoc.includes("Tenant GPT action calls should use the tenant-safe"));
assert.ok(followupDoc.includes("canonical manifest/digest"));
assert.ok(followupDoc.includes("reuse cached/summarized canonical evidence"));
assert.ok(followupDoc.includes("credential_intake.completed"));
assert.ok(followupDoc.includes("secrets_included=false"));

const disallowedOldAliasImports = [];
function walkFiles(dirUrl, prefix = "") {
  const entries = readdirSync(dirUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (rel.includes("node_modules")) continue;
    const childUrl = new URL(`./${rel}`, apiRoot);
    if (entry.isDirectory()) {
      files.push(...walkFiles(childUrl, rel));
    } else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}
for (const rel of walkFiles(apiRoot)) {
  const source = readFileSync(new URL(`./${rel}`, apiRoot), "utf8");
  if (rel === "config.js") continue;
  if (rel === "executionResolution.js") continue; // legacy getSheetValues placeholder compatibility.
  if (rel === "test-sheets-range-drift.mjs") continue; // legacy placeholder test.
  if (/import\s*\{[^}]*ACTIVATION_BOOTSTRAP_SPREADSHEET_ID/.test(source)) {
    disallowedOldAliasImports.push(rel);
  }
}
assert.deepEqual(disallowedOldAliasImports, []);

console.log("activation follow-up hardening tests passed");
