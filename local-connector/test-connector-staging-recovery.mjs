import assert from "node:assert/strict";
import test from "node:test";
import {
  createStagingRecoveryBridge, stagingRecoveryCapabilities,
} from "./connector-staging-recovery.mjs";

const config = { CONNECTOR_RECOVERY_STAGING_READONLY_ENABLED: "true", CONNECTOR_RECOVERY_STAGING_MCP_ENABLED: "true" };
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", ...headers },
});
const offlineProduction = async (url, options) => {
  if (url === "https://auth.mad4b.com/health") return reply({ ok: false }, 503);
  if (url === "https://dev.mad4b.com/health") return reply({ ok: true, service: "dev" });
  if (url.includes("oauth-protected-resource")) return reply({ resource: "https://mcp-dev.mad4b.com" });
  if (url === "https://mcp-dev.mad4b.com/mcp") {
    return reply({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "list_accessible_workspaces" }] } });
  }
  throw new Error("Unexpected URL");
};
test("disabled by default and does not mutate Production binding", async () => {
  const result = await createStagingRecoveryBridge({ env: {}, fetchImpl: offlineProduction })({ action: "health" });
  assert.equal(result.code, "staging_recovery_disabled");
  assert.equal(stagingRecoveryCapabilities({}).enabled, false);
  assert.equal(stagingRecoveryCapabilities({}).environment_binding_mutated, false);
});
test("Production healthy denies Staging access, including MCP", async () => {
  const fetchImpl = async () => reply({ ok: true });
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl });
  assert.equal((await bridge({ action: "health" })).code, "production_available_or_authority_denied");
  assert.equal((await bridge({ action: "mcp_catalog" }, { stagingBearer: "stage-token-123456" })).code,
    "production_available_or_authority_denied");
});
test("Production 401 and 403 are not interpreted as outages", async () => {
  for (const status of [401, 403]) {
    const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: async () => reply({ ok: false }, status) });
    assert.equal((await bridge({ action: "health" })).http_status, 409);
  }
});
test("Staging health fallback occurs only for real Production outage", async () => {
  const seen = [];
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: async (url, opts) => {
    seen.push({ url, opts });
    return offlineProduction(url, opts);
  } });
  const health = await bridge({ action: "health" });
  assert.equal(health.ok, true);
  assert.equal(health.selected_environment, "staging");
  assert.equal(health.execution_allowed, false);
  assert.deepEqual(seen.map((s) => s.url), ["https://auth.mad4b.com/health", "https://dev.mad4b.com/health"]);
  assert.ok(seen.every((s) => s.opts.redirect === "manual"));
});
test("No caller-selected URL, environment, method or redirect", async () => {
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: offlineProduction });
  for (const key of ["url", "target", "environment", "method", "headers"]) {
    assert.equal((await bridge({ action: "health", [key]: "https://example.org" })).code,
      "caller_routing_not_allowed");
  }
  const redirectBridge = createStagingRecoveryBridge({ env: config, fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }) });
  assert.equal((await redirectBridge({ action: "health" })).http_status, 409);
});
test("MCP metadata uses dedicated staging resource and excludes Production bearer", async () => {
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: offlineProduction });
  const result = await bridge({ action: "mcp_metadata" });
  assert.equal(result.ok, true);
  assert.equal(result.metadata.resource, "https://mcp-dev.mad4b.com");
  assert.equal(result.production_token_reuse, undefined);
});
test("MCP calls require staging-specific bearer, only closed-world read tools", async () => {
  const calls = [];
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: async (url, opts) => {
    calls.push({ url, opts });
    return offlineProduction(url, opts);
  } });
  assert.equal((await bridge({ action: "mcp_catalog" })).code, "staging_oauth_token_required");
  assert.equal((await bridge({ action: "mcp_tool_read", tool_name: "destroy_all" },
    { stagingBearer: "stage-token-123456" })).code, "mcp_method_not_allowlisted");
  const result = await bridge({ action: "mcp_tool_read", tool_name: "list_accessible_workspaces", arguments: {} },
    { stagingBearer: "stage-token-123456" });
  assert.equal(result.ok, true);
  const mcp = calls.find((call) => call.url.endsWith("/mcp"));
  assert.ok(mcp);
  assert.equal(mcp.opts.headers.Authorization, "Bearer stage-token-123456");
  assert.equal(JSON.parse(mcp.opts.body).params.name, "list_accessible_workspaces");
  assert.equal(mcp.opts.redirect, "manual");
});
test("MCP Production-only outage can trigger a separate staging diagnostic", async () => {
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: async (url, opts) => {
    if (url === "https://auth.mad4b.com/health") return reply({ ok: true });
    if (url === "https://mcp.mad4b.com/.well-known/oauth-protected-resource") return reply({ error: "bad_gateway" }, 502);
    return offlineProduction(url, opts);
  } });
  assert.equal((await bridge({ action: "mcp_metadata" })).ok, true);
});
test("Oversize upstream output is not returned", async () => {
  const bridge = createStagingRecoveryBridge({ env: config, fetchImpl: async (url) => {
    if (url === "https://auth.mad4b.com/health") return reply({ ok: false }, 503);
    return reply({ data: "A".repeat(80000) });
  } });
  const result = await bridge({ action: "mcp_metadata" });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes("AAAAAAAA"), false);
});
