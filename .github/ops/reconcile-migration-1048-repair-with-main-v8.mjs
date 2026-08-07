import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const repo = String(process.env.GITHUB_REPOSITORY || '');
const head = String(process.env.GITHUB_SHA || '');
const main = String(process.env.EXPECTED_MAIN || '');
const branch = String(process.env.REPAIR_BRANCH || '');
assert.ok(repo && head && main && branch, 'Missing V8 reconciliation environment');

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }).trim();
}

function remoteSha(name) {
  const out = git(['ls-remote', 'origin', `refs/heads/${name}`]);
  const sha = out.split(/\s+/)[0] || '';
  assert.match(sha, /^[0-9a-f]{40}$/);
  return sha;
}

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  assert.equal(count, 1, `${label}: expected one anchor, found ${count}`);
  return text.replace(oldValue, newValue);
}

assert.equal(git(['rev-parse', 'HEAD']), head, 'Checkout is not exact trigger SHA');
assert.equal(remoteSha('main'), main, 'main moved before V8');
assert.equal(remoteSha(branch), head, 'repair branch moved before V8');
git(['fetch', 'origin', main]);

const workflowPath = '.github/workflows/transport-response-schema-1048-governed-rollout.yml';
const runnerPath = '.github/ops/transport-response-schema-1048-governed-rollout.mjs';
const testPath = 'http-generic-api/test-transport-response-schema-1048-governed-rollout.mjs';
const desiredWorkflow = readFileSync(workflowPath, 'utf8');

let runner = git(['show', `${main}:${runnerPath}`]);
runner += '\n';
runner = replaceOnce(
  runner,
  "const VERIFY_CONFIRM = 'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY';",
  'const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`;',
  'runner VERIFY confirmation',
);
writeFileSync(runnerPath, runner, 'utf8');

let test = git(['show', `${main}:${testPath}`]);
test += '\n';
for (const [oldValue, newValue] of [
  ['  "AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",', '  "AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",'],
  ['  "APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",', '  "APPLY_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",'],
  ['  "VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY",', '  "VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_CHUNK_SCHEMA_RECOVERY",'],
]) {
  test = replaceOnce(test, oldValue, newValue, `test workflow command ${oldValue}`);
}
const applyExpected = '  "const APPLY_CONFIRM = `APPLY_${MIGRATION_CONFIRMATION_KEY}`",\n';
const verifyExpected = '  "const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`",\n';
test = replaceOnce(test, applyExpected, applyExpected + verifyExpected, 'dynamic VERIFY assertion');

const readinessBlock = `for (const expected of [
  'issues: write',
  'Publish checksum-bound readiness marker',
  'actions/github-script@v7',
  'summary.readiness_marker',
  'TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass ',
  'issue_number: 6531',
]) {
  assert.ok(workflow.includes(expected), \`Migration 1048 workflow is missing readiness publication contract: \${expected}\`);
}

for (const forbidden of [
  'AUTHORIZE_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
  'APPLY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
  'VERIFY_GOVERNED_MIGRATION_1048_TRANSPORT_RESPONSE_SCHEMA_RECOVERY',
]) {
  assert.ok(!workflow.includes(forbidden), \`Migration 1048 workflow retains obsolete confirmation: \${forbidden}\`);
  assert.ok(!runner.includes(forbidden), \`Migration 1048 runner retains obsolete confirmation: \${forbidden}\`);
}

`;
test = replaceOnce(test, 'const applyModeLiterals = runner.match', readinessBlock + 'const applyModeLiterals = runner.match', 'readiness regression insertion');
writeFileSync(testPath, test, 'utf8');
writeFileSync(workflowPath, desiredWorkflow, 'utf8');

execFileSync('node', [testPath], { stdio: 'inherit' });
assert.ok(readFileSync(workflowPath, 'utf8').includes('TRANSPORT_RESPONSE_SCHEMA_1048_READINESS result=pass '));
assert.ok(readFileSync(runnerPath, 'utf8').includes('const VERIFY_CONFIRM = `VERIFY_GOVERNED_MIGRATION_${MIGRATION_CONFIRMATION_KEY}`;'));

git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
const runnerBlob = git(['hash-object', '-w', runnerPath]);
const workflowBlob = git(['hash-object', '-w', workflowPath]);
const testBlob = git(['hash-object', '-w', testPath]);
const indexFile = `${process.env.RUNNER_TEMP}/migration-1048-v8.index`;
const env = { ...process.env, GIT_INDEX_FILE: indexFile };
try { execFileSync('rm', ['-f', indexFile]); } catch {}
execFileSync('git', ['read-tree', `${main}^{tree}`], { env, stdio: 'inherit' });
for (const [blob, path] of [[runnerBlob, runnerPath], [workflowBlob, workflowPath], [testBlob, testPath]]) {
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env, stdio: 'inherit' });
}
const tree = execFileSync('git', ['write-tree'], { env, encoding: 'utf8' }).trim();
const commitResult = spawnSync('git', ['commit-tree', tree, '-p', head, '-p', main], {
  input: 'merge: reconcile Migration 1048 repair with current main\n',
  encoding: 'utf8',
});
assert.equal(commitResult.status, 0, commitResult.stderr || 'git commit-tree failed');
const commit = commitResult.stdout.trim();
assert.match(commit, /^[0-9a-f]{40}$/);

const actual = git(['diff-tree', '--no-commit-id', '--name-only', '-r', main, commit]).split('\n').filter(Boolean).sort();
const expected = [runnerPath, workflowPath, testPath].sort();
assert.deepEqual(actual, expected, `Unexpected final diff: ${actual.join(', ')}`);
assert.equal(git(['rev-parse', `${commit}^1`]), head);
assert.equal(git(['rev-parse', `${commit}^2`]), main);
assert.equal(remoteSha('main'), main, 'main moved before push');
assert.equal(remoteSha(branch), head, 'repair branch moved before push');
execFileSync('git', ['merge-base', '--is-ancestor', head, commit], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', `${commit}:refs/heads/${branch}`], { stdio: 'inherit' });
assert.equal(remoteSha('main'), main, 'main moved after push');
assert.equal(remoteSha(branch), commit, 'remote repair ref did not land on V8 merge commit');
console.log(`V8_RECONCILED_HEAD=${commit}`);
