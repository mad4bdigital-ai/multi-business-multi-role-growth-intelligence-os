import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(API_DIR, '..');
const RUNNER_PATH = path.join(ROOT, '.github/ops/spec014-wave1-apply.mjs');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/spec014-wave1-apply.yml');
const E2E_PATH = path.join(ROOT, '.changes/e2e/spec014-wave1-apply-contract.json');

const APPLY_CONFIRM = 'APPLY_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const READINESS_CONFIRM =
  'AUTHORIZE_GOVERNED_MIGRATION_20260802_01_SPEC014_HOSTINGER_STORAGE_FOUNDATION';
const CHECKSUM = '9eca6e585d12de633931c7d7e099f467a955aaf7b819ccb2660d34acf63d5053';
const BLOB = '1e820553d95e5bdb5f8c49d7bf09cb159c51c7bc';
const SOURCE_MERGE = '7a96920eff2579321707d193a1d030e6454891b1';
const REPOSITORY_READINESS = '0f83d8faf1abf8b0bf149f08c10f652d2a3ed3fa';
const RUNTIME_READINESS = '4c683e825320b02d49235fabc610e2cd8d8afb89';

const [runner, workflow, e2eText] = await Promise.all([
  fs.readFile(RUNNER_PATH, 'utf8'),
  fs.readFile(WORKFLOW_PATH, 'utf8'),
  fs.readFile(E2E_PATH, 'utf8'),
]);
const e2e = JSON.parse(e2eText);

const syntax = spawnSync(process.execPath, ['--check', RUNNER_PATH], {
  cwd: ROOT,
  encoding: 'utf8',
});
assert.equal(syntax.status, 0, syntax.stderr || 'Wave 1 Apply runner syntax check failed.');

assert.match(workflow, /^on:\n  issue_comment:\n    types: \[created\]/m);
assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|workflow_dispatch):/m);
assert.match(workflow, /permissions:\n  contents: read/);
assert.doesNotMatch(workflow, /contents:\s*write|issues:\s*write|pull-requests:\s*write/);
assert.match(workflow, /github\.event\.issue\.number == 6215/);
assert.match(workflow, /!github\.event\.issue\.pull_request/);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/);
assert.ok(workflow.includes(`github.event.comment.body == '${APPLY_CONFIRM}'`));
assert.equal(
  workflow.includes(READINESS_CONFIRM),
  false,
  'Apply workflow must not reuse the readiness trigger.',
);
assert.match(workflow, /^\s{2}apply:/m);
assert.equal((workflow.match(/^\s{2}apply:/gm) || []).length, 1);
assert.doesNotMatch(workflow, /gh\s+api|issues:\s*write|comments\/|workflow_dispatch/);
assert.match(workflow, /BACKEND_API_KEY: \$\{\{ secrets\.BACKEND_API_KEY \}\}/);
assert.match(workflow, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/);
assert.match(workflow, /ref: main/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /if: always\(\)[\s\S]*actions\/upload-artifact@v4/);

for (const value of [
  APPLY_CONFIRM,
  CHECKSUM,
  BLOB,
  SOURCE_MERGE,
  REPOSITORY_READINESS,
  RUNTIME_READINESS,
]) {
  assert.ok(runner.includes(value), `Apply runner is missing pinned value ${value}.`);
}

assert.match(runner, /governed_migration_authorization_registry/);
assert.match(runner, /authorization_source, AUTHORIZATION_SOURCE/);
assert.match(runner, /policy_key, AUTHORIZATION_POLICY_KEY/);
assert.match(runner, /allow_apply \|\| 0\), 1/);
assert.match(runner, /metadata\.migration_checksum_sha256/);
assert.match(runner, /metadata\.expected_statement_count/);
assert.match(runner, /metadata\.pull_request/);
assert.match(runner, /metadata\.merge_sha/);
assert.doesNotMatch(runner, /governed_migration_authorization_bootstrap/);

assert.match(runner, /name: 'governed_migration_schema_readback'/);
assert.match(runner, /name: 'governed_migration_execute'/);
assert.match(runner, /mode: 'dry_run'/);
assert.equal(
  (runner.match(/mode: 'apply'/g) || []).length,
  1,
  'Apply runner must expose exactly one Apply request.',
);
assert.match(runner, /confirm: APPLY_CONFIRM/);
assert.match(runner, /capability_resolution_envelope_apply_authorize/);
assert.match(runner, /apply_sent: applySent/);
assert.match(runner, /apply_retried: false/);
assert.match(runner, /retry_permitted: false/);
assert.match(runner, /No retry is permitted before exact readback/i);
assert.match(runner, /provider_call_executed: false/);
assert.match(runner, /credential_payload_accessed: false/);
assert.match(runner, /external_business_write_executed: false/);
assert.match(runner, /production_ref_mutation_executed: false/);
assert.match(runner, /deployment_executed: false/);
assert.match(runner, /restart_executed: false/);
assert.match(runner, /secrets_included: false/);
assert.match(runner, /exactApplyLedger/);
assert.match(runner, /exactTables/);
assert.match(runner, /final_readback/);

const mainBody = runner.slice(runner.indexOf('async function main()'));
const order = [
  "stage = 'repository_and_runtime_parity'",
  "stage = 'readback_first'",
  "stage = 'readiness_authorization_readback'",
  "stage = 'same_cycle_dry_run'",
  "stage = 'execution_envelope'",
  "stage = 'single_apply_attempt'",
  "stage = 'final_readback'",
  "stage = 'apply_complete'",
].map((marker) => ({ marker, index: mainBody.indexOf(marker) }));
for (const item of order) assert(item.index >= 0, `Apply flow is missing ${item.marker}.`);
for (let index = 1; index < order.length; index += 1) {
  assert(
    order[index - 1].index < order[index].index,
    `${order[index - 1].marker} must precede ${order[index].marker}.`,
  );
}

assert.equal(e2e.feature_key, 'spec014-wave1-apply-contract');
assert.equal(e2e.current_phase, 'mvp');
const include = new Set(e2e.scope?.include || []);
for (const expectedPath of [
  '.github/ops/spec014-wave1-apply.mjs',
  '.github/workflows/spec014-wave1-apply.yml',
  '.changes/e2e/spec014-wave1-apply-contract.json',
  'http-generic-api/test-spec014-wave1-apply-contract.mjs',
]) {
  assert.ok(include.has(expectedPath), `E2E contract is missing ${expectedPath}.`);
}
const journey = e2e.phases?.find((phase) => phase.id === 'mvp')?.e2e_journeys?.[0];
assert.ok(journey?.end_to_end === true);
assert.ok(
  (journey.tests || []).some((entry) => entry.path === 'test-spec014-wave1-apply-contract.mjs'),
);
assert.ok(
  (journey.assertions || []).some((value) =>
    String(value).includes('never creates readiness authorization'),
  ),
);
assert.ok(
  (journey.assertions || []).some((value) => String(value).includes('never retries Apply')),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: 'spec014_wave1_apply_contract_test.v1',
      exact_trigger: APPLY_CONFIRM,
      issue: 6215,
      readiness_authorization_must_preexist: true,
      same_cycle_dry_run_required: true,
      apply_request_count: 1,
      apply_retry_allowed: false,
      exact_ledger_and_tables_required: true,
      provider_call_executed: false,
      external_business_write_executed: false,
      secrets_included: false,
    },
    null,
    2,
  ),
);
