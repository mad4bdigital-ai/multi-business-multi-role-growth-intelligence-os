import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const disposable = readFileSync(new URL("./scripts/brand-skill-mariadb-disposable-certification.mjs", import.meta.url), "utf8");
const staging = readFileSync(new URL("./scripts/brand-skill-staging-preflight-evidence.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/brand-skill-mariadb-certification.yml", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../.github/workflows/brand-skill-staging-preflight-dispatch-bridge.yml", import.meta.url), "utf8");

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
assert.match(workflow, /- name: Validate typed binding inputs\n\s+working-directory: \.\n\s+shell: bash/);
assert.match(workflow, /docs\/\*\*\/brand-skill-migration\.md/);
assert.doesNotMatch(workflow, /docs\/runbooks\/brand-skill-migration\.md/);

for (const marker of [
  "issue_comment:",
  "github.event.issue.number == 3809",
  "github.event.issue.pull_request == null",
  "AUTHORIZE_BRAND_SKILL_STAGING_READ_ONLY_PREFLIGHT_E1084397_ECA204DC",
  "AUTHORIZATION_COMMENT_ID: \"5136135941\"",
  "contains(fromJSON('[\"OWNER\",\"MEMBER\",\"COLLABORATOR\"]')",
  "brand-skill-mariadb-certification.yml",
  "/actions/workflows/${TARGET_WORKFLOW}/dispatches",
  "run_mode:$mode",
  "expected_commit_sha:$commit",
  "expected_migration_sha256:$checksum",
  "e1084397317a7f2645d78fc43a3064eef98fabaf",
  "eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802",
  "e36f9241a819018659788edb2a8a854da641b4b8",
  "1e90ac74cfff2413ee10abf5986bc2b28bcf5ad7",
  "BRAND_SKILL_STAGING_PREFLIGHT_DISPATCH status=claiming",
  "BRAND_SKILL_STAGING_PREFLIGHT_DISPATCH status=dispatched",
  "BRAND_SKILL_STAGING_PREFLIGHT_DISPATCH status=completed",
  "brand-skill-staging-read-only-preflight",
  "requires_separate_apply_authorization: true",
  "applies_sql: false",
  "records_ledger: false",
  "migration_apply_authorized: false",
  "production_authorized: false",
  "provider_calls: false",
  "external_writes: false",
  "secrets_included: false",
  "state_reason=completed",
]) assert(bridge.includes(marker), `dispatch bridge missing ${marker}`);
assert.doesNotMatch(bridge, /pull_request_target:/);
assert.doesNotMatch(bridge, /environment:\s*staging/i);
assert.doesNotMatch(bridge, /secrets\./);
assert.doesNotMatch(bridge, /STAGING_DB_/);
assert.doesNotMatch(bridge, /governed-migration-runner\.mjs/);
assert.doesNotMatch(bridge, /--apply/);
assert.doesNotMatch(bridge, /environment:\s*production/i);
assert.doesNotMatch(bridge, /PRODUCTION_DB_/);

console.log("PASS brand skill MariaDB certification contract");
