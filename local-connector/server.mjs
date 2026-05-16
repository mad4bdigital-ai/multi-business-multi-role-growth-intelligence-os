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
const N8N_ENABLED = process.env.CONNECTOR_N8N_ENABLED !== 'false';
const N8N_BASE = (process.env.N8N_BASE_URL ?? 'http://localhost:5678').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY ?? '';
const N8N_COMMAND = process.env.N8N_COMMAND ?? (process.platform === 'win32' ? 'D:\\npm-global\\n8n.cmd' : 'n8n');
const N8N_USER_FOLDER = process.env.N8N_USER_FOLDER ?? (process.platform === 'win32' ? 'D:\\n8n-data' : path.join(os.homedir(), '.n8n'));
const N8N_PORT = String(process.env.N8N_PORT ?? '5678');
const N8N_LISTEN_ADDRESS = process.env.N8N_LISTEN_ADDRESS ?? '127.0.0.1';
const N8N_PUBLIC_URL = (process.env.N8N_PUBLIC_URL ?? process.env.N8N_EDITOR_BASE_URL ?? 'https://n8n.mad4b.com/').replace(/\/$/, '/');
const N8N_PROCESS_NAME = process.env.N8N_PROCESS_NAME ?? 'node';
const CF_ENABLED = process.env.CONNECTOR_CF_ENABLED === 'true';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const CF_ZONE_ID = process.env.CF_ZONE_ID ?? '';
const DEPENDENCIES_ENABLED = process.env.CONNECTOR_DEPENDENCIES_ENABLED === 'true';
const APPS_ENABLED = process.env.CONNECTOR_APPS_ENABLED === 'true';

const DEFAULT_DEPENDENCY_ALLOWLIST = {
  gh: {
    package: 'gh',
    display_name: 'GitHub CLI',
    manager: 'choco',
    post_install_check: { command: 'gh', args: ['--version'] },
  },
  googlecloudsdk: {
    package: 'googlecloudsdk',
    display_name: 'Google Cloud SDK',
    manager: 'choco',
    post_install_check: { command: 'gcloud', args: ['--version'] },
  },
};

const DEFAULT_APP_ALLOWLIST = {
  edge: {
    display_name: 'Microsoft Edge',
    command: 'msedge',
    process_name: 'msedge',
    browser: true,
    capability_class: 'browser',
    risk_class: 'interactive',
  },
  chrome: {
    display_name: 'Google Chrome',
    command: 'chrome',
    process_name: 'chrome',
    browser: true,
    capability_class: 'browser',
    risk_class: 'interactive',
  },
  vscode: {
    display_name: 'Visual Studio Code',
    command: 'code',
    process_name: 'Code',
    browser: false,
    capability_class: 'developer_tool',
    risk_class: 'interactive',
  },
  notepad: {
    display_name: 'Notepad',
    command: 'notepad',
    process_name: 'notepad',
    browser: false,
    capability_class: 'utility',
    risk_class: 'low',
  },
};

/** @type {Record<string, ShellAlias>} */
let SHELL_ALLOWLIST = {};
try {
  if (process.env.CONNECTOR_SHELL_ALLOWLIST) {
    SHELL_ALLOWLIST = JSON.parse(process.env.CONNECTOR_SHELL_ALLOWLIST);
  }
} catch (e) {
  console.error('[connector] Failed to parse CONNECTOR_SHELL_ALLOWLIST:', e.message);
}

let DEPENDENCY_ALLOWLIST = DEFAULT_DEPENDENCY_ALLOWLIST;
try {
  if (process.env.CONNECTOR_DEPENDENCY_ALLOWLIST) {
    DEPENDENCY_ALLOWLIST = JSON.parse(process.env.CONNECTOR_DEPENDENCY_ALLOWLIST);
  }
} catch (e) {
  console.error('[connector] Failed to parse CONNECTOR_DEPENDENCY_ALLOWLIST:', e.message);
}

let APP_ALLOWLIST = DEFAULT_APP_ALLOWLIST;
try {
  if (process.env.CONNECTOR_APP_ALLOWLIST) {
    APP_ALLOWLIST = JSON.parse(process.env.CONNECTOR_APP_ALLOWLIST);
  }
} catch (e) {
  console.error('[connector] Failed to parse CONNECTOR_APP_ALLOWLIST:', e.message);
}

/** @type {string[]} */
const FILE_ALLOWLIST = (process.env.CONNECTOR_FILE_PATHS ?? '')
  .split(',')
  .map(p => p.trim())
  .filter(Boolean);

function isSubPath(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isExistingDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function resolveAllowedFilePath(inputPath) {
  const resolved = path.resolve(String(inputPath || ''));
  const allowedRoots = FILE_ALLOWLIST.map(p => path.resolve(p));

  for (const root of allowedRoots) {
    if (resolved === root) return { resolved, root };
    if (isExistingDirectory(root) && isSubPath(root, resolved)) {
      return { resolved, root };
    }
  }

  return null;
}

function directoryEntries(dirPath, maxEntries = 200) {
  const limit = Math.min(Math.max(parseInt(maxEntries, 10) || 200, 1), 500);
  const children = fs.readdirSync(dirPath, { withFileTypes: true }).slice(0, limit);
  return children.map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    const stat = fs.statSync(fullPath);
    return {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'dir' : 'file',
      size: entry.isFile() ? stat.size : null,
      modified: stat.mtime.toISOString(),
    };
  });
}

function detectDriveRoots() {
  if (process.platform === 'win32') {
    const roots = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) roots.push(drive);
    }
    return roots;
  }
  return ['/'];
}

function rootIsOnDrive(root, drive) {
  const resolvedRoot = path.resolve(root).toLowerCase();
  const resolvedDrive = path.resolve(drive).toLowerCase();
  return resolvedRoot === resolvedDrive || resolvedRoot.startsWith(resolvedDrive);
}

function repoMarkerMatches(candidateDir, markers) {
  const found = [];
  for (const marker of markers) {
    const markerPath = path.resolve(candidateDir, marker);
    if (resolveAllowedFilePath(markerPath) && fs.existsSync(markerPath)) {
      found.push(marker);
    }
  }
  return found;
}

function locateRepoCandidates(startPath, options = {}) {
  const markers = Array.isArray(options.markers) && options.markers.length
    ? options.markers.map(String)
    : ['.git', 'AGENTS.md', 'package.json', 'http-generic-api/openapi.yaml'];
  const parsedMaxDepth = parseInt(options.max_depth, 10);
  const maxDepth = Number.isFinite(parsedMaxDepth) ? Math.min(Math.max(parsedMaxDepth, 0), 8) : 5;
  const maxMatches = Math.min(Math.max(parseInt(options.max_matches, 10) || 20, 1), 50);
  const maxEntries = Math.min(Math.max(parseInt(options.max_entries, 10) || 200, 1), 500);
  const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache']);
  const candidates = [];
  const visited = new Set();

  function walk(dirPath, depth) {
    if (candidates.length >= maxMatches) return;
    const allowed = resolveAllowedFilePath(dirPath);
    if (!allowed) return;

    const resolved = allowed.resolved;
    const key = resolved.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    const found = repoMarkerMatches(resolved, markers);
    if (found.length) {
      candidates.push({
        path: resolved,
        root: allowed.root,
        markers_found: found,
        score: found.length,
      });
    }

    if (depth >= maxDepth || candidates.length >= maxMatches) return;

    let children;
    try {
      children = fs.readdirSync(resolved, { withFileTypes: true }).slice(0, maxEntries);
    } catch {
      return;
    }

    for (const entry of children) {
      if (!entry.isDirectory() || skipDirs.has(entry.name)) continue;
      walk(path.join(resolved, entry.name), depth + 1);
      if (candidates.length >= maxMatches) break;
    }
  }

  walk(startPath, 0);
  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

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

function windowsCommand(command) {
  if (process.platform !== 'win32') return command;
  const lower = String(command).toLowerCase();
  if (lower === 'gcloud') return 'gcloud.cmd';
  if (lower === 'gh') return 'gh.exe';
  if (lower === 'choco') return 'choco.exe';
  return command;
}

function isSafeAlias(value) {
  return /^[A-Za-z0-9_.-]+$/.test(String(value || ''));
}

function getAllowedApp(appKey) {
  const key = String(appKey || '').trim().toLowerCase();
  if (!isSafeAlias(key)) return null;
  return APP_ALLOWLIST[key] ? { key, ...APP_ALLOWLIST[key] } : null;
}

function assertHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function psString(value) {
  return JSON.stringify(String(value));
}

function psArray(values) {
  return `@(${values.map(psString).join(',')})`;
}

function appClassification(entry) {
  const capabilityClass = String(entry.capability_class || (entry.browser ? 'browser' : 'desktop_app'));
  const riskClass = String(entry.risk_class || (entry.browser ? 'interactive' : 'low'));
  return {
    capability_class: capabilityClass,
    risk_class: riskClass,
    execution_surface: 'local_device_app',
    requires_allowlist: true,
    requires_runtime_enablement: 'CONNECTOR_APPS_ENABLED',
    consequential_actions_require_confirmation: true,
  };
}

function browserClassification() {
  return {
    capability_class: 'browser',
    risk_class: 'interactive',
    execution_surface: 'local_device_browser',
    requires_allowlist: true,
    requires_runtime_enablement: 'CONNECTOR_APPS_ENABLED',
    allowed_url_schemes: ['http', 'https'],
    consequential_actions_require_confirmation: true,
  };
}

async function startApp(entry, args = [], timeoutMs = 8000) {
  const command = String(entry.command || '').trim();
  if (!command) throw new Error('Configured app command is empty');
  if (/[<>\n\r]/.test(command)) throw new Error('Configured app command is unsafe');
  const script = args.length
    ? `Start-Process -FilePath ${psString(command)} -ArgumentList ${psArray(args)}`
    : `Start-Process -FilePath ${psString(command)}`;
  return runPs(script, timeoutMs);
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
    const result = await runCommand(windowsCommand('gh'), args, timeoutMs);
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
    const result = await runCommand(windowsCommand('gcloud'), args, timeoutMs);
    return ok(res, result);
  } catch (e) {
    return err(res, 500, 'EXEC_ERROR', e.message);
  }
}

async function handleDependencies(req, res) {
  if (!DEPENDENCIES_ENABLED) return err(res, 403, 'DISABLED', 'Dependency installer is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, package_key, timeout_ms } = body;

  if (action === 'status') {
    audit(req, { action: 'dependencies:status' });
    return ok(res, {
      dependencies_enabled: DEPENDENCIES_ENABLED,
      package_count: Object.keys(DEPENDENCY_ALLOWLIST).length,
    });
  }

  if (action === 'list') {
    audit(req, { action: 'dependencies:list' });
    return ok(res, {
      packages: Object.entries(DEPENDENCY_ALLOWLIST).map(([key, entry]) => ({
        package_key: key,
        display_name: entry.display_name ?? key,
        manager: entry.manager ?? 'choco',
        package: entry.package,
      })),
    });
  }

  if (action === 'install') {
    if (!package_key) return err(res, 400, 'MISSING_PACKAGE_KEY', 'package_key is required for action=install');
    const entry = DEPENDENCY_ALLOWLIST[String(package_key)];
    if (!entry) return err(res, 404, 'UNKNOWN_PACKAGE', `Package "${package_key}" is not in the dependency allowlist`);
    if ((entry.manager ?? 'choco') !== 'choco') return err(res, 400, 'UNSUPPORTED_MANAGER', 'Only choco dependency installs are supported');

    const packageName = String(entry.package || '');
    if (!/^[A-Za-z0-9_.-]+$/.test(packageName)) return err(res, 400, 'UNSAFE_PACKAGE', 'Dependency package name is invalid');

    const timeoutMs = clampTimeout(timeout_ms, 600000);
    audit(req, { action: 'dependencies:install', package_key, manager: 'choco', package: packageName });

    try {
      const install = await runCommand(windowsCommand('choco'), ['install', packageName, '-y', '--no-progress'], timeoutMs);
      let post_install_check = null;
      if (entry.post_install_check?.command) {
        const checkCommand = windowsCommand(String(entry.post_install_check.command));
        const checkArgs = Array.isArray(entry.post_install_check.args) ? entry.post_install_check.args.map(String) : [];
        post_install_check = await runCommand(checkCommand, checkArgs, 30000);
      }
      return ok(res, {
        package_key,
        manager: 'choco',
        package: packageName,
        install,
        post_install_check,
      });
    } catch (e) {
      return err(res, 500, 'INSTALL_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "status", "list", or "install"');
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

async function handleApps(req, res) {
  if (!APPS_ENABLED) return err(res, 403, 'DISABLED', 'App control endpoint is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, app_alias, timeout_ms } = body;

  if (action === 'status') {
    audit(req, { action: 'apps:status' });
    return ok(res, {
      apps_enabled: APPS_ENABLED,
      app_count: Object.keys(APP_ALLOWLIST).length,
      classification: {
        capability_class: 'desktop_app_control',
        risk_class: 'interactive',
        execution_surface: 'local_device_app',
        requires_allowlist: true,
        requires_runtime_enablement: 'CONNECTOR_APPS_ENABLED',
      },
    });
  }

  if (action === 'list') {
    audit(req, { action: 'apps:list' });
    return ok(res, {
      apps: Object.entries(APP_ALLOWLIST).map(([key, entry]) => ({
        app_alias: key,
        display_name: entry.display_name ?? key,
        browser: entry.browser === true,
        classification: appClassification(entry),
      })),
    });
  }

  if (action === 'launch') {
    const app = getAllowedApp(app_alias);
    if (!app) return err(res, 404, 'APP_NOT_ALLOWED', 'app_alias must match an allowlisted app');
    audit(req, { action: 'apps:launch', app_alias: app.key });
    try {
      const result = await startApp(app, [], clampTimeout(timeout_ms, 8000));
      return ok(res, { app_alias: app.key, launched: true, classification: appClassification(app), ...result });
    } catch (e) {
      return err(res, 500, 'APP_LAUNCH_ERROR', e.message);
    }
  }

  if (action === 'status_app') {
    const app = getAllowedApp(app_alias);
    if (!app) return err(res, 404, 'APP_NOT_ALLOWED', 'app_alias must match an allowlisted app');
    const processName = String(app.process_name || app.command || app.key).replace(/\.exe$/i, '');
    audit(req, { action: 'apps:status_app', app_alias: app.key });
    try {
      const result = await runPs(`Get-Process -Name ${psString(processName)} -ErrorAction SilentlyContinue | Select-Object Name,Id,MainWindowTitle | ConvertTo-Json -Compress`, 10000);
      let processes;
      try { processes = JSON.parse(result.stdout || '[]'); } catch { processes = result.stdout; }
      if (!Array.isArray(processes)) processes = processes ? [processes] : [];
      return ok(res, { app_alias: app.key, running: processes.length > 0, processes, classification: appClassification(app) });
    } catch (e) {
      return err(res, 500, 'APP_STATUS_ERROR', e.message);
    }
  }

  if (action === 'close') {
    const app = getAllowedApp(app_alias);
    if (!app) return err(res, 404, 'APP_NOT_ALLOWED', 'app_alias must match an allowlisted app');
    const processName = String(app.process_name || app.command || app.key).replace(/\.exe$/i, '');
    audit(req, { action: 'apps:close', app_alias: app.key });
    try {
      const result = await runPs(`Stop-Process -Name ${psString(processName)} -ErrorAction Stop`, 15000);
      return ok(res, { app_alias: app.key, closed: true, exit_code: result.exitCode, classification: appClassification(app) });
    } catch (e) {
      return err(res, 500, 'APP_CLOSE_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "status", "list", "launch", "status_app", or "close"');
}

async function handleBrowser(req, res) {
  if (!APPS_ENABLED) return err(res, 403, 'DISABLED', 'Browser control endpoint is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, browser_alias = 'edge', url, timeout_ms } = body;

  if (action === 'list') {
    audit(req, { action: 'browser:list' });
    return ok(res, {
      browsers: Object.entries(APP_ALLOWLIST)
        .filter(([, entry]) => entry.browser === true)
        .map(([key, entry]) => ({
          browser_alias: key,
          display_name: entry.display_name ?? key,
          classification: { ...browserClassification(), ...appClassification(entry) },
        })),
      classification: browserClassification(),
    });
  }

  if (action === 'open_url') {
    const browser = getAllowedApp(browser_alias);
    if (!browser || browser.browser !== true) return err(res, 404, 'BROWSER_NOT_ALLOWED', 'browser_alias must match an allowlisted browser');
    const safeUrl = assertHttpUrl(url);
    if (!safeUrl) return err(res, 400, 'INVALID_URL', 'url must be absolute http or https');
    audit(req, { action: 'browser:open_url', browser_alias: browser.key, url: safeUrl });
    try {
      const result = await startApp(browser, [safeUrl], clampTimeout(timeout_ms, 8000));
      return ok(res, { browser_alias: browser.key, opened: safeUrl, classification: browserClassification(), ...result });
    } catch (e) {
      return err(res, 500, 'BROWSER_OPEN_ERROR', e.message);
    }
  }

  if (action === 'screenshot') {
    const scale = Math.min(Math.max(Number(body.scale) || 0.5, 0.1), 1.0);
    audit(req, { action: 'browser:screenshot', scale });
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
      return ok(res, { image_base64: result.stdout.trim(), format: 'jpeg', scale, classification: browserClassification() });
    } catch (e) {
      return err(res, 500, 'BROWSER_SCREENSHOT_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "list", "open_url", or "screenshot"');
}

async function handleFiles(req, res) {
  if (!FILES_ENABLED) return err(res, 403, 'DISABLED', 'Files endpoint is disabled on this connector');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, path: filePath, content, max_entries, markers, max_depth, max_matches } = body;

  if (action === 'list') {
    if (!filePath) {
      audit(req, { action: 'files:list_roots' });
      return ok(res, { allowed_paths: FILE_ALLOWLIST });
    }

    const allowed = resolveAllowedFilePath(filePath);
    if (!allowed) {
      return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
    }

    audit(req, { action: 'files:list', path: allowed.resolved });
    try {
      const stat = fs.statSync(allowed.resolved);
      if (!stat.isDirectory()) {
        return err(res, 400, 'NOT_DIRECTORY', 'path must be an allowed directory for action=list');
      }
      const entries = directoryEntries(allowed.resolved, max_entries);
      return ok(res, {
        path: allowed.resolved,
        root: allowed.root,
        entries,
        count: entries.length,
        allowed_paths: FILE_ALLOWLIST,
      });
    } catch (e) {
      return err(res, 500, 'LIST_ERROR', e.message);
    }
  }

  if (action === 'list_drives') {
    audit(req, { action: 'files:list_drives' });
    const allowedRoots = FILE_ALLOWLIST.map(p => path.resolve(p));
    const drives = detectDriveRoots().map((drive) => ({
      path: drive,
      allowed: allowedRoots.some((root) => rootIsOnDrive(root, drive)),
      allowed_paths: allowedRoots.filter((root) => rootIsOnDrive(root, drive)),
    }));
    return ok(res, { drives, count: drives.length, allowed_paths: FILE_ALLOWLIST });
  }

  if (action === 'locate_repo') {
    const searchRoots = filePath ? [filePath] : FILE_ALLOWLIST;
    const candidates = [];

    for (const searchRoot of searchRoots) {
      const allowed = resolveAllowedFilePath(searchRoot);
      if (!allowed) {
        if (filePath) return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
        continue;
      }
      audit(req, { action: 'files:locate_repo', path: allowed.resolved });
      try {
        candidates.push(...locateRepoCandidates(allowed.resolved, {
          markers,
          max_depth,
          max_matches,
          max_entries,
        }));
      } catch (e) {
        return err(res, 500, 'LOCATE_REPO_ERROR', e.message);
      }
      if (candidates.length >= (Math.min(Math.max(parseInt(max_matches, 10) || 20, 1), 50))) break;
    }

    const deduped = Array.from(
      new Map(candidates.map((candidate) => [candidate.path.toLowerCase(), candidate])).values(),
    ).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    return ok(res, {
      candidates: deduped.slice(0, Math.min(Math.max(parseInt(max_matches, 10) || 20, 1), 50)),
      count: deduped.length,
      allowed_paths: FILE_ALLOWLIST,
    });
  }

  if (action === 'read') {
    if (!filePath) return err(res, 400, 'MISSING_PATH', 'path is required for action=read');
    const allowed = resolveAllowedFilePath(filePath);
    if (!allowed) {
      return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
    }
    audit(req, { action: 'files:read', path: allowed.resolved });
    try {
      const stat = fs.statSync(allowed.resolved);
      if (!stat.isFile()) {
        return err(res, 400, 'NOT_FILE', 'path must be an allowed file for action=read');
      }
      const data = fs.readFileSync(allowed.resolved, 'utf8');
      return ok(res, { path: allowed.resolved, root: allowed.root, content: data, size: Buffer.byteLength(data) });
    } catch (e) {
      return err(res, 500, 'READ_ERROR', e.message);
    }
  }

  if (action === 'write') {
    if (!filePath) return err(res, 400, 'MISSING_PATH', 'path is required for action=write');
    if (content === undefined || content === null) return err(res, 400, 'MISSING_CONTENT', 'content is required for action=write');
    const allowed = resolveAllowedFilePath(filePath);
    if (!allowed) {
      return err(res, 403, 'PATH_NOT_ALLOWED', 'Path is not in the allowed list');
    }
    audit(req, { action: 'files:write', path: allowed.resolved, bytes: Buffer.byteLength(String(content)) });
    try {
      fs.mkdirSync(path.dirname(allowed.resolved), { recursive: true });
      fs.writeFileSync(allowed.resolved, String(content), 'utf8');
      return ok(res, { path: allowed.resolved, root: allowed.root, bytes_written: Buffer.byteLength(String(content)) });
    } catch (e) {
      return err(res, 500, 'WRITE_ERROR', e.message);
    }
  }

  return err(res, 400, 'UNKNOWN_ACTION', 'action must be "list", "list_drives", "locate_repo", "read", or "write"');
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

function n8nRuntimeInfo(extra = {}) {
  return {
    base_url: N8N_BASE,
    public_url: N8N_PUBLIC_URL,
    command: N8N_COMMAND,
    user_folder: N8N_USER_FOLDER,
    port: N8N_PORT,
    listen_address: N8N_LISTEN_ADDRESS,
    enabled: N8N_ENABLED,
    ...extra,
  };
}

function n8nCommandExists() {
  try { return fs.existsSync(N8N_COMMAND); } catch { return false; }
}

function spawnDetached(command, args = [], envPatch = {}) {
  const isWindowsCommandScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const quoteForCmd = (value) => {
    const s = String(value);
    if (!s) return '""';
    return `"${s.replace(/"/g, '\\"')}"`;
  };
  const spawnCommand = isWindowsCommandScript ? (process.env.ComSpec || 'cmd.exe') : command;
  const spawnArgs = isWindowsCommandScript
    ? ['/d', '/s', '/c', [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ')]
    : args;
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: N8N_USER_FOLDER,
    env: { ...process.env, ...envPatch },
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false,
  });
  child.unref();
  return { pid: child.pid, command, args };
}

async function n8nHealthProbe() {
  const candidates = ['/healthz', '/healthz/readiness', '/rest/settings'];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${N8N_BASE}${candidate}`, {
        method: 'GET',
        headers: { ...(N8N_API_KEY ? { 'X-N8N-API-KEY': N8N_API_KEY } : {}) },
        signal: AbortSignal.timeout(5000),
      });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
      return { reachable: true, path: candidate, status: response.status, body };
    } catch (e) {
      // try next endpoint
    }
  }
  return { reachable: false };
}

async function n8nProcessProbe() {
  if (process.platform !== 'win32') return { supported: false, reason: 'process_probe_windows_only' };
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'n8n' -or $_.CommandLine -match 'n8n.cmd' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  try {
    const result = await runPs(ps, 10000);
    let processes;
    try { processes = JSON.parse(result.stdout || '[]'); } catch { processes = result.stdout; }
    if (!Array.isArray(processes)) processes = processes ? [processes] : [];
    return { supported: true, running: processes.length > 0, processes };
  } catch (e) {
    return { supported: true, running: null, error: e.message };
  }
}

async function n8nStart() {
  if (!n8nCommandExists() && path.isAbsolute(N8N_COMMAND)) {
    const errObj = new Error(`n8n command not found at ${N8N_COMMAND}`);
    errObj.code = 'N8N_COMMAND_NOT_FOUND';
    throw errObj;
  }
  fs.mkdirSync(N8N_USER_FOLDER, { recursive: true });
  return spawnDetached(N8N_COMMAND, ['start'], {
    N8N_USER_FOLDER,
    N8N_PORT,
    N8N_HOST: process.env.N8N_HOST ?? 'n8n.mad4b.com',
    N8N_LISTEN_ADDRESS,
    N8N_PROTOCOL: process.env.N8N_PROTOCOL ?? 'https',
    N8N_EDITOR_BASE_URL: process.env.N8N_EDITOR_BASE_URL ?? N8N_PUBLIC_URL,
    WEBHOOK_URL: process.env.WEBHOOK_URL ?? N8N_PUBLIC_URL,
  });
}

async function handleN8nV2(req, res) {
  if (!N8N_ENABLED) return err(res, 403, 'DISABLED', 'n8n endpoint is disabled — set CONNECTOR_N8N_ENABLED=true');
  if (!requireAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch { return err(res, 400, 'BAD_BODY', 'Invalid JSON'); }

  const { action, browser_alias = 'edge', timeout_ms } = body;
  if (!action) return err(res, 400, 'MISSING_ACTION', 'action is required');
  audit(req, { action: `n8n:${action}` });

  try {
    if (action === 'status' || action === 'diagnose') {
      const [health, processStatus] = await Promise.all([n8nHealthProbe(), n8nProcessProbe()]);
      let version = null;
      try { version = await runCommand(N8N_COMMAND, ['--version'], clampTimeout(timeout_ms, 15000)); } catch (e) { version = { error: e.message }; }
      return ok(res, { n8n: n8nRuntimeInfo({ health, process: processStatus, command_exists: n8nCommandExists(), version }) });
    }

    if (action === 'start') {
      const before = await n8nHealthProbe();
      if (before.reachable) return ok(res, { already_running: true, n8n: n8nRuntimeInfo({ health: before }) });
      const launched = await n8nStart();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const after = await n8nHealthProbe();
      return ok(res, { started: true, launched, n8n: n8nRuntimeInfo({ health: after }) });
    }

    if (action === 'open') {
      const safeUrl = assertHttpUrl(body.url || N8N_PUBLIC_URL);
      if (!safeUrl) return err(res, 400, 'INVALID_URL', 'url must be absolute http or https');
      const browser = getAllowedApp(browser_alias) || getAllowedApp('edge');
      if (browser?.browser === true) {
        const result = await startApp(browser, [safeUrl], clampTimeout(timeout_ms, 8000));
        return ok(res, { opened: safeUrl, browser_alias: browser.key, n8n: n8nRuntimeInfo(), ...result });
      }
      const result = await runPs(`Start-Process ${psString(safeUrl)}`, clampTimeout(timeout_ms, 8000));
      return ok(res, { opened: safeUrl, n8n: n8nRuntimeInfo(), ...result });
    }

    if (action === 'stop') {
      if (process.platform !== 'win32') return err(res, 400, 'UNSUPPORTED_PLATFORM', 'stop is currently implemented for Windows connectors only');
      const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'n8n' -or $_.CommandLine -match 'n8n.cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      const result = await runPs(ps, clampTimeout(timeout_ms, 15000));
      return ok(res, { stopped: true, n8n: n8nRuntimeInfo(), ...result });
    }

    if (action === 'restart') {
      if (process.platform === 'win32') {
        await runPs(`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'n8n' -or $_.CommandLine -match 'n8n.cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`, 15000).catch(() => null);
      }
      const launched = await n8nStart();
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const health = await n8nHealthProbe();
      return ok(res, { restarted: true, launched, n8n: n8nRuntimeInfo({ health }) });
    }

    // Fall through to the API-control implementation for workflow operations.
    return await handleN8n(req, res);
  } catch (e) {
    return err(res, 500, e.code || 'N8N_CONTROL_ERROR', e.message);
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
    if (method === 'POST' && url === '/dependencies') return await handleDependencies(req, res);
    if (method === 'POST' && url === '/shell') return await handleShell(req, res);
    if (method === 'POST' && url === '/apps') return await handleApps(req, res);
    if (method === 'POST' && url === '/browser') return await handleBrowser(req, res);
    if (method === 'POST' && url === '/files') return await handleFiles(req, res);
    if (method === 'POST' && url === '/fetch-upload') return await handleFetchUpload(req, res);
    if (method === 'POST' && url === '/shell-fetch-upload') return await handleShellFetchUpload(req, res);
    if (method === 'POST' && url === '/ps') return await handlePs(req, res);
    if (method === 'POST' && url === '/win') return await handleWin(req, res);
    if (method === 'POST' && url === '/n8n') return await handleN8nV2(req, res);
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
