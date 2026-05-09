/**
 * local-connector/server.mjs
 * Break-glass Express connector â€” reached via Cloudflare Tunnel when Cloud Run is down.
 * Bind: 127.0.0.1 only. Cloudflare Tunnel is the sole entry point.
 */

import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Bootstrap â€” manual .env parse (no dotenv dependency)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(envPath) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env is optional
  }
}

loadEnv(path.join(__dirname, '.env'));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.CONNECTOR_PORT ?? '7070', 10);
const API_KEY = process.env.BACKEND_API_KEY ?? '';
const SHELL_ENABLED = process.env.CONNECTOR_SHELL_ENABLED === 'true';
const FILES_ENABLED = process.env.CONNECTOR_FILES_ENABLED === 'true';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

/** @type {Record<string, ShellAlias>} */
let SHELL_ALLOWLIST = {};
try {
  if (process.env.CONNECTOR_SHELL_ALLOWLIST) {
    SHELL_ALLOWLIST = JSON.parse(process.env.CONNECTOR_SHELL_ALLOWLIST);
  }
} catch (e) {
  console.error('[connector] Failed to parse CONNECTOR_SHELL_ALLOWLIST:', e.message);
}

/** @type {string[]} */
const FILE_ALLOWLIST = (process.env.CONNECTOR_FILE_PATHS ?? '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Minimal HTTP framework (no Express dependency)
// Uses Node's built-in http module + manual routing
// ---------------------------------------------------------------------------

/**
 * @typedef {{ command: string, args: string[], display_name?: string,
 *             allow_extra_args?: boolean, max_extra_args?: number, timeout_ms?: number }} ShellAlias
 */

const UNSAFE_CHARS = /[;&|`$<>\\!{}()\n\r]/;

/**
 * Clamp a timeout value.
 * @param {number|undefined} requested
 * @param {number} [aliasDefault]
 * @returns {number}
 */
function clampTimeout(requested, aliasDefault) {
  const base = aliasDefault ?? DEFAULT_TIMEOUT_MS;
  if (!requested) return base;
  return Math.min(Math.max(requested, 1000), MAX_TIMEOUT_MS);
}

/**
 * Run a command safely via spawn (no shell).
 * @param {string} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runCommand(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

        const isWindowsCommandScript =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);

    const quoteForCmd = (value) => {
      const s = String(value);
      if (!s) return '""';
      return `"${s.replace(/"/g, '\\"')}"`;
    };

    const spawnCommand = isWindowsCommandScript
      ? (process.env.ComSpec || 'cmd.exe')
      : command;

    const spawnArgs = isWindowsCommandScript
      ? ['/d', '/s', '/c', [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ')]
      : args;

    const proc = spawn(spawnCommand, spawnArgs, { shell: false, windowsHide: true });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

    proc.on('close', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? 0;
        resolve({ stdout, stderr, exitCode, exit_code: exitCode });
      }
    });

    proc.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Request parsing helpers
// ---------------------------------------------------------------------------

/**
 * Read and JSON-parse the request body.
 * @param {http.IncomingMessage} req
 * @returns {Promise<unknown>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString(); });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function ok(res, data) {
  json(res, 200, { ok: true, ...data });
}

function err(res, status, code, message) {
  json(res, status, { ok: false, error: { code, message } });
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean} true if authenticated
 */
function requireAuth(req, res) {
  if (!API_KEY) {
    err(res, 500, 'NO_API_KEY', 'BACKEND_API_KEY is not configured on this connector');
    return false;
  }
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== API_KEY) {
    err(res, 401, 'UNAUTHORIZED', 'Missing or invalid Bearer token');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Audit logger
// ---------------------------------------------------------------------------

function audit(req, details) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, method: req.method, path: req.url, ...details }));
}

// ---------------------------------------------------------------------------
// Health check response
// ---------------------------------------------------------------------------

function healthBody() {
  return {
    ok: true,
    service: 'local-connector',
    hostname: os.hostname(),
    platform: process.platform,
    uptime: process.uptime(),
  };
}

// ---------------------------------------------------------------------------
// Config â€” fetch-upload
// ---------------------------------------------------------------------------

const MAIN_API_URL = (process.env.MAIN_API_URL ?? 'https://api.mad4b.com').replace(/\/$/, '');
const FETCH_UPLOAD_ENABLED = process.env.CONNECTOR_FETCH_UPLOAD_ENABLED !== 'false';

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleFetchUpload(req, res) {
  if (!FETCH_UPLOAD_ENABLED) return err(res, 403, 'DISABLED', 'fetch-upload is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { url, upload_type, metadata = {}, filename, uploaded_by, timeout_ms } = body;
  if (!url || typeof url !== 'string') return err(res, 400, 'MISSING_URL', 'url is required');
  if (!upload_type) return err(res, 400, 'MISSING_TYPE', 'upload_type is required');

  audit(req, { action: 'fetch_upload:browser', url, upload_type });

  let content;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clampTimeout(timeout_ms));
    const fetchRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!fetchRes.ok) return err(res, 502, 'FETCH_FAILED', `Remote ${fetchRes.status} ${fetchRes.statusText}`);
    content = await fetchRes.text();
  } catch (e) {
    return err(res, 502, 'FETCH_ERROR', e.message);
  }

  try {
    const uploadRes = await fetch(`${MAIN_API_URL}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        upload_type,
        source_mode: 'connector_browser',
        content,
        filename: filename || url.split('/').pop() || 'fetched_file',
        uploaded_by: uploaded_by || `connector:${os.hostname()}`,
        metadata: { ...metadata, source: { mode: 'connector_browser', origin_url: url, fetched_at: new Date().toISOString(), ...(metadata.source || {}) } },
      }),
    });
    const result = await uploadRes.json();
    return ok(res, { fetched_url: url, via: 'fetch', ...result });
  } catch (e) {
    return err(res, 502, 'FORWARD_ERROR', e.message);
  }
}

async function handleShellFetchUpload(req, res) {
  if (!FETCH_UPLOAD_ENABLED) return err(res, 403, 'DISABLED', 'fetch-upload is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { url, upload_type, metadata = {}, filename, uploaded_by, timeout_ms } = body;
  if (!url || typeof url !== 'string') return err(res, 400, 'MISSING_URL', 'url is required');
  if (!upload_type) return err(res, 400, 'MISSING_TYPE', 'upload_type is required');
  if (UNSAFE_CHARS.test(url)) return err(res, 400, 'UNSAFE_URL', 'URL contains unsafe characters');

  audit(req, { action: 'fetch_upload:shell', url, upload_type });

  let stdout;
  try {
    const result = await runCommand('curl', ['-sL', '--max-time', '60', url], clampTimeout(timeout_ms));
    if (result.exitCode !== 0) return err(res, 502, 'CURL_FAILED', result.stderr || 'curl exited non-zero');
    stdout = result.stdout;
  } catch (e) {
    return err(res, 502, 'CURL_ERROR', e.message);
  }

  try {
    const uploadRes = await fetch(`${MAIN_API_URL}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        upload_type,
        source_mode: 'connector_shell',
        content: stdout,
        filename: filename || url.split('/').pop() || 'fetched_file',
        uploaded_by: uploaded_by || `connector:${os.hostname()}`,
        metadata: { ...metadata, source: { mode: 'connector_shell', origin_url: url, fetched_at: new Date().toISOString(), ...(metadata.source || {}) } },
      }),
    });
    const result = await uploadRes.json();
    return ok(res, { fetched_url: url, via: 'curl', ...result });
  } catch (e) {
    return err(res, 502, 'FORWARD_ERROR', e.message);
  }
}

async function handleGitHub(req, res) {
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const rawArgs = body.args;
  if (!rawArgs) return err(res, 400, 'MISSING_ARGS', 'args is required');
  const args = Array.isArray(rawArgs) ? rawArgs.map(String) : String(rawArgs).split(/\s+/);

  for (const a of args) {
    if (UNSAFE_CHARS.test(a)) return err(res, 400, 'UNSAFE_ARGS', `Unsafe character in argument: ${a}`);
  }

  const timeoutMs = clampTimeout(body.timeout_ms);
  audit(req, { action: 'gh', args });

  try {
    const result = await runCommand('gh', args, timeoutMs);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, 'EXEC_ERROR', e.message);
  }
}

async function handleGCloud(req, res) {
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const rawArgs = body.args;
  if (!rawArgs) return err(res, 400, 'MISSING_ARGS', 'args is required');
  const args = Array.isArray(rawArgs) ? rawArgs.map(String) : String(rawArgs).split(/\s+/);

  for (const a of args) {
    if (UNSAFE_CHARS.test(a)) return err(res, 400, 'UNSAFE_ARGS', `Unsafe character in argument: ${a}`);
  }

  const timeoutMs = clampTimeout(body.timeout_ms);
  audit(req, { action: 'gcloud', args });

  try {
    const result = await runCommand('gcloud', args, timeoutMs);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, 'EXEC_ERROR', e.message);
  }
}

async function handleShell(req, res) {
  if (!SHELL_ENABLED) return err(res, 403, 'DISABLED', 'Shell endpoint is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, alias, extra_args = [], timeout_ms } = body;

  if (action === 'list') {
    audit(req, { action: 'shell:list' });
    return ok(res, {
      aliases: Object.fromEntries(
        Object.entries(SHELL_ALLOWLIST).map(([k, v]) => [k, { display_name: v.display_name ?? k, allow_extra_args: v.allow_extra_args ?? false }])
      ),
    });
  }

  if (action === 'status') {
    audit(req, { action: 'shell:status' });
    return ok(res, { shell_enabled: SHELL_ENABLED, alias_count: Object.keys(SHELL_ALLOWLIST).length });
  }

  if (action === 'run') {
    if (!alias) return err(res, 400, 'MISSING_ALIAS', 'alias is required for action=run');
    const entry = SHELL_ALLOWLIST[alias];
    if (!entry) return err(res, 404, 'UNKNOWN_ALIAS', `Alias "${alias}" is not in the allowlist`);

    const extraArr = Array.isArray(extra_args) ? extra_args.map(String) : [];

    if (extraArr.length > 0 && !entry.allow_extra_args) {
      return err(res, 400, 'EXTRA_ARGS_FORBIDDEN', `Alias "${alias}" does not permit extra_args`);
    }

    const maxExtra = entry.max_extra_args ?? 10;
    if (extraArr.length > maxExtra) {
      return err(res, 400, 'TOO_MANY_ARGS', `Alias "${alias}" allows at most ${maxExtra} extra args`);
    }

    for (const a of extraArr) {
      if (UNSAFE_CHARS.test(a)) return err(res, 400, 'UNSAFE_ARGS', `Unsafe character in extra_arg: ${a}`);
    }

    const args = [...entry.args, ...extraArr];
    const timeoutMs = clampTimeout(timeout_ms, entry.timeout_ms);
    audit(req, { action: 'shell:run', alias, command: entry.command, args });

    try {
      const result = await runCommand(entry.command, args, timeoutMs);
      return ok(res, { alias, display_name: entry.display_name ?? alias, ...result });
    } catch (e) {
      return err(res, 500, 'EXEC_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "status", "list", or "run"');
}

async function handleFiles(req, res) {
  if (!FILES_ENABLED) return err(res, 403, 'DISABLED', 'Files endpoint is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, path: filePath, content } = body;

  if (action === 'list') {
    audit(req, { action: 'files:list' });
    return ok(res, { allowed_paths: FILE_ALLOWLIST });
  }

  if (action === 'read') {
    if (!filePath) return err(res, 400, 'MISSING_PATH', 'path is required for action=read');
    const resolved = path.resolve(filePath);
    if (!FILE_ALLOWLIST.map(p => path.resolve(p)).includes(resolved)) {
      return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
    }
    audit(req, { action: 'files:read', path: resolved });
    try {
      const data = fs.readFileSync(resolved, 'utf8');
      return ok(res, { path: resolved, content: data, size: Buffer.byteLength(data) });
    } catch (e) {
      return err(res, 500, 'READ_ERROR', e.message);
    }
  }

  if (action === 'write') {
    if (!filePath) return err(res, 400, 'MISSING_PATH', 'path is required for action=write');
    if (content === undefined || content === null) return err(res, 400, 'MISSING_CONTENT', 'content is required for action=write');
    const resolved = path.resolve(filePath);
    if (!FILE_ALLOWLIST.map(p => path.resolve(p)).includes(resolved)) {
      return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
    }
    audit(req, { action: 'files:write', path: resolved, bytes: Buffer.byteLength(String(content)) });
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, String(content), 'utf8');
      return ok(res, { path: resolved, bytes_written: Buffer.byteLength(String(content)) });
    } catch (e) {
      return err(res, 500, 'WRITE_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "list", "read", or "write"');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/';
  const method = req.method ?? 'GET';

  try {
    if ((method === 'GET') && (url === '/' || url === '/health')) {
      audit(req, { action: 'health' });
      return json(res, 200, healthBody());
    }

    if (method === 'POST' && url === '/github') return await handleGitHub(req, res);
    if (method === 'POST' && url === '/gcloud') return await handleGCloud(req, res);
    if (method === 'POST' && url === '/shell') return await handleShell(req, res);
    if (method === 'POST' && url === '/files') return await handleFiles(req, res);
    if (method === 'POST' && url === '/fetch-upload') return await handleFetchUpload(req, res);
    if (method === 'POST' && url === '/shell-fetch-upload') return await handleShellFetchUpload(req, res);

    return err(res, 404, 'NOT_FOUND', `No route for ${method} ${url}`);
  } catch (e) {
    console.error('[connector] Unhandled error:', e);
    return err(res, 500, 'INTERNAL_ERROR', 'Unexpected server error');
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[connector] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[connector] Shell enabled: ${SHELL_ENABLED}, Files enabled: ${FILES_ENABLED}`);
  console.log(`[connector] Shell aliases: ${Object.keys(SHELL_ALLOWLIST).join(', ') || '(none)'}`);
  console.log(`[connector] File allowlist: ${FILE_ALLOWLIST.join(', ') || '(none)'}`);
});

