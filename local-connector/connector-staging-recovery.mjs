// Independently authenticated Admin Recovery *diagnostic* bridge.
// Does not alter the connector's signed Production/Staging policy binding.
// Does not proxy arbitrary URLs, commands or Production credentials.
const PRODUCTION_HEALTH = "https://auth.mad4b.com/health";
const PRODUCTION_MCP_META = "https://mcp.mad4b.com/.well-known/oauth-protected-resource";
const STAGING_API = "https://dev.mad4b.com";
const STAGING_MCP = "https://mcp-dev.mad4b.com";
const MAX_BYTES = 65536;
const READ_TOOLS = new Set(["list_accessible_workspaces", "list_accessible_brands"]);
const MCP_METHODS = new Set(["initialize", "tools/list", "ping"]);
const ACTIONS = Object.freeze(["status", "health", "mcp_metadata", "mcp_initialize", "mcp_catalog", "mcp_tool_read"]);
const TIMEOUT_MS = 5000;

function problem(code, httpStatus = 403) {
  return { ok: false, http_status: httpStatus, code, secrets_included: false };
}
function probeSummary(result) {
  return { available: result.available, http_status: result.status ?? null, reason: result.reason };
}
async function limitedRequest(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: "manual", cache: "no-store" });
    if (response.status >= 300 && response.status < 400) {
      return { available: false, status: response.status, reason: "redirect_denied", body: null };
    }
    const available = response.status < 500;
    if (Number(response.headers?.get?.("content-length")) > MAX_BYTES) {
      return { available: false, status: response.status, reason: "response_too_large", body: null };
    }
    const reader = response.body?.getReader?.();
    const sse = String(response.headers?.get?.("content-type") || "").toLowerCase().includes("text/event-stream");
    let content = "";
    if (reader) {
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return { available: false, status: response.status, reason: "response_too_large", body: null };
        }
        chunks.push(value);
        if (sse && Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8").match(/\r?\n\r?\n/)) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      content = Buffer.concat(chunks.map((value) => Buffer.from(value))).toString("utf8");
    } else {
      content = await response.text();
      if (Buffer.byteLength(content) > MAX_BYTES) return { available: false, status: response.status, reason: "response_too_large", body: null };
    }
    let body = null;
    if (sse) {
      const frames = content.split(/\r?\n\r?\n/);
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try { body = JSON.parse(data); break; } catch { /* bounded unknown SSE event */ }
      }
    } else {
      try { body = content ? JSON.parse(content) : null; } catch { /* do not emit raw upstream HTML */ }
    }
    return { available, status: response.status, reason: response.ok ? "healthy" : "upstream_http_status", body };
  } catch {
    return { available: false, status: null, reason: "transport_unavailable", body: null };
  } finally {
    clearTimeout(timeout);
  }
}
function isProductionUnavailable(result) {
  return result.reason === "transport_unavailable" || (result.status >= 500 && result.status <= 599);
}
function safeMcpPayload(action, input) {
  if (action === "mcp_initialize") return {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mad4b-admin-staging-recovery", version: "1" } },
  };
  if (action === "mcp_catalog") return { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
  if (action === "mcp_tool_read") {
    if (!READ_TOOLS.has(input?.tool_name)) return null;
    const args = input?.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args) || JSON.stringify(args).length > 2048) return null;
    return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: input.tool_name, arguments: args } };
  }
  return null;
}
export function stagingRecoveryCapabilities(env = process.env) {
  const enabled = env.CONNECTOR_RECOVERY_STAGING_READONLY_ENABLED === "true";
  const mcpEnabled = enabled && env.CONNECTOR_RECOVERY_STAGING_MCP_ENABLED === "true";
  return Object.freeze({
    enabled, mcp_enabled: mcpEnabled, mode: "admin_recovery_read_only",
    paths: ["/recovery/staging"],
    actions: ACTIONS.map((action) => ({
      action, available: enabled && (!action.startsWith("mcp_") || mcpEnabled),
      requires_staging_oauth: ["mcp_catalog", "mcp_tool_read"].includes(action),
    })),
    prod_probe: PRODUCTION_HEALTH,
    staging_api: STAGING_API, staging_mcp_resource: STAGING_MCP,
    fallback_trigger: "production_transport_error_or_5xx_only",
    tenant_access: false, production_token_reuse: false,
    environment_binding_mutated: false, execution_allowed: false,
    secrets_included: false,
  });
}
export function createStagingRecoveryBridge({ env = process.env, fetchImpl = fetch } = {}) {
  const capabilities = stagingRecoveryCapabilities(env);
  return async function dispatch(input = {}, { stagingBearer = "" } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return problem("invalid_request", 400);
    const action = input.action;
    if (!ACTIONS.includes(action)) return problem("unknown_recovery_action", 400);
    if (!capabilities.enabled) return problem("staging_recovery_disabled");
    if (action.startsWith("mcp_") && !capabilities.mcp_enabled) return problem("staging_mcp_recovery_disabled");
    if ("url" in input || "target" in input || "environment" in input || "method" in input || "headers" in input) {
      return problem("caller_routing_not_allowed", 400);
    }
    const isMcp = action.startsWith("mcp_");
    const prod = await limitedRequest(PRODUCTION_HEALTH, { method: "GET" }, fetchImpl);
    const prodMcp = isMcp && !isProductionUnavailable(prod)
      ? await limitedRequest(PRODUCTION_MCP_META, { method: "GET" }, fetchImpl)
      : null;
    const unavailable = isProductionUnavailable(prod) || (prodMcp && isProductionUnavailable(prodMcp));
    if (action === "status") {
      return {
        ok: true, http_status: 200, action, production: probeSummary(prod),
        failover_eligible: Boolean(unavailable),
        staging_execution_allowed: false, staging_mcp_enabled: capabilities.mcp_enabled,
        environment_binding_mutated: false, secrets_included: false,
      };
    }
    if (!unavailable) return problem("production_available_or_authority_denied", 409);
    if (action === "health") {
      const staging = await limitedRequest(STAGING_API + "/health", { method: "GET" }, fetchImpl);
      const healthy = staging.available && staging.status === 200 && staging.body?.ok === true;
      return {
        ok: healthy,
        http_status: healthy ? 200 : 502, action, selected_environment: "staging",
        production: probeSummary(prod), staging: probeSummary(staging),
        mode: "read_only_diagnostic", execution_allowed: false,
        environment_binding_mutated: false, secrets_included: false,
      };
    }
    if (action === "mcp_metadata") {
      const response = await limitedRequest(STAGING_MCP + "/.well-known/oauth-protected-resource", { method: "GET" }, fetchImpl);
      return {
        ok: response.status === 200 && response.body !== null,
        http_status: response.status === 200 ? 200 : 502, action, selected_environment: "staging",
        mcp_resource: STAGING_MCP,
        metadata: response.status === 200 ? response.body : null,
        upstream: probeSummary(response), execution_allowed: false, secrets_included: false,
      };
    }
    if ((action === "mcp_catalog" || action === "mcp_tool_read") && (
      typeof stagingBearer !== "string" || stagingBearer.length < 10 || stagingBearer.length > 8192 ||
      /[\r\n]/.test(stagingBearer)
    )) return problem("staging_oauth_token_required", 401);
    const payload = safeMcpPayload(action, input);
    if (!payload || !MCP_METHODS.has(payload.method) && !(action === "mcp_tool_read" && payload.method === "tools/call")) {
      return problem("mcp_method_not_allowlisted", 403);
    }
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(action !== "mcp_initialize" && stagingBearer ? { Authorization: "Bearer " + stagingBearer } : {}),
    };
    const response = await limitedRequest(STAGING_MCP + "/mcp", {
      method: "POST", headers, body: JSON.stringify(payload),
    }, fetchImpl);
    if (response.status !== 200 || !response.body || typeof response.body !== "object") {
      return {
        ok: false, http_status: response.status === 401 || response.status === 403 ? 403 : 502,
        code: "staging_mcp_upstream_not_ready_or_unauthorized",
        action, selected_environment: "staging", upstream: probeSummary(response),
        secrets_included: false,
      };
    }
    if (response.body.error || response.body.result?.isError === true) {
      return {
        ok: false, http_status: 502, code: "staging_mcp_read_failed", action,
        selected_environment: "staging", mcp_resource: STAGING_MCP,
        secrets_included: false,
      };
    }
    return {
      ok: true, http_status: 200, action, selected_environment: "staging",
      mcp_resource: STAGING_MCP, result: response.body,
      production_token_reuse: false, execution_allowed: false, secrets_included: false,
    };
  };
}
