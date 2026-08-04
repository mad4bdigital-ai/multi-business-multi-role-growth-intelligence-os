import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/hostinger-production-runtime-readback-r7.yml');
const TEST_PATH = path.join(ROOT, 'http-generic-api/test-hostinger-production-runtime-readback-r7.mjs');

const workflow = await fs.readFile(WORKFLOW_PATH, 'utf8');
const testSource = await fs.readFile(TEST_PATH, 'utf8');
for (const filePath of [TEST_PATH]) {
  const syntax = spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr || `Syntax check failed for ${filePath}`);
}

const focused = spawnSync(process.execPath, [TEST_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(focused.status, 0, focused.stderr || focused.stdout || 'R7 focused regression failed');
assert.match(focused.stdout, /mad4b\.hostinger-production-runtime-readback-r7\.workflow-test\.v3/);

assert.match(workflow, /Initialize bounded report directory after runner allocation/);
assert.match(workflow, /report_dir="\$\{RUNNER_TEMP\}\/hostinger-production-runtime-readback-r7"/);
assert.match(workflow, /Publish bounded read-only runtime decision/);
assert.match(workflow, /GITHUB_STEP_SUMMARY/);
assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/hostinger-production-runtime-readback-r7\/\*/);
assert.doesNotMatch(workflow, /issues: write|GH_TOKEN|\bgh\s+api\b/);
assert.doesNotMatch(workflow, /^\s{6}REPORT_DIR:\s*\$\{\{\s*runner\.temp\s*\}\}/m);
assert.doesNotMatch(workflow, /HOSTINGER_API_TOKEN|BACKEND_API_KEY|secrets\./);
assert.doesNotMatch(workflow, /workflow_dispatch|schedule:|git push|\bssh\b|\brsync\b|\bscp\b/i);
assert.match(workflow, /repository_issue_comment_authorized: false/);
assert.match(workflow, /repository_issue_comment_performed: false/);
assert.match(workflow, /deployment_performed: false/);
assert.match(workflow, /migration_apply_performed: false/);
assert.match(workflow, /database_mutation_performed: false/);
assert.match(workflow, /secrets_included: false/);

assert.match(testSource, /workflow-test\.v3/);
assert.match(testSource, /report_directory_initialized_after_runner_allocation: true/);
assert.match(testSource, /repository_issue_comment_authorized: false/);
assert.match(testSource, /repository_issue_comment_performed: false/);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'hostinger_production_runtime_readback_r7_exact_candidate_validation.v1',
      candidate_pr: 6309,
      candidate_head: '12539c83fc096c0cd9731c27a90d388caf02d0b5',
      workflow_blob_sha: '2d31a445f7ced416502958cf3fac15aed8a52723',
      test_blob_sha: '86092081e82e6af8b8a419884e411654a8b0019e',
      focused_regression_passed: true,
      report_directory_initialized_after_runner_allocation: true,
      public_get_only: true,
      repository_issue_comment_authorized: false,
      repository_issue_comment_performed: false,
      deployment_performed: false,
      restart_performed: false,
      sql_execution_performed: false,
      migration_apply_performed: false,
      database_mutation_performed: false,
      secrets_included: false,
    },
    null,
    2,
  ),
);
