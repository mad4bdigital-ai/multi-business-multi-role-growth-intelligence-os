import { getPool } from "../db.js";
import crypto from "node:crypto";

const PLATFORM_TENANT_ID = "00000000-0000-4000-a000-000000000001";
const PLATFORM_ADMIN_USER_ID = "00000000-0000-4000-a000-000000000002";

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

function connectorAuthToken(config) {
  const token = String(config?.connector_secret || "").trim();
  if (!token) throw new Error("Per-device connector_secret is not configured for this local connector.");
  return token;
}

async function resolveUserLocalConfig(userId, tenantId, deviceId) {
  const principal = resolveLocalConnectorPrincipalAliases(userId, tenantId);
  const [configs] = await getPool().query(
    "SELECT *, COALESCE(device_runtime_url, tunnel_url) AS runtime_url FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? AND is_enabled = TRUE LIMIT 1",
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
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId);
    if (!userConfig) throw new Error("Local connector not enabled or configured for this user/device.");

    const allowlistEntry = userConfig.shellAllowlists.find(e => e.alias === alias);
    if (!allowlistEntry) throw new Error(`Command alias '${alias}' not found in allowlist.`);
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
      signal: AbortSignal.timeout(35000),
    });
    const raw = await response.json();
    if (!raw.ok && raw.error) throw new Error(raw.error.message || raw.stderr || "Command failed");
    output = raw;
    status = "completed";

  } catch (err) {
    error = { code: "local_command_execution_failed", message: err.message };
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
      http_status: status === "completed" ? 200 : 400,
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
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId);
    if (!userConfig) throw new Error("Local connector not enabled or configured for this user/device.");

    const rule = userConfig.fileAccessRules.find(r =>
      r.path_pattern === path && (r.access_mode === "read" || r.access_mode === "read_write")
    );
    if (!rule) throw new Error(`File path '${path}' not allowed for read access.`);

    const runtimeUrl = connectorRuntimeUrl(userConfig.config);
    if (!runtimeUrl) throw new Error("Local connector runtime URL is not configured for this user/device.");
    const token = connectorAuthToken(userConfig.config);
    const response = await fetch(`${runtimeUrl}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "read", path }),
      signal: AbortSignal.timeout(35000),
    });
    const raw = await response.json();
    if (!raw.ok) throw new Error(raw.error?.message || "File read failed");
    content = raw.content;
    status = "completed";

  } catch (err) {
    error = { code: "local_file_read_failed", message: err.message };
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
      http_status: status === "completed" ? 200 : 400,
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
    const userConfig = await resolveUserLocalConfig(userId, tenantId, deviceId);
    if (!userConfig) throw new Error("Local connector not enabled or configured for this user/device.");

    const rule = userConfig.fileAccessRules.find(r =>
      r.path_pattern === path && (r.access_mode === "write" || r.access_mode === "read_write")
    );
    if (!rule) throw new Error(`File path '${path}' not allowed for write access.`);

    const token = userConfig.config.connector_secret || process.env.CONNECTOR_LOCAL_API_KEY || '';
    const response = await fetch(`${userConfig.config.tunnel_url}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "write", path, content }),
      signal: AbortSignal.timeout(35000),
    });
    const raw = await response.json();
    if (!raw.ok) throw new Error(raw.error?.message || "File write failed");
    result = raw;
    status = "completed";

  } catch (err) {
    error = { code: "local_file_write_failed", message: err.message };
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
      http_status: status === "completed" ? 200 : 400,
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
