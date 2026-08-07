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
assert.equal((runner.match(/tool:\s*'db'/g) || []).length, 1, 'Migration 1049 runner must contain exactly one direct DB operation');
assert.match(runner, /const READBACK_SQL = `SELECT\s+/);
for (const forbidden of [
  /mysql\s+-/i, /mariadb\s+-/i,
  /tool:\s*'db'[\s\S]{0,500}\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|REPLACE)\b/i,
  /apply_retried:\s*true/i,
  /APPLY_GITHUB_MAIN_REVIEW_POLICY/,
]) assert.doesNotMatch(runner, forbidden, `Migration 1049 rollout violates safety contract: ${forbidden}`);

assert.ok(!workflow.includes('issues: write'), 'Rollout producer must remain read-only to GitHub issue metadata');
assert.ok(publisherWorkflow.includes('workflow_run:'));
assert.ok(publisherWorkflow.includes('issues: write'));
assert.ok(publisherWorkflow.includes('github.event.workflow_run.conclusion == \'success\''));
assert.ok(publisherWorkflow.includes('actions/download-artifact@v4'));
assert.ok(publisherWorkflow.includes('migration-1049-readiness-issue-publisher.mjs'));

for (const expected of [
  "const EXPECTED_WORKFLOW = 'Governed Migration 1049 GitHub Repository Policy Rollout'",
  'const ISSUE = Number(process.env.CONTROL_ISSUE || 6612)',
  "const READY_PREFIX = 'GITHUB_REPOSITORY_POLICY_1049_READINESS result=pass '",
  "sourceRun?.event, 'issue_comment'",
  "sourceRun?.conclusion, 'success'",
  "summary?.result, 'ready_for_apply'",
  "summary?.authorization, 'pass'",
  "summary?.dry_run, 'pass'",
  "method: 'POST'",
  'issues/${ISSUE}/comments',
  "action: 'unchanged'",
]) assert.ok(publisher.includes(expected), `Migration 1049 publisher missing ${expected}`);

console.log('PASS governed Migration 1049 repository-policy rollout contract');
