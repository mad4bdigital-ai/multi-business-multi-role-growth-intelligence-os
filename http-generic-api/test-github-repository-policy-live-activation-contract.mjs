import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const migrationWorkflow = read('../.github/workflows/github-repository-policy-1051-governed-rollout.yml');
const liveWorkflow = read('../.github/workflows/github-main-review-policy-live-activation.yml');
const publisherWorkflow = read('../.github/workflows/github-main-review-policy-readiness-publisher.yml');
const migrationRunner = read('../.github/ops/github-repository-policy-1051-governed-rollout.mjs');
const liveRunner = read('../.github/ops/github-main-review-policy-live-activation.mjs');
const readbackRunner = read('../.github/ops/github-repository-policy-readback.mjs');
const publisher = read('./scripts/github-main-review-policy-readiness-issue-publisher.mjs');
const verifierRegistry = JSON.parse(read('../.github/governance/verifier-registry.json'));

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
for (const command of [
  'AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS',
  'APPLY_GITHUB_MAIN_REVIEW_POLICY',
  'VERIFY_GITHUB_MAIN_REVIEW_POLICY',
  'AUTHORIZE_GITHUB_PRODUCTION_POLICY_READINESS',
  'APPLY_GITHUB_PRODUCTION_POLICY',
  'VERIFY_GITHUB_PRODUCTION_POLICY',
]) assert.match(liveWorkflow, new RegExp(command));
assert.doesNotMatch(liveWorkflow, /TARGET_BRANCH:/);
assert.match(liveWorkflow, /POLICY_PHASE: \$\{\{ format\('\{0\}:\{1\}'/);
assert.match(liveWorkflow, /github-repository-policy-evidence-\$\{\{ github\.run_id \}\}/);
assert.equal((liveWorkflow.match(/node \.github\/ops\/github-main-review-policy-live-activation\.mjs/g) || []).length, 1, 'One branch-parameterized activation runner should own the lifecycle');
assert.match(liveWorkflow, /persist-credentials: false/);

assert.match(publisherWorkflow, /^name: GitHub Main Review Policy Readiness Publisher/m);
assert.match(publisherWorkflow, /workflow_run:/);
assert.match(publisherWorkflow, /Governed GitHub Main Review Policy Live Activation/);
assert.match(publisherWorkflow, /actions: read/);
assert.match(publisherWorkflow, /contents: read/);
assert.match(publisherWorkflow, /issues: write/);
assert.match(publisherWorkflow, /const expected = `github-repository-policy-evidence-\$\{context\.payload\.workflow_run\.id\}`;/);
assert.match(publisherWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
assert.match(publisherWorkflow, /persist-credentials: false/);

assert.equal((migrationRunner.match(/name: 'governed_migration_execute'/g) || []).length, 2, 'Migration 1051 runner should contain one dry-run and one Apply transport call');
assert.match(migrationRunner, /apply_retried: false/);
assert.match(migrationRunner, /live_github_policy_apply: false/);
assert.match(migrationRunner, /provider_call_executed: false/);
assert.match(migrationRunner, /external_write_executed: false/);
assert.match(migrationRunner, /SOURCE_PR must identify the merged source PR/);

assert.equal((liveRunner.match(/applyResponse = await requestRaw\('\/admin\/repository-automation\/policy-controller'/g) || []).length, 1, 'Live policy runner must contain exactly one Ruleset Apply transport call');
assert.doesNotMatch(liveRunner, /process\.env\.TARGET_BRANCH/);
assert.match(liveRunner, /function targetBranch\(\)/);
assert.match(liveRunner, /function lifecyclePhase\(\)/);
assert.match(liveRunner, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);
assert.match(liveRunner, /APPLY_GITHUB_PRODUCTION_POLICY/);
assert.match(liveRunner, /GITHUB_REPOSITORY_POLICY_READINESS result=pass /);
assert.match(liveRunner, /expected_commit_sha: targetSha/);
assert.match(liveRunner, /default_branch: targetBranch\(\)/);
assert.match(liveRunner, /assert\.equal\(await currentRefSha\(targetBranch\(\)\), targetSha/);
assert.match(liveRunner, /verifyMigration1051Applied/);
assert.match(liveRunner, /capability_resolution_envelope_apply_authorize/);
assert.match(liveRunner, /ambiguous_transport_reconciliation/);
assert.match(liveRunner, /Apply was not retried/);
assert.match(liveRunner, /force_push_executed: false/);
assert.match(liveRunner, /repository_content_mutation_executed: false/);

assert.match(publisher, /EXPECTED_WORKFLOW = 'Governed GitHub Main Review Policy Live Activation'/);
assert.match(publisher, /ALLOWED_BRANCHES = new Set\(\['main', 'Production'\]\)/);
assert.match(publisher, /action: 'not_readiness'/);
assert.match(publisher, /branch=\$\{summary\.target_branch\} target_sha=\$\{summary\.target_sha\}/);
assert.match(publisher, /assert\.equal\(summary\?\.migration_1051_verified, true\)/);
assert.match(publisher, /assert\.equal\(summary\?\.envelope_created_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.apply_sent_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.provider_call_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.external_write_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.secrets_included, false\)/);

assert.match(readbackRunner, /Object\.freeze\(\["main", "Production"\]\)/);
assert.match(readbackRunner, /server_policy_drift_count/);
assert.match(readbackRunner, /GOVERNANCE_SERVER_POLICY_DRIFT/);
assert.match(readbackRunner, /governance_fixed_point/);

assert.equal(verifierRegistry.fixed_point_authorities.runner, 'scripts/repository-governance-fixed-point.mjs');
assert.equal(verifierRegistry.fixed_point_authorities.semantic_verifier_bindings, '.github/governance/semantic-verifier-bindings.json');
assert.equal(verifierRegistry.fixed_point_authorities.executable_validator_registry, '.github/governance/executable-validator-registry.json');
assert.equal(verifierRegistry.fixed_point_authorities.test_authority_registry, '.github/governance/test-authority-registry.json');
for (const path of Object.values(verifierRegistry.fixed_point_authorities).filter((value) => typeof value === 'string' && value.includes('/'))) {
  assert.equal(fs.existsSync(new URL(`../${path}`, import.meta.url)), true, `registered fixed-point authority must exist: ${path}`);
}

console.log('github repository policy live activation contract tests passed');
