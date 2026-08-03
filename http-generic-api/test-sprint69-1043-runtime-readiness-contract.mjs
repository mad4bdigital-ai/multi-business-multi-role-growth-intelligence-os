import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const RUNNER_PATH = path.join(ROOT, '.github/ops/sprint69-1043-runtime-readiness.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/sprint69-1043-runtime-readiness.yml');
const BACKFILL_RUNNER_PATH = path.join(ROOT, '.github/ops/sprint69-1043-runtime-readiness-backfill.mjs');
const BACKFILL_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/sprint69-1043-runtime-readiness-backfill.yml');
const E2E_PATH = path.join(ROOT, '.changes/e2e/sprint69-1043-runtime-readiness.json');

const AUTH_CONFIRM = 'AUTHORIZE_GOVERNED_MIGRATION_1043_SPRINT69_TENANT_MANAGED_EXECUTION_LIFECYCLE';
const AUTH_COMMENT_ID = '5169156192';
const CHECKSUM = 'a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9';
const BLOB = '7f3e0152bcdfba36a659ff4a1df8e30d82024c8c';
const SOURCE_MERGE = 'a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3';
const REPOSITORY_READINESS_MERGE = '0cd5e8c894f2877db9de1e1942ff9db25d9ecc5e';

const [runner, workflow, backfillRunner, backfillWorkflow, e2eText] = await Promise.all([
  fs.readFile(RUNNER_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(BACKFILL_RUNNER_PATH, 'utf8'),
  fs.readFile(BACKFILL_WORKFLOW_PATH, 'utf8'),
  fs.readFile(E2E_PATH, 'utf8'),
]);
const e2e = JSON.parse(e2eText);

for (const executable of [RUNNER_PATH, BACKFILL_RUNNER_PATH]) {
  const syntax = spawnSync(process.execPath, ['--check', executable], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(syntax.status, 0, syntax.stderr || `Syntax check failed for ${executable}.`);
}

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 4449/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${AUTH_CONFIRM}'`));
assert.doesNotMatch(workflow, /^\s{2}apply:/m);
assert.doesNotMatch(workflow, /gh\s+api|issues\/\$|comments/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

for (const value of [AUTH_CONFIRM, CHECKSUM, BLOB, SOURCE_MERGE, REPOSITORY_READINESS_MERGE]) {
  assert.ok(runner.includes(value), `Runtime readiness runner is missing pinned value ${value}.`);
}
assert.match(runner, /governed_migration_schema_readback/);
assert.match(runner, /capability_resolution_envelope_create/);
assert.match(runner, /capability_resolution_envelope_approve/);
assert.match(runner, /governed_migration_authorization_bootstrap/);
assert.match(runner, /name: 'governed_migration_execute'/);
assert.match(runner, /mode: 'dry_run'/);
assert.match(runner, /applies_sql, false/);
assert.match(runner, /\/health/);
assert.match(runner, /\/version/);
assert.match(runner, /\/deployment-info/);
assert.match(runner, /currentRefSha\('Production'\)/);
assert.match(runner, /git\/ref\/heads\/\$\{branch\}/);
assert.match(runner, /contents\/\$\{MIGRATION_PATH\}\?ref=\$\{targetSha\}/);
assert.match(runner, /managed_control_plane_write_executed: true/);
assert.match(runner, /business_data_mutation_executed: false/);
assert.match(runner, /apply_authorized: false/);
assert.match(runner, /apply_sent: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /activation_registry_sync_executed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /secrets_included: false/);
assert.doesNotMatch(runner, /mode: ['"]apply['"]/);
assert.doesNotMatch(runner, /capability_resolution_envelope_apply_authorize/);
assert.doesNotMatch(runner, /activation_authorized_surface_registry_sync/);
assert.doesNotMatch(runner, /APPLY_GOVERNED_MIGRATION_1043/);

assert.match(backfillWorkflow, /^on:\n  push:\n    branches: \[main\]/m);
assert.match(backfillWorkflow, /^\s{2}workflow_dispatch:/m);
assert.doesNotMatch(backfillWorkflow, /^\s{2}(?:pull_request|issue_comment|workflow_run):/m);
assert.match(backfillWorkflow, /permissions:\n  actions: read\n  contents: read\n  issues: write/);
assert.doesNotMatch(backfillWorkflow, /contents:\s*write|actions:\s*write|pull-requests:\s*write/);
assert.match(backfillWorkflow, /persist-credentials: false/);
assert.match(backfillWorkflow, /actions\/download-artifact@v4/);
assert.match(backfillWorkflow, /run-id: \$\{\{ steps\.discover\.outputs\.run_id \}\}/);
assert.match(backfillWorkflow, /github-token: \$\{\{ github\.token \}\}/);
assert.match(backfillWorkflow, /if: always\(\)[\s\S]*sprint69-1043-runtime-readiness-backfill-/);
assert.match(backfillWorkflow, /steps\.publish\.outputs\.publication_ok/);

for (const value of [AUTH_CONFIRM, AUTH_COMMENT_ID, 'Sprint 69 Migration 1043 Runtime Readiness']) {
  assert.ok(backfillRunner.includes(value), `Backfill runner is missing pinned value ${value}.`);
}
assert.match(backfillRunner, /actions\/workflows\/\$\{encodeURIComponent\(WORKFLOW_FILE\)\}\/runs\?event=issue_comment/);
assert.match(backfillRunner, /per_page=100&page=\$\{page\}/);
assert.match(backfillRunner, /reachedCommentBoundary/);
assert.match(backfillRunner, /nonSkippedCandidates/);
assert.match(backfillRunner, /function safeBoolean/);
assert.doesNotMatch(backfillRunner, /per_page=50/);
assert.match(runner, /SAFE_EVIDENCE_KEYS/);
assert.match(backfillRunner, /SAFE_EVIDENCE_KEYS/);
assert.match(runner, /'secrets_included'/);
assert.match(backfillRunner, /unverified/);
assert.match(backfillRunner, /issues\/comments\/\$\{AUTHORIZATION_COMMENT_ID\}/);
assert.match(backfillRunner, /author_association/);
assert.match(backfillRunner, /artifact_ready/);
assert.match(backfillRunner, /summary\.json/);
assert.match(backfillRunner, /failure\.json/);
assert.match(backfillRunner, /issues\/\$\{ISSUE_NUMBER\}\/comments\?per_page=100/);
assert.match(backfillRunner, /sprint69-1043-runtime-readiness-backfill:/);
assert.match(backfillRunner, /consult_job_logs: false/);
assert.match(backfillRunner, /repository_mutation_performed: false/);
assert.match(backfillRunner, /runtime_contacted_by_backfill: false/);
assert.match(backfillRunner, /migration_apply_executed_by_backfill: false/);
assert.match(backfillRunner, /provider_call_executed: false/);
assert.match(backfillRunner, /credential_payload_accessed: false/);
assert.match(backfillRunner, /external_business_write_executed: false/);
assert.match(backfillRunner, /secrets_included: false/);
assert.doesNotMatch(backfillRunner, /BACKEND_API_KEY|\/admin\/control|\/gpt\/tools\/call/);
assert.doesNotMatch(backfillRunner, /mode:\s*['"]apply['"]/);
assert.doesNotMatch(backfillRunner, /capability_resolution_envelope_create|governed_migration_authorization_bootstrap/);

assert.equal(e2e.feature_key, 'sprint69-1043-runtime-readiness');
assert.equal(e2e.current_phase, 'mvp');
const include = new Set(e2e.scope?.include || []);
for (const expectedPath of [
  '.github/ops/sprint69-1043-runtime-readiness.mjs',
  '.github/workflows/sprint69-1043-runtime-readiness.yml',
  '.github/ops/sprint69-1043-runtime-readiness-backfill.mjs',
  '.github/workflows/sprint69-1043-runtime-readiness-backfill.yml',
  '.changes/e2e/sprint69-1043-runtime-readiness.json',
  'http-generic-api/test-sprint69-1043-runtime-readiness-contract.mjs',
]) {
  assert.ok(include.has(expectedPath), `E2E contract is missing ${expectedPath}.`);
}
const journeys = e2e.phases?.find((phase) => phase.id === 'mvp')?.e2e_journeys || [];
assert.ok(journeys.some((journey) => journey.id === 'authorize-and-prove-migration-1043-runtime-readiness-without-apply'));
assert.ok(journeys.some((journey) => journey.id === 'backfill-runtime-readiness-artifact-to-control-issue'));
assert.ok(journeys.every((journey) => journey.end_to_end === true));
assert.ok(journeys.some((journey) => (journey.tests || []).some(
  (entry) => entry.path === 'test-sprint69-1043-runtime-readiness-contract.mjs',
)));
assert.ok(journeys.some((journey) => (journey.assertions || []).some(
  (value) => String(value).includes('never exposes an Apply job'),
)));
assert.ok(journeys.some((journey) => (journey.assertions || []).some(
  (value) => String(value).includes('Job logs'),
)));

console.log(JSON.stringify({
  ok: true,
  contract: 'sprint69_1043_runtime_readiness_contract_test.v2',
  exact_trigger: AUTH_CONFIRM,
  authorization_comment_id: Number(AUTH_COMMENT_ID),
  issue: 4449,
  runtime_readiness_only: true,
  artifact_backfill_publisher: true,
  apply_job_exposed: false,
  migration_apply_executed: false,
  activation_registry_sync_executed: false,
  external_business_write_executed: false,
  consult_job_logs: false,
  secrets_included: false,
}, null, 2));
