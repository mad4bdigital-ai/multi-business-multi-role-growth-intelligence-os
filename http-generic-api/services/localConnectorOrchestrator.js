import { getPool } from "../db.js";
import crypto from "node:crypto";
import { assertLocalConnectorDeviceTrust } from "../localConnectorDeviceTrust.js";

const PLATFORM_TENANT_ID = "00000000-0000-4000-a000-000000000001";
const PLATFORM_ADMIN_USER_ID = "00000000-0000-4000-a000-000000000002";
const CONNECTOR_TIMEOUT_MS = 35_000;
const CONNECTOR_RESPONSE_EXCERPT_MAX_CHARS = 768;

function createLocalActionId() {
  return `local_action_${crypto.randomUUID().replace(/-/g, "")}`;
}

function resolveLocalConnectorPrincipalAliases(userId, tenantId) {
  const normalizedUser = String(userId || "").trim().toLowerCase();
  const normalizedTenant = String(tenantId || "").trim().toLowerCase();
  return {
    userId: ["admin", "nagy", "platform_admin"].includes(normalizedUser)
      ? PLATFORM_ADMIN_USER_ID
      : userId,
    tenantId: ["platform", "mad4b", "platform_owner"].includes(normalizedTenant)
      ? PLATFORM_TENANT_ID
      : tenantId,
  };
}

function connectorRuntimeUrl(config) {
  return String(config?.runtime_url || config?.device_runtime_url || config?.tunnel_url || "").replace(/\/$/, "");
}

function localConnectorError(code, message, httpStatus = 500, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = httpStatus;
  error.http_status = httpStatus;
  error.retryable = Boolean(details.retryable);
  error.details = {
    ...details,
    retryable: Boolean(details.retryable),
    secrets_included: false,
  };
  return error;
}

function connectorAuthToken(config) {
  const token = String(config?.connector_secret || "").trim();
  if (!token) {
    throw localConnectorError(
      "connector_credential_missing",
      "The local connector credential is not configured for this device.",
      401,
      { reason: "credential_missing", retryable: false },
    );
  }
  return token;
}

function responseHeader(response, name) {
  return String(response?.headers?.get?.(name) || "").trim();
}

function redactConnectorExcerpt(value = "") {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu, "Bearer [REDACTED]")
    .replace(/(["']?)(authorization|api[_-]?key|token|secret|password|passwd|cookie)\1\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;]+)/giu, "$1$2$1=[REDACTED]")
    .slice(0, CONNECTOR_RESPONSE_EXCERPT_MAX_CHARS);
}

export function classifyLocalConnectorHttpFailure(status) {
  const normalizedStatus = Number(status || 0);
  if (normalizedStatus === 401) {
    return {
      code: "connector_credential_invalid",
      message: "The local connector rejected the supplied credential.",
      http_status: 401,
      reason: "credential_invalid",
      retryable: false,
    };
  }
  if (normalizedStatus === 403) {
    return {
      code: "connector_scope_denied",
      message: "The local connector denied the requested capability scope.",
      http_status: 403,
      reason: "scope_denied",
      retryable: false,
    };
  }
  if (normalizedStatus === 408 || normalizedStatus === 504) {
    return {
      code: "connector_timeout",
      message: "The local connector did not complete the request before the timeout.",
      http_status: 504,
      reason: "upstream_timeout",
      retryable: true,
    };
  }
  if (normalizedStatus === 429) {
    return {
      code: "connector_rate_limited",
      message: "The local connector temporarily rejected the request because of rate limiting.",
      http_status: 429,
      reason: "rate_limited",
      retryable: true,
    };
  }
  if ([500, 502, 503].includes(normalizedStatus)) {
    return {
      code: "connector_transport_unavailable",
      message: "The local connector transport is temporarily unavailable.",
      http_status: normalizedStatus || 502,
      reason: "upstream_unavailable",
      retryable: true,
    };
  }
  return {
    code: "connector_upstream_http_error",
    message: "The local connector returned an unsuccessful HTTP response.",
    http_status: normalizedStatus >= 400 ? normalizedStatus : 502,
    reason: "upstream_http_error",
    retryable: normalizedStatus >= 500,
  };
}

export async function readLocalConnectorResponse(response, { operation = "local_connector_call" } = {}) {
  const status = Number(response?.status || 0);
  const contentType = responseHeader(response, "content-type").toLowerCase();
  const requestId =
    responseHeader(response, "x-request-id") ||
    responseHeader(response, "cf-ray") ||
    responseHeader(response, "x-correlation-id") ||
    null;
  const responseText = String(await response.text());
  let payload = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
  }

  if (!response?.ok) {
    const classification = classifyLocalConnectorHttpFailure(status);
    const providerMessage = payload?.error?.message || payload?.message || null;
    throw localConnectorError(
      classification.code,
      providerMessage || classification.message,
      classification.http_status,
      {
        operation,
        reason: classification.reason,
        retryable: classification.retryable,
        upstream_status: status || null,
        request_id: requestId,
        content_type: contentType || null,
        response_excerpt: redactConnectorExcerpt(responseText),
      },
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw localConnectorError(
      "connector_response_invalid",
      "The local connector returned a non-JSON or invalid response envelope.",
      502,
      {
        operation,
        reason: "invalid_response_envelope",
        retryable: true,
        upstream_status: status || null,
        request_id: requestId,
        content_type: contentType || null,
        response_excerpt: redactConnectorExcerpt(responseText),
      },
    );
  }

  if (payload.ok === false) {
    const payloadCode = String(payload?.error?.code || "").trim();
    const payloadMessage = payload?.error?.message || payload?.stderr || "The local connector operation failed.";
    throw localConnectorError(
      payloadCode || "connector_operation_failed",
      payloadMessage,
      status >= 400 ? status : 400,
      {
        operation,
        reason: payloadCode || "operation_failed",
        retryable: false,
        upstream_status: status || null,
        request_id: requestId,
      },
    );
  }

  return payload;
}

function normalizeLocalConnectorError(error, fallbackCode) {
  if (error?.code && (error?.http_status || error?.status)) {
    return {
      code: error.code,
      message: error.message,
      http_status: Number(error.http_status || error.status),
      retryable: Boolean(error.retryable ?? error?.details?.retryable),
      details: error.details || null,
      device_trust: error.device_trust || null,
    };
  }

  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return {
      code: "connector_timeout",
      message: "The local connector did not complete the request before the timeout.",
      http_status: 504,
      retryable: true,
      details: {
        reason: "client_timeout",
        retryable: true,
        timeout_ms: CONNECTOR_TIMEOUT_MS,
        secrets_included: false,
      },
      device_trust: error.device_trust || null,
    };
  }

  if (error instanceof TypeError) {
    return {
      code: "connector_transport_unavailable",
      message: "The local connector transport could not be reached.",
      http_status: 502,
      retryable: true,
      details: {
        reason: "network_or_fetch_failure",
        retryable: true,
        secrets_included: false,
      },
      device_trust: error.device_trust || null,
    };
  }

  return {
    code: error?.code || fallbackCode,
    message: error?.message || "The local connector operation failed.",
    http_status: Number(error?.status || 400),
    retryable: false,
    details: error?.details || null,
    device_trust: error?.device_trust || null,
  };
}

async function resolveUserLocalConfig(userId, tenantId, deviceId, { includeDisabled = false } = {}) {
  const principal = resolveLocalConnectorPrincipalAliases(userId, tenantId);
  const enabledClause = includeDisabled ? "" : " AND is_enabled = TRUE";
  const [configs] = await getPool().query(
    `SELECT *, COALESCE(device_runtime_url, tunnel_url) AS runtime_url
       FROM \`local_connector_user_configs\`
      WHERE user_id = ? AND tenant_id = ? AND device_id = ?${enabledClause}
      LIMIT 1`,
    [principal.userId, principal.tenantId, deviceId]
  );
  const config = configs[0];
  if (!config) return null;

  const [shellAllowlists] = await getPool().query(
    "SELECT * FROM `local_connector_shell_allowlists` WHERE config_id = ?",
    [config.config_id]
  );
  const [fileAccessRules] = await getPool().query(
    "SELECT * FROM `local_connector_file_access_rules` WHERE config_id = ?",
    [config.config_id]
  );
  return { config, shellAllowlists, fileAccessRules };
}

async function executeGovernedShellCommand(args) {
  const { userId, tenantId, deviceId, alias, extraArgs = [], agentId = null, performUniversalServerWriteback } = args;
  const localActionId = createLocalActionId();
  const startedAt = new Date();
  let status = "failed";
  let output = null;
  let error = null;

  try {
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId, { includeDisabled: true });
    const allowlistEntry = userConfig?.shellAllowlists.find((entry) => entry.alias === alias) || null;
    assertLocalConnectorDeviceTrust({
      config: userConfig?.config || null,
      userId: resolveLocalConnectorPrincipalAliases(userId, tenantId).userId,
      tenantId: resolveLocalConnectorPrincipalAliases(userId, tenantId).tenantId,
      deviceId,
      capabilityKey: `shell:${alias}`,
      capabilitySupported: Boolean(allowlistEntry),
    });
    if (extraArgs.length > 0 && !allowlistEntry.allow_extra_args) {
      throw new Error(`Command alias '${alias}' does not allow extra arguments.`);
    }

    const runtimeUrl = connectorRuntimeUrl(userConfig.config);
    if (!runtimeUrl) throw new Error("Local connector runtime URL is not configured for this user/device.");
    const token = connectorAuthToken(userConfig.config);
    const response = await fetch(`${runtimeUrl}/shell`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "run", alias, extra_args: extraArgs }),
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
    });
    output = await readLocalConnectorResponse(response, { operation: `shell:${alias}` });
    status = "completed";
  } catch (caught) {
    error = normalizeLocalConnectorError(caught, "local_command_execution_failed");
  } finally {
    await performUniversalServerWriteback({
      mode: "sync",
      job_id: localActionId,
      target_key: alias,
      parent_action_key: "local_connector_shell",
      endpoint_key: alias,
      source_layer: "local_connector_orchestrator",
      entry_type: "local_command_execution",
      execution_class: "local_action",
      attempt_count: 1,
      status_source: status,
      responseBody: output || error,
      error_code: error?.code,
      error_message_short: error?.message,
      http_status: status === "completed" ? 200 : error?.http_status || 500,
      brand_name: null,
      execution_trace_id: localActionId,
      started_at: startedAt.toISOString(),
      agent_id: agentId,
      tenant_id: tenantId,
      user_id: userId,
    });
  }

  if (error) return { ok: false, status: "failed", reason: error.message, details: error };
  return { ok: true, status: "completed", result: output };
}

async function readGovernedLocalFile(args) {
  const { userId, tenantId, deviceId, path, agentId = null, performUniversalServerWriteback } = args;
  const localActionId = createLocalActionId();
  const startedAt = new Date();
  let status = "failed";
  let content = null;
  let error = null;

  try {
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId, { includeDisabled: true });
    const rule = userConfig?.fileAccessRules.find((entry) =>
      entry.path_pattern === path && (entry.access_mode === "read" || entry.access_mode === "read_write")
    ) || null;
    const principal = resolveLocalConnectorPrincipalAliases(userId, tenantId);
    assertLocalConnectorDeviceTrust({
      config: userConfig?.config || null,
      userId: principal.userId,
      tenantId: principal.tenantId,
      deviceId,
      capabilityKey: "file:read",
      capabilitySupported: Boolean(rule),
    });

    const runtimeUrl = connectorRuntimeUrl(userConfig.config);
    if (!runtimeUrl) throw new Error("Local connector runtime URL is not configured for this user/device.");
    const token = connectorAuthToken(userConfig.config);
    const response = await fetch(`${runtimeUrl}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "read", path }),
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
    });
    const raw = await readLocalConnectorResponse(response, { operation: "file:read" });
    content = raw.content;
    status = "completed";
  } catch (caught) {
    error = normalizeLocalConnectorError(caught, "local_file_read_failed");
  } finally {
    await performUniversalServerWriteback({
      mode: "sync",
      job_id: localActionId,
      target_key: path,
      parent_action_key: "local_connector_file",
      endpoint_key: "read_file",
      source_layer: "local_connector_orchestrator",
      entry_type: "local_file_read",
      execution_class: "local_action",
      attempt_count: 1,
      status_source: status,
      responseBody: content || error,
      error_code: error?.code,
      error_message_short: error?.message,
      http_status: status === "completed" ? 200 : error?.http_status || 500,
      brand_name: null,
      execution_trace_id: localActionId,
      started_at: startedAt.toISOString(),
      agent_id: agentId,
      tenant_id: tenantId,
      user_id: userId,
    });
  }

  if (error) return { ok: false, status: "failed", reason: error.message, details: error };
  return { ok: true, status: "completed", content };
}

async function writeGovernedLocalFile(args) {
  const { userId, tenantId, deviceId, path, content, agentId = null, performUniversalServerWriteback } = args;
  const localActionId = createLocalActionId();
  const startedAt = new Date();
  let status = "failed";
  let result = null;
  let error = null;

  try {
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId, { includeDisabled: true });
    const rule = userConfig?.fileAccessRules.find((entry) =>
      entry.path_pattern === path && (entry.access_mode === "write" || entry.access_mode === "read_write")
    ) || null;
    const principal = resolveLocalConnectorPrincipalAliases(userId, tenantId);
    assertLocalConnectorDeviceTrust({
      config: userConfig?.config || null,
      userId: principal.userId,
      tenantId: principal.tenantId,
      deviceId,
      capabilityKey: "file:write",
      capabilitySupported: Boolean(rule),
    });

    const runtimeUrl = connectorRuntimeUrl(userConfig.config);
    if (!runtimeUrl) throw new Error("Local connector runtime URL is not configured for this user/device.");
    const token = connectorAuthToken(userConfig.config);
    const response = await fetch(`${runtimeUrl}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "write", path, content }),
      signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS),
    });
    result = await readLocalConnectorResponse(response, { operation: "file:write" });
    status = "completed";
  } catch (caught) {
    error = normalizeLocalConnectorError(caught, "local_file_write_failed");
  } finally {
    await performUniversalServerWriteback({
      mode: "sync",
      job_id: localActionId,
      target_key: path,
      parent_action_key: "local_connector_file",
      endpoint_key: "write_file",
      source_layer: "local_connector_orchestrator",
      entry_type: "local_file_write",
      execution_class: "local_action",
      attempt_count: 1,
      status_source: status,
      responseBody: result || error,
      error_code: error?.code,
      error_message_short: error?.message,
      http_status: status === "completed" ? 200 : error?.http_status || 500,
      brand_name: null,
      execution_trace_id: localActionId,
      started_at: startedAt.toISOString(),
      agent_id: agentId,
      tenant_id: tenantId,
      user_id: userId,
    });
  }

  if (error) return { ok: false, status: "failed", reason: error.message, details: error };
  return { ok: true, status: "completed", result };
}

export function createLocalConnectorOrchestrator(deps) {
  const { performUniversalServerWriteback } = deps;
  return {
    resolveUserLocalConfig,
    executeGovernedShellCommand: (args) => executeGovernedShellCommand({ ...args, performUniversalServerWriteback }),
    readGovernedLocalFile:       (args) => readGovernedLocalFile({ ...args, performUniversalServerWriteback }),
    writeGovernedLocalFile:      (args) => writeGovernedLocalFile({ ...args, performUniversalServerWriteback }),
  };
}
