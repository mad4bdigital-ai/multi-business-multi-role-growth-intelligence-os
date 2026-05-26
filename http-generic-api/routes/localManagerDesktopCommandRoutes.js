import crypto from "node:crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { requireLocalManagerDevice } from "../services/localManagerDeviceLinkService.js";

const ALLOWED_ACTIONS = new Set(["open_url", "open_n8n", "notify", "focus_local_manager", "codex_exec_readonly"]);
const ALLOWED_MODES = new Set(["desktop", "background"]);
const ALL_ZERO_TENANT_ID = "00000000-0000-0000-0000-000000000000";

function isWildcardTenantId(value) {
  const tenantId = cleanText(value, 64);
  return !tenantId || tenantId === ALL_ZERO_TENANT_ID;
}

function uniqueStrings(values, max = 50) {
  return [...new Set((values || []).map((value) => cleanText(value, 128)).filter(Boolean))].slice(0, max);
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function jsonString(value) {
  try { return JSON.stringify(value || {}); } catch { return "{}"; }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function sanitizeCommand(row) {
  if (!row) return null;
  return {
    command_id: row.command_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    device_id: row.device_id,
    execution_mode: row.execution_mode,
    action: row.action,
    status: row.status,
    priority: row.priority,
    requires_user_confirmation: Boolean(Number(row.requires_user_confirmation || 0)),
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    requested_by: row.requested_by || null,
    request_context: parseJson(row.request_context_json),
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    claimed_at: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    secrets_included: false,
  };
}

function normalizePayload(action, payload = {}) {
  const clean = { ...payload };
  if (action === "open_url") {
    const url = cleanText(clean.url, 2048);
    let parsed;
    try { parsed = new URL(url); } catch {
      const err = new Error("A valid http/https URL is required.");
      err.status = 400;
      err.code = "invalid_url";
      throw err;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      const err = new Error("Only http and https URLs are allowed for desktop open_url.");
      err.status = 400;
      err.code = "unsupported_url_scheme";
      throw err;
    }
    clean.url = parsed.toString();
    clean.browser_alias = cleanText(clean.browser_alias || "default", 64) || "default";
  }
  if (action === "notify") {
    clean.title = cleanText(clean.title || "Mad4B", 120) || "Mad4B";
    clean.message = cleanText(clean.message || "", 1000);
  }
  if (action === "codex_exec_readonly") {
    clean.runtime_key = cleanText(clean.runtime_key || "codex_essam_chatgpt_v1", 128);
    clean.profile_key = cleanText(clean.profile_key || "codex_essam_chatgpt_oauth_v1", 128);
    clean.command_path = cleanText(clean.command_path || "C:\\Users\\IT\\AppData\\Roaming\\npm\\codex.cmd", 512);
    clean.working_directory = cleanText(clean.working_directory || clean.repo_path || "D:\\mad4b-agent-workspaces\\growth-intelligence-os-readonly", 512);
    clean.prompt = cleanText(clean.prompt || clean.analysis_goal || "", 4000);
    clean.sandbox = cleanText(clean.sandbox || "read-only", 64);
    clean.output_max_chars = Math.max(500, Math.min(Number(clean.output_max_chars || 5000), 20000));
    clean.timeout_seconds = Math.max(30, Math.min(Number(clean.timeout_seconds || 300), 1800));
    if (!clean.prompt) {
      const err = new Error("codex_exec_readonly requires a prompt.");
      err.status = 400;
      err.code = "codex_prompt_required";
      throw err;
    }
    if (clean.sandbox !== "read-only") {
      const err = new Error("codex_exec_readonly requires sandbox=read-only.");
      err.status = 403;
      err.code = "codex_readonly_sandbox_required";
      throw err;
    }
    if (!/codex(?:\.cmd)?$/i.test(clean.command_path)) {
      const err = new Error("codex_exec_readonly command_path must point to codex or codex.cmd.");
      err.status = 403;
      err.code = "codex_command_path_blocked";
      throw err;
    }
  }
  clean.secrets_included = false;
  return clean;
}

async function ensureDesktopCommandTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_manager_desktop_commands\` (
      \`command_id\` VARCHAR(64) NOT NULL,
      \`tenant_id\` VARCHAR(64) NULL,
      \`user_id\` VARCHAR(64) NOT NULL,
      \`device_id\` VARCHAR(128) NOT NULL,
      \`execution_mode\` ENUM('desktop','background') NOT NULL DEFAULT 'desktop',
      \`action\` VARCHAR(64) NOT NULL,
      \`status\` ENUM('queued','claimed','completed','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
      \`priority\` INT NOT NULL DEFAULT 100,
      \`requires_user_confirmation\` TINYINT(1) NOT NULL DEFAULT 0,
      \`payload_json\` JSON NULL,
      \`result_json\` JSON NULL,
      \`requested_by\` VARCHAR(128) NULL,
      \`request_context_json\` JSON NULL,
      \`error_code\` VARCHAR(96) NULL,
      \`error_message\` TEXT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`claimed_at\` DATETIME NULL,
      \`completed_at\` DATETIME NULL,
      \`expires_at\` DATETIME NULL,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`command_id\`),
      KEY \`idx_lm_desktop_command_device\` (\`tenant_id\`, \`user_id\`, \`device_id\`, \`status\`, \`priority\`, \`created_at\`),
      KEY \`idx_lm_desktop_command_status\` (\`status\`, \`expires_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function expireOldCommands() {
  await getPool().query(
    `UPDATE \`local_manager_desktop_commands\`
        SET status = 'expired', error_code = 'command_expired', error_message = 'Command expired before completion.'
      WHERE status IN ('queued','claimed') AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
}

async function resolveDesktopCommandDeviceIds(device = {}) {
  const primaryDeviceId = cleanText(device.device_id, 128);
  const userId = cleanText(device.user_id, 64);
  const tenantId = cleanText(device.tenant_id, 64) || null;
  const ids = new Set(primaryDeviceId ? [primaryDeviceId] : []);
  if (!primaryDeviceId || !userId) return [...ids];

  try {
    const [rows] = await getPool().query(
      `SELECT alias_device_id, canonical_device_id
         FROM \`local_connector_device_aliases\`
        WHERE status = 'active'
          AND (alias_device_id = ? OR canonical_device_id = ?)
          AND (user_id = ? OR user_id IS NULL)
          AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL)
        LIMIT 50`,
      [primaryDeviceId, primaryDeviceId, userId, tenantId, tenantId]
    );
    for (const row of rows) {
      const alias = cleanText(row.alias_device_id, 128);
      const canonical = cleanText(row.canonical_device_id, 128);
      if (alias) ids.add(alias);
      if (canonical) ids.add(canonical);
    }
  } catch {
    // Alias resolution is best-effort. If the alias table is unavailable,
    // polling remains scoped to the device_id embedded in the device token.
  }

  return [...ids].filter(Boolean).slice(0, 50);
}

export function buildLocalManagerDesktopCommandRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();

  router.post("/local-manager/device/desktop-commands", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      await expireOldCommands();
      const body = req.body || {};
      const action = cleanText(body.action, 64);
      const executionMode = cleanText(body.execution_mode || body.mode || "desktop", 32);
      if (!ALLOWED_ACTIONS.has(action)) return res.status(400).json({ ok: false, error: { code: "unsupported_desktop_action", message: "Unsupported desktop action." }, secrets_included: false });
      if (!ALLOWED_MODES.has(executionMode)) return res.status(400).json({ ok: false, error: { code: "unsupported_execution_mode", message: "Unsupported execution mode." }, secrets_included: false });
      const userId = cleanText(body.user_id, 64);
      const tenantId = cleanText(body.tenant_id, 64) || null;
      const deviceId = cleanText(body.device_id, 128);
      if (!userId || !deviceId) return res.status(400).json({ ok: false, error: { code: "missing_target", message: "user_id and device_id are required." }, secrets_included: false });
      const payload = normalizePayload(action, body.payload || {});
      const commandId = crypto.randomUUID();
      const ttlSeconds = Math.max(30, Math.min(Number(body.ttl_seconds || 300), 3600));
      const priority = Math.max(1, Math.min(Number(body.priority || 100), 1000));
      const requiresUserConfirmation = body.requires_user_confirmation === true || body.requires_user_confirmation === 1;
      await getPool().query(
        `INSERT INTO \`local_manager_desktop_commands\`
          (command_id, tenant_id, user_id, device_id, execution_mode, action, status, priority, requires_user_confirmation, payload_json, requested_by, request_context_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [commandId, tenantId, userId, deviceId, executionMode, action, priority, requiresUserConfirmation ? 1 : 0, jsonString(payload), cleanText(body.requested_by || "gpt", 128), jsonString(body.request_context || {}), ttlSeconds]
      );
      return res.status(201).json({ ok: true, command: { command_id: commandId, execution_mode: executionMode, action, status: "queued", expires_in: ttlSeconds }, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "desktop_command_enqueue_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/local-manager/device/desktop-commands/pending", async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      await expireOldCommands();
      const device = await requireLocalManagerDevice(req);
      const limit = Math.max(1, Math.min(Number(req.query.limit || 5), 20));
      const deviceIds = await resolveDesktopCommandDeviceIds(device);
      const devicePlaceholders = deviceIds.map(() => "?").join(", ");
      const [rows] = await getPool().query(
        `SELECT * FROM \`local_manager_desktop_commands\`
          WHERE user_id = ?
            AND device_id IN (${devicePlaceholders})
            AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL)
            AND execution_mode = 'desktop'
            AND status = 'queued'
          ORDER BY priority ASC, created_at ASC
          LIMIT ?`,
        [device.user_id, ...deviceIds, device.tenant_id, device.tenant_id, limit]
      );
      const ids = rows.map((row) => row.command_id);
      if (ids.length) {
        await getPool().query(
          `UPDATE \`local_manager_desktop_commands\` SET status = 'claimed', claimed_at = NOW() WHERE command_id IN (${ids.map(() => "?").join(",")}) AND status = 'queued'`,
          ids
        );
      }
      return res.status(200).json({ ok: true, commands: rows.map((row) => sanitizeCommand({ ...row, status: "claimed", claimed_at: row.claimed_at || new Date() })), secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "desktop_command_poll_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/local-manager/device/desktop-commands/:commandId/complete", async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      const device = await requireLocalManagerDevice(req);
      const commandId = cleanText(req.params.commandId, 64);
      const status = cleanText(req.body?.status || "completed", 24);
      const finalStatus = status === "completed" ? "completed" : "failed";
      const result = { ...(req.body?.result || {}), secrets_included: false };
      const deviceIds = await resolveDesktopCommandDeviceIds(device);
      const devicePlaceholders = deviceIds.map(() => "?").join(", ");
      const [resultRows] = await getPool().query(
        `UPDATE \`local_manager_desktop_commands\`
            SET status = ?, result_json = ?, error_code = ?, error_message = ?, completed_at = NOW()
          WHERE command_id = ?
            AND user_id = ?
            AND device_id IN (${devicePlaceholders})
            AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL)
          LIMIT 1`,
        [finalStatus, jsonString(result), cleanText(req.body?.error_code, 96) || null, cleanText(req.body?.error_message, 1000) || null, commandId, device.user_id, ...deviceIds, device.tenant_id, device.tenant_id]
      );
      if (!Number(resultRows?.affectedRows || 0)) return res.status(404).json({ ok: false, error: { code: "desktop_command_not_found", message: "Command was not found for this device." }, secrets_included: false });
      return res.status(200).json({ ok: true, command_id: commandId, status: finalStatus, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "desktop_command_complete_failed", message: err.message }, secrets_included: false });
    }
  });

  router.get("/local-manager/device/desktop-commands/:commandId", requireBackendApiKey, requireAdminPrincipal, async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      const [rows] = await getPool().query(`SELECT * FROM \`local_manager_desktop_commands\` WHERE command_id = ? LIMIT 1`, [cleanText(req.params.commandId, 64)]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: { code: "desktop_command_not_found", message: "Command was not found." }, secrets_included: false });
      return res.status(200).json({ ok: true, command: sanitizeCommand(rows[0]), secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "desktop_command_status_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}
