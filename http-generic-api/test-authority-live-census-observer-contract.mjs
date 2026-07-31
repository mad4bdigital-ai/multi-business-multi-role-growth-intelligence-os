import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const observerPath = path.resolve(testDirectory, "../.github/scripts/authority-live-census-observation.mjs");
const source = readFileSync(observerPath, "utf8");

assert.match(source, /mode: "read_only_authority_catalog_census"/);
assert.match(source, /database_mutation_executed: false/);
assert.match(source, /migration_apply_authorized: false/);
assert.match(source, /provider_calls: false/);
assert.match(source, /credential_payload_read: false/);
assert.match(source, /external_writes: false/);
assert.match(source, /secrets_included: false/);
assert.match(source, /statement_result_type === "rows"/);
assert.match(source, /\^\(SELECT\|WITH\|SHOW\)/);
assert.match(source, /INSERT\|UPDATE\|DELETE\|REPLACE\|ALTER\|CREATE\|DROP\|TRUNCATE\|GRANT\|REVOKE\|CALL\|DO\|SET/);

assert.doesNotMatch(source, /COLUMN_DEFAULT/);
assert.doesNotMatch(source, /VIEW_DEFINITION(?!, ''\), 256\) AS definition_sha256)/);
assert.match(source, /SHA2\(COALESCE\(VIEW_DEFINITION, ''\), 256\) AS definition_sha256/);

assert.match(source, /"schema_objects", 2048\)/);
assert.match(source, /"schema_columns", 32768\)/);
assert.match(source, /"schema_indexes", 32768\)/);
assert.match(source, /"schema_foreign_keys", 16384\)/);
assert.match(source, /"schema_views", 2048\)/);
assert.match(source, /"view_dependencies", 20000\)/);

for (const queryKey of [
  "database_identity",
  "schema_objects",
  "schema_columns",
  "schema_indexes",
  "schema_foreign_keys",
  "schema_views",
  "view_dependencies",
  "same_cycle_readback",
]) {
  assert.match(source, new RegExp(`"${queryKey}"`), `${queryKey} must remain in the trusted observer`);
}

assert.match(source, /same_cycle_readback:\s*\{[\s\S]*verified: true/);
assert.match(source, /payload\.observation_sha256 = sha256\(payload\)/);
assert.match(source, /fs\.writeFileSync\(evidencePath/);

console.log("authority live census observer contract tests passed");
