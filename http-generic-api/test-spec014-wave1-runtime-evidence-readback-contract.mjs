import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const SCRIPT_PATH = path.join(ROOT, '.github/ops/spec014-wave1-runtime-evidence-readback.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/spec014-wave1-runtime-evidence-readback.yml');
const CONTROL_PLANE_GUARD_PATH = path.join(
  ROOT,
  '.github/workflows/hostinger-storage-control-plane-guard.yml',
);

const [script, workflow, controlPlaneGuard] = await Promise.all([
  fs.readFile(SCRIPT_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(CONTROL_PLANE_GUARD_PATH, 'utf8'),
]);
const syntax = spawnSync(process.execPath, ['--check', SCRIPT_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Readback script syntax check failed.');

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.match(workflow, /^  pull_request:\n    branches: \[main\]\n    types: \[opened, reopened, synchronize\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|workflow_dispatch|workflow_run):/m);
assert.match(workflow, /actions: read/);
assert.match(workflow, /contents: read/);
assert.match(workflow, /issues: write/);
assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event_name == 'issue_comment'/);
assert.match(workflow, /github\.event\.issue\.number == 6215/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /READBACK_SPEC014_WAVE1_RUNTIME_EVIDENCE_5179409708/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.match(workflow, /github\.event_name == 'pull_request'/);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
assert.match(
  workflow,
  /github\.event\.pull_request\.head\.ref == 'gpt\/trigger-spec014-wave1-runtime-evidence-readback-5179409708-v1'/,
);
assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /actions\/upload-artifact@v4/);

assert.match(
  controlPlaneGuard,
  /\.github\/validation-triggers\/spec014-wave1-runtime-evidence-readback-5179409708-v1\.txt/,
);
assert.match(controlPlaneGuard, /permissions:\n  contents: read/);
assert.doesNotMatch(
  controlPlaneGuard.slice(0, controlPlaneGuard.indexOf('jobs:')),
  /actions:\s*write|contents:\s*write|issues:\s*write|pull-requests:\s*write/,
);
assert.match(controlPlaneGuard, /collect-spec014-wave1-runtime-evidence:/);
assert.match(controlPlaneGuard, /name: Collect exact Spec 014 Wave 1 runtime Artifact/);
assert.match(
  controlPlaneGuard,
  /github\.event\.pull_request\.head\.ref == 'gpt\/trigger-spec014-wave1-runtime-evidence-readback-5179409708-v1'/,
);
assert.match(controlPlaneGuard, /github\.event\.pull_request\.base\.ref == 'main'/);
assert.match(
  controlPlaneGuard,
  /collect-spec014-wave1-runtime-evidence:[\s\S]*permissions:\n      actions: read\n      contents: read\n      issues: write/,
);
assert.doesNotMatch(
  controlPlaneGuard.match(/collect-spec014-wave1-runtime-evidence:[\s\S]*/)?.[0] || '',
  /actions:\s*write|contents:\s*write|pull-requests:\s*write/,
);
assert.match(
  controlPlaneGuard,
  /collect-spec014-wave1-runtime-evidence:[\s\S]*ref: main[\s\S]*persist-credentials: false/,
);
assert.match(
  controlPlaneGuard,
  /collect-spec014-wave1-runtime-evidence:[\s\S]*node \.github\/ops\/spec014-wave1-runtime-evidence-readback\.mjs/,
);
assert.match(
  controlPlaneGuard,
  /collect-spec014-wave1-runtime-evidence:[\s\S]*spec014-wave1-runtime-evidence-readback-\$\{\{ github\.run_id \}\}/,
);

for (const value of [
  'spec014-wave1-runtime-readiness.yml',
  'Spec 014 Wave 1 Runtime Readiness',
  '5179409708',
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION',
  'SPEC014_WAVE1_RUNTIME_EVIDENCE_READBACK',
  'target_run_not_found_near_authorization_comment',
  'target_runtime_job_skipped_no_artifact',
]) {
  assert.ok(script.includes(value), `Readback script is missing pinned value ${value}.`);
}
assert.doesNotMatch(
  script,
  /TARGET_EVENT_HEAD|d76dc2bf9b073a18c2fa51cd5907cb30f0c03ab4/,
  'Readback must not assume the default-branch SHA used by an issue_comment event.',
);
assert.match(script, /issues\/comments\/\$\{AUTHORIZATION_COMMENT_ID\}/);
assert.match(script, /authorizationComment\.created_at/);
assert.match(script, /Math\.abs\(Date\.parse\(run\.created_at\) - authorizationCreatedAtMs\)/);
assert.match(script, /MAX_RUN_SELECTION_DELTA_MS/);
assert.match(script, /run\.actor\?\.login === authorizationComment\.user\?\.login/);
assert.match(script, /event === 'issue_comment'/);
assert.match(script, /targetRun\.status === 'completed'/);
assert.match(script, /targetRun\.status !== 'completed'/);
assert.match(script, /target_run_not_terminal_within_bounded_window/);
assert.match(script, /startsWith\('spec014-wave1-runtime-readiness-'\)/);
assert.match(script, /assertBoundary\(state\)/);
assert.match(script, /assertBoundary\(observerResult\)/);
assert.match(script, /readback_status: 'complete'/);
assert.match(script, /failure_code=/);
assert.match(script, /apply_authorized: false/);
assert.match(script, /apply_sent: false/);
assert.match(script, /migration_apply_executed: false/);
assert.match(script, /provider_call_executed: false/);
assert.match(script, /credential_payload_accessed: false/);
assert.match(script, /external_business_write_executed: false/);
assert.match(script, /secrets_included: false/);
assert.match(script, /issues\/\$\{ISSUE_NUMBER\}\/comments/);
assert.doesNotMatch(
  script,
  /auth\.mad4b\.com|BACKEND_API_KEY|governed_migration_execute|mode:\s*['"](?:apply|dry_run)['"]/,
);
assert.doesNotMatch(
  script,
  /capability_resolution_envelope|governed_migration_authorization_bootstrap/,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'spec014_wave1_runtime_evidence_readback_contract.v5',
      exact_issue_trigger: 'READBACK_SPEC014_WAVE1_RUNTIME_EVIDENCE_5179409708',
      exact_pr_fallback:
        'gpt/trigger-spec014-wave1-runtime-evidence-readback-5179409708-v1',
      control_plane_guard_carrier: true,
      collector_job_permissions_isolated: true,
      authorization_comment_time_bound: true,
      fixed_event_head_assumption: false,
      structured_failure_comment: true,
      actions_read: true,
      result_comment_write_only: true,
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
