import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowUrl = new URL('../.github/workflows/production-certified-release-cut-validation.yml', import.meta.url);
const workflow = fs.readFileSync(workflowUrl, 'utf8');
const finalizeIndex = workflow.indexOf('  finalize:');
assert.notEqual(finalizeIndex, -1, 'finalize job must exist');
const finalize = workflow.slice(finalizeIndex);
const envIndex = finalize.indexOf('    env:');
const stepsIndex = finalize.indexOf('    steps:');
assert.ok(envIndex >= 0 && stepsIndex > envIndex, 'finalize env must precede steps');
const jobEnv = finalize.slice(envIndex, stepsIndex);

assert.equal(jobEnv.includes('runner.'), false, 'job-level env must not use runner context');
assert.ok(finalize.includes('- name: Initialize runner-local evidence paths'));
assert.ok(finalize.includes('echo "EVIDENCE_PATH=${RUNNER_TEMP}/certified-production-release-cut.json" >> "$GITHUB_ENV"'));
assert.ok(finalize.includes('echo "CI_SUMMARY_PATH=${RUNNER_TEMP}/certified-release-ci.json" >> "$GITHUB_ENV"'));
assert.ok(workflow.includes('pull_request_target:'));
assert.ok(workflow.includes("if: startsWith(github.event.pull_request.title, 'test(release): certify immutable Production candidate ')"));
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /^\s*[A-Za-z][A-Za-z-]*:\s*write\s*$/m);
assert.doesNotMatch(workflow, /gh pr comment/);
assert.doesNotMatch(workflow, /gpt\/validate-certified-release-(?:base|candidate)-/);
assert.ok(finalize.includes('name: Publish certified release-cut evidence'));
assert.ok(finalize.includes('- name: Require successful direct ARM CI gates'));

console.log('production certified release-cut registration contract: pass');
