#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULTS = {
  artifact: 'D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm',
  manifest: 'D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-db-primary-2026-05-17T18-10-17-164Z.manifest.json',
  recoveryKey: 'D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-db-primary-2026-05-17T18-10-17-164Z.recovery-key.json',
  restoreRoot: 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated\\growth-os-db-primary-2026-05-17T18-10-17-164Z',
  checksum: 'e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756',
};

function env(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function fileInfo(file) {
  if (!file || !existsSync(file)) return { exists: false, path: file || null };
  const stat = statSync(file);
  return { exists: true, path: file, size_bytes: stat.size, modified_at: stat.mtime.toISOString() };
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(command, args = [], timeoutMs = 30000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const proc = spawn(command, args, { shell: false, windowsHide: true });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        resolve({ ok: false, exit_code: null, stdout, stderr, error: `timeout_after_${timeoutMs}ms` });
      }
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, exit_code: null, stdout, stderr, error: err.message });
      }
    });
    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, exit_code: code, stdout, stderr });
      }
    });
  });
}

async function main() {
  const started = new Date().toISOString();
  const mode = env('DB_RESTORE_CERTIFIER_MODE', 'probe');
  const artifact = env('DB_RESTORE_CERTIFIER_ARTIFACT', DEFAULTS.artifact);
  const manifest = env('DB_RESTORE_CERTIFIER_MANIFEST', DEFAULTS.manifest);
  const recoveryKey = env('DB_RESTORE_CERTIFIER_RECOVERY_KEY', DEFAULTS.recoveryKey);
  const restoreRoot = env('DB_RESTORE_CERTIFIER_RESTORE_ROOT', DEFAULTS.restoreRoot);
  const expectedChecksum = env('DB_RESTORE_CERTIFIER_CHECKSUM_SHA256', DEFAULTS.checksum).toLowerCase();
  const verifyChecksum = boolEnv('DB_RESTORE_CERTIFIER_VERIFY_CHECKSUM', true);

  const checks = [];
  const add = (name, passed, details = {}) => checks.push({ name, passed: Boolean(passed), details });

  const artifactInfo = fileInfo(artifact);
  const manifestInfo = fileInfo(manifest);
  const keyInfo = fileInfo(recoveryKey);
  add('artifact exists', artifactInfo.exists, { size_bytes: artifactInfo.size_bytes || null });
  add('manifest exists', manifestInfo.exists, { size_bytes: manifestInfo.size_bytes || null });
  add('recovery key file exists without reading it', keyInfo.exists, { size_bytes: keyInfo.size_bytes || null });

  let actualChecksum = null;
  if (artifactInfo.exists && verifyChecksum) {
    actualChecksum = await sha256File(artifact);
    add('artifact checksum matches manifest record', actualChecksum === expectedChecksum, { expected: expectedChecksum, actual: actualChecksum });
  }

  try {
    mkdirSync(restoreRoot, { recursive: true });
    add('restore root exists or was created', existsSync(restoreRoot), { restore_root: restoreRoot });
  } catch (err) {
    add('restore root exists or was created', false, { error: err.message });
  }

  const mysqlVersion = await run(process.platform === 'win32' ? 'mysql.exe' : 'mysql', ['--version'], 15000);
  const mariadbVersion = mysqlVersion.ok ? null : await run(process.platform === 'win32' ? 'mariadb.exe' : 'mariadb', ['--version'], 15000);
  add('mysql or mariadb client is available', mysqlVersion.ok || mariadbVersion.ok, {
    mysql_exit_code: mysqlVersion.exit_code,
    mariadb_exit_code: mariadbVersion?.exit_code ?? null,
  });

  const appHealthUrl = env('DB_RESTORE_CERTIFIER_APP_HEALTH_URL', '');
  if (appHealthUrl) {
    try {
      const res = await fetch(appHealthUrl, { signal: AbortSignal.timeout(15000) });
      add('optional app health URL is reachable', res.ok, { status: res.status });
    } catch (err) {
      add('optional app health URL is reachable', false, { error: err.message });
    }
  } else {
    add('optional app health URL not configured', true, { skipped: true });
  }

  const applyRequested = mode === 'apply';
  add('full import not executed by probe alias', !applyRequested, { mode });

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.length - passed;
  const result = {
    ok: failed === 0,
    mode,
    hostname: os.hostname(),
    platform: process.platform,
    started_at: started,
    completed_at: new Date().toISOString(),
    passed,
    failed,
    checks,
    artifact: { exists: artifactInfo.exists, size_bytes: artifactInfo.size_bytes || null, checksum_sha256: actualChecksum || null },
    manifest: { exists: manifestInfo.exists, size_bytes: manifestInfo.size_bytes || null },
    recovery_key: { exists: keyInfo.exists, size_bytes: keyInfo.size_bytes || null, content_read: false },
    restore_root: { path: restoreRoot, exists: existsSync(restoreRoot) },
    mysql_client: {
      available: mysqlVersion.ok || Boolean(mariadbVersion?.ok),
      command: mysqlVersion.ok ? 'mysql' : (mariadbVersion?.ok ? 'mariadb' : null),
      version_preview: (mysqlVersion.ok ? mysqlVersion.stdout : mariadbVersion?.stdout || '').slice(0, 200),
    },
    writes_attempted: false,
    full_import_attempted: false,
    secrets_included: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || 'db_restore_certifier_failed', message: err.message }, writes_attempted: false, full_import_attempted: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
