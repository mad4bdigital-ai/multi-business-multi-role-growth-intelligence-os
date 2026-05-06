import { Router } from "express";
import { spawn } from "child_process";
import { writeAuditLogAsync } from "../auditLogger.js";
import { getPool } from "../db.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
const MAX_COMMAND_TIMEOUT_MS = 600000;
const SENSITIVE_ENV_PATTERN = /(password|passwd|pwd|secret|token|key|credential|private|auth|cookie|session)/i;
const LOCAL_WINDOWS_APP_ALLOWLIST_ENV = "LOCAL_WINDOWS_APP_ALLOWLIST";
const LOCAL_WINDOWS_APP_CONTROL_ENABLED_ENV = "LOCAL_WINDOWS_APP_CONTROL_ENABLED";

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

export function handleWindowsAppControl(body = {}, deps = {}) {
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const spawnImpl = deps.spawn || spawn;
  const action = String(body.action || "list").trim().toLowerCase();

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

  const err = new Error("tool must be one of github, gcloud, db, env, or windows_app.");
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
      windows_app_alias: tool === "windows_app" ? body.app_alias : undefined
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

  return router;
}
