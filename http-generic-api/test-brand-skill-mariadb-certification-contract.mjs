import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const disposable = readFileSync(new URL("./scripts/brand-skill-mariadb-disposable-certification.mjs", import.meta.url), "utf8");
const staging = readFileSync(new URL("./scripts/brand-skill-staging-preflight-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/brand-skill-mariadb-certification.yml", import.meta.url), "utf8");

for (const marker of [
  "brand_skill_mariadb_disposable_v1",
  "assessBrandSkillMigrationPreflight",
  "splitSqlStatements",
  "statements.length === 3",
  "delimiter_collision_prevented",
  "suspended_status_accepted",
  "connection.rollback()",
  "applies_to_disposable_only: true",
  "production_authorized: false",
  "staging_apply_authorized: false",
  "secrets_included: false",
]) assert(disposable.includes(marker), `disposable certification missing ${marker}`);
assert.doesNotMatch(disposable, /governed-migration-runner\.mjs[\s\S]*--apply/);
assert.doesNotMatch(disposable, /process\.env\.(PRODUCTION|HOSTINGER)/);

for (const marker of [
  'targetEnvironment === "staging"',
  "BRAND_SKILL_PREFLIGHT_NON_STAGING_TARGET_BLOCKED",
  "BRAND_SKILL_CHECKOUT_COMMIT_MISMATCH",
  "BRAND_SKILL_MIGRATION_CHECKSUM_MISMATCH",
  "applies_sql: false",
  "records_ledger: false",
  "migration_apply_authorized: false",
  "requires_separate_apply_authorization: true",
  "secrets_included: false",
]) assert(staging.includes(marker), `staging evidence missing ${marker}`);
assert.doesNotMatch(staging, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[\s\S]*pool\.query/i);
assert.doesNotMatch(staging, /--apply/);

for (const marker of [
  "workflow_dispatch:",
  "disposable-mariadb-certification:",
  "staging-read-only-preflight:",
  "environment: staging",
  "inputs.run_mode == 'staging_read_only'",
  "STAGING_DB_HOST",
  "STAGING_DB_NAME",
  "STAGING_DB_USER",
  "STAGING_DB_PASSWORD",
  "expected_commit_sha",
  "expected_migration_sha256",
  "brand-skill-mariadb-certification.json",
  "brand-skill-staging-preflight.json",
]) assert(workflow.includes(marker), `workflow missing ${marker}`);
assert.doesNotMatch(workflow, /governed-migration-runner\.mjs[\s\S]*--apply/);
assert.doesNotMatch(workflow, /environment:\s*production/i);
assert.doesNotMatch(workflow, /PRODUCTION_DB_/);

console.log("PASS brand skill MariaDB certification contract");
