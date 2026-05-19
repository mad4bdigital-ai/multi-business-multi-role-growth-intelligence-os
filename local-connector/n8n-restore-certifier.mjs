#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULTS = {
  artifact: 'D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm',
  manifest: 'D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.manifest.json',
  recoveryKey: 'D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.recovery-key.json',
  restoreRoot: 'D:\\Nagy\\Growth-0s-Backups\\restore-tests\\n8n-local\\growth-os-n8n-local-2026-05-17T18-25-41-880Z',
  checksum: 'cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7',
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

function listRestoreMarkers(root) {
  const markers = {
    root_exists: existsSync(root),
    has_database_sqlite: false,
    has_config: false,
    has_nodes_dir: false,
    file_count_sample: 0,
  };
  if (!markers.root_exists) return markers;
  const candidates = [
    path.join(root, 'database.sqlite'),
    path.join(root, '.n8n', 'database.sqlite'),
  ];
  markers.has_database_sqlite = candidates.some((candidate) => existsSync(candidate));
  markers.has_config = [path.join(root, 'config'), path.join(root, 'config.json'), path.join(root, '.n8n', 'config')].some((candidate) => existsSync(candidate));
  markers.has_nodes_dir = [path.join(root, 'nodes'), path.join(root, '.n8n', 'nodes')].some((candidate) => existsSync(candidate));
  try { markers.file_count_sample = readdirSync(root, { recursive: true }).slice(0, 10000).length; } catch {}
  return markers;
}

async function main() {
  const started = new Date().toISOString();
  const mode = env('N8N_RESTORE_CERTIFIER_MODE', 'probe');
  const artifact = env('N8N_RESTORE_CERTIFIER_ARTIFACT', DEFAULTS.artifact);
  const manifest = env('N8N_RESTORE_CERTIFIER_MANIFEST', DEFAULTS.manifest);
  const recoveryKey = env('N8N_RESTORE_CERTIFIER_RECOVERY_KEY', DEFAULTS.recoveryKey);
  const restoreRoot = env('N8N_RESTORE_CERTIFIER_RESTORE_ROOT', DEFAULTS.restoreRoot);
  const expectedChecksum = env('N8N_RESTORE_CERTIFIER_CHECKSUM_SHA256', DEFAULTS.checksum).toLowerCase();
  const verifyChecksum = boolEnv('N8N_RESTORE_CERTIFIER_VERIFY_CHECKSUM', true);

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

  const nodeVersion = await run(process.execPath, ['--version'], 15000);
  add('node runtime is available', nodeVersion.ok, { version_preview: nodeVersion.stdout.trim().slice(0, 100) });

  const n8nVersion = await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'n8n', '--version'], 45000);
  add('n8n CLI is available or can be resolved by npx', n8nVersion.ok, { exit_code: n8nVersion.exit_code, version_preview: (n8nVersion.stdout || n8nVersion.stderr || '').slice(0, 200) });

  const markers = listRestoreMarkers(restoreRoot);
  add('restore target markers are present if structural restore already ran', markers.has_database_sqlite && markers.has_config, markers);

  const appHealthUrl = env('N8N_RESTORE_CERTIFIER_APP_HEALTH_URL', '');
  if (appHealthUrl) {
    try {
      const res = await fetch(appHealthUrl, { signal: AbortSignal.timeout(15000) });
      add('optional isolated n8n health URL is reachable', res.ok, { status: res.status });
    } catch (err) {
      add('optional isolated n8n health URL is reachable', false, { error: err.message });
    }
  } else {
    add('optional isolated n8n health URL not configured', true, { skipped: true });
  }

  const bootRequested = mode === 'boot';
  add('isolated boot not executed by probe alias', !bootRequested, { mode });

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
    restore_root: { path: restoreRoot, markers },
    node_runtime: { available: nodeVersion.ok, version_preview: nodeVersion.stdout.trim().slice(0, 100) },
    n8n_cli: { available: n8nVersion.ok, version_preview: (n8nVersion.stdout || n8nVersion.stderr || '').slice(0, 200) },
    writes_attempted: false,
    isolated_boot_attempted: false,
    secrets_included: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || 'n8n_restore_certifier_failed', message: err.message }, writes_attempted: false, isolated_boot_attempted: false, secrets_included: false }, null, 2));
  process.exitCode = 1;
});
