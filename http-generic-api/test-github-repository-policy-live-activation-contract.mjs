import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const migrationWorkflow = read('../.github/workflows/github-repository-policy-1051-governed-rollout.yml');
const liveWorkflow = read('../.github/workflows/github-main-review-policy-live-activation.yml');
const publisherWorkflow = read('../.github/workflows/github-main-review-policy-readiness-publisher.yml');
const migrationRunner = read('../.github/ops/github-repository-policy-1051-governed-rollout.mjs');
const liveRunner = read('../.github/ops/github-main-review-policy-live-activation.mjs');
const publisher = read('./scripts/github-main-review-policy-readiness-issue-publisher.mjs');

assert.match(migrationWorkflow, /^name: Governed Migration 1051 GitHub Repository Policy Authority Rollout/m);
assert.match(migrationWorkflow, /permissions:\n  contents: read/);
assert.doesNotMatch(migrationWorkflow, /issues:\s*write/);
assert.match(migrationWorkflow, /AUTHORIZE_GOVERNED_MIGRATION_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /APPLY_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /VERIFY_GOVERNED_MIGRATION_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /SOURCE_PR: '6631'/);
assert.match(migrationWorkflow, /persist-credentials: false/);

assert.match(liveWorkflow, /^name: Governed GitHub Main Review Policy Live Activation/m);
assert.match(liveWorkflow, /permissions:\n  contents: read/);
assert.doesNotMatch(liveWorkflow, /issues:\s*write/);
assert.match(liveWorkflow, /AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS/);
assert.match(liveWorkflow, /github\.event\.comment\.body == 'APPLY_GITHUB_MAIN_REVIEW_POLICY'/);
assert.match(liveWorkflow, /VERIFY_GITHUB_MAIN_REVIEW_POLICY/);
assert.match(liveWorkflow, /persist-credentials: false/);

assert.match(publisherWorkflow, /^name: GitHub Main Review Policy Readiness Publisher/m);
assert.match(publisherWorkflow, /workflow_run:/);
assert.match(publisherWorkflow, /Governed GitHub Main Review Policy Live Activation/);
assert.match(publisherWorkflow, /actions: read/);
assert.match(publisherWorkflow, /contents: read/);
assert.match(publisherWorkflow, /issues: write/);
assert.match(publisherWorkflow, /const expected = `github-main-review-policy-readiness-\$\{context\.payload\.workflow_run\.id\}`;/);
assert.match(publisherWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
assert.match(publisherWorkflow, /persist-credentials: false/);

assert.equal((migrationRunner.match(/name: 'governed_migration_execute'/g) || []).length, 2, 'Migration 1051 runner should contain one dry-run and one Apply transport call');
assert.match(migrationRunner, /apply_retried: false/);
assert.match(migrationRunner, /live_github_policy_apply: false/);
assert.match(migrationRunner, /provider_call_executed: false/);
assert.match(migrationRunner, /external_write_executed: false/);
assert.match(migrationRunner, /SOURCE_PR must identify the merged source PR/);

assert.equal((liveRunner.match(/applyResponse = await requestRaw\('\/admin\/repository-automation\/policy-controller'/g) || []).length, 1, 'Live policy runner must contain exactly one Ruleset Apply transport call');
assert.match(liveRunner, /apply_retried: false/);
assert.match(liveRunner, /GITHUB_MAIN_REVIEW_POLICY_READINESS result=pass /);
assert.match(liveRunner, /verifyMigration1051Applied/);
assert.match(liveRunner, /capability_resolution_envelope_apply_authorize/);
assert.match(liveRunner, /assert\.equal\(await currentRefSha\(DEFAULT_BRANCH\), mainSha, 'main moved after envelope authorization'\)/);
assert.match(liveRunner, /ambiguous_transport_reconciliation/);
assert.match(liveRunner, /Apply was not retried/);
assert.match(liveRunner, /force_push_executed: false/);
assert.match(liveRunner, /repository_content_mutation_executed: false/);

assert.match(publisher, /EXPECTED_WORKFLOW = 'Governed GitHub Main Review Policy Live Activation'/);
assert.match(publisher, /assert\.equal\(summary\?\.migration_1051_verified, true\)/);
assert.match(publisher, /assert\.equal\(summary\?\.envelope_created_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.apply_sent_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.provider_call_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.external_write_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.secrets_included, false\)/);
assert.match(publisher, /main_sha=\$\{summary\.main_sha\} policy_fingerprint=\$\{summary\.policy_fingerprint\} binding_sha256=\$\{summary\.binding_sha256\}/);

console.log('github repository policy live activation contract tests passed');