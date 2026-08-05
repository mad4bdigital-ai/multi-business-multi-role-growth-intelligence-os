import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const RUNNER_PATH = path.join(ROOT, '.github/ops/spec014-wave1-runtime-readiness.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/spec014-wave1-runtime-readiness.yml');
const GUARD_PATH = path.join(
  ROOT,
  '.github/workflows/spec014-wave1-runtime-readiness-contract-guard.yml',
);
const E2E_PATH = path.join(ROOT, '.changes/e2e/spec014-wave1-runtime-readiness.json');
const MANIFEST_PATH = path.join(ROOT, 'http-generic-api/scripts/test-manifest.mjs');

const AUTH_CONFIRM =
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const CHECKSUM = '9eca6e585d12de633931c7d7e099f467a955aaf7b819ccb2660d34acf63d5053';
const BLOB = '1e820553d95e5bdb5f8c49d7bf09cb159c51c7bc';
const SOURCE_MERGE = '7a96920eff2579321707d193a1d030e6454891b1';
const READINESS_MERGE = '0f83d8faf1abf8b0bf149f08c10f652d2a3ed3fa';

const [runner, workflow, guard, e2eText, manifest] = await Promise.all([
  fs.readFile(RUNNER_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(GUARD_PATH, 'utf8'),
  fs.readFile(E2E_PATH, 'utf8'),
  fs.readFile(MANIFEST_PATH, 'utf8'),
]);
const e2e = JSON.parse(e2eText);

const syntax = spawnSync(process.execPath, ['--check', RUNNER_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Wave 1 runner syntax check failed.');

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch|workflow_run):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 6215/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${AUTH_CONFIRM}'`));
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);
assert.doesNotMatch(workflow, /^\s{2}apply:/m);

assert.match(guard, /^on:\n  pull_request:/m);
assert.match(guard, /permissions:\n  contents: read/);
assert.doesNotMatch(guard, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(guard, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
assert.match(guard, /node --check \.github\/ops\/spec014-wave1-runtime-readiness\.mjs/);
assert.match(guard, /test-spec014-wave1-runtime-readiness-contract\.mjs/);
assert.match(guard, /actions\/upload-artifact@v4/);

for (const value of [AUTH_CONFIRM, CHECKSUM, BLOB, SOURCE_MERGE, READINESS_MERGE]) {
  assert.ok(runner.includes(value), `Runner is missing pinned value ${value}.`);
}
for (const table of [
  'storage_provider_accounts',
  'storage_targets',
  'storage_target_bindings',
  'storage_pressure_snapshots',
]) {
  assert.ok(runner.includes(table), `Runner is missing expected table ${table}.`);
}
assert.match(runner, /governed_migration_schema_readback/);
assert.match(runner, /capability_resolution_envelope_create/);
assert.match(runner, /capability_resolution_envelope_approve/);
const approvalDecisionNote = runner.match(
  /'--decision-note=([^'\n]+)'/,
)?.[1];
assert.ok(approvalDecisionNote, 'Runner is missing the approval decision note.');
assert.doesNotMatch(
  approvalDecisionNote,
  /[;&|`$<>\\!{}()\n\r]/,
  'Approval decision note must remain safe for /admin/control extra_args.',
);
assert.match(runner, /governed_migration_authorization_bootstrap/);
assert.match(runner, /name: 'governed_migration_execute'/);
assert.match(runner, /mode: 'dry_run'/);
assert.match(runner, /applies_sql, false/);
assert.match(runner, /currentRefSha\('Production'\)/);
assert.match(runner, /managed_control_plane_write_executed: true/);
assert.match(runner, /business_data_mutation_executed: false/);
assert.match(runner, /apply_authorized: false/);
assert.match(runner, /apply_sent: false/);
assert.match(runner, /migration_apply_executed: false/);
assert.match(runner, /provider_call_executed: false/);
assert.match(runner, /credential_payload_accessed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /secrets_included: false/);
assert.doesNotMatch(runner, /mode: ['"]apply['"]/);
assert.doesNotMatch(runner, /capability_resolution_envelope_apply_authorize/);
assert.doesNotMatch(runner, /APPLY_GOVERNED_MIGRATION/);

assert.equal(e2e.feature_key, 'spec014-wave1-runtime-readiness');
assert.equal(e2e.current_phase, 'mvp');
const include = new Set(e2e.scope?.include || []);
for (const expectedPath of [
  '.changes/e2e/spec014-wave1-runtime-readiness.json',
  '.github/ops/spec014-wave1-runtime-readiness.mjs',
  '.github/workflows/spec014-wave1-runtime-readiness.yml',
  '.github/workflows/spec014-wave1-runtime-readiness-contract-guard.yml',
  'http-generic-api/test-spec014-wave1-runtime-readiness-contract.mjs',
  'http-generic-api/scripts/test-manifest.mjs',
]) {
  assert.ok(include.has(expectedPath), `E2E contract is missing ${expectedPath}.`);
}
const journeys = e2e.phases?.find((phase) => phase.id === 'mvp')?.e2e_journeys || [];
assert.ok(
  journeys.some(
    (journey) =>
      journey.id === 'authorize-and-prove-spec014-wave1-runtime-readiness-without-apply',
  ),
);
assert.ok(journeys.every((journey) => journey.end_to_end === true));
assert.ok(
  journeys.some((journey) =>
    (journey.tests || []).some(
      (entry) => entry.path === 'test-spec014-wave1-runtime-readiness-contract.mjs',
    ),
  ),
);
assert.ok(
  journeys.some((journey) =>
    (journey.assertions || []).some((value) =>
      String(value).includes('never exposes an Apply job'),
    ),
  ),
);

assert.ok(
  manifest.includes('node test-spec014-wave1-runtime-readiness-contract.mjs'),
  'Canonical test manifest is missing the Wave 1 runtime-readiness regression.',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'spec014_wave1_runtime_readiness_contract_test.v1',
      exact_trigger: AUTH_CONFIRM,
      issue: 6215,
      runtime_readiness_only: true,
      apply_job_exposed: false,
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