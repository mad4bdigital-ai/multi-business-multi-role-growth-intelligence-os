import assert from "node:assert/strict";
import fs from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const contractMigrationName = "20260718_expand_resource_authority_shell_alias_contract.sql";
const repairMigrationName = "20260718_repair_resource_authority_grant_tags_csv.sql";

const contractMigration = fs.readFileSync(
  new URL(`./migrations/${contractMigrationName}`, import.meta.url),
  "utf8",
);
const repairMigration = fs.readFileSync(
  new URL(`./migrations/${repairMigrationName}`, import.meta.url),
  "utf8",
);

for (const [migrationName, migrationSql] of [
  [contractMigrationName, contractMigration],
  [repairMigrationName, repairMigration],
]) {
  assert.match(
    migrationSql,
    /tags\s*=\s*'admin,resource_authority,state_changing,dry_run_default,typed_confirmation,readback,/,
    `${migrationName} must persist canonical comma-separated governance tags`,
  );
  assert.doesNotMatch(
    migrationSql,
    /tags\s*=\s*JSON_ARRAY\s*\(/i,
    `${migrationName} must not write JSON text to the legacy CSV tags column`,
  );
  assert.doesNotMatch(migrationSql, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);

  for (const marker of [
    "no_provider_call=true",
    "no_credential_payload_read=true",
    "no_raw_secrets=true",
    "no_external_send=true",
    "no_external_write=true",
    "secrets_included=false",
  ]) {
    assert.ok(migrationSql.includes(marker), `${migrationName} missing ${marker}`);
  }

  const preflight = assessMigrationSqlPreflight(migrationName, migrationSql);
  assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
  assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
  assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));
}

for (const marker of [
  "platform_resource_authority_grant_apply",
  "shell_alias",
  "dev_growth_intelligence_pilot_read",
  "dev_growth_intelligence_pilot_apply",
  "dev_governed_migration_client",
  "dev_governed_migration_client_apply",
  "no_arbitrary_shell",
  "expected_commit_sha",
]) {
  assert.ok(contractMigration.includes(marker), `contract migration missing ${marker}`);
}

assert.match(repairMigration, /WHERE tool_key = 'platform_resource_authority_grant_apply'/);
assert.doesNotMatch(
  contractMigration + repairMigration,
  /shell:\/\/powershell|shell:\/\/bash|arbitrary_shell_allowed[^\n]*true/i,
);

console.log("platform resource authority tags contract tests passed");
