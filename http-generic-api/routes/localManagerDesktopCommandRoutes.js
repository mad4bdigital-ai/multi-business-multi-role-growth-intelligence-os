import crypto from "node:crypto";
import { Router } from "express";
import { getPool } from "../db.js";
import { requireLocalManagerDevice } from "../services/localManagerDeviceLinkService.js";
import { assertLocalManagerDesktopCommandSchema } from "../localManagerDesktopCommandSchema.js";

const ALLOWED_ACTIONS = new Set(["open_url", "open_n8n", "notify", "focus_local_manager", "repair_connector", "codex_exec_readonly", "capture_chatgpt_current_url"]);
const ALLOWED_MODES = new Set(["desktop", "background"]);
const SERVER_CONFIRMATION_REQUIRED_ACTIONS = new Set(["repair_connector", "codex_exec_readonly"]);
const SENSITIVE_DESKTOP_PURPOSES = new Set(["secure_credential_intake", "secret_provisioning", "credential_rotation", "privileged_installer"]);
const ALL_ZERO_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DESKTOP_COMMAND_CLAIM_LEASE_SECONDS = 120;

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

function sanitizeCommand(row, { includeClaimProof = false } = {}) {
  if (!row) return null;
  const command = {
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
  if (includeClaimProof) {
    command.claim_token = row.claim_token || null;
    command.claim_lease_expires_at = row.claim_lease_expires_at ? new Date(row.claim_lease_expires_at).toISOString() : null;
  }
  return command;
}

function isLoopbackDesktopHost(hostname) {
  const host = cleanText(hostname, 255).toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host.endsWith(".localhost")
    || host === "127.0.0.1"
    || host === "::1";
}

function requiresServerSideDesktopConfirmation(action, payload = {}) {
  if (SERVER_CONFIRMATION_REQUIRED_ACTIONS.has(action)) return true;
  if (action !== "open_url") return false;
  try {
    const parsed = new URL(String(payload?.url || ""));
    return !isLoopbackDesktopHost(parsed.hostname);
  } catch {
    return true;
  }
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
    if (parsed.protocol === "http:" && !isLoopbackDesktopHost(parsed.hostname)) {
      const err = new Error("Remote desktop open_url targets must use HTTPS.");
      err.status = 400;
      err.code = "remote_open_url_requires_https";
      throw err;
    }
    clean.url = parsed.toString();
    clean.browser_alias = cleanText(clean.browser_alias || "default", 64) || "default";
  }
  if (action === "notify") {
    clean.title = cleanText(clean.title || "Mad4B", 120) || "Mad4B";
    clean.message = cleanText(clean.message || "", 1000);
  }
  if (action === "capture_chatgpt_current_url") {
    clean.session_id = cleanText(clean.session_id || clean.gpt_session_id || clean.current_session_id, 128);
    clean.capture_endpoint = cleanText(clean.capture_endpoint || (clean.session_id ? `/gpt/sessions/${clean.session_id}/conversation-ref/capture-current` : ""), 256);
    clean.expected_host = cleanText(clean.expected_host || "chatgpt.com", 128);
    clean.expected_path_markers = uniqueStrings(clean.expected_path_markers || ["/g/", "/c/", "/share/"], 10);
    clean.source = cleanText(clean.source || "local_connector", 64);
    clean.instructions = cleanText(clean.instructions || "Capture the active ChatGPT conversation URL and return it as current_url; do not return page content, cookies, tokens, or secrets.", 1000);
    if (!clean.session_id) {
      const err = new Error("capture_chatgpt_current_url requires session_id from activation_session_context.current_session_id.");
      err.status = 400;
      err.code = "chatgpt_capture_session_required";
      throw err;
    }
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

function requiresVerifiedDesktopIdentity(action, payload = {}, requestContext = {}) {
  const purpose = cleanText(requestContext?.purpose || requestContext?.operation || requestContext?.intent, 128).toLowerCase();
  if (SENSITIVE_DESKTOP_PURPOSES.has(purpose) || requestContext?.sensitive_operation === true) return true;
  if (action !== "open_url") return false;
  try {
    const parsed = new URL(String(payload?.url || ""));
    return parsed.pathname.startsWith("/credential-intake/")
      || parsed.pathname.startsWith("/local-connector/install/")
      || parsed.pathname.includes("/credentials/");
  } catch {
    return false;
  }
}

async function ensureDesktopCommandTable() {
  return assertLocalManagerDesktopCommandSchema(getPool());
}

function desktopIdentityAuthorityError(error, table) {
  const err = new Error(`Desktop command target identity dependency ${table} is not readable by runtime authority.`);
  err.status = 503;
  err.code = "desktop_target_identity_authority_not_ready";
  err.details = {
    table,
    required_operations: ["SELECT"],
    sql_code: cleanText(error?.code, 96) || null,
    retryable: false,
    secrets_included: false,
  };
  return err;
}

async function expireOldCommands() {
  const pool = getPool();
  await pool.query(
    `UPDATE \`local_manager_desktop_commands\`
        SET status = 'expired',
            error_code = 'command_expired',
            error_message = 'Command expired before claim.',
            claim_token = NULL,
            claim_lease_expires_at = NULL
      WHERE status = 'queued'
        AND expires_at IS NOT NULL
        AND expires_at < NOW()`
  );
  await pool.query(
    `UPDATE \`local_manager_desktop_commands\`
        SET status = 'expired',
            error_code = 'command_expired',
            error_message = 'Command claim lease expired after enqueue TTL elapsed.',
            claim_token = NULL,
            claim_lease_expires_at = NULL
      WHERE status = 'claimed'
        AND (claim_lease_expires_at IS NULL OR claim_lease_expires_at < NOW())
        AND expires_at IS NOT NULL
        AND expires_at < NOW()`
  );
  await pool.query(
    `UPDATE \`local_manager_desktop_commands\`
        SET status = 'queued',
            claimed_at = NULL,
            claim_token = NULL,
            claim_lease_expires_at = NULL,
            error_code = NULL,
            error_message = NULL
      WHERE status = 'claimed'
        AND (claim_lease_expires_at IS NULL OR claim_lease_expires_at < NOW())
        AND (expires_at IS NULL OR expires_at >= NOW())`
  );
}

async function loadActiveDeviceAliasRows({ userId, tenantId, deviceId } = {}) {
  const primaryDeviceId = cleanText(deviceId, 128);
  const scopedUserId = cleanText(userId, 64);
  const scopedTenantId = cleanText(tenantId, 64) || null;
  if (!primaryDeviceId || !scopedUserId) return [];
  const wildcardTenant = isWildcardTenantId(scopedTenantId);
  try {
    const [rows] = await getPool().query(
      `SELECT alias_device_id, canonical_device_id, user_id, tenant_id, updated_at
         FROM \`local_connector_device_aliases\`
        WHERE status = 'active'
          AND (alias_device_id = ? OR canonical_device_id = ?)
          AND (user_id = ? OR user_id IS NULL)
          AND (? = 1 OR tenant_id = ? OR tenant_id IS NULL)
        ORDER BY
          CASE WHEN tenant_id IS NOT NULL AND tenant_id <> ? THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT 50`,
      [primaryDeviceId, primaryDeviceId, scopedUserId, wildcardTenant ? 1 : 0, scopedTenantId, ALL_ZERO_TENANT_ID]
    );
    return rows || [];
  } catch (error) {
    throw desktopIdentityAuthorityError(error, "local_connector_device_aliases");
  }
}

function deviceIdsFromAliasRows(primaryDeviceId, aliasRows = []) {
  const values = [primaryDeviceId];
  for (const row of aliasRows) {
    values.push(row.alias_device_id, row.canonical_device_id);
  }
  return uniqueStrings(values);
}

function canonicalDeviceIdFromAliasRows(primaryDeviceId, aliasRows = []) {
  const primary = cleanText(primaryDeviceId, 128);
  const exactAlias = aliasRows.find((row) => cleanText(row.alias_device_id, 128) === primary && cleanText(row.canonical_device_id, 128));
  if (exactAlias) return cleanText(exactAlias.canonical_device_id, 128);
  const exactCanonical = aliasRows.find((row) => cleanText(row.canonical_device_id, 128) === primary);
  if (exactCanonical) return cleanText(exactCanonical.canonical_device_id, 128);
  return primary;
}

async function resolveEffectiveDesktopCommandTarget({ userId, tenantId, deviceId, requestContext = {} } = {}) {
  const requestedUserId = cleanText(userId, 64);
  const requestedTenantId = cleanText(tenantId, 64) || null;
  const requestedDeviceId = cleanText(deviceId, 128);
  const fallback = {
    user_id: requestedUserId,
    tenant_id: requestedTenantId,
    device_id: requestedDeviceId,
    request_context: {
      ...(requestContext || {}),
      desktop_identity_resolution: {
        requested_user_id: requestedUserId,
        requested_tenant_id: requestedTenantId,
        requested_device_id: requestedDeviceId,
        effective_tenant_id: requestedTenantId,
        effective_device_id: requestedDeviceId,
        canonical_device_id: requestedDeviceId,
        identity_resolution_source: "requested_identity",
        identity_resolution_status: "fallback_requested_identity",
        secrets_included: false,
      },
    },
  };
  if (!requestedUserId || !requestedDeviceId) return fallback;

  const wildcardTenant = isWildcardTenantId(requestedTenantId);
  const aliasRows = await loadActiveDeviceAliasRows({ userId: requestedUserId, tenantId: requestedTenantId, deviceId: requestedDeviceId });
  const candidateDeviceIds = deviceIdsFromAliasRows(requestedDeviceId, aliasRows);
  const canonicalDeviceId = canonicalDeviceIdFromAliasRows(requestedDeviceId, aliasRows);
  const placeholders = candidateDeviceIds.map(() => "?").join(", ");

  try {
    const [recentRows] = await getPool().query(
      `SELECT tenant_id, device_id, status, claimed_at, completed_at, created_at
         FROM \`local_manager_desktop_commands\`
        WHERE user_id = ?
          AND device_id IN (${placeholders})
          AND status IN ('claimed','completed')
          AND (? = 1 OR tenant_id = ? OR tenant_id IS NULL)
        ORDER BY COALESCE(completed_at, claimed_at, created_at) DESC
        LIMIT 1`,
      [requestedUserId, ...candidateDeviceIds, wildcardTenant ? 1 : 0, requestedTenantId]
    );
    if (recentRows?.[0]?.device_id) {
      const effectiveTenantId = cleanText(recentRows[0].tenant_id, 64) || requestedTenantId;
      const effectiveDeviceId = cleanText(recentRows[0].device_id, 128);
      return {
        user_id: requestedUserId,
        tenant_id: effectiveTenantId,
        device_id: effectiveDeviceId,
        request_context: {
          ...(requestContext || {}),
          desktop_identity_resolution: {
            requested_user_id: requestedUserId,
            requested_tenant_id: requestedTenantId,
            requested_device_id: requestedDeviceId,
            effective_tenant_id: effectiveTenantId,
            effective_device_id: effectiveDeviceId,
            canonical_device_id: canonicalDeviceId,
            candidate_device_ids: candidateDeviceIds,
            identity_resolution_source: "recent_claimed_or_completed_desktop_command",
            identity_resolution_status: "resolved",
            secrets_included: false,
          },
        },
      };
    }
  } catch {
    // Recent polling history is an optimization. Alias/config fallback still applies.
  }

  const activeAlias = aliasRows.find((row) => {
    const alias = cleanText(row.alias_device_id, 128);
    const canonical = cleanText(row.canonical_device_id, 128);
    const rowTenant = cleanText(row.tenant_id, 64) || null;
    if (!alias && !canonical) return false;
    if (!wildcardTenant && rowTenant && rowTenant !== requestedTenantId) return false;
    return true;
  });
  if (activeAlias) {
    const aliasDeviceId = cleanText(activeAlias.alias_device_id, 128);
    const canonical = cleanText(activeAlias.canonical_device_id, 128) || canonicalDeviceId;
    const rowTenant = cleanText(activeAlias.tenant_id, 64) || requestedTenantId;
    const effectiveDeviceId = aliasDeviceId || requestedDeviceId;
    return {
      user_id: requestedUserId,
      tenant_id: rowTenant,
      device_id: effectiveDeviceId,
      request_context: {
        ...(requestContext || {}),
        desktop_identity_resolution: {
          requested_user_id: requestedUserId,
          requested_tenant_id: requestedTenantId,
          requested_device_id: requestedDeviceId,
          effective_tenant_id: rowTenant,
          effective_device_id: effectiveDeviceId,
          canonical_device_id: canonical,
          candidate_device_ids: candidateDeviceIds,
          identity_resolution_source: "active_device_alias",
          identity_resolution_status: "resolved",
          secrets_included: false,
        },
      },
    };
  }

  try {
    const [configRows] = await getPool().query(
      `SELECT tenant_id, device_id, hostname, last_health_at, updated_at
         FROM \`local_connector_user_configs\`
        WHERE is_enabled = 1
          AND user_id = ?
          AND device_id IN (${placeholders})
          AND (? = 1 OR tenant_id = ? OR tenant_id IS NULL)
        ORDER BY COALESCE(last_health_at, updated_at) DESC
        LIMIT 1`,
      [requestedUserId, ...candidateDeviceIds, wildcardTenant ? 1 : 0, requestedTenantId]
    );
    if (configRows?.[0]?.device_id) {
      const effectiveTenantId = cleanText(configRows[0].tenant_id, 64) || requestedTenantId;
      const effectiveDeviceId = cleanText(configRows[0].device_id, 128);
      return {
        user_id: requestedUserId,
        tenant_id: effectiveTenantId,
        device_id: effectiveDeviceId,
        request_context: {
          ...(requestContext || {}),
          desktop_identity_resolution: {
            requested_user_id: requestedUserId,
            requested_tenant_id: requestedTenantId,
            requested_device_id: requestedDeviceId,
            effective_tenant_id: effectiveTenantId,
            effective_device_id: effectiveDeviceId,
            canonical_device_id: canonicalDeviceId,
            candidate_device_ids: candidateDeviceIds,
            identity_resolution_source: "active_connector_config",
            identity_resolution_status: "resolved",
            secrets_included: false,
          },
        },
      };
    }
  } catch (error) {
    throw desktopIdentityAuthorityError(error, "local_connector_user_configs");
  }

  return {
    ...fallback,
    request_context: {
      ...(requestContext || {}),
      desktop_identity_resolution: {
        ...fallback.request_context.desktop_identity_resolution,
        canonical_device_id: canonicalDeviceId,
        candidate_device_ids: candidateDeviceIds,
        identity_resolution_source: "requested_identity_no_mapping_found",
        identity_resolution_status: "fallback_new_or_unlinked_device",
        secrets_included: false,
      },
    },
  };
}

async function resolveDesktopCommandDeviceIds(device = {}) {
  const primaryDeviceId = cleanText(device.device_id, 128);
  const userId = cleanText(device.user_id, 64);
  const tenantId = cleanText(device.tenant_id, 64) || null;
  const aliasRows = await loadActiveDeviceAliasRows({ userId, tenantId, deviceId: primaryDeviceId });
  return deviceIdsFromAliasRows(primaryDeviceId, aliasRows);
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
      const target = await resolveEffectiveDesktopCommandTarget({ userId, tenantId, deviceId, requestContext: body.request_context || {} });
      const identityResolution = target.request_context?.desktop_identity_resolution || {};
      if (requiresVerifiedDesktopIdentity(action, payload, body.request_context || {}) && identityResolution.identity_resolution_status !== "resolved") {
        return res.status(409).json({
          ok: false,
          error: {
            code: "desktop_target_identity_unverified",
            message: "Sensitive desktop commands require an active, user-scoped device identity mapping.",
            details: { identity_resolution_status: identityResolution.identity_resolution_status || "unresolved", secrets_included: false },
          },
          secrets_included: false,
        });
      }
      const commandId = crypto.randomUUID();
      const ttlSeconds = Math.max(30, Math.min(Number(body.ttl_seconds || 300), 3600));
      const priority = Math.max(1, Math.min(Number(body.priority || 100), 1000));
      const confirmationRequested = body.requires_user_confirmation === true || body.requires_user_confirmation === 1;
      const confirmationServerEnforced = requiresServerSideDesktopConfirmation(action, payload);
      const requiresUserConfirmation = confirmationRequested || confirmationServerEnforced;
      const commandRequestContext = {
        ...(target.request_context || {}),
        desktop_confirmation_policy: {
          requested_by_caller: confirmationRequested,
          server_enforced: confirmationServerEnforced,
          required: requiresUserConfirmation,
          policy_version: "local_manager.desktop_confirmation.v1",
          secrets_included: false,
        },
      };
      await getPool().query(
        `INSERT INTO \`local_manager_desktop_commands\`
          (command_id, tenant_id, user_id, device_id, execution_mode, action, status, priority, requires_user_confirmation, payload_json, requested_by, request_context_json, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
        [commandId, target.tenant_id, target.user_id, target.device_id, executionMode, action, priority, requiresUserConfirmation ? 1 : 0, jsonString(payload), cleanText(body.requested_by || "gpt", 128), jsonString(commandRequestContext), ttlSeconds]
      );
      return res.status(201).json({
        ok: true,
        command: {
          command_id: commandId,
          execution_mode: executionMode,
          action,
          status: "queued",
          expires_in: ttlSeconds,
          requires_user_confirmation: requiresUserConfirmation,
          confirmation_server_enforced: confirmationServerEnforced,
          target: {
            user_id: target.user_id,
            tenant_id: target.tenant_id,
            device_id: target.device_id,
            identity_resolution: target.request_context?.desktop_identity_resolution || null,
          },
        },
        secrets_included: false,
      });
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
      const claimToken = crypto.randomUUID();
      const [claimResult] = await getPool().query(
        `UPDATE \`local_manager_desktop_commands\`
            SET status = 'claimed',
                claimed_at = NOW(),
                claim_token = ?,
                claim_lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
          WHERE user_id = ?
            AND device_id IN (${devicePlaceholders})
            AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL OR tenant_id = ?)
            AND execution_mode = 'desktop'
            AND status = 'queued'
            AND (expires_at IS NULL OR expires_at >= NOW())
          ORDER BY priority ASC, created_at ASC
          LIMIT ?`,
        [claimToken, DESKTOP_COMMAND_CLAIM_LEASE_SECONDS, device.user_id, ...deviceIds, device.tenant_id, device.tenant_id, ALL_ZERO_TENANT_ID, limit]
      );
      let rows = [];
      if (Number(claimResult?.affectedRows || 0) > 0) {
        [rows] = await getPool().query(
          `SELECT * FROM \`local_manager_desktop_commands\`
            WHERE claim_token = ?
              AND status = 'claimed'
            ORDER BY priority ASC, created_at ASC`,
          [claimToken]
        );
      }
      return res.status(200).json({
        ok: true,
        commands: rows.map((row) => sanitizeCommand(row, { includeClaimProof: true })),
        claim_lease_seconds: DESKTOP_COMMAND_CLAIM_LEASE_SECONDS,
        secrets_included: false
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "desktop_command_poll_failed", message: err.message, details: err.details || undefined }, secrets_included: false });
    }
  });

  router.post("/local-manager/device/desktop-commands/:commandId/heartbeat", async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      const device = await requireLocalManagerDevice(req);
      const commandId = cleanText(req.params.commandId, 64);
      const claimToken = cleanText(req.body?.claim_token, 64);
      if (!claimToken) return res.status(400).json({ ok: false, error: { code: "desktop_command_claim_token_required", message: "Claim token is required." }, secrets_included: false });
      const deviceIds = await resolveDesktopCommandDeviceIds(device);
      const devicePlaceholders = deviceIds.map(() => "?").join(", ");
      const [heartbeatResult] = await getPool().query(
        `UPDATE \`local_manager_desktop_commands\`
            SET claim_lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
          WHERE command_id = ?
            AND user_id = ?
            AND device_id IN (${devicePlaceholders})
            AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL OR tenant_id = ?)
            AND status = 'claimed'
            AND claim_token = ?
            AND claim_lease_expires_at > NOW()
          LIMIT 1`,
        [DESKTOP_COMMAND_CLAIM_LEASE_SECONDS, commandId, device.user_id, ...deviceIds, device.tenant_id, device.tenant_id, ALL_ZERO_TENANT_ID, claimToken]
      );
      if (!Number(heartbeatResult?.affectedRows || 0)) {
        return res.status(409).json({ ok: false, error: { code: "desktop_command_claim_not_owned", message: "Command claim is missing, expired, or owned by another poller." }, secrets_included: false });
      }
      return res.status(200).json({ ok: true, command_id: commandId, lease_seconds: DESKTOP_COMMAND_CLAIM_LEASE_SECONDS, secrets_included: false });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "desktop_command_heartbeat_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/local-manager/device/desktop-commands/:commandId/complete", async (req, res) => {
    try {
      await ensureDesktopCommandTable();
      const device = await requireLocalManagerDevice(req);
      const commandId = cleanText(req.params.commandId, 64);
      const status = cleanText(req.body?.status || "completed", 24);
      const finalStatus = status === "completed" ? "completed" : "failed";
      const claimToken = cleanText(req.body?.claim_token, 64);
      if (!claimToken) return res.status(400).json({ ok: false, error: { code: "desktop_command_claim_token_required", message: "Claim token is required." }, secrets_included: false });
      const result = { ...(req.body?.result || {}), secrets_included: false };
      const deviceIds = await resolveDesktopCommandDeviceIds(device);
      const devicePlaceholders = deviceIds.map(() => "?").join(", ");
      const [resultRows] = await getPool().query(
        `UPDATE \`local_manager_desktop_commands\`
            SET status = ?,
                result_json = ?,
                error_code = ?,
                error_message = ?,
                completed_at = NOW(),
                claim_token = NULL,
                claim_lease_expires_at = NULL
          WHERE command_id = ?
            AND user_id = ?
            AND device_id IN (${devicePlaceholders})
            AND (? IS NULL OR tenant_id = ? OR tenant_id IS NULL OR tenant_id = ?)
            AND status = 'claimed'
            AND claim_token = ?
            AND claim_lease_expires_at > NOW()
          LIMIT 1`,
        [finalStatus, jsonString(result), cleanText(req.body?.error_code, 96) || null, cleanText(req.body?.error_message, 1000) || null, commandId, device.user_id, ...deviceIds, device.tenant_id, device.tenant_id, ALL_ZERO_TENANT_ID, claimToken]
      );
      if (!Number(resultRows?.affectedRows || 0)) return res.status(409).json({ ok: false, error: { code: "desktop_command_claim_not_owned", message: "Command is not actively claimed by this poller or is already terminal." }, secrets_included: false });
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
