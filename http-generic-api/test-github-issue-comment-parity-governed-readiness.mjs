import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = '../.github/workflows/github-issue-comment-parity-governed-readiness.yml';
const scriptPath = '../.github/ops/github-issue-comment-parity-governed-readiness.mjs';

const [workflow, script] = await Promise.all([
  readFile(workflowPath, 'utf8'),
  readFile(scriptPath, 'utf8'),
]);

const token = 'AUTHORIZE_GOVERNED_MIGRATION_20260810_GITHUB_ISSUE_COMMENT_EXACT_RESPONSE_PARITY';
const migration = '20260810_github_issue_comment_exact_response_parity.sql';
const productionSha = '6957f56ead3f720767957dbb7b9b213cc54ed04e';
const checksum = 'a2322903e061c7084370aa32f8426082f10fecd58679d4743122fbe43a2d9c42';

assert.match(workflow, /github\.event\.issue\.number == 4451/);
assert.ok(workflow.includes(token));
assert.match(workflow, /Authorize and dry-run GitHub issue-comment parity migration/);
assert.ok(!workflow.includes('APPLY_20260810_GITHUB_ISSUE_COMMENT_EXACT_RESPONSE_PARITY'));
assert.ok(!workflow.includes('ROLLOUT_PHASE: apply'));

assert.ok(script.includes(migration));
assert.ok(script.includes(productionSha));
assert.ok(script.includes(checksum));
assert.ok(script.includes("name: 'governed_migration_authorization_bootstrap'"));
assert.ok(script.includes("name: 'governed_migration_execute'"));
assert.ok(script.includes("mode: 'dry_run'"));
assert.ok(script.includes("stage = 'production_ref_repin'"));
assert.ok(script.includes('Production ref moved after runtime parity and before authorization mutation'));
assert.ok(script.includes('migration_apply_performed: false'));
assert.ok(!script.includes("mode: 'apply'"));
assert.ok(!script.includes('APPLY_20260810_GITHUB_ISSUE_COMMENT_EXACT_RESPONSE_PARITY'));
assert.ok(!script.includes('capability_resolution_envelope_apply_authorize'));
assert.ok(!script.includes('github_create_issue_comment'), 'Readiness bridge must not dispatch the repaired provider operation');

console.log('GitHub issue-comment exact-response parity governed readiness contract: OK');
