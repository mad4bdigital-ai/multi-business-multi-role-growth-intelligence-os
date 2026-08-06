import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationName = "1048_transport_response_chunk_schema_recovery.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
const storeSource = readFileSync(new URL("./governedToolResponseChunkStore.js", import.meta.url), "utf8");

const requiredColumnsMatch = storeSource.match(
  /GOVERNED_RESPONSE_CHUNK_REQUIRED_COLUMNS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/u,
);
assert.ok(requiredColumnsMatch, "Unable to resolve the runtime response-chunk column contract.");

const requiredColumns = [...requiredColumnsMatch[1].matchAll(/["']([a-z0-9_]+)["']/giu)]
  .map((match) => match[1]);
assert.equal(requiredColumns.length, 16, "Runtime response-chunk contract must remain explicit.");

for (const column of requiredColumns) {
  assert.ok(
    migration.includes(`'${column}'`) || migration.includes(`${column} `),
    `Transport recovery migration is missing runtime column ${column}.`,
  );
}

for (const marker of [
  "CREATE TABLE IF NOT EXISTS governed_tool_response_chunks",
  "information_schema.columns",
  "information_schema.statistics",
  "idx_governed_chunk_owner_user_expiry",
  "idx_governed_chunk_principal_expiry",
  "v_governed_response_chunk_transport_schema_readiness",
  "required_column_count",
  "present_column_count",
  "secrets_included",
]) {
  assert.ok(migration.includes(marker), `Transport recovery migration is missing ${marker}.`);
}

for (const unrelatedSurface of [
  "tenant_resolution_cases",
  "tenant_resolution_case_events",
  "tenant_resolution_readbacks",
  "ticket_lifecycle_events",
  "ALTER TABLE tickets",
  "REGISTRY_SPREADSHEET_ID",
]) {
  assert.ok(
    !migration.includes(unrelatedSurface),
    `Transport recovery migration must not depend on unrelated surface ${unrelatedSurface}.`,
  );
}

assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT|REPLACE)\b/mi);
assert.doesNotMatch(migration, /(client_secret|backend_api_key|jwt_secret|access_token)/i);
assert.match(migration, /secrets_included=false/i);

console.log("PASS transport response chunk schema recovery");
