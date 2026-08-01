import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = new URL('./hostinger-storage-cleanup.sh', import.meta.url).pathname;
const script = readFileSync(scriptPath, 'utf8');

assert(script.includes('ACTION="scan"'), 'scan must be the default action');
assert(script.includes('APPLY_HOSTINGER_STORAGE_CLEANUP:'), 'apply must require typed confirmation');
assert(script.includes('plan has expired'), 'apply must reject expired plans');
assert(script.includes('plan content hash mismatch'), 'apply must verify plan integrity');
assert(script.includes('current_size') && script.includes('current_mtime'), 'apply must revalidate size and mtime');
assert(script.includes('[[ -f "$path" && ! -L "$path" ]]'), 'symlinks must be rejected');
assert(script.includes('/public_html/'), 'public_html must be protected');
assert(script.includes('/.ssh/'), '.ssh must be protected');
assert(script.includes('/secrets/'), 'secret directories must be protected');
assert(script.includes('/backups/'), 'backup directories must be protected');
assert(script.includes('MAX_DELETE_BYTES'), 'a byte deletion cap must exist');
assert(script.includes('MAX_FILES'), 'a file deletion cap must exist');
assert(script.includes('rm -- "$canonical"'), 'apply must delete one revalidated file at a time');
assert(!script.includes('rm -rf'), 'recursive force deletion is forbidden');
assert(!script.includes('eval '), 'eval is forbidden');
assert(!script.includes('sudo '), 'sudo is forbidden');
assert(!script.includes('chmod -R'), 'recursive chmod is forbidden');

function run(args, env) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
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
  oldTmp: path.join(home, 'tmp/old.tmp'),
  rotatedLog: path.join(home, 'logs/app.log.1'),
  activeLog: path.join(home, 'logs/app.log'),
  protectedPublic: path.join(home, 'domains/auth.mad4b.com/public_html/old.log.1'),
  protectedEnv: path.join(home, '.env'),
};
for (const [key, file] of Object.entries(files)) writeFileSync(file, key);
utimesSync(files.oldCache, oldEpoch, oldEpoch);
utimesSync(files.rotatedLog, oldEpoch, oldEpoch);
utimesSync(files.protectedPublic, oldEpoch, oldEpoch);
utimesSync(files.oldTmp, tmpOldEpoch, tmpOldEpoch);

try {
  const env = { HOME: home };
  const scan = run(['scan', '--root', home], env);
  assert.equal(scan.ok, true);
  assert.equal(scan.action, 'scan');
  assert.equal(scan.deletion_executed, false);

  const plan = run(['plan', '--root', home], env);
  assert.equal(plan.ok, true);
  assert.equal(plan.action, 'plan');
  assert.equal(plan.deletion_executed, false);
  assert.equal(plan.candidate_count, 3);
  assert(plan.confirmation.startsWith(`APPLY_HOSTINGER_STORAGE_CLEANUP:${plan.plan_id}:`));

  for (const file of [files.oldCache, files.oldTmp, files.rotatedLog]) {
    assert.equal(statSync(file).isFile(), true, 'plan must not delete candidates');
  }

  const apply = run([
    'apply', '--root', home,
    '--plan-id', plan.plan_id,
    '--confirm', plan.confirmation,
  ], env);
  assert.equal(apply.ok, true);
  assert.equal(apply.action, 'apply');
  assert.equal(apply.deleted_count, 3);
  assert.equal(apply.deletion_executed, true);

  for (const file of [files.recentCache, files.activeLog, files.protectedPublic, files.protectedEnv]) {
    assert.equal(statSync(file).isFile(), true, `protected/recent file must remain: ${file}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Hostinger storage cleanup script guard passed');
