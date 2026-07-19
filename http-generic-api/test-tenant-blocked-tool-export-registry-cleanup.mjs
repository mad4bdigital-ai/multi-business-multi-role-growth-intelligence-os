import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = "./migrations/20260719_tenant_blocked_tool_exports_fail_closed.sql";
const migration = fs.readFileSync(migrationPath, "utf8");

const expectedToolKeys = [
  "connect_credential_intake_create",
  "connector_agent_runtime",
  "gpt_session_conversation_ref_capture_current",
  "gpt_session_conversation_ref_mark_primary",
  "local_gateway_tools_call",
  "support_ticket_event_append",
  "tenant_agent_surface_deployment_upsert",
  "tenant_repository_intelligence_v3_v4_readiness_smoke",
];

assert.match(migration, /UPDATE tenant_platform_endpoint_tools AS t/);
assert.match(migration, /JOIN platform_capability_compiled_manifests AS m/);
assert.match(migration, /m\.capability_key = CONCAT\('tenant_tool\.', t\.tool_key\)/);
assert.match(migration, /m\.is_current = 1/);
assert.match(migration, /m\.status = 'blocked'/);
assert.match(migration, /SET t\.is_enabled = 0/);
assert.match(migration, /WHERE t\.is_enabled = 1/);
assert.match(migration, /manifest_blocked/);
assert.match(migration, /fail_closed/);
assert.match(migration, /CURRENT_TIMESTAMP/);

for (const toolKey of expectedToolKeys) {
  assert.match(migration, new RegExp(`'${toolKey}'`), `${toolKey} must be covered by the cleanup`);
}

const inClause = migration.match(/t\.tool_key IN \(([\s\S]*?)\)\s*;/)?.[1] || "";
const coveredKeys = [...inClause.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
assert.deepEqual(coveredKeys, expectedToolKeys);

const updateStatements = migration.match(/\bUPDATE\b/gi) || [];
assert.equal(updateStatements.length, 1, "cleanup migration must contain exactly one UPDATE statement");

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
  assert.equal(forbidden.test(migration), false, `migration must not match ${forbidden}`);
}

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
assert.match(packageJson.scripts["schemas:guard"], /test-tenant-blocked-tool-export-registry-cleanup\.mjs/);

const manifestSource = fs.readFileSync("./scripts/test-manifest.mjs", "utf8");
assert.match(manifestSource, /node test-tenant-blocked-tool-export-registry-cleanup\.mjs/);

console.log("Tenant blocked tool export registry cleanup tests passed.");
