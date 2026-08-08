import assert from "node:assert/strict";
import fs from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const migrationPath = new URL("./migrations/1051_github_repository_policy_live_apply_authority.sql", import.meta.url);
const sql = fs.readFileSync(migrationPath, "utf8");
const statements = splitMigrationSqlStatements(sql);

function stripLeadingSqlComments(statement = "") {
  let value = String(statement || "").trimStart();
  while (value) {
    const next = value
      .replace(/^--[^\n]*(?:\n|$)/, "")
      .replace(/^#[^\n]*(?:\n|$)/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trimStart();
    if (next === value) break;
    value = next;
  }
  return value;
}

assert.equal(statements.length, 6, "Migration 1051 must remain exactly six bounded metadata statements");
for (const statement of statements) {
  const executable = stripLeadingSqlComments(statement);
  assert.match(executable, /^INSERT\b/i, "Migration 1051 must remain additive/idempotent INSERT metadata only");
  assert.doesNotMatch(executable, /^(?:UPDATE|DELETE|DROP|TRUNCATE|ALTER|REPLACE)\b/i, "Migration 1051 must not contain standalone destructive or direct-update statements");
}

assert.match(sql, /github_repository_policy_v2/);
assert.match(sql, /github_repository_policy_controller_readback_v2/);
assert.match(sql, /github_repository_policy_controller_apply_v1/);
assert.match(sql, /growth_intelligence_platform\.github\.repository_policy_controller\.production/);
assert.match(sql, /'repository_policy_controller',\s*'github_repository_policy_apply'/);
assert.match(sql, /'system_layer'/);
assert.match(sql, /JSON_ARRAY\('platform_managed_fallback'\)/);
assert.match(sql, /'APPLY_GITHUB_MAIN_REVIEW_POLICY'/);
assert.match(sql, /allow_external_write[\s\S]*?1/);
assert.match(sql, /allow_credential_binding[\s\S]*?0/);
assert.match(sql, /allow_no_credential_binding[\s\S]*?1/);
assert.match(sql, /requires_same_cycle_dry_run[\s\S]*?1/);
assert.match(sql, /same_cycle_readback_required',TRUE/);
assert.match(sql, /rollback_on_postcondition_failure',TRUE/);
assert.match(sql, /bypass_actors_allowed',FALSE/);
assert.match(sql, /force_push_allowed',FALSE/);
assert.match(sql, /repository_content_mutation_allowed',FALSE/);
assert.match(sql, /live_github_policy_apply',FALSE/);
assert.match(sql, /credential_payload_read',FALSE/);
assert.match(sql, /secrets_included',FALSE/);

assert.doesNotMatch(sql, /https:\/\/api\.github\.com/);
assert.doesNotMatch(sql, /\b(?:DELETE|DROP|TRUNCATE|ALTER)\b/i);
assert.doesNotMatch(sql, /BEGIN\b|COMMIT\b|ROLLBACK\b/i);

console.log(JSON.stringify({
  ok: true,
  test: "github_repository_policy_live_apply_authority",
  statement_count: statements.length,
  standalone_update_statement_count: statements.filter((statement) => /^UPDATE\b/i.test(stripLeadingSqlComments(statement))).length,
  provider_call_executed: false,
  external_write_executed: false,
  live_github_policy_apply: false,
  secrets_included: false,
}));