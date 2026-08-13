import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/github-repository-policy-1049-governed-rollout.yml', import.meta.url), 'utf8');
const publisherWorkflow = readFileSync(new URL('../.github/workflows/migration-1049-readiness-evidence-publisher.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../.github/ops/github-repository-policy-1049-governed-rollout.mjs', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('./scripts/migration-1049-readiness-issue-publisher.mjs', import.meta.url), 'utf8');

for (const expected of [
  'github.event.issue.number == 6612',
  'AUTHORIZE_GOVERNED_MIGRATION_1049_GITHUB_REPOSITORY_POLICY_SINGLE_OWNER_MODE',
  'APPLY_1049_GITHUB_REPOSITORY_POLICY_SINGLE_OWNER_MODE',
  'VERIFY_GOVERNED_MIGRATION_1049_GITHUB_REPOSITORY_POLICY_SINGLE_OWNER_MODE',
  'ROLLOUT_PHASE: readiness', 'ROLLOUT_PHASE: apply', 'ROLLOUT_PHASE: verify',
]) assert.ok(workflow.includes(expected), `Migration 1049 workflow is missing ${expected}`);

for (const expected of [
  "const MIGRATION = '1049_github_repository_policy_single_owner_mode.sql'",
  "const MIGRATION_BLOB_SHA = '55f9996b736debf072d1a54c2f19adf7fcd8c704'",
  'const EXPECTED_STATEMENT_COUNT = 4',
  'const SOURCE_PR = 6550',
  "const SOURCE_MERGE_SHA = 'f3f98374a8207c6106aea8a6a334e38101defed1'",
  "const AUTH_CONFIRM = `AUTHORIZE_GOVERNED_MIGRATION_${CONFIRMATION_KEY}`",
  "const APPLY_CONFIRM = `APPLY_${CONFIRMATION_KEY}`",
  "name: 'governed_migration_execute'",
  "mode: 'dry_run'", "mode: 'apply'",
  "name: 'governed_migration_schema_readback'",
  'Apply was not retried', 'apply_retried: false',
  "review_policy_mode, 'auto_single_owner_or_independent'",
  "single_owner_gate_check, 'Single Owner Review Gate'",
  "single_owner_input_type, 'boolean'",
  "authorization_status, 'authorized'",
  'live_github_policy_apply_performed: false',
]) assert.ok(runner.includes(expected), `Migration 1049 runner is missing ${expected}`);

assert.equal((runner.match(/mode:\s*'apply'/g) || []).length, 1, 'Migration 1049 runner must contain exactly one Apply invocation literal');
assert.ok(runner.includes("import { buildAdminControlDbReadRequest } from './lib/admin-control-db-request.mjs';"), 'Migration 1049 runner must import the shared Admin DB request builder');
assert.equal((runner.match(/tool:\s*'db'/g) || []).length, 0, 'Migration 1049 runner must not handcraft Admin DB control requests');
assert.equal((runner.match(/buildAdminControlDbReadRequest\(\{/g) || []).length, 1, 'Migration 1049 runner must use the shared Admin DB request builder exactly once');
assert.match(runner, /const READBACK_SQL = `SELECT\s+/);
assert.ok(runner.includes("const SAFE_EVIDENCE_KEYS = new Set(['secrets_included']);"), 'Migration 1049 runner must preserve the safe secrets_included evidence boolean');
assert.ok(runner.includes("redactKey.test(key) && !SAFE_EVIDENCE_KEYS.has(key) ? '[redacted]' : sanitize(child)"), 'Migration 1049 sanitizer must redact sensitive keys except explicitly safe evidence flags');
assert.ok(publisher.includes("assert.equal(summary?.secrets_included, false);"), 'Trusted publisher must continue to require explicit no-secret evidence');
for (const forbidden of [
  /mysql\s+-/i, /mariadb\s+-/i,
  /tool:\s*'db'[\s\S]{0,500}\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/i,
  /apply_retried:\s*true/i,
  /APPLY_GITHUB_MAIN_REVIEW_POLICY/,
]) assert.doesNotMatch(runner, forbidden, `Migration 1049 rollout violates safety contract: ${forbidden}`);

const authorizationStage = runner.indexOf("stage = 'authorization_bootstrap'; await bootstrapAuthorization(envelopeId);");
const dryRunStage = runner.indexOf("stage = 'dry_run'; await dryRun();");
const readySummaryStage = runner.indexOf("result: 'ready_for_apply'");
assert.ok(authorizationStage >= 0 && dryRunStage > authorizationStage && readySummaryStage > dryRunStage,
  'ready_for_apply must be emitted only after successful authorization bootstrap and dry-run');

assert.ok(!workflow.includes('issues: write'), 'Rollout producer must remain read-only to GitHub issue metadata');
assert.ok(publisherWorkflow.includes('workflow_run:'));
assert.ok(publisherWorkflow.includes('issues: write'));
assert.ok(publisherWorkflow.includes('github.event.workflow_run.conclusion == \'success\''));
assert.ok(publisherWorkflow.includes('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4'));
assert.ok(publisherWorkflow.includes('migration-1049-readiness-issue-publisher.mjs'));

for (const expected of [
  "const EXPECTED_WORKFLOW = 'Governed Migration 1049 GitHub Repository Policy Rollout'",
  'const ISSUE = Number(process.env.CONTROL_ISSUE || 6612)',
  "const EXPECTED_SOURCE_MERGE_SHA = 'f3f98374a8207c6106aea8a6a334e38101defed1'",
  "const READY_PREFIX = 'GITHUB_REPOSITORY_POLICY_1049_READINESS result=pass '",
  "sourceRun?.event, 'issue_comment'",
  "sourceRun?.conclusion, 'success'",
  "summary?.result, 'ready_for_apply'",
  "summary?.dry_run, 'pass'",
  "summary?.source_merge_status",
  'source_merge=${EXPECTED_SOURCE_MERGE_SHA}',
  "method: 'POST'",
  'issues/${ISSUE}/comments',
  "action: 'unchanged'",
]) assert.ok(publisher.includes(expected), `Migration 1049 publisher missing ${expected}`);

assert.ok(!publisher.includes('summary?.authorization'), 'Trusted publisher must not depend on a sanitizer-redacted authorization field');
assert.ok(!publisher.includes('summary?.source_merge_sha'), 'Trusted publisher must not depend on an optional source_merge_sha field from readiness summary');

console.log('PASS governed Migration 1049 repository-policy rollout contract');
