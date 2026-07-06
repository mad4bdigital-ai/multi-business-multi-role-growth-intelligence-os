import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationName = "1032_sprint69_registry_export_legacy_hygiene.sql";
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
assert.match(migration, /LEFT JOIN endpoints endpoint_row\s+ON endpoint_row\.id = export_row\.source_endpoint_id/);
assert.match(migration, /SET export_row\.status = 'archived'/);
assert.match(migration, /export_row\.status = 'active'/);
assert.match(migration, /NOT EXISTS \(\s*SELECT 1\s+FROM platform_tool_dispatch_bindings binding_row/s);
assert.match(migration, /binding_row\.export_key = export_row\.export_key/);
assert.match(migration, /binding_row\.status = 'active'/);
assert.match(migration, /export_row\.source_endpoint_id IS NULL/);
assert.match(migration, /endpoint_row\.id IS NULL/);
assert.match(migration, /endpoint_row\.status <> 'active'/);
assert.match(migration, /admin tool rows, if any, are not modified/);
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

console.log("registry export legacy hygiene tests passed");
