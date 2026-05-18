import { Router } from "express";
import crypto from "node:crypto";
import { getPool } from "../db.js";
import {
  resolveCallerTypeForRequest,
  dispatchToolForCaller,
} from "./gptToolsRoutes.js";

const SENSITIVE_ARG_SUBSTRINGS = [
  "password", "secret", "token", "api_key", "apikey",
  "credential", "private_key", "client_secret", "refresh_token",
  "access_token", "authorization", "connector_secret", "cf_token",
];

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isAdminRequest(req) {
  return req?.auth?.mode === "backend_api_key" || req?.auth?.is_admin === true;
}

function normalizeCallerTypeForGateway(req) {
  return isAdminRequest(req) ? "admin" : "tenant";
}

function redactArgs(value) {
  if (Array.isArray(value)) return value.map(redactArgs);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const lower = String(key).toLowerCase();
    if (SENSITIVE_ARG_SUBSTRINGS.some((part) => lower.includes(part))) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactArgs(child);
    }
  }
  return out;
}

function hashArgs(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function publicHostForRequest(req) {
  return String(req.headers?.["x-forwarded-host"] || req.headers?.host || "local.mad4b.com")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

function normalizeToolRow(row) {
  return {
    name: row.tool_key,
    tool_key: row.tool_key,
    dispatch_tool_key: row.dispatch_tool_key,
    displayName: row.display_name,
    description: row.description,
    public_host: row.public_host,
    public_path: row.public_path,
    dispatch_surface: row.dispatch_surface,
    credential_policy: row.credential_policy,
    credential_reuse_policy: row.credential_reuse_policy,
    capability_class: row.capability_class,
    risk_class: row.risk_class,
    allowed_caller_types: parseJson(row.allowed_caller_types_json, []),
    service_modes: parseJson(row.service_modes_json, []),
    required_entitlement_key: row.required_entitlement_key || null,
    default_service_mode: row.default_service_mode || "self_serve",
    requires_device_id: !!row.requires_device_id,
    requires_tenant_context: !!row.requires_tenant_context,
    requires_admin: !!row.requires_admin,
    requires_approval: !!row.requires_approval,
    is_consequential: !!row.is_consequential,
    consent_required: !!row.consent_required,
    risk_label: row.risk_label || null,
    consent_text: row.consent_text || null,
    approval_hold_type: row.approval_hold_type || "review",
    approval_required_role: row.approval_required_role || null,
    approval_ttl_minutes: Number(row.approval_ttl_minutes || 1440),
    inputSchema: parseJson(row.input_schema, null),
    tags: String(row.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    status: row.status,
    sort_order: row.sort_order,
  };
}

async function fetchGatewayTool(toolKey) {
  const [rows] = await getPool().query(
    `SELECT * FROM \`local_gateway_tools\` WHERE tool_key = ? LIMIT 1`,
    [toolKey]
  );
  return rows[0] || null;
}

async function listGatewayTools({ callerType, includePlanned = false }) {
  const statuses = includePlanned && callerType === "admin" ? ["active", "planned"] : ["active"];
  const [rows] = await getPool().query(
    `SELECT * FROM \`local_gateway_tools\`
      WHERE status IN (?)
      ORDER BY sort_order ASC, tool_key ASC`,
    [statuses]
  );
  return rows
    .filter((row) => callerType === "admin" || !row.requires_admin)
    .filter((row) => {
      const allowed = parseJson(row.allowed_caller_types_json, []);
      return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(callerType);
    })
    .map(normalizeToolRow);
}

async function resolveDeviceConfig({ req, args, isAdmin }) {
  const deviceId = String(args.device_id || "").trim();
  if (!deviceId) return null;

  if (!isAdmin) {
    const userId = req.auth?.user_id;
    const tenantId = req.auth?.tenant_id;
    if (!userId || !tenantId) return null;
    const [rows] = await getPool().query(
      `SELECT config_id, user_id, tenant_id, device_id, tunnel_url
         FROM \`local_connector_user_configs\`
        WHERE user_id = ? AND device_id = ? AND is_enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [userId, deviceId]
    );
    return rows[0] || null;
  }

  const requestedUserId = String(args.user_id || "").trim();
  if (requestedUserId) {
    const [rows] = await getPool().query(
      `SELECT config_id, user_id, tenant_id, device_id, tunnel_url
         FROM \`local_connector_user_configs\`
        WHERE user_id = ? AND device_id = ? AND is_enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
      [requestedUserId, deviceId]
    );
    if (rows[0]) return rows[0];
  }

  const [rows] = await getPool().query(
    `SELECT config_id, user_id, tenant_id, device_id, tunnel_url
       FROM \`local_connector_user_configs\`
      WHERE device_id = ? AND is_enabled = 1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [deviceId]
  );
  return rows[0] || null;
}

function validateCredentialBoundary({ req, tool, args, isAdmin }) {
  if (!isAdmin && tool.credential_policy === "platform_admin_recovery") {
    return {
      ok: false,
      status: 403,
      code: "admin_recovery_tool_denied",
      message: "This local gateway tool is admin recovery only and is not available in tenant/member flows.",
    };
  }

  if (!isAdmin && tool.credential_reuse_policy === "forbid_cross_principal_reuse") {
    const argUserId = String(args.user_id || "").trim();
    if (argUserId && argUserId !== req.auth?.user_id) {
      return {
        ok: false,
        status: 403,
        code: "cross_principal_credential_reuse_denied",
        message: "Tenant/member calls cannot target another user's local connector credentials.",
      };
    }
  }

  return { ok: true };
}

function normalizeServiceMode(row, args = {}) {
  return String(args.service_mode || row.default_service_mode || "self_serve").trim();
}

function serviceModeAllowed(row, serviceMode) {
  const allowed = parseJson(row.service_modes_json, []);
  return !Array.isArray(allowed) || allowed.length === 0 || allowed.includes(serviceMode);
}

function consentStatusFor(row, args = {}) {
  if (!row.consent_required) return "not_required";
  return args.consent_accepted === true || args.consent_accepted === "true" ? "accepted" : "missing";
}

async function tenantHasEntitlement(tenantId, entitlementKey) {
  if (!entitlementKey) return true;
  if (!tenantId) return false;
  const [rows] = await getPool().query(
    `SELECT entitlement_id
       FROM \`entitlements\`
      WHERE tenant_id = ?
        AND entitlement_key = ?
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1`,
    [tenantId, entitlementKey]
  );
  return Boolean(rows[0]);
}

async function getApprovedApprovalHold({ holdId, tenantId, row }) {
  const normalized = String(holdId || "").trim();
  if (!normalized) return null;
  const [rows] = await getPool().query(
    `SELECT hold_id, tenant_id, hold_type, requested_by, required_role, status, expires_at
       FROM \`approval_holds\`
      WHERE hold_id = ?
        AND tenant_id = ?
        AND status = 'approved'
        AND hold_type = ?
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1`,
    [normalized, tenantId, row.approval_hold_type || "review"]
  );
  return rows[0] || null;
}

async function createApprovalHold({ callId, req, row, tenantId }) {
  const holdId = crypto.randomUUID();
  const ttlMinutes = Math.max(15, Math.min(10080, Number(row.approval_ttl_minutes || 1440)));
  await getPool().query(
    `INSERT INTO \`approval_holds\`
       (hold_id, run_id, tenant_id, hold_type, requested_by, required_role, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW())`,
    [
      holdId,
      callId,
      tenantId,
      row.approval_hold_type || "review",
      req.auth?.user_id || null,
      row.approval_required_role || null,
      ttlMinutes,
    ]
  );
  return holdId;
}

async function insertCallLog({ tool, req, args, deviceConfig, callId, publicHost, serviceMode = null, entitlementKey = null, consentStatus = "not_required", approvalHoldId = null }) {
  const redactedArgs = redactArgs(args || {});
  await getPool().query(
    `INSERT INTO \`local_gateway_tool_call_log\`
       (call_id, tool_key, dispatch_tool_key, public_host, public_path,
        user_id, tenant_id, device_id, config_id, auth_mode, caller_type,
        request_args_hash, request_args_json, redaction_status, status, trace_id, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'redacted', 'started', ?, NOW())`,
    [
      callId,
      tool.tool_key,
      tool.dispatch_tool_key,
      publicHost,
      tool.public_path,
      deviceConfig?.user_id || req.auth?.user_id || args.user_id || null,
      deviceConfig?.tenant_id || req.auth?.tenant_id || args.tenant_id || null,
      args.device_id || null,
      deviceConfig?.config_id || null,
      req.auth?.mode || null,
      normalizeCallerTypeForGateway(req),
      hashArgs(redactedArgs),
      JSON.stringify(redactedArgs),
      req.headers?.["x-request-id"] || null,
    ]
  );
}

async function completeCallLog({ callId, status, httpStatus, errorCode = null, errorMessage = null, startedAt }) {
  const durationMs = Math.max(0, Date.now() - startedAt);
  await getPool().query(
    `UPDATE \`local_gateway_tool_call_log\`
        SET status = ?, http_status = ?, error_code = ?, error_message = ?, duration_ms = ?, completed_at = NOW()
      WHERE call_id = ?`,
    [status, httpStatus || null, errorCode, errorMessage ? String(errorMessage).slice(0, 4000) : null, durationMs, callId]
  );
}

function httpError(status, code, message, details = null) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

export function buildLocalGatewayToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  router.get("/local/tools", requireBackendApiKey, async (req, res) => {
    try {
      const callerType = normalizeCallerTypeForGateway(req);
      const includePlanned = String(req.query.include_planned || "").toLowerCase() === "true";
      const tools = await listGatewayTools({ callerType, includePlanned });
      return res.status(200).json({
        ok: true,
        surface: "local_gateway",
        public_host: "local.mad4b.com",
        caller_type: callerType,
        count: tools.length,
        tools,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "local_tools_list_failed", message: err.message } });
    }
  });

  router.post("/local/tools/call", requireBackendApiKey, async (req, res) => {
    const startedAt = Date.now();
    const callId = crypto.randomUUID();
    let tool = null;
    let deviceConfig = null;
    try {
      const body = req.body || {};
      const toolKey = String(body.name || body.tool_key || "").trim();
      const args = body.tool_args ?? body.arguments ?? {};
      if (!toolKey) throw httpError(400, "missing_tool_key", "name or tool_key is required.");
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        throw httpError(400, "invalid_tool_args", "tool_args or arguments must be an object.");
      }

      const row = await fetchGatewayTool(toolKey);
      if (!row) throw httpError(404, "local_tool_not_found", `Local gateway tool '${toolKey}' was not found.`);
      if (row.status !== "active") throw httpError(409, "local_tool_not_active", `Local gateway tool '${toolKey}' is ${row.status}.`);
      tool = row;

      const isAdmin = isAdminRequest(req);
      const callerType = normalizeCallerTypeForGateway(req);
      const allowedCallerTypes = parseJson(row.allowed_caller_types_json, []);
      if (Array.isArray(allowedCallerTypes) && allowedCallerTypes.length && !allowedCallerTypes.includes(callerType)) {
        throw httpError(403, "caller_type_not_allowed", `Tool '${toolKey}' does not allow caller type '${callerType}'.`);
      }
      if (row.requires_admin && !isAdmin) {
        throw httpError(403, "admin_required", `Tool '${toolKey}' requires admin access.`);
      }
      if (row.requires_tenant_context && !isAdmin && (!req.auth?.tenant_id || !req.auth?.user_id)) {
        throw httpError(403, "tenant_context_required", "Signed-in user and tenant context are required.");
      }

      const boundary = validateCredentialBoundary({ req, tool: row, args, isAdmin });
      if (!boundary.ok) throw httpError(boundary.status, boundary.code, boundary.message);

      if (row.requires_device_id) {
        deviceConfig = await resolveDeviceConfig({ req, args, isAdmin });
        if (!deviceConfig) {
          throw httpError(404, "device_config_not_found", "No enabled local connector config was found for the requested device and principal.");
        }
      }

      if (!isAdmin && row.requires_approval) {
        throw httpError(403, "approval_required", `Tool '${toolKey}' requires approval before tenant/member dispatch.`);
      }

      const publicHost = publicHostForRequest(req);
      await insertCallLog({ tool: row, req, args, deviceConfig, callId, publicHost });

      const dispatchArgs = { ...args };
      if (!isAdmin) {
        dispatchArgs.user_id = req.auth.user_id;
      }
      const dispatchCallerType = resolveCallerTypeForRequest(req);
      const result = await dispatchToolForCaller(dispatchCallerType, row.dispatch_tool_key, dispatchArgs, req);
      const ok = result?.body?.ok !== false && result.status < 400;
      await completeCallLog({
        callId,
        status: ok ? "ok" : "failed",
        httpStatus: result.status,
        errorCode: ok ? null : result?.body?.error?.code || "dispatch_failed",
        errorMessage: ok ? null : result?.body?.error?.message || "Dispatch failed.",
        startedAt,
      });
      return res.status(result.status).json({
        ...result.body,
        local_gateway: {
          call_id: callId,
          tool_key: row.tool_key,
          dispatch_tool_key: row.dispatch_tool_key,
          credential_policy: row.credential_policy,
          credential_reuse_policy: row.credential_reuse_policy,
        },
      });
    } catch (err) {
      const status = err.status || 500;
      if (tool) {
        try {
          await completeCallLog({
            callId,
            status: status === 403 ? "denied" : status === 404 ? "blocked" : "failed",
            httpStatus: status,
            errorCode: err.code || "local_gateway_tool_call_failed",
            errorMessage: err.message,
            startedAt,
          });
        } catch {}
      }
      return res.status(status).json({
        ok: false,
        error: {
          code: err.code || "local_gateway_tool_call_failed",
          message: err.message,
          details: err.details || undefined,
        },
        local_gateway: { call_id: callId, tool_key: tool?.tool_key || null },
      });
    }
  });

  return router;
}
