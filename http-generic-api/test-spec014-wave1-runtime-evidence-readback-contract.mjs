import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const SCRIPT_PATH = path.join(ROOT, '.github/ops/spec014-wave1-runtime-evidence-readback.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/spec014-wave1-runtime-evidence-readback.yml');

const [script, workflow] = await Promise.all([
  fs.readFile(SCRIPT_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
]);
const syntax = spawnSync(process.execPath, ['--check', SCRIPT_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Readback script syntax check failed.');

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch|workflow_run):/m);
assert.match(workflow, /actions: read/);
assert.match(workflow, /contents: read/);
assert.match(workflow, /issues: write/);
assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 6215/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /READBACK_SPEC014_WAVE1_RUNTIME_EVIDENCE_5179409708/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /actions\/upload-artifact@v4/);

for (const value of [
  'spec014-wave1-runtime-readiness.yml',
  'Spec 014 Wave 1 Runtime Readiness',
  'd76dc2bf9b073a18c2fa51cd5907cb30f0c03ab4',
  '5179409708',
  'SPEC014_WAVE1_RUNTIME_EVIDENCE_READBACK',
]) {
  assert.ok(script.includes(value), `Readback script is missing pinned value ${value}.`);
}
assert.match(script, /event === 'issue_comment'/);
assert.match(script, /targetRun\.status, 'completed'/);
assert.match(script, /startsWith\('spec014-wave1-runtime-readiness-'\)/);
assert.match(script, /assertBoundary\(state\)/);
assert.match(script, /apply_authorized, false/);
assert.match(script, /apply_sent, false/);
assert.match(script, /migration_apply_executed, false/);
assert.match(script, /provider_call_executed, false/);
assert.match(script, /credential_payload_accessed, false/);
assert.match(script, /external_business_write_executed, false/);
assert.match(script, /secrets_included, false/);
assert.match(script, /issues\/\$\{ISSUE_NUMBER\}\/comments/);
assert.doesNotMatch(script, /auth\.mad4b\.com|BACKEND_API_KEY|governed_migration_execute|mode:\s*['"](?:apply|dry_run)['"]/);
assert.doesNotMatch(script, /capability_resolution_envelope|governed_migration_authorization_bootstrap/);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'spec014_wave1_runtime_evidence_readback_contract.v1',
      exact_trigger: 'READBACK_SPEC014_WAVE1_RUNTIME_EVIDENCE_5179409708',
      actions_read: true,
      issue_comment_write_only: true,
      runtime_contact: false,
      database_access: false,
      migration_apply_executed: false,
      provider_call_executed: false,
      credential_payload_accessed: false,
      external_business_write_executed: false,
      secrets_included: false,
    },
    null,
    2,
  ),
);
