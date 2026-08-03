import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = new URL('./hostinger-storage-cleanup.sh', import.meta.url).pathname;
const script = readFileSync(scriptPath, 'utf8');

const policyPath = new URL('../config/hostinger-storage-cleanup-policy.json', import.meta.url).pathname;
const docsPath = new URL('../../docs/hostinger-storage-cleanup.md', import.meta.url).pathname;
const architecturePath = new URL('../../docs/hostinger-storage-control-plane.md', import.meta.url).pathname;
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const docs = readFileSync(docsPath, 'utf8');
const architecture = readFileSync(architecturePath, 'utf8');

assert.equal(policy.schema_version, 'mad4b.hostinger-storage-control.v1');
assert.deepEqual(policy.measurement.dimensions, ['disk_bytes', 'inode_count']);
assert.equal(policy.measurement.never_treat_df_as_hosting_plan_quota, true);
assert.equal(policy.execution.public_web_runtime_allowed, false);
assert.equal(policy.execution.freeform_shell_allowed, false);
assert.equal(policy.execution.automatic_apply_allowed, false);
assert.equal(policy.execution.apply_gate_source, 'platform_owner_approval_and_capability_envelope');
assert.equal(policy.execution.host_key_fingerprint_required, true);
assert.equal(policy.execution.exact_plan_hash_required, true);
assert.equal(policy.emergency_reserve.recommended_bytes, 67108864);
assert(policy.review_required_classes.includes('node_modules'));
assert(policy.review_required_classes.includes('deployment_history'));
assert(docs.includes('scan -> plan -> inspect -> approval -> apply -> readback'));
assert(docs.includes('This intentionally means the first release cannot clean an old Node deployment inside `public_html`'));
assert(architecture.includes('platform-managed Hostinger SSH target'));
assert(architecture.includes('StrictHostKeyChecking=no` is not acceptable'));

assert(script.includes('TOOL_VERSION="2.0.0"'), 'v2 tool contract must be present');
assert(script.includes('ACTION="scan"'), 'scan must be the default action');
assert(script.includes('state_directory_write_required":false'), 'scan must disclose no state write requirement');
assert(script.includes('account_inode_count'), 'scan must measure account inode consumption');
assert(script.includes('inode_hotspots'), 'scan must report inode hotspots');
assert(script.includes('hpanel_resources_usage_required'), 'scan must not treat filesystem df as Hostinger plan quota');
assert(script.includes('APPLY_HOSTINGER_STORAGE_CLEANUP:'), 'apply must require typed confirmation');
assert(script.includes('expected-plan-hash'), 'apply must bind to an inspected plan hash');
assert(script.includes('plan has already been applied'), 'apply must reject plan replay');
assert(script.includes('current_inode') && script.includes('current_dev'), 'apply must revalidate inode and device');
assert(script.includes('current_ctime') && script.includes('current_mtime'), 'apply must revalidate ctime and mtime');
assert(script.includes('[[ -f "$path" && ! -L "$path" ]]'), 'symlinks must be rejected');
assert(script.includes('/public_html/'), 'public_html must be protected');
assert(script.includes('/.ssh/'), '.ssh must be protected');
assert(script.includes('/secrets/'), 'secret directories must be protected');
assert(script.includes('/backups/'), 'backup directories must be protected');
assert(script.includes('MAX_DELETE_BYTES'), 'a byte deletion cap must exist');
assert(script.includes('MAX_FILES'), 'a file deletion cap must exist');
assert(script.includes('rm -- "$canonical"'), 'apply must delete one revalidated file at a time');
assert(script.includes('reserve-create') && script.includes('reserve-release'), 'emergency reserve lifecycle must exist');
assert(!script.includes('rm -rf'), 'recursive force deletion is forbidden');
assert(!script.includes('eval '), 'eval is forbidden');
assert(!script.includes('sudo '), 'sudo is forbidden');
assert(!script.includes('chmod -R'), 'recursive chmod is forbidden');
assert(!script.includes('collect_find_candidates "$ROOT_CANON/tmp"'), 'account tmp must not be auto-deleted');

function execute(args, env) {
  return spawnSync('bash', [scriptPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function run(args, env) {
  const result = execute(args, env);
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

function runFailure(args, env, expectedCode) {
  const result = execute(args, env);
  assert.notEqual(result.status, 0, 'command must fail');
  assert(result.stderr.includes(`ERROR[${expectedCode}]`), `expected ${expectedCode}, got: ${result.stderr}`);
}

const root = mkdtempSync(path.join(tmpdir(), 'hostinger-storage-cleanup-test-'));
const home = path.join(root, 'home');
const dirs = [
  '.npm/_cacache',
  '.npm/_logs',
  'tmp',
  'logs',
  'domains/auth.mad4b.com/logs',
  'domains/auth.mad4b.com/public_html',
];
for (const dir of dirs) mkdirSync(path.join(home, dir), { recursive: true });

const oldEpoch = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
const tmpOldEpoch = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
const files = {
  oldCache: path.join(home, '.npm/_cacache/old-cache'),
  recentCache: path.join(home, '.npm/_cacache/recent-cache'),
  oldNpmLog: path.join(home, '.npm/_logs/old-debug.log'),
  oldTmp: path.join(home, 'tmp/old.tmp'),
  rotatedLog: path.join(home, 'logs/app.log.1'),
  activeLog: path.join(home, 'logs/app.log'),
  protectedPublic: path.join(home, 'domains/auth.mad4b.com/public_html/old.log.1'),
  protectedEnv: path.join(home, '.env'),
};
for (const [key, file] of Object.entries(files)) writeFileSync(file, key);
utimesSync(files.oldCache, oldEpoch, oldEpoch);
utimesSync(files.oldNpmLog, oldEpoch, oldEpoch);
utimesSync(files.rotatedLog, oldEpoch, oldEpoch);
utimesSync(files.protectedPublic, oldEpoch, oldEpoch);
utimesSync(files.oldTmp, tmpOldEpoch, tmpOldEpoch);

try {
  const env = { HOME: home };
  const stateDir = path.join(home, '.mad4b-storage-cleanup');

  const scan = run(['scan', '--root', home], env);
  assert.equal(scan.ok, true);
  assert.equal(scan.action, 'scan');
  assert.equal(scan.deletion_executed, false);
  assert.equal(scan.state_directory_write_required, false);
  assert.equal(typeof scan.account_inode_count, 'number');
  assert(Array.isArray(scan.inode_hotspots));
  assert.equal(existsSync(stateDir), false, 'scan must not create state files under storage pressure');

  const reserveCreate = run([
    'reserve-create', '--root', home,
    '--reserve-bytes', '1048576',
    '--confirm', 'PROVISION_HOSTINGER_STORAGE_RESERVE:1048576',
  ], env);
  assert.equal(reserveCreate.ok, true);
  assert.equal(reserveCreate.size_bytes, 1048576);
  const reserveStatus = run(['reserve-status', '--root', home], env);
  assert.equal(reserveStatus.exists, true);
  assert(reserveStatus.release_confirmation.startsWith('RELEASE_HOSTINGER_STORAGE_RESERVE:'));
  const reserveRelease = run([
    'reserve-release', '--root', home,
    '--confirm', reserveStatus.release_confirmation,
  ], env);
  assert.equal(reserveRelease.released_bytes, 1048576);
  assert.equal(reserveRelease.reserve_only, true);

  const plan = run(['plan', '--root', home], env);
  assert.equal(plan.ok, true);
  assert.equal(plan.action, 'plan');
  assert.equal(plan.deletion_executed, false);
  assert.equal(plan.candidate_count, 3);
  assert.equal(plan.next_action, 'inspect');
  assert.match(plan.plan_hash, /^[a-f0-9]{64}$/);
  assert(plan.confirmation.startsWith(`APPLY_HOSTINGER_STORAGE_CLEANUP:${plan.plan_id}:`));
  assert(plan.review_required_categories.includes('account_tmp'));

  const inspect = run(['inspect', '--root', home, '--plan-id', plan.plan_id], env);
  assert.equal(inspect.ok, true);
  assert.equal(inspect.action, 'inspect');
  assert.equal(inspect.plan_hash, plan.plan_hash);
  assert.equal(inspect.candidate_count, 3);
  assert(inspect.candidates.every((item) => !item.relative_path.startsWith('/')), 'inspect paths must be relative');
  assert(!inspect.candidates.some((item) => item.relative_path.includes('tmp/old.tmp')), 'tmp must remain review-only');

  for (const file of [files.oldCache, files.oldNpmLog, files.rotatedLog]) {
    assert.equal(statSync(file).isFile(), true, 'plan must not delete candidates');
  }

  runFailure([
    'apply', '--root', home,
    '--plan-id', plan.plan_id,
    '--expected-plan-hash', '0'.repeat(64),
    '--confirm', plan.confirmation,
  ], env, 'expected_plan_hash_mismatch');

  const originalCache = readFileSync(files.oldCache);
  const originalCacheMoved = `${files.oldCache}.moved`;
  renameSync(files.oldCache, originalCacheMoved);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  writeFileSync(files.oldCache, originalCache);
  utimesSync(files.oldCache, oldEpoch, oldEpoch);
  assert.equal(lstatSync(files.oldCache).isFile(), true);

  const apply = run([
    'apply', '--root', home,
    '--plan-id', plan.plan_id,
    '--expected-plan-hash', plan.plan_hash,
    '--confirm', plan.confirmation,
  ], env);
  assert.equal(apply.ok, true);
  assert.equal(apply.action, 'apply');
  assert.equal(apply.deleted_count, 2, 'inode-replaced candidate must be skipped');
  assert.equal(apply.skipped_count, 1);
  assert.equal(apply.deletion_executed, true);
  assert.equal(apply.plan_consumed, true);

  assert.equal(statSync(files.oldCache).isFile(), true, 'inode-replaced file must remain');
  for (const file of [files.recentCache, files.oldTmp, files.activeLog, files.protectedPublic, files.protectedEnv]) {
    assert.equal(statSync(file).isFile(), true, `protected/review/recent file must remain: ${file}`);
  }

  runFailure([
    'apply', '--root', home,
    '--plan-id', plan.plan_id,
    '--expected-plan-hash', plan.plan_hash,
    '--confirm', plan.confirmation,
  ], env, 'plan_already_applied');
} finally {
  chmodSync(home, 0o700);
  rmSync(root, { recursive: true, force: true });
}

console.log('Hostinger storage cleanup script guard passed');
