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
const PS_ENABLED = process.env.CONNECTOR_POWERSHELL_ENABLED === 'true';
const WIN_ENABLED = process.env.CONNECTOR_WIN_ENABLED === 'true';
const N8N_ENABLED = process.env.CONNECTOR_N8N_ENABLED === 'true';
const N8N_BASE = (process.env.N8N_BASE_URL ?? 'http://localhost:5678').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY ?? '';
const CF_ENABLED = process.env.CONNECTOR_CF_ENABLED === 'true';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const CF_ZONE_ID = process.env.CF_ZONE_ID ?? '';

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
// PowerShell helper
// ---------------------------------------------------------------------------

function runPs(script, timeoutMs = 10000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return runCommand('powershell.exe', [
    '-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded,
  ], timeoutMs);
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
      aliases: Object.entries(SHELL_ALLOWLIST).map(([alias, v]) => ({
        alias,
        display_name: v.display_name ?? alias,
        allow_extra_args: v.allow_extra_args ?? false,
      })),
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

async function handlePs(req, res) {
  if (!PS_ENABLED) return err(res, 403, 'DISABLED', 'PowerShell endpoint is disabled — set CONNECTOR_POWERSHELL_ENABLED=true');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { script, timeout_ms } = body;
  if (!script || typeof script !== 'string') return err(res, 400, 'MISSING_SCRIPT', 'script is required');
  if (script.length > 10000) return err(res, 400, 'SCRIPT_TOO_LONG', 'script must be <= 10000 chars');

  const timeoutMs = clampTimeout(timeout_ms);
  audit(req, { action: 'ps:run', script_len: script.length });

  try {
    const result = await runPs(script, timeoutMs);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, 'EXEC_ERROR', e.message);
  }
}

async function handleWin(req, res) {
  if (!WIN_ENABLED) return err(res, 403, 'DISABLED', 'Windows control endpoint is disabled — set CONNECTOR_WIN_ENABLED=true');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action } = body;
  if (!action) return err(res, 400, 'MISSING_ACTION', 'action is required');
  audit(req, { action: `win:${action}` });

  if (action === 'open_url') {
    const { url } = body;
    if (!url || typeof url !== 'string') return err(res, 400, 'MISSING_URL', 'url is required');
    try {
      await runPs(`Start-Process ${JSON.stringify(url)}`, 8000);
      return ok(res, { opened: url });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'open_vscode') {
    const { path: filePath } = body;
    if (!filePath || typeof filePath !== 'string') return err(res, 400, 'MISSING_PATH', 'path is required');
    try {
      await runPs(`Start-Process 'code' -ArgumentList ${JSON.stringify(filePath)}`, 8000);
      return ok(res, { opened: filePath });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'screenshot') {
    const scale = Math.min(Math.max(Number(body.scale) || 0.5, 0.1), 1.0);
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
$g=[System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
$w=[int]($bounds.Width*${scale});$h=[int]($bounds.Height*${scale})
$scaled=New-Object System.Drawing.Bitmap($w,$h)
$sg=[System.Drawing.Graphics]::FromImage($scaled)
$sg.DrawImage($full,0,0,$w,$h)
$m=New-Object System.IO.MemoryStream
$scaled.Save($m,[System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($m.ToArray())`;
    try {
      const result = await runPs(ps, 15000);
      if (result.exitCode !== 0) return err(res, 500, 'SCREENSHOT_FAILED', result.stderr);
      return ok(res, { image_base64: result.stdout.trim(), format: 'jpeg', scale });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'process_list') {
    const filter = body.filter ?? '';
    const top = Math.min(Number(body.top) || 30, 100);
    if (filter && /[^\w\s\-.*]/.test(filter)) return err(res, 400, 'UNSAFE_FILTER', 'filter contains unsafe characters');
    const filterPs = filter ? `| Where-Object {$_.Name -like '*${filter}*'}` : '';
    const ps = `Get-Process ${filterPs} | Sort-Object CPU -Descending | Select-Object -First ${top} Name,Id,@{N='CPU';E={[math]::Round($_.CPU,1)}},@{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress`;
    try {
      const result = await runPs(ps, 10000);
      let processes;
      try { processes = JSON.parse(result.stdout); } catch { processes = result.stdout; }
      return ok(res, { processes });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'process_kill') {
    const { name, pid } = body;
    if (!name && !pid) return err(res, 400, 'MISSING_TARGET', 'name or pid is required');
    if (name && /[^\w\-.]/.test(name)) return err(res, 400, 'UNSAFE_NAME', 'process name contains unsafe characters');
    const ps = pid
      ? `Stop-Process -Id ${parseInt(pid, 10)} -Force -ErrorAction Stop`
      : `Stop-Process -Name '${name}' -Force -ErrorAction Stop`;
    try {
      const result = await runPs(ps, 10000);
      return ok(res, { killed: name || pid, exit_code: result.exitCode });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'notify') {
    const title = String(body.title ?? 'Growth Intelligence').slice(0, 100);
    const message = String(body.message ?? '').slice(0, 250);
    const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$n=New-Object System.Windows.Forms.NotifyIcon
$n.Icon=[System.Drawing.SystemIcons]::Information
$n.Visible=$true
$n.ShowBalloonTip(5000,${JSON.stringify(title)},${JSON.stringify(message)},[System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -Milliseconds 500;$n.Dispose()`;
    try {
      await runPs(ps, 8000);
      return ok(res, { notified: true, title, message });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'service_list') {
    const filter = body.filter ?? '';
    if (filter && /[^\w\s\-.*]/.test(filter)) return err(res, 400, 'UNSAFE_FILTER', 'filter contains unsafe characters');
    const filterPs = filter ? `| Where-Object {$_.Name -like '*${filter}*' -or $_.DisplayName -like '*${filter}*'}` : '';
    const ps = `Get-Service ${filterPs} | Select-Object Name,DisplayName,Status | ConvertTo-Json -Compress`;
    try {
      const result = await runPs(ps, 10000);
      let services;
      try { services = JSON.parse(result.stdout); } catch { services = result.stdout; }
      return ok(res, { services });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'service_action') {
    const { service_name, service_action: svcAct } = body;
    if (!service_name) return err(res, 400, 'MISSING_SERVICE', 'service_name is required');
    if (!['start', 'stop', 'restart'].includes(svcAct)) return err(res, 400, 'INVALID_ACTION', 'service_action must be start, stop, or restart');
    if (/[^\w\-.]/.test(service_name)) return err(res, 400, 'UNSAFE_NAME', 'service_name contains unsafe characters');
    const cmdMap = { start: 'Start-Service', stop: 'Stop-Service', restart: 'Restart-Service' };
    const ps = `${cmdMap[svcAct]} -Name '${service_name}' -ErrorAction Stop`;
    try {
      const result = await runPs(ps, 30000);
      return ok(res, { service_name, service_action: svcAct, exit_code: result.exitCode });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'disk_list') {
    const ps = `Get-Volume | Where-Object {$_.DriveType -in 'Fixed','Removable','Network'} | Select-Object DriveLetter,FileSystemLabel,FileSystem,DriveType,@{N='SizeGB';E={[math]::Round($_.Size/1GB,2)}},@{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}} | ConvertTo-Json -Compress`;
    try {
      const result = await runPs(ps, 10000);
      let disks;
      try { disks = JSON.parse(result.stdout); } catch { disks = result.stdout; }
      if (!Array.isArray(disks)) disks = disks ? [disks] : [];
      return ok(res, { disks });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'dir_list') {
    const { path: dirPath } = body;
    if (!dirPath || typeof dirPath !== 'string') return err(res, 400, 'MISSING_PATH', 'path is required');
    const ps = `Get-ChildItem -Path ${JSON.stringify(dirPath)} -ErrorAction SilentlyContinue | Select-Object Name,@{N='Type';E={if($_.PSIsContainer){'dir'}else{'file'}}},@{N='SizeKB';E={if($_.PSIsContainer){$null}else{[math]::Round($_.Length/1KB,1)}}},@{N='Modified';E={$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')}} | ConvertTo-Json -Compress`;
    try {
      const result = await runPs(ps, 15000);
      let entries;
      try { entries = JSON.parse(result.stdout); } catch { entries = result.stdout; }
      if (!Array.isArray(entries)) entries = entries ? [entries] : [];
      return ok(res, { path: dirPath, entries, count: entries.length });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  if (action === 'file_search') {
    const { path: searchPath = 'D:\\', pattern = '*', recurse = true, limit = 50 } = body;
    const maxLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const ps = `Get-ChildItem -Path ${JSON.stringify(searchPath)} ${recurse ? '-Recurse' : ''} -Filter ${JSON.stringify(pattern)} -File -ErrorAction SilentlyContinue | Select-Object -First ${maxLimit} FullName,@{N='SizeKB';E={[math]::Round($_.Length/1KB,1)}},@{N='Modified';E={$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')}} | ConvertTo-Json -Compress`;
    try {
      const result = await runPs(ps, 30000);
      let files;
      try { files = JSON.parse(result.stdout); } catch { files = result.stdout; }
      if (!Array.isArray(files)) files = files ? [files] : [];
      return ok(res, { path: searchPath, pattern, files, count: files.length });
    } catch (e) { return err(res, 500, 'EXEC_ERROR', e.message); }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be: open_url, open_vscode, screenshot, process_list, process_kill, notify, service_list, service_action, disk_list, dir_list, file_search');
}

async function handleN8n(req, res) {
  if (!N8N_ENABLED) return err(res, 403, 'DISABLED', 'n8n endpoint is disabled — set CONNECTOR_N8N_ENABLED=true');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action } = body;
  if (!action) return err(res, 400, 'MISSING_ACTION', 'action is required');
  audit(req, { action: `n8n:${action}` });

  const n8nHeaders = { 'Content-Type': 'application/json', ...(N8N_API_KEY ? { 'X-N8N-API-KEY': N8N_API_KEY } : {}) };

  const n8nFetch = async (method, path, data) => {
    const opts = { method, headers: n8nHeaders };
    if (data !== undefined) opts.body = JSON.stringify(data);
    const r = await fetch(`${N8N_BASE}${path}`, opts);
    return r.json();
  };

  try {
    if (action === 'health') {
      const data = await n8nFetch('GET', '/healthz');
      return ok(res, { n8n: data });
    }
    if (action === 'list_workflows') {
      const data = await n8nFetch('GET', '/api/v1/workflows?limit=50');
      return ok(res, { workflows: data });
    }
    if (action === 'get_workflow') {
      const { workflow_id } = body;
      if (!workflow_id) return err(res, 400, 'MISSING_ID', 'workflow_id is required');
      const data = await n8nFetch('GET', `/api/v1/workflows/${workflow_id}`);
      return ok(res, { workflow: data });
    }
    if (action === 'activate_workflow') {
      const { workflow_id } = body;
      if (!workflow_id) return err(res, 400, 'MISSING_ID', 'workflow_id is required');
      const data = await n8nFetch('POST', `/api/v1/workflows/${workflow_id}/activate`);
      return ok(res, { result: data });
    }
    if (action === 'deactivate_workflow') {
      const { workflow_id } = body;
      if (!workflow_id) return err(res, 400, 'MISSING_ID', 'workflow_id is required');
      const data = await n8nFetch('POST', `/api/v1/workflows/${workflow_id}/deactivate`);
      return ok(res, { result: data });
    }
    if (action === 'run_workflow') {
      const { workflow_id, input_data = {} } = body;
      if (!workflow_id) return err(res, 400, 'MISSING_ID', 'workflow_id is required');
      const data = await n8nFetch('POST', `/api/v1/workflows/${workflow_id}/run`, { data: input_data });
      return ok(res, { execution: data });
    }
    if (action === 'list_executions') {
      const { workflow_id, limit = 10 } = body;
      const qs = workflow_id ? `?workflowId=${workflow_id}&limit=${limit}` : `?limit=${limit}`;
      const data = await n8nFetch('GET', `/api/v1/executions${qs}`);
      return ok(res, { executions: data });
    }
    return err(res, 400, 'UNKNOWN_ACTION', 'action must be: health, list_workflows, get_workflow, activate_workflow, deactivate_workflow, run_workflow, list_executions');
  } catch (e) {
    return err(res, 502, 'N8N_ERROR', e.message);
  }
}

async function handleCf(req, res) {
  if (!CF_ENABLED) return err(res, 403, 'DISABLED', 'Cloudflare endpoint is disabled — set CONNECTOR_CF_ENABLED=true');
  if (!requireAuth(req, res)) return;
  if (!CF_TOKEN) return err(res, 500, 'NO_CF_TOKEN', 'CLOUDFLARE_API_TOKEN not configured');
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action } = body;
  if (!action) return err(res, 400, 'MISSING_ACTION', 'action is required');
  audit(req, { action: `cf:${action}` });

  const zoneId = body.zone_id || CF_ZONE_ID;
  const CF_BASE = 'https://api.cloudflare.com/client/v4';
  const cfHeaders = { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };

  const cfFetch = async (method, path, data) => {
    const opts = { method, headers: cfHeaders };
    if (data !== undefined) opts.body = JSON.stringify(data);
    const r = await fetch(`${CF_BASE}${path}`, opts);
    return r.json();
  };

  try {
    if (action === 'list_zones') {
      const data = await cfFetch('GET', `/zones?account.id=${CF_ACCOUNT_ID}&per_page=50`);
      return ok(res, { zones: data.result });
    }
    if (action === 'list_dns') {
      if (!zoneId) return err(res, 400, 'MISSING_ZONE', 'zone_id is required (or set CF_ZONE_ID in env)');
      const data = await cfFetch('GET', `/zones/${zoneId}/dns_records?per_page=100`);
      return ok(res, { records: data.result });
    }
    if (action === 'create_dns') {
      if (!zoneId) return err(res, 400, 'MISSING_ZONE', 'zone_id is required');
      const { type, name, content, proxied = true, ttl = 1 } = body;
      if (!type || !name || !content) return err(res, 400, 'MISSING_FIELDS', 'type, name, content are required');
      const data = await cfFetch('POST', `/zones/${zoneId}/dns_records`, { type, name, content, proxied, ttl });
      return ok(res, { record: data.result });
    }
    if (action === 'delete_dns') {
      if (!zoneId) return err(res, 400, 'MISSING_ZONE', 'zone_id is required');
      const { record_id } = body;
      if (!record_id) return err(res, 400, 'MISSING_ID', 'record_id is required');
      const data = await cfFetch('DELETE', `/zones/${zoneId}/dns_records/${record_id}`);
      return ok(res, { deleted: record_id, success: data.success });
    }
    if (action === 'list_tunnels') {
      const data = await cfFetch('GET', `/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?is_deleted=false`);
      return ok(res, { tunnels: data.result });
    }
    if (action === 'tunnel_status') {
      const { tunnel_id } = body;
      if (!tunnel_id) return err(res, 400, 'MISSING_ID', 'tunnel_id is required');
      const data = await cfFetch('GET', `/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}`);
      return ok(res, { tunnel: data.result });
    }
    if (action === 'purge_cache') {
      if (!zoneId) return err(res, 400, 'MISSING_ZONE', 'zone_id is required');
      const { files, tags, prefixes } = body;
      const data = await cfFetch('POST', `/zones/${zoneId}/purge_cache`, { files, tags, prefixes });
      return ok(res, { purged: data.success });
    }
    return err(res, 400, 'UNKNOWN_ACTION', 'action must be: list_zones, list_dns, create_dns, delete_dns, list_tunnels, tunnel_status, purge_cache');
  } catch (e) {
    return err(res, 502, 'CF_ERROR', e.message);
  }
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

    if (method === 'GET' && url === '/schema') {
      const schemaPath = path.join(__dirname, '..', 'http-generic-api', 'openapi.gpt-action.local-connector.yaml');
      try {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/yaml; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(schema);
      } catch {
        return err(res, 404, 'SCHEMA_NOT_FOUND', 'Schema file not found');
      }
      return;
    }

    if (method === 'POST' && url === '/github') return await handleGitHub(req, res);
    if (method === 'POST' && url === '/gcloud') return await handleGCloud(req, res);
    if (method === 'POST' && url === '/shell') return await handleShell(req, res);
    if (method === 'POST' && url === '/files') return await handleFiles(req, res);
    if (method === 'POST' && url === '/fetch-upload') return await handleFetchUpload(req, res);
    if (method === 'POST' && url === '/shell-fetch-upload') return await handleShellFetchUpload(req, res);
    if (method === 'POST' && url === '/ps') return await handlePs(req, res);
    if (method === 'POST' && url === '/win') return await handleWin(req, res);
    if (method === 'POST' && url === '/n8n') return await handleN8n(req, res);
    if (method === 'POST' && url === '/cf') return await handleCf(req, res);

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
  console.log(`[connector] PowerShell enabled: ${PS_ENABLED}, Win control: ${WIN_ENABLED}`);
  console.log(`[connector] n8n enabled: ${N8N_ENABLED} (${N8N_BASE}), CF enabled: ${CF_ENABLED}`);
});

