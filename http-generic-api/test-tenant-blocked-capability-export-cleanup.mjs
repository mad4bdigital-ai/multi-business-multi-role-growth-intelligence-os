import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = "./migrations/20260719_tenant_blocked_capability_exports_fail_closed.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

const expectedExportKeys = [
  "tenant_tool_export.connect_credential_intake_create",
  "tenant_tool_export.connector_agent_runtime",
  "tenant_tool_export.gpt_session_conversation_ref_capture_current",
  "tenant_tool_export.gpt_session_conversation_ref_mark_primary",
  "tenant_tool_export.local_gateway_tools_call",
  "tenant_tool_export.support_ticket_event_append",
  "tenant_tool_export.tenant_agent_surface_deployment_upsert",
  "tenant_tool_export.tenant_repository_intelligence_v3_v4_readiness_smoke",
];

assert.match(migration, /UPDATE platform_plugin_capability_exports AS e/);
assert.match(migration, /JOIN platform_capability_compiled_manifests AS m/);
assert.match(migration, /m\.capability_key = e\.capability_key/);
assert.match(migration, /m\.is_current = 1/);
assert.match(migration, /m\.status = 'blocked'/);
assert.match(migration, /SET e\.export_status = 'disabled'/);
assert.match(migration, /WHERE e\.export_status = 'active'/);
assert.match(migration, /e\.exposure_scope = 'tenant'/);
assert.match(migration, /e\.export_surface = 'tenant_platform_tool'/);
assert.match(migration, /e\.source_table = 'tenant_platform_endpoint_tools'/);
assert.match(migration, /CURRENT_TIMESTAMP/);

for (const exportKey of expectedExportKeys) {
  assert.match(migration, new RegExp(`'${exportKey.replaceAll(".", "\\.")}'`), `${exportKey} must be covered by the cleanup`);
}

const inClause = migration.match(/e\.export_key IN \(([\s\S]*?)\)\s*;/)?.[1] || "";
const coveredKeys = [...inClause.matchAll(/'([a-z0-9_.]+)'/g)].map((match) => match[1]);
assert.deepEqual(coveredKeys, expectedExportKeys);

const executableSql = migration.replace(/^\s*--.*$/gm, "");
const updateStatements = executableSql.match(/\bUPDATE\b/gi) || [];
assert.equal(updateStatements.length, 1, "cleanup migration must contain exactly one executable UPDATE statement");

for (const forbidden of [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\b/i,
  /UPDATE\s+platform_capability_compiled_manifests/i,
  /INSERT\s+INTO\s+platform_capability_compiled_manifests/i,
  /provider_call/i,
  /credential_payload/i,
  /raw_secret/i,
]) {
  assert.equal(forbidden.test(executableSql), false, `migration must not match ${forbidden}`);
}

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
assert.match(packageJson.scripts["schemas:guard"], /test-tenant-blocked-capability-export-cleanup\.mjs/);

const manifestSource = fs.readFileSync("./scripts/test-manifest.mjs", "utf8");
assert.match(manifestSource, /node test-tenant-blocked-capability-export-cleanup\.mjs/);

console.log("Tenant blocked capability export cleanup tests passed.");
