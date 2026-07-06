import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationName = "1029_sprint69_registry_export_schema_parity_gate.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `missing migration safety marker ${marker}`);
}

assert.match(migration, /UPDATE platform_endpoint_tool_exports export_row/);
assert.match(migration, /JOIN endpoints endpoint_row\s+ON endpoint_row\.id = export_row\.source_endpoint_id/);
assert.match(migration, /export_row\.input_schema_json = endpoint_row\.schema_json/);
assert.match(migration, /export_row\.status = 'active'/);
assert.match(migration, /endpoint_row\.status = 'active'/);
assert.match(migration, /endpoint_row\.schema_json IS NOT NULL/);
assert.match(migration, /NOT \(export_row\.input_schema_json <=> endpoint_row\.schema_json\)/);

assert.match(migration, /CREATE OR REPLACE VIEW v_platform_endpoint_export_schema_parity AS/);
for (const column of [
  "missing_source_endpoint",
  "missing_endpoint_row",
  "endpoint_inactive",
  "endpoint_not_ready",
  "schema_mismatch",
  "schema_parity_status",
]) {
  assert.ok(migration.includes(column), `missing parity column ${column}`);
}
assert.match(migration, /WHEN NOT \(export_row\.input_schema_json <=> endpoint_row\.schema_json\) THEN 'schema_mismatch'/);
assert.match(migration, /ELSE 'pass'/);

assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER)\b/i);
assert.doesNotMatch(migration, /fetch\s*\(/);
assert.doesNotMatch(migration, /axios\s*\(/);
assert.doesNotMatch(migration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);
assert.equal((migration.match(/^UPDATE\s+/gmi) || []).length, 1);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.counts.update, 1, JSON.stringify(preflight, null, 2));
assert.equal(preflight.counts.update_guarded, 1, JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("platform endpoint export schema parity tests passed");
