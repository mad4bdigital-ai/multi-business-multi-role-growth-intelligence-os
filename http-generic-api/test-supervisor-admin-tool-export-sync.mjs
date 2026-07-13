import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";
import { checkSupervisorAdminToolExportSync } from "./scripts/check-supervisor-admin-tool-export-sync.mjs";

const result = checkSupervisorAdminToolExportSync();
assert.equal(result.ok, true, JSON.stringify(result, null, 2));
assert.equal(result.tools_checked, 3);
assert.equal(result.secrets_included, false);

const migrationName = "20260711_supervisor_runtime_admin_tool_exports.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
for (const marker of [
  "supervisor_runtime_readiness",
  "supervisor_behavioral_certification",
  "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION",
  "no_provider_call=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `migration missing ${marker}`);
}
assert.doesNotMatch(migration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("supervisor Admin tool export sync contract OK");
