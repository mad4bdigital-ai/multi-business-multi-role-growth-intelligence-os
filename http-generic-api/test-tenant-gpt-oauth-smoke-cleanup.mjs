import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";

for (const removedPath of [
  "../docs/tenant-gpt-oauth-live-smoke.md",
  "./scripts/tenant-gpt-oauth-live-smoke.mjs",
  "./scripts/tenant-gpt-oauth-live-smoke-capture.mjs",
  "./test-tenant-gpt-oauth-live-smoke.mjs",
  "./test-tenant-gpt-oauth-live-smoke-capture.mjs",
]) {
  assert.equal(existsSync(new URL(removedPath, import.meta.url)), false, `${removedPath} must be removed after production verification`);
}

const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const authorityTool = readFileSync(new URL("./platformResourceAuthorityGrantTool.js", import.meta.url), "utf8");
assert.doesNotMatch(adminCli, /tenant_gpt_oauth_live_smoke|tenant-gpt-oauth-live-smoke/);
assert.doesNotMatch(authorityTool, /tenant_gpt_oauth_live_smoke/);

const migrationName = "20260720_cleanup_tenant_gpt_oauth_smoke_authority.sql";
const migration = readFileSync(new URL(`./migrations/${migrationName}`, import.meta.url), "utf8");
for (const marker of [
  "platform_resource_authority_grant_apply",
  "shell://tenant_gpt_oauth_live_smoke",
  "status = 'revoked'",
  "temporary_production_smoke_cleanup=true",
  "same_cycle_readback_required=true",
  "secrets_included=false",
]) {
  assert.ok(migration.includes(marker), `cleanup migration missing ${marker}`);
}
assert.equal(splitSqlStatements(migration).length, 2);
assert.doesNotMatch(migration, /^\s*(DELETE FROM|DROP|TRUNCATE|ALTER)\b/mi);
const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
assert.equal(preflight.risk_count, 0, JSON.stringify(preflight, null, 2));
assert.equal(preflight.secrets_included, false, JSON.stringify(preflight, null, 2));

console.log("PASS tenant-gpt-oauth-smoke-cleanup");
