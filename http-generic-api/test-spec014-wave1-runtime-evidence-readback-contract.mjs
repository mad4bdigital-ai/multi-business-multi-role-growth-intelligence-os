import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const OBSERVER_BRANCH = 'gpt/observe-spec014-wave1-runtime-run-5179409708-20260804';
const SCRIPT_PATH = path.join(ROOT, '.github/ops/spec014-wave1-runtime-evidence-readback.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/spec014-wave1-runtime-evidence-readback.yml');
const DISCOVERY_PATH = path.join(
  ROOT,
  'http-generic-api/scripts/spec014-wave1-runtime-public-run-discovery.mjs',
);

const [script, workflow, discovery] = await Promise.all([
  fs.readFile(SCRIPT_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(DISCOVERY_PATH, 'utf8'),
]);

for (const filePath of [SCRIPT_PATH, DISCOVERY_PATH]) {
  const syntax = spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr || `Syntax check failed for ${filePath}`);
}

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.match(workflow, /actions: read/);
assert.match(workflow, /contents: read/);
assert.match(workflow, /issues: write/);
assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write/);
assert.match(workflow, /READBACK_SPEC014_WAVE1_RUNTIME_EVIDENCE_5179409708/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);

for (const marker of [
  'apply_authorized: false',
  'apply_sent: false',
  'migration_apply_executed: false',
  'provider_call_executed: false',
  'credential_payload_accessed: false',
  'external_business_write_executed: false',
  'secrets_included: false',
  'target_run_not_found_near_authorization_comment',
  'target_runtime_job_skipped_no_artifact',
]) {
  assert.ok(script.includes(marker), `Readback script is missing ${marker}`);
}
assert.doesNotMatch(
  script,
  /auth\.mad4b\.com|BACKEND_API_KEY|governed_migration_execute|mode:\s*['"](?:apply|dry_run)['"]/,
);
assert.match(discovery, /issues\/comments\/\$\{authorizationCommentId\}/);
assert.match(discovery, /spec014-wave1-runtime-readiness\.yml/);
assert.match(discovery, /event=issue_comment/);
assert.match(discovery, /maxDeltaMs = 5 \* 60 \* 1000/);
assert.match(discovery, /public_metadata_only: true/);
assert.match(discovery, /runtime_contact: false/);
assert.match(discovery, /database_access: false/);
assert.match(discovery, /migration_apply_executed: false/);
assert.match(discovery, /provider_call_executed: false/);
assert.match(discovery, /secrets_included: false/);
assert.doesNotMatch(discovery, /Authorization:|GITHUB_TOKEN|BACKEND_API_KEY|auth\.mad4b\.com/);

if (String(process.env.GITHUB_HEAD_REF || '') === OBSERVER_BRANCH) {
  await import('./scripts/spec014-wave1-runtime-public-run-discovery.mjs');
}

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'spec014_wave1_runtime_public_run_discovery_guard.v1',
      observer_branch: OBSERVER_BRANCH,
      public_metadata_only: true,
      artifact_download_performed: false,
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
