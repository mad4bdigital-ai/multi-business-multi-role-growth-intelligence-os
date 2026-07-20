import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "./migrations/20260720_tenant_export_manifest_eligibility_hardening.sql",
  "utf8"
);
const executableSql = migration.replace(/^\s*--.*$/gm, "");

assert.match(migration, /CREATE OR REPLACE VIEW v_platform_exports_current/);
assert.match(migration, /FROM tenant_platform_endpoint_tools t/);
assert.match(migration, /EXISTS \([\s\S]*platform_capability_compiled_manifests m/);
assert.match(migration, /m\.capability_key = CONCAT\('tenant_tool\.', t\.tool_key\)/);
assert.match(migration, /m\.is_current = 1/);
assert.match(migration, /m\.status IN \('shadow_ready', 'active', 'certified'\)/);
assert.match(migration, /THEN 'active'[\s\S]*ELSE 'disabled'/);
assert.match(migration, /UPDATE platform_plugin_capability_exports e/);
assert.match(migration, /LEFT JOIN platform_capability_compiled_manifests m/);
assert.match(migration, /e\.exposure_scope = 'tenant'/);
assert.match(migration, /e\.export_surface = 'tenant_platform_tool'/);
assert.match(migration, /e\.source_table = 'tenant_platform_endpoint_tools'/);
assert.match(migration, /m\.capability_key IS NULL OR m\.status NOT IN \('shadow_ready', 'active', 'certified'\)/);

const triggerNames = [
  "trg_tenant_export_manifest_guard_before_insert",
  "trg_tenant_export_manifest_guard_before_update",
  "trg_tenant_export_manifest_guard_after_manifest_insert",
  "trg_tenant_export_manifest_guard_after_manifest_update",
  "trg_tenant_export_manifest_guard_after_manifest_delete",
];
for (const triggerName of triggerNames) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE TRIGGER ${triggerName}`));
}
assert.equal((migration.match(/CREATE OR REPLACE TRIGGER/g) || []).length, 5);
assert.match(migration, /BEFORE INSERT ON platform_plugin_capability_exports/);
assert.match(migration, /BEFORE UPDATE ON platform_plugin_capability_exports/);
assert.match(migration, /AFTER INSERT ON platform_capability_compiled_manifests/);
assert.match(migration, /AFTER UPDATE ON platform_capability_compiled_manifests/);
assert.match(migration, /AFTER DELETE ON platform_capability_compiled_manifests/);
assert.match(migration, /NOT EXISTS \([\s\S]*m\.status IN \('shadow_ready', 'active', 'certified'\)/);
assert.match(migration, /NEW\.export_status = CASE[\s\S]*THEN 'disabled'/);
assert.match(migration, /OLD\.is_current = 1/);
assert.match(migration, /\[disabled: current capability manifest not exportable\]/);

for (const forbidden of [
  /\bDROP\s+(TABLE|VIEW|TRIGGER|DATABASE)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /provider_call/i,
  /credential_payload/i,
  /raw_secret/i,
]) {
  assert.equal(forbidden.test(executableSql), false, `migration must not match ${forbidden}`);
}

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf8"));
assert.match(packageJson.scripts["schemas:guard"], /test-tenant-export-manifest-eligibility\.mjs/);
const manifestSource = fs.readFileSync("./scripts/test-manifest.mjs", "utf8");
assert.match(manifestSource, /node test-tenant-export-manifest-eligibility\.mjs/);

console.log("Tenant export manifest eligibility tests passed.");
