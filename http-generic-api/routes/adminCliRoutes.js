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
  const sql = typeof body.sql === "string" ? body.sql.trim() : "";
  const params = Array.isArray(body.params) ? body.params : [];

  if (!sql) {
    const err = new Error("sql is required for db control.");
    err.status = 400;
    err.code = "missing_sql";
    throw err;
  }

  const [result, fields] = await getPool().query(sql, params);

  return {
    rows: Array.isArray(result) ? result : undefined,
    result: Array.isArray(result) ? undefined : result,
    fields: Array.isArray(fields)
      ? fields.map((field) => ({ name: field.name, column_type: field.columnType }))
      : undefined
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

function getShellAllowlist(env = process.env) {
  return Object.entries(loadShellAllowlist(env)).map(([alias, entry]) => {
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
  const alias     = String(body.alias  || "").trim().toLowerCase();
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
      if (extraArgs.length > entry.max_extra_args) {
        const e = new Error(`Too many extra_args (max ${entry.max_extra_args}).`); e.status = 400; e.code = "too_many_extra_args"; throw e;
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

  if (tool === "shell") {
    return { tool, result: await executeShellControl(body) };
  }

  const err = new Error("tool must be one of github, gcloud, db, env, windows_app, hostinger, or shell.");
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

  // ── GET /admin/cli/dns — list DNS records for a domain ─────────────────────
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

  // ── POST /admin/cli/dns — upsert a DNS record ───────────────────────────────
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

  // ── DELETE /admin/cli/dns — delete a DNS record ─────────────────────────────
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

  return router;
}
