import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";

const migrationName = "20260719_reactivate_github_raw_contents_endpoint.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

for (const marker of [
  "github_api_mcp",
  "getFileContents",
  "github_get_contents",
  "target.status = 'active'",
  "target.execution_readiness = source.execution_readiness",
  "target.schema_json = source.schema_json",
  "same_cycle_readback_required=true",
  "no_provider_mutation=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `raw contents migration missing ${marker}`);
}

assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
assert.doesNotMatch(migration, /(client_secret|backend_api_key|jwt_secret|access_token)/i);
assert.equal(splitSqlStatements(migration).length, 1);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("PASS github raw contents endpoint contract");
