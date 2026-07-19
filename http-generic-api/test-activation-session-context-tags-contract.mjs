import assert from "node:assert/strict";
import fs from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationNames = [
  "20260717_runtime_contract_root_cause_reconciliation.sql",
  "20260718_repair_activation_session_context_tool_registration.sql",
  "20260719_repair_activation_session_context_tags_csv.sql",
];

for (const migrationName of migrationNames) {
  const sql = fs.readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");

  assert.ok(
    sql.includes("activation,session,read_only,diagnostic"),
    `${migrationName} must persist canonical comma-separated session-context tags`,
  );
  assert.doesNotMatch(
    sql,
    /JSON_ARRAY\s*\(\s*'activation'\s*,\s*'session'\s*,\s*'read_only'\s*,\s*'diagnostic'\s*\)/i,
    `${migrationName} must not write JSON text into the legacy CSV tags column`,
  );
  assert.doesNotMatch(sql, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

  for (const marker of [
    "no_provider_call=true",
    "no_credential_payload_read=true",
    "no_raw_secrets=true",
    "no_external_send=true",
    "no_external_write=true",
    "secrets_included=false",
  ]) {
    assert.ok(sql.includes(marker), `${migrationName} missing safety marker ${marker}`);
  }

  const preflight = assessMigrationSqlPreflight(migrationName, sql);
  assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
  assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
  assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));
}

const repairSql = fs.readFileSync(
  new URL("./migrations/20260719_repair_activation_session_context_tags_csv.sql", import.meta.url),
  "utf8",
);
assert.match(repairSql, /WHERE tool_key = 'activation_session_context_read_only'/);

console.log("activation session-context tags contract tests passed");
