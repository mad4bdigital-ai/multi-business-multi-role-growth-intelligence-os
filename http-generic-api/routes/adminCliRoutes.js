import { Router } from "express";
import { spawn } from "child_process";
import { writeAuditLogAsync } from "../auditLogger.js";
import { getPool } from "../db.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_TIMEOUT_MS = 600000;
const SENSITIVE_ENV_PATTERN = /(password|passwd|pwd|secret|token|key|credential|private|auth|cookie|session)/i;
const LOCAL_WINDOWS_APP_ALLOWLIST_ENV = "LOCAL_WINDOWS_APP_ALLOWLIST";
const LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV = "LOCAL_WINDOWS_APP_CONTROL_ENABLED";
const ADMIN_SHELL_ALLOWLIST_ENV = "ADMIN_SHELL_ALLOWLIST";
const ADMIN_SHELL_ENABLED_ENV   = "ADMIN_SHELL_ENABLED";
const EXTRA_ARG_UNSAFE_PATTERN  = /[;&|`$<>\\!{}()\n\r]/;

export function parseArgs(input) {
  if (Array.isArray(input)) return input.map((arg) => String(arg));
  if (typeof input === "string") {
    return input.trim() ? input.trim().split(/\s+/) : [];
  }
  return [];
}

function normalizeTimeoutMs(input) {
  const value = Number(input) || DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.min(Math.max(value, 1000), MAX_COMMAND_TIMEOUT_MS);
}

function maskEnvValue(name, value, revealValues) {
  if (revealValues === true) return value;
  if (SENSITIVE_ENV_PATTERN.test(String(name || ""))) return "[masked]";
  return value;
}

function parseBooleanEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isGcloudRuntime(env = process.env) {
  return Boolean(env.K_SERVICE || env.CLOUD_RUN_JOB || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT);
}

function loadWindowsAppAllowlist(env = process.env) {
  const raw = String(env[LOCAL_WINDOWS_APP_ALLOWLIST_ENV] || "").trim();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error(`${LOCAL_WINDOWS_APP_ALLOWLIST_ENV} must be valid JSON.`);
    err.status = 500;
    err.code = "invalid_windows_app_allowlist";
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error(`${LOCAL_WINDOWS_APP_ALLOWLIST_ENV} must be a JSON object keyed by app alias.`);
    err.status = 500;
    err.code = "invalid_windows_app_allowlist";
    throw err;
  }

  return parsed;
}

function normalizeWindowsAppEntry(alias, entry) {
  const normalizedAlias = String(alias || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(normalizedAlias)) {
    const err = new Error("Windows app alias must use only lowercase letters, numbers, underscore, or dash.");
    err.status = 500;
    err.code = "invalid_windows_app_alias";
    throw err;
  }

  const value = typeof entry === "string" ? { command: entry, args: [] } : entry;
  const command = typeof value?.command === "string" ? value.command.trim() : "";
  const args = Array.isArray(value?.args) ? value.args.map((arg) => String(arg)) : [];
  const displayName = typeof value?.display_name === "string" ? value.display_name.trim() : normalizedAlias;

  if (!command) {
    const err = new Error(`Windows app alias ${normalizedAlias} is missing command.`);
    err.status = 500;
    err.code = "invalid_windows_app_entry";
    throw err;
  }

  if (args.length > 20) {
    const err = new Error(`Windows app alias ${normalizedAlias} has too many configured args.`);
    err.status = 500;
    err.code = "invalid_windows_app_entry";
    throw err;
  }

  return { alias: normalizedAlias, display_name: displayName, command, args };
}

function getWindowsAppAllowlist(env = process.env) {
  return Object.entries(loadWindowsAppAllowlist(env)).map(([alias, entry]) => normalizeWindowsAppEntry(alias, entry));
}

function buildWindowsAppAuthorizationStatus({ env, platform }) {
  const enabled = parseBooleanEnv(env[LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV]);
  const gcloudRuntime = isGcloudRuntime(env);
  const windowsRuntime = platform === "win32";
  let allowlistCount = 0;
  let allowlistValid = true;
  let allowlistError = "";

  try {
    allowlistCount = getWindowsAppAllowlist(env).length;
  } catch (error) {
    allowlistValid = false;
    allowlistError = error.code || "invalid_windows_app_allowlist";
  }

  return {
    authorized: enabled && windowsRuntime && !gcloudRuntime && allowlistValid && allowlistCount > 0,
    enabled,
    runtime: gcloudRuntime ? "gcloud" : windowsRuntime ? "local_windows" : "non_windows_local",
    allowlist: {
      env_name: LOCAL_WINDOWS_APP_ALLOWLIST_ENV,
      configured_count: allowlistCount,
      valid: allowlistValid,
      error_code: allowlistError || undefined
    },
    required_setup: [
      `${LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV}=true`,
      `${LOCAL_WINDOWS_APP_ALLOWLIST_ENV} JSON object with fixed app aliases`,
      "Run this connector on the local Windows device, not Cloud Run",
      "Authenticate with the admin/service BACKEND_API_KEY"
    ]
  };
}

export function handleWindowsAppControl(body = {}, deps = {}) {
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const spawnImpl = deps.spawn || spawn;
  const action = String(body.action || "list").trim().toLowerCase();

  if (action === "status" || action === "authorize") {
    return {
      action,
      ...buildWindowsAppAuthorizationStatus({ env, platform })
    };
  }

  if (!parseBooleanEnv(env[LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV])) {
    const err = new Error(`${LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV}=true is required before local Windows app control can run.`);
    err.status = 403;
    err.code = "local_windows_app_control_disabled";
    throw err;
  }

  if (isGcloudRuntime(env)) {
    const err = new Error("Local Windows app control is blocked in GCloud runtimes.");
    err.status = 403;
    err.code = "local_windows_app_control_gcloud_blocked";
    throw err;
  }

  if (platform !== "win32") {
    const err = new Error("Local Windows app control is only available on Windows.");
    err.status = 400;
    err.code = "local_windows_app_control_requires_windows";
    throw err;
  }

  const allowlist = getWindowsAppAllowlist(env);
  const publicApps = allowlist.map((entry) => ({
    alias: entry.alias,
    display_name: entry.display_name,
    configured_args_count: entry.args.length
  }));

  if (action === "list") {
    return {
      action,
      enabled: true,
      runtime: "local_windows",
      apps: publicApps,
      count: publicApps.length
    };
  }

  if (action !== "launch") {
    const err = new Error("Unsupported windows_app action. Use list or launch.");
    err.status = 400;
    err.code = "unsupported_windows_app_action";
    throw err;
  }

  const alias = String(body.app_alias || "").trim().toLowerCase();
  const app = allowlist.find((entry) => entry.alias === alias);
  if (!app) {
    const err = new Error("app_alias must match a configured allowlisted Windows app.");
    err.status = 400;
    err.code = "windows_app_not_allowlisted";
    throw err;
  }

  const child = spawnImpl(app.command, app.args, {
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  if (typeof child.unref === "function") child.unref();

  return {
    action,
    launched: true,
    app_alias: app.alias,
    display_name: app.display_name,
    pid: child.pid || null
  };
}

export function handleEnvControl(body = {}) {
  const action = String(body.action || "list").trim().toLowerCase();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const revealValues = body.reveal_values === true;

  if (action === "list") {
    const keys = Object.keys(process.env).sort();
    return {
      action,
      keys,
      values: body.include_values === true
        ? Object.fromEntries(keys.map((key) => [key, maskEnvValue(key, process.env[key], revealValues)]))
        : undefined
    };
  }

  if (!name) {
    const err = new Error("name is required for env get, set, and unset actions.");
    err.status = 400;
    err.code = "missing_env_name";
    throw err;
  }

  if (action === "get") {
    return {
      action,
      name,
      exists: Object.prototype.hasOwnProperty.call(process.env, name),
      value: maskEnvValue(name, process.env[name], revealValues)
    };
  }

  if (action === "set") {
    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      const err = new Error("value is required for env set action.");
      err.status = 400;
      err.code = "missing_env_value";
      throw err;
    }
    process.env[name] = String(body.value);
    return { action, name, value: maskEnvValue(name, process.env[name], revealValues) };
  }

  if (action === "unset") {
    const existed = Object.prototype.hasOwnProperty.call(process.env, name);
    delete process.env[name];
    return { action, name, existed };
  }

  const err = new Error("Unsupported env action. Use list, get, set, or unset.");
  err.status = 400;
  err.code = "unsupported_env_action";
  throw err;
}

export async function executeSafe(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = normalizeTimeoutMs(options.timeout_ms);
    const proc = spawn(cmd, args, { shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        const err = new Error(`Command timed out after ${timeoutMs}ms`);
        err.code = "command_timeout";
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      if (code !== 0) {
        const err = new Error(`Command failed with code ${code}\nStderr: ${stderr}`);
        err.code = "command_failed";
        err.exitCode = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }

      resolve({ stdout, stderr, exit_code: code });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function executeDbControl(body = {}) {
  const action = String(body.action || "run").trim().toLowerCase();
  if (action !== "run") {
    const err = new Error("Unsupported db action. Use run.");
    err.status = 400;
    err.code = "unsupported_db_action";
    throw err;
  }

  const sql = typeof body.sql === "string" ? body.sql.trim() : "";
  const params = Array.isArray(body.params) ? body.params : [];

  if (!sql) {
    const err = new Error("sql is required for db control.");
    err.status = 400;
    err.code = "missing_sql";
    throw err;
  }

  // Split on semicolons so multi-statement migration SQL can be run in one call.
  // Params only apply to single-statement calls (the typical interactive case).
  const statements = sql
    .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)  // split on ; outside string literals
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--") && !/^\/\*/.test(s));

  if (statements.length === 1) {
    const [result, fields] = await getPool().query(statements[0], params);
    return {
      rows: Array.isArray(result) ? result : undefined,
      result: Array.isArray(result) ? undefined : result,
      fields: Array.isArray(fields)
        ? fields.map((f) => ({ name: f.name, column_type: f.columnType }))
        : undefined,
    };
  }

  // Multi-statement execution: run sequentially, collect per-statement results.
  const results = [];
  for (const stmt of statements) {
    const [result] = await getPool().query(stmt);
    results.push({
      statement: stmt.slice(0, 120),
      affectedRows: result?.affectedRows,
      insertId: result?.insertId,
      warningStatus: result?.warningStatus,
    });
  }
  return { statements_executed: results.length, results };
}

function looksLikeUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

async function linkSessionContinuity(body = {}) {
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
  const scope = String(body.scope || "current_unlinked_sessions").trim().toLowerCase();

  if (!looksLikeUuid(userId)) {
    const err = new Error("user_id must be a UUID.");
    err.status = 400;
    err.code = "invalid_user_id";
    throw err;
  }
  if (!looksLikeUuid(tenantId)) {
    const err = new Error("tenant_id must be a UUID.");
    err.status = 400;
    err.code = "invalid_tenant_id";
    throw err;
  }
  if (scope !== "current_unlinked_sessions" && scope !== "tenant_unlinked_sessions") {
    const err = new Error("scope must be current_unlinked_sessions or tenant_unlinked_sessions.");
    err.status = 400;
    err.code = "invalid_scope";
    throw err;
  }

  const pool = getPool();
  const whereClause = scope === "tenant_unlinked_sessions"
    ? "user_id IS NULL AND tenant_id = ?"
    : "user_id IS NULL";
  const whereParams = scope === "tenant_unlinked_sessions" ? [tenantId] : [];

  const [[beforeRow]] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM \`request_envelopes\`
      WHERE ${whereClause}`,
    whereParams
  );

  const [updateResult] = await pool.query(
    `UPDATE \`request_envelopes\`
        SET user_id = ?, tenant_id = COALESCE(tenant_id, ?)
      WHERE ${whereClause}`,
    [userId, tenantId, ...whereParams]
  );

  const [[afterRow]] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM \`request_envelopes\`
      WHERE ${whereClause}`,
    whereParams
  );

  return {
    user_id: userId,
    tenant_id: tenantId,
    scope,
    matched_before: Number(beforeRow?.count || 0),
    updated_rows: Number(updateResult?.affectedRows || 0),
    remaining_unlinked: Number(afterRow?.count || 0)
  };
}

async function executeCliTool(tool, body = {}) {
  const args = parseArgs(body.args);

  if (args.length === 0) {
    const err = new Error("args array is required.");
    err.status = 400;
    err.code = "missing_args";
    throw err;
  }

  const command = tool === "github" ? "gh" : "gcloud";
  return executeSafe(command, args, { timeout_ms: body.timeout_ms });
}

function loadShellAllowlist(env = process.env) {
  const raw = String(env[ADMIN_SHELL_ALLOWLIST_ENV] || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
    return parsed;
  } catch (e) {
    const err = new Error(`${ADMIN_SHELL_ALLOWLIST_ENV} must be valid JSON object: ${e.message}`);
    err.status = 500; err.code = "invalid_shell_allowlist"; throw err;
  }
}

function builtInShellAllowlist() {
  return {
    session_archive_relink_repair_dry_run: {
      command: process.execPath,
      args: ["session-archive-relink-repair.mjs", "--dry-run"],
      display_name: "Session archive relink repair dry-run",
      allow_extra_args: true,
      max_extra_args: 12,
      timeout_ms: 120000,
      built_in: true
    },
    session_archive_relink_repair_apply: {
      command: "node",
      args: ["session-archive-relink-repair.mjs", "--apply"],
      display_name: "Session archive relink repair apply",
      allow_extra_args: true,
      max_extra_args: 12,
      timeout_ms: 120000,
      built_in: true
    }
  };
}

function mergedShellAllowlist(env = process.env) {
  return { ...builtInShellAllowlist(), ...loadShellAllowlist(env) };
}

function getShellAllowlist(env = process.env) {
  return Object.entries(mergedShellAllowlist(env)).map(([alias, entry]) => {
    const normalized = String(alias).trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) {
      const err = new Error(`Shell alias '${alias}' must use only lowercase letters, numbers, underscore, or dash.`);
      err.status = 500; err.code = "invalid_shell_alias"; throw err;
    }
    const value     = typeof entry === "string" ? { command: entry, args: [] } : entry;
    const command   = String(value?.command || "").trim();
    const args      = Array.isArray(value?.args) ? value.args.map(String) : [];
    const display   = String(value?.display_name || normalized);
    const allowExtra = value?.allow_extra_args === true;
    const maxExtra  = Math.min(parseInt(value?.max_extra_args) || 10, 20);
    const timeoutMs = Math.min(parseInt(value?.timeout_ms) || DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);
    if (!command) {
      const err = new Error(`Shell alias '${normalized}' is missing command.`);
      err.status = 500; err.code = "invalid_shell_entry"; throw err;
    }
    return { alias: normalized, display_name: display, command, args, allow_extra_args: allowExtra, max_extra_args: maxExtra, timeout_ms: timeoutMs };
  });
}

function buildShellAuthStatus(env = process.env) {
  const enabled = parseBooleanEnv(env[ADMIN_SHELL_ENABLED_ENV]);
  let allowlistCount = 0, allowlistValid = true, allowlistError = "";
  try { allowlistCount = getShellAllowlist(env).length; }
  catch (e) { allowlistValid = false; allowlistError = e.code || "invalid_shell_allowlist"; }
  return {
    authorized: enabled && allowlistValid && allowlistCount > 0,
    enabled,
    allowlist: { env_name: ADMIN_SHELL_ALLOWLIST_ENV, configured_count: allowlistCount, valid: allowlistValid, error_code: allowlistError || undefined },
    required_setup: [
      `${ADMIN_SHELL_ENABLED_ENV}=true`,
      `${ADMIN_SHELL_ALLOWLIST_ENV}={"alias":{"command":"cmd","args":[],"display_name":"..."}}`,
    ],
  };
}

async function executeShellControl(body = {}) {
  const action    = String(body.action || "list").trim().toLowerCase();
  const alias     = String(body.alias || body.app_alias || body.name || (Array.isArray(body.args) ? body.args[0] : "")).trim().toLowerCase();
  const extraArgs = Array.isArray(body.extra_args) ? body.extra_args.map(String) : [];

  if (action === "status") return { action, ...buildShellAuthStatus() };

  if (!parseBooleanEnv(process.env[ADMIN_SHELL_ENABLED_ENV])) {
    const err = new Error(`${ADMIN_SHELL_ENABLED_ENV}=true is required before shell control can run.`);
    err.status = 403; err.code = "shell_control_disabled"; throw err;
  }

  const allowlist = getShellAllowlist();
  if (action === "list") {
    return {
      action, enabled: true,
      commands: allowlist.map(({ alias: a, display_name, command, allow_extra_args, max_extra_args }) =>
        ({ alias: a, display_name, command, allow_extra_args, max_extra_args })),
      count: allowlist.length,
    };
  }

  if (action === "run") {
    if (!alias) { const e = new Error("alias required for shell run."); e.status = 400; e.code = "missing_alias"; throw e; }
    const entry = allowlist.find((e) => e.alias === alias);
    if (!entry) { const e = new Error(`alias '${alias}' not in shell allowlist.`); e.status = 400; e.code = "shell_alias_not_found"; throw e; }

    if (extraArgs.length > 0) {
      if (!entry.allow_extra_args) {
        const e = new Error(`extra_args not permitted for alias '${alias}'.`); e.status = 400; e.code = "extra_args_not_allowed"; throw e;
      }
      if (alias === "session_archive_relink_repair_dry_run" && extraArgs.includes("--apply")) {
        const e = new Error("dry-run relink alias must not receive --apply in extra_args."); e.status = 400; e.code = "conflicting_mode_flags"; throw e;
      }
      if (alias === "session_archive_relink_repair_apply" && extraArgs.includes("--dry-run")) {
        const e = new Error("apply relink alias must not receive --dry-run in extra_args."); e.status = 400; e.code = "conflicting_mode_flags"; throw e;
      }
      if (extraArgs.length > entry.max_extra_args) {
        const e = new Error(`Too many extra_args (max ${entry.max_extra_args}).`); e.status = 400; e.code = "too_many_extra_args"; throw e;
      }
      if (alias === "session_archive_relink_repair_dry_run" && extraArgs.includes("--apply")) {
        const e = new Error("dry-run relink alias must not receive --apply in extra_args."); e.status = 400; e.code = "conflicting_mode_flags"; throw e;
      }
      if (alias === "session_archive_relink_repair_apply" && extraArgs.includes("--dry-run")) {
        const e = new Error("apply relink alias must not receive --dry-run in extra_args."); e.status = 400; e.code = "conflicting_mode_flags"; throw e;
      }
      for (const arg of extraArgs) {
        if (EXTRA_ARG_UNSAFE_PATTERN.test(arg)) {
          const e = new Error(`extra_args contains disallowed shell metacharacter: ${JSON.stringify(arg)}`);
          e.status = 400; e.code = "unsafe_extra_arg"; throw e;
        }
      }
    }

    const result = await executeSafe(entry.command, [...entry.args, ...extraArgs], { timeout_ms: body.timeout_ms || entry.timeout_ms });
    return { action, alias, command: entry.command, ...result };
  }

  const err = new Error("shell action must be one of: status, list, run.");
  err.status = 400; err.code = "unsupported_shell_action"; throw err;
}

async function executeHostingerControl(body = {}) {
  const apiPath   = String(body.path   || "").trim();
  const method    = String(body.method || "GET").toUpperCase();
  const keyRef    = String(body.api_key_ref || "cloud_plan").trim();
  const reqParams = body.params && typeof body.params === "object" ? body.params : {};
  const reqBody   = body.request_body;

  if (!apiPath) {
    const err = new Error("path is required for hostinger control.");
    err.status = 400; err.code = "missing_path"; throw err;
  }

  const apiKey = keyRef === "shared_manager"
    ? process.env.HOSTINGER_SHARED_MANAGER_01_API_KEY
    : process.env.HOSTINGER_CLOUD_PLAN_01_API_KEY;

  if (!apiKey) {
    const err = new Error(`Hostinger API key not configured (api_key_ref: ${keyRef}).`);
    err.status = 500; err.code = "hostinger_key_missing"; throw err;
  }

  const url = new URL(apiPath.startsWith("/") ? apiPath : `/${apiPath}`, "https://developers.hostinger.com");
  for (const [k, v] of Object.entries(reqParams)) url.searchParams.set(k, String(v));

  const fetchOpts = {
    method,
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (reqBody !== undefined && method !== "GET") {
    fetchOpts.body = JSON.stringify(reqBody);
  }

  const res  = await fetch(url.toString(), fetchOpts);
  const text = await res.text().catch(() => "");
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  return { status: res.status, ok: res.ok, data };
}

async function executeCloudflareControl(body = {}) {
  const apiPath  = String(body.path   || "").trim();
  const method   = String(body.method || "GET").toUpperCase();
  const reqBody  = body.request_body;
  const reqParams = body.params && typeof body.params === "object" ? body.params : {};

  if (!apiPath) {
    const err = new Error("path is required for cloudflare control.");
    err.status = 400; err.code = "missing_path"; throw err;
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    const err = new Error("CLOUDFLARE_API_TOKEN is not configured.");
    err.status = 500; err.code = "cloudflare_token_missing"; throw err;
  }

  const url = new URL(apiPath.startsWith("/") ? apiPath : `/${apiPath}`, "https://api.cloudflare.com");
  for (const [k, v] of Object.entries(reqParams)) url.searchParams.set(k, String(v));

  const fetchOpts = {
    method,
    headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
  };
  if (reqBody !== undefined && method !== "GET") {
    fetchOpts.body = JSON.stringify(reqBody);
  }

  const res  = await fetch(url.toString(), fetchOpts);
  const text = await res.text().catch(() => "");
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  return { status: res.status, ok: res.ok, data };
}

async function executeAdminControl(body = {}) {
  const tool = String(body.tool || "").trim().toLowerCase();

  if (tool === "github" || tool === "gcloud") {
    return { tool, result: await executeCliTool(tool, body) };
  }

  if (tool === "db") {
    return { tool, result: await executeDbControl(body) };
  }

  if (tool === "env") {
    return { tool, result: handleEnvControl(body) };
  }

  if (tool === "windows_app") {
    return { tool, result: handleWindowsAppControl(body) };
  }

  if (tool === "hostinger") {
    return { tool, result: await executeHostingerControl(body) };
  }

  if (tool === "cloudflare") {
    return { tool, result: await executeCloudflareControl(body) };
  }

  if (tool === "shell") {
    return { tool, result: await executeShellControl(body) };
  }

  const err = new Error("tool must be one of github, gcloud, db, env, windows_app, hostinger, cloudflare, or shell.");
  err.status = 400;
  err.code = "unsupported_admin_control_tool";
  throw err;
}

function auditAdminControl(tool, body) {
  writeAuditLogAsync({
    action: `admin_control.${tool}`,
    resource_type: "admin_control",
    resource_id: tool,
    payload: {
      tool,
      args: Array.isArray(body.args) ? body.args : undefined,
      sql: tool === "db" ? body.sql : undefined,
      env_action: tool === "env" ? body.action || "list" : undefined,
      env_name: tool === "env" ? body.name : undefined,
      windows_app_action: tool === "windows_app" ? body.action || "list" : undefined,
      windows_app_alias: tool === "windows_app" ? body.app_alias : undefined,
      hostinger_path: tool === "hostinger" ? body.path : undefined,
      hostinger_method: tool === "hostinger" ? body.method || "GET" : undefined,
      cloudflare_path: tool === "cloudflare" ? body.path : undefined,
      cloudflare_method: tool === "cloudflare" ? body.method || "GET" : undefined,
      shell_alias: tool === "shell" ? body.alias : undefined,
      shell_action: tool === "shell" ? body.action || "list" : undefined
    }
  });
}

export function buildAdminControlHandler() {
  return async function adminControlHandler(req, res) {
    const body = req.body || {};
    const tool = String(body.tool || "").trim().toLowerCase();

    try {
      const execution = await executeAdminControl(body);
      auditAdminControl(execution.tool, body);
      return res.status(200).json({ ok: true, ...execution });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        ok: false,
        tool,
        error: {
          code: err.code || `${tool || "admin_control"}_failed`,
          message: err.message,
          ...(err.exitCode !== undefined ? { exit_code: err.exitCode } : {}),
          ...(err.stdout !== undefined ? { stdout: err.stdout } : {}),
          ...(err.stderr !== undefined ? { stderr: err.stderr } : {})
        }
      });
    }
  };
}

export function buildSessionContinuityHandler() {
  return async function sessionContinuityHandler(req, res) {
    try {
      const result = await linkSessionContinuity(req.body || {});
      writeAuditLogAsync({
        action: "admin_control.session_continuity_link_user",
        resource_type: "request_envelopes",
        resource_id: result.user_id,
        payload: result
      });
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        ok: false,
        error: {
          code: err.code || "session_continuity_link_failed",
          message: err.message
        }
      });
    }
  };
}

export function requireAdminPrincipal(req, res, next) {
  if (req.auth?.is_admin === true) return next();

  return res.status(403).json({
    ok: false,
    error: {
      code: "admin_backend_api_key_required",
      message: "Admin control endpoints require the admin/service BACKEND_API_KEY. User JWT access is not allowed.",
      status: 403
    }
  });
}

export function buildAdminCliRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  const adminControlHandler = buildAdminControlHandler();

  router.post("/gcloud", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const parsedArgs = parseArgs(req.body?.args);

      if (parsedArgs.length === 0) {
        return res.status(400).json({ ok: false, error: { code: "missing_args", message: "args array is required." } });
      }

      writeAuditLogAsync({ action: "admin_cli.gcloud", resource_type: "cli", resource_id: "gcloud", payload: { args: parsedArgs } });

      const result = await executeSafe("gcloud", parsedArgs, { timeout_ms: req.body?.timeout_ms });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "gcloud_execution_failed", message: err.message } });
    }
  });

  router.post("/github", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const parsedArgs = parseArgs(req.body?.args);

      if (parsedArgs.length === 0) {
        return res.status(400).json({ ok: false, error: { code: "missing_args", message: "args array is required." } });
      }

      writeAuditLogAsync({ action: "admin_cli.github", resource_type: "cli", resource_id: "gh", payload: { args: parsedArgs } });

      const result = await executeSafe("gh", parsedArgs, { timeout_ms: req.body?.timeout_ms });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "github_execution_failed", message: err.message } });
    }
  });

  router.post("/control", requireBackendApiKey, requireAdminPrincipal, adminControlHandler);

  // â”€â”€ GET /admin/cli/dns â€” list DNS records for a domain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.get("/dns", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const domain = String(req.query.domain || "mad4b.com").trim();
    const keyRef = String(req.query.api_key_ref || "cloud_plan").trim();
    try {
      const result = await executeHostingerControl({ path: `/api/dns/v1/zones/${encodeURIComponent(domain)}`, method: "GET", api_key_ref: keyRef });
      return res.status(result.status || 200).json({ ok: result.ok, domain, records: result.data });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "dns_list_failed", message: err.message } });
    }
  });

  // â”€â”€ POST /admin/cli/dns â€” upsert a DNS record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.post("/dns", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { domain = "mad4b.com", name, type, content, ttl = 300, api_key_ref = "cloud_plan" } = req.body || {};
    if (!name || !type || !content) {
      return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "name, type, content required." } });
    }
    try {
      writeAuditLogAsync({ action: "admin_dns.upsert", resource_type: "dns_record", resource_id: `${name}.${domain}`, payload: { name, type, content, ttl } });
      const result = await executeHostingerControl({
        path: `/api/dns/v1/zones/${encodeURIComponent(domain)}`,
        method: "PUT",
        api_key_ref,
        request_body: { overwrite: false, zone: [{ name, type, ttl, records: [{ content }] }] },
      });
      return res.status(result.status || 200).json({ ok: result.ok, domain, name, type, result: result.data });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "dns_upsert_failed", message: err.message } });
    }
  });

  // â”€â”€ DELETE /admin/cli/dns â€” delete a DNS record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  router.delete("/dns", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const { domain = "mad4b.com", name, type, api_key_ref = "cloud_plan" } = req.body || {};
    if (!name || !type) {
      return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "name and type required." } });
    }
    try {
      writeAuditLogAsync({ action: "admin_dns.delete", resource_type: "dns_record", resource_id: `${name}.${domain}`, payload: { name, type } });
      const result = await executeHostingerControl({
        path: `/api/dns/v1/zones/${encodeURIComponent(domain)}`,
        method: "DELETE",
        api_key_ref,
        request_body: { filters: [{ name, type }] },
      });
      return res.status(result.status || 200).json({ ok: result.ok, domain, name, type, result: result.data });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "dns_delete_failed", message: err.message } });
    }
  });

  router.post("/hostinger", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const body = req.body || {};
    try {
      writeAuditLogAsync({
        action: "admin_cli.hostinger",
        resource_type: "hostinger_api",
        resource_id: body.path || "unknown",
        payload: { method: body.method || "GET", path: body.path, api_key_ref: body.api_key_ref || "cloud_plan" },
      });
      const result = await executeHostingerControl(body);
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "hostinger_failed", message: err.message },
      });
    }
  });

  router.post("/cloudflare", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    const body = req.body || {};
    try {
      writeAuditLogAsync({
        action: "admin_cli.cloudflare",
        resource_type: "cloudflare_api",
        resource_id: body.path || "unknown",
        payload: { method: body.method || "GET", path: body.path },
      });
      const result = await executeCloudflareControl(body);
      return res.status(200).json({ ok: true, result });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "cloudflare_failed", message: err.message },
      });
    }
  });

  // ── GET /admin/cli/local-connector/install-bundle ─────────────────────────
  // Generates a pre-filled Windows .bat installer.
  // Credential resolution order:
  //   1. DB: local_connector_user_configs for the given user_id + device_id
  //   2. Env fallback: CLOUDFLARE_TUNNEL_TOKEN (for backward compat / admin own device)
  // ?user_id=X   → resolve config for this user (admin only; defaults to platform admin)
  // ?device_id=Y → resolve config for this device (defaults to "mohammedlap")
  // ?format=bat  → returns the file directly as an attachment (for curl)
  router.get("/local-connector/install-bundle", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const format   = String(req.query.format || "json").toLowerCase();
      const userId   = String(req.query.user_id   || "").trim() || "00000000-0000-4000-a000-000000000002";
      const deviceId = String(req.query.device_id || "").trim() || "mohammedlap";

      // 1. Look up device config from DB
      let tunnelToken    = "";
      let backendKey     = "";
      let configSource   = "env";
      let resolvedDevice = deviceId;
      try {
        const pool = getPool();
        const [[row]] = await pool.query(
          "SELECT cf_token, connector_secret, device_id FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",
          [userId, deviceId]
        );
        if (row?.cf_token) {
          tunnelToken    = row.cf_token;
          backendKey     = row.connector_secret || "";
          configSource   = "db";
          resolvedDevice = row.device_id;
        }
      } catch (dbErr) {
        console.warn("[install-bundle] DB lookup failed, trying env fallback:", dbErr.message);
      }

      // 2. Env fallback — also persist to DB so subsequent calls use DB
      if (!tunnelToken) {
        tunnelToken = process.env.CLOUDFLARE_TUNNEL_TOKEN || "";
        backendKey  = process.env.BACKEND_API_KEY || "";
        configSource = "env";
        if (tunnelToken) {
          try {
            const pool = getPool();
            await pool.query(
              `UPDATE \`local_connector_user_configs\`
               SET cf_token = COALESCE(NULLIF(cf_token,''), ?),
                   connector_secret = COALESCE(NULLIF(connector_secret,''), ?)
               WHERE user_id = ? AND device_id = ?`,
              [tunnelToken, backendKey || null, userId, deviceId]
            );
          } catch {}
        }
      }

      if (!tunnelToken) {
        return res.status(404).json({
          ok: false,
          error: {
            code: "config_not_found",
            message: `No connector config found in DB for user_id=${userId} device_id=${deviceId}, and CLOUDFLARE_TUNNEL_TOKEN is not set. Run POST /local-connector/install first to provision the device.`,
          }
        });
      }

      const batContent = generateConnectorInstallerBat(tunnelToken, backendKey);
      const filename   = `install-connector-${new Date().toISOString().slice(0,10)}.bat`;

      if (format === "bat") {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(batContent);
      }

      // Upload to Drive so GPT can share a link
      let driveResult = null;
      let driveUploadStatus = typeof deps.getGoogleClients === "function" ? "attempted" : "not_configured";
      let driveError = null;
      if (typeof deps.getGoogleClients === "function") {
        try {
          const { drive } = await deps.getGoogleClients();
          const created = await drive.files.create({
            requestBody: { name: filename, mimeType: "application/octet-stream" },
            media: { mimeType: "application/octet-stream", body: batContent },
            fields: "id,webViewLink",
          });
          if (created?.data?.id) {
            await drive.permissions.create({
              fileId: created.data.id,
              requestBody: { role: "reader", type: "anyone" },
            });
            driveResult = {
              drive_file_id: created.data.id,
              drive_link: `https://drive.google.com/uc?export=download&id=${created.data.id}`,
              view_link: created.data.webViewLink,
            };
          }
        } catch (driveErr) {
          driveUploadStatus = "failed";
          driveError = sanitizeDriveUploadError(driveErr);
          console.warn("[install-bundle] Drive upload failed:", driveErr.message);
        }
      }
      if (driveResult) driveUploadStatus = "uploaded";

      writeAuditLogAsync({
        action: "admin_cli.local_connector_install_bundle",
        resource_type: "install_bundle",
        resource_id: filename,
        payload: {
          drive_uploaded: !!driveResult,
          drive_upload_status: driveUploadStatus,
          config_source: configSource,
          device_id: resolvedDevice,
          user_id: userId
        },
      });

      return res.status(200).json({
        ok: true,
        filename,
        config_source: configSource,
        device_id: resolvedDevice,
        instructions: driveResult
          ? "Download the generated installer from drive.drive_link and run it as Administrator from the repo root. cloudflared and the Node.js connector service (via NSSM) will be installed automatically if missing. Both services auto-restart on failure and reboot."
          : "Drive upload was unavailable. Use the direct admin-only format=bat download path outside Custom GPT to retrieve the installer, then run it as Administrator from the repo root.",
        script_content_omitted: true,
        script_content_reason: "installer contains live tunnel and backend credentials",
        drive_upload_status: driveUploadStatus,
        drive_error: driveError,
        drive: driveResult,
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: "install_bundle_failed", message: err.message },
      });
    }
  });

  // ── POST /admin/cli/local-connector/self-repair ───────────────────────────
  // Single-shot self-repair for the admin's local connector.
  // 1. Reads device config from DB (user_id + device_id, defaults to admin / mohammedlap).
  // 2. Checks CF tunnel health via Cloudflare API.
  // 3. Generates and uploads install bundle.
  // 4. Returns diagnosis + Drive download link so GPT can hand it directly to user.
  // GPT should call this whenever connector.mad4b.com returns 1033.
  router.post("/local-connector/self-repair", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      const userId   = String(req.body?.user_id   || "").trim() || "00000000-0000-4000-a000-000000000002";
      const deviceId = String(req.body?.device_id || "").trim() || "mohammedlap";

      // 1. Load config from DB
      let tunnelToken  = "";
      let backendKey   = "";
      let cfTunnelId   = null;
      let tunnelUrl    = null;
      let configSource = "env";
      try {
        const pool = getPool();
        const [[row]] = await pool.query(
          "SELECT cf_token, connector_secret, cf_tunnel_id, tunnel_url FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",
          [userId, deviceId]
        );
        if (row) {
          tunnelToken  = row.cf_token || "";
          backendKey   = row.connector_secret || "";
          cfTunnelId   = row.cf_tunnel_id || null;
          tunnelUrl    = row.tunnel_url || null;
          configSource = tunnelToken ? "db" : "env_fallback";
        }
      } catch (dbErr) {
        console.warn("[self-repair] DB lookup failed:", dbErr.message);
      }
      if (!tunnelToken) {
        tunnelToken  = process.env.CLOUDFLARE_TUNNEL_TOKEN || "";
        backendKey   = process.env.BACKEND_API_KEY || "";
        configSource = "env";
        // Persist to DB so future calls resolve from DB
        if (tunnelToken) {
          try {
            const pool = getPool();
            await pool.query(
              `UPDATE \`local_connector_user_configs\`
               SET cf_token = COALESCE(NULLIF(cf_token,''), ?),
                   connector_secret = COALESCE(NULLIF(connector_secret,''), ?)
               WHERE user_id = ? AND device_id = ?`,
              [tunnelToken, backendKey || null, userId, deviceId]
            );
          } catch {}
        }
      }

      // 2. Check CF tunnel status via API (best-effort, non-blocking)
      let tunnelStatus = null;
      const cfApiToken  = process.env.CLOUDFLARE_API_TOKEN || "";
      const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
      if (cfApiToken && cfAccountId && cfTunnelId) {
        try {
          const cfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/cfd_tunnel/${cfTunnelId}`,
            { headers: { Authorization: `Bearer ${cfApiToken}` }, signal: AbortSignal.timeout(8000) }
          );
          const cfJson = await cfRes.json();
          tunnelStatus = cfJson?.result?.status || null;
        } catch (cfErr) {
          console.warn("[self-repair] CF tunnel status check failed:", cfErr.message);
        }
      }

      // 3. Generate install bundle
      if (!tunnelToken) {
        return res.status(404).json({
          ok: false,
          diagnosis: { error: "no_tunnel_token", tunnel_status: tunnelStatus },
          error: {
            code: "config_not_found",
            message: `No cf_token in DB for user=${userId} device=${deviceId} and CLOUDFLARE_TUNNEL_TOKEN env not set. Run POST /local-connector/install to provision the device first.`,
          }
        });
      }

      const batContent = generateConnectorInstallerBat(tunnelToken, backendKey);
      const filename   = `repair-connector-${deviceId}-${new Date().toISOString().slice(0,10)}.bat`;
      let driveResult  = null;
      let driveUploadStatus = typeof deps.getGoogleClients === "function" ? "attempted" : "not_configured";
      let driveError = null;
      if (typeof deps.getGoogleClients === "function") {
        try {
          const { drive } = await deps.getGoogleClients();
          const created = await drive.files.create({
            requestBody: { name: filename, mimeType: "application/octet-stream" },
            media: { mimeType: "application/octet-stream", body: batContent },
            fields: "id,webViewLink",
          });
          if (created?.data?.id) {
            await drive.permissions.create({
              fileId: created.data.id,
              requestBody: { role: "reader", type: "anyone" },
            });
            driveResult = {
              drive_file_id: created.data.id,
              drive_link: `https://drive.google.com/uc?export=download&id=${created.data.id}`,
              view_link: created.data.webViewLink,
            };
          }
        } catch (driveErr) {
          driveUploadStatus = "failed";
          driveError = sanitizeDriveUploadError(driveErr);
          console.warn("[self-repair] Drive upload failed:", driveErr.message);
        }
      }
      if (driveResult) driveUploadStatus = "uploaded";

      writeAuditLogAsync({
        action: "admin_cli.local_connector_self_repair",
        resource_type: "install_bundle",
        resource_id: filename,
        payload: {
          user_id: userId,
          device_id: deviceId,
          tunnel_status: tunnelStatus,
          config_source: configSource,
          drive_uploaded: !!driveResult,
          drive_upload_status: driveUploadStatus
        },
      });

      return res.status(200).json({
        ok: true,
        diagnosis: {
          device_id: deviceId,
          tunnel_url: tunnelUrl || "https://connector.mad4b.com",
          cf_tunnel_id: cfTunnelId,
          cf_tunnel_status: tunnelStatus,
          config_source: configSource,
          likely_cause: "cloudflared or node connector service not running on the local device",
        },
        repair: {
          action: "Run the installer as Administrator on the Windows device. It installs cloudflared and the Node.js connector as auto-restart Windows services (via NSSM).",
          filename,
          drive: driveResult,
          drive_upload_status: driveUploadStatus,
          drive_error: driveError,
          script_content_omitted: true,
          script_content_reason: "installer contains live tunnel and backend credentials",
        },
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: "self_repair_failed", message: err.message },
      });
    }
  });

  router.get("/data-source/census", requireBackendApiKey, requireAdminPrincipal, async (_req, res) => {
    try {
      const { TABLE_MAP } = await import("../sqlAdapter.js");
      const pool = getPool();
      const tables = [];

      for (const [sheetName, sqlTable] of Object.entries(TABLE_MAP)) {
        try {
          const [[counts]] = await pool.query(
            `SELECT COUNT(*) AS row_count FROM \`${sqlTable}\``
          );
          let lastWriteAt = null;
          try {
            const [[ts]] = await pool.query(
              `SELECT MAX(GREATEST(COALESCE(updated_at, '1970-01-01'), COALESCE(created_at, '1970-01-01'))) AS last_write_at FROM \`${sqlTable}\``
            );
            lastWriteAt = ts?.last_write_at || null;
          } catch {
            lastWriteAt = null;
          }
          tables.push({
            sql_table: sqlTable,
            sheet_name: sheetName,
            sql_row_count: Number(counts?.row_count || 0),
            sql_last_write_at: lastWriteAt,
            sql_seeded: Number(counts?.row_count || 0) > 0,
          });
        } catch (err) {
          tables.push({
            sql_table: sqlTable,
            sheet_name: sheetName,
            sql_row_count: null,
            sql_last_write_at: null,
            sql_seeded: false,
            error: { code: "sql_read_failed", message: String(err?.message || err).slice(0, 200) },
          });
        }
      }

      const dataSourceMode = (process.env.DATA_SOURCE || "sql").trim().toLowerCase();
      const sheetsMirrorConfigured = Boolean(
        process.env.REGISTRY_SPREADSHEET_ID || process.env.ACTIVITY_SPREADSHEET_ID
      );
      const seededCount = tables.filter((t) => t.sql_seeded).length;

      return res.status(200).json({
        ok: true,
        data_source: {
          runtime_authority: "sql",
          mode: dataSourceMode,
          sheets_role: "async_mirror_and_recovery",
          sheets_mirror_configured: sheetsMirrorConfigured,
        },
        summary: {
          total_tables: tables.length,
          seeded_tables: seededCount,
          empty_tables: tables.length - seededCount,
        },
        tables,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: { code: "data_source_census_failed", message: err.message },
      });
    }
  });

  return router;
}

function sanitizeDriveUploadError(err) {
  const status = err?.response?.status || err?.status || err?.code || null;
  const message = String(err?.message || "Drive upload failed").slice(0, 300);
  return {
    code: "drive_upload_failed",
    ...(status ? { status } : {}),
    message,
  };
}

function generateConnectorInstallerBat(tunnelToken, backendKey) {
  const bk = backendKey || "";
  return `@echo off
setlocal EnableDelayedExpansion
title Growth Intelligence Platform - Connector Installer

net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Run this as Administrator. Right-click ^> Run as administrator.
    pause
    exit /b 1
)

set CF_TOKEN=${tunnelToken}
set CF_SERVICE=cloudflared
set NODE_SERVICE=local-connector
set TUNNEL_HOST=connector.mad4b.com
set CONNECTOR_DIR=%~dp0local-connector
set SERVER_MJS=%CONNECTOR_DIR%\\server.mjs
set BACKEND_KEY=${bk}

echo.
echo  Growth Intelligence Platform - Local Connector Installer
echo  =========================================================
echo.

:: ═══════════════════════════════════════════════════════
:: PART 1: cloudflared tunnel service
:: ═══════════════════════════════════════════════════════
echo  Part 1: Cloudflare tunnel service
echo  -----------------------------------

sc query %CF_SERVICE% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=4" %%s in ('sc query %CF_SERVICE% ^| findstr /i "STATE"') do set SVC_STATE=%%s
    if /i "!SVC_STATE!"=="RUNNING" (
        echo  cloudflared already running.
        goto :part2
    )
    echo  Service exists but stopped. Starting...
    net start %CF_SERVICE%
    if %ERRORLEVEL% equ 0 ( goto :part2 )
    echo  Start failed. Reinstalling service...
    cloudflared service uninstall >nul 2>&1
    timeout /t 2 /nobreak >nul
)

where cloudflared >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  cloudflared not found. Installing via winget...
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    if %ERRORLEVEL% neq 0 (
        echo  ERROR: winget install failed.
        echo  Download from: https://github.com/cloudflare/cloudflared/releases
        pause
        exit /b 1
    )
    where cloudflared >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo  PATH not updated yet. Restart your terminal and re-run this installer.
        pause
        exit /b 1
    )
)

echo  Installing cloudflared tunnel service...
cloudflared service install %CF_TOKEN%
if %ERRORLEVEL% neq 0 (
    echo  ERROR: cloudflared service install failed ^(exit %ERRORLEVEL%^).
    pause
    exit /b 1
)
net start %CF_SERVICE%
if %ERRORLEVEL% neq 0 (
    echo  ERROR: cloudflared service did not start.
    echo  Check: eventvwr ^> Windows Logs ^> System, source cloudflared
    pause
    exit /b 1
)
echo  cloudflared running. Tunnel %TUNNEL_HOST% active in ~30s.

:: ═══════════════════════════════════════════════════════
:: PART 2: Node.js connector service (via NSSM)
:: ═══════════════════════════════════════════════════════
:part2
echo.
echo  Part 2: Node.js connector service (NSSM)
echo  -----------------------------------------

if not exist "%SERVER_MJS%" (
    echo  WARN: server.mjs not found at %SERVER_MJS%
    echo  Skipping Node service setup. Ensure this .bat is in the repo root.
    goto :summary
)

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  ERROR: node not found on PATH. Install Node.js from https://nodejs.org/
    goto :summary
)

where nssm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  NSSM not found. Installing via winget...
    winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements
    where nssm >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo  WARN: NSSM not available. Node service will not be installed.
        echo  Install from https://nssm.cc/ then re-run this installer.
        goto :summary
    )
)

if not "!BACKEND_KEY!"=="" (
    if not exist "%CONNECTOR_DIR%\\.env" (
        echo BACKEND_API_KEY=!BACKEND_KEY!> "%CONNECTOR_DIR%\\.env"
        echo CONNECTOR_PORT=7070>> "%CONNECTOR_DIR%\\.env"
        echo CONNECTOR_SHELL_ENABLED=true>> "%CONNECTOR_DIR%\\.env"
        echo  .env written.
    )
)

sc query %NODE_SERVICE% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=4" %%s in ('sc query %NODE_SERVICE% ^| findstr /i "STATE"') do set NODE_STATE=%%s
    if /i "!NODE_STATE!"=="RUNNING" (
        echo  local-connector service already running.
        goto :summary
    )
    echo  Restarting existing local-connector service...
    net start %NODE_SERVICE% >nul 2>&1
    goto :summary
)

echo  Installing local-connector service with NSSM...
for /f "tokens=*" %%p in ('where node') do set NODE_EXE=%%p
nssm install %NODE_SERVICE% "!NODE_EXE!" "\"%SERVER_MJS%\""
nssm set %NODE_SERVICE% AppDirectory "%CONNECTOR_DIR%"
nssm set %NODE_SERVICE% AppStdout "%CONNECTOR_DIR%\\connector.log"
nssm set %NODE_SERVICE% AppStderr "%CONNECTOR_DIR%\\connector-error.log"
nssm set %NODE_SERVICE% AppRotateFiles 1
nssm set %NODE_SERVICE% AppRotateBytes 5242880
nssm set %NODE_SERVICE% Start SERVICE_AUTO_START
nssm set %NODE_SERVICE% ObjectName LocalSystem
net start %NODE_SERVICE%
timeout /t 3 /nobreak >nul
sc query %NODE_SERVICE% >nul 2>&1
for /f "tokens=4" %%s in ('sc query %NODE_SERVICE% ^| findstr /i "STATE"') do set NODE_FINAL=%%s
if /i "!NODE_FINAL!"=="RUNNING" (
    echo  local-connector service running on port 7070.
) else (
    echo  WARN: local-connector service did not start.
    echo  Check: %CONNECTOR_DIR%\\connector-error.log
)

:: ═══════════════════════════════════════════════════════
:: SUMMARY
:: ═══════════════════════════════════════════════════════
:summary
echo.
echo  Status:
sc query %CF_SERVICE% 2>nul | findstr /i "STATE"
sc query %NODE_SERVICE% 2>nul | findstr /i "STATE"
echo.
echo  %TUNNEL_HOST% -^> localhost:7070
echo.
pause
`;
}
