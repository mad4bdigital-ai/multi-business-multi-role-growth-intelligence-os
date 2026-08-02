import assert from "node:assert/strict";
import {
  REMOTE_MCP_PROTOCOL_VERSION,
  buildRemoteMcpProtectedResourceMetadata,
  getRemoteMcpRuntimeConfiguration,
  handleRemoteMcpConnectorRequest,
  listRemoteMcpClientProfiles,
  listRemoteMcpTools,
  remoteMcpEnabled,
  resolveRemoteMcpClientProfile,
  resolveRemoteMcpEndpoint,
} from "./remoteMcpConnectorRuntime.js";

function createPool() {
  return {
    async query() {
      return [[], []];
    },
  };
}

const baseHeaders = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};

const remoteEnv = {
  REMOTE_MCP_ENABLED: "true",
  REMOTE_MCP_LEGACY_USER_JWT_ENABLED: "false",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test",
  REMOTE_MCP_ALLOWED_ORIGINS: "https://chatgpt.com,https://claude.ai,https://client.example.test",
};

{
  const profiles = listRemoteMcpClientProfiles();
  assert.deepEqual(profiles.map((profile) => profile.key), [
    "openai_chatgpt",
    "anthropic_claude",
    "generic_remote_mcp_client",
  ]);
  assert(profiles.every((profile) => profile.transports.includes("streamable_http")));
}

{
  assert.equal(resolveRemoteMcpClientProfile({ origin: "https://chatgpt.com" }).key, "openai_chatgpt");
  assert.equal(resolveRemoteMcpClientProfile({ origin: "https://claude.ai" }).key, "anthropic_claude");
  assert.equal(resolveRemoteMcpClientProfile({ "user-agent": "Claude remote MCP client" }).key, "anthropic_claude");
  assert.equal(resolveRemoteMcpClientProfile({ origin: "https://client.example.test" }).key, "generic_remote_mcp_client");
  assert.equal(resolveRemoteMcpClientProfile({}).key, "generic_remote_mcp_client");
}

{
  assert.equal(remoteMcpEnabled(remoteEnv), true);
  assert.equal(resolveRemoteMcpEndpoint(remoteEnv), "https://mcp.example.test/mcp");
  const metadata = buildRemoteMcpProtectedResourceMetadata(remoteEnv);
  assert.equal(metadata.resource, "https://mcp.example.test");
  assert.deepEqual(metadata.authorization_servers, ["https://auth.example.test"]);
  assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
}

{
  const compatibilityEnv = {
    CHATGPT_MCP_ENABLED: "true",
    CHATGPT_MCP_RESOURCE_URL: "https://legacy-name.example.test",
  };
  assert.equal(remoteMcpEnabled(compatibilityEnv), true);
  assert.equal(resolveRemoteMcpEndpoint(compatibilityEnv), "https://legacy-name.example.test/mcp");
}

{
  const config = getRemoteMcpRuntimeConfiguration(remoteEnv);
  assert.equal(config.enabled, true);
  assert.equal(config.transport, "streamable_http");
  assert(config.allowed_origins.includes("https://claude.ai"));
  assert(config.supported_client_profiles.includes("generic_remote_mcp_client"));
  assert.equal(config.secrets_included, false);
}

for (const origin of [
  "https://chatgpt.com",
  "https://claude.ai",
  "https://client.example.test",
]) {
  const result = await handleRemoteMcpConnectorRequest({
    body: {
      jsonrpc: "2.0",
      id: origin,
      method: "initialize",
      params: {
        protocolVersion: REMOTE_MCP_PROTOCOL_VERSION,
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    },
    headers: { ...baseHeaders, origin },
    env: remoteEnv,
    pool: createPool(),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.protocolVersion, REMOTE_MCP_PROTOCOL_VERSION);
  assert(result.headers["x-mad4b-mcp-client-profile"]);
}

{
  const claudeResult = await handleRemoteMcpConnectorRequest({
    body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers: {
      ...baseHeaders,
      origin: "https://claude.ai",
      "mcp-protocol-version": REMOTE_MCP_PROTOCOL_VERSION,
    },
    env: remoteEnv,
    pool: createPool(),
  });
  assert.equal(claudeResult.status, 200);
  assert.equal(claudeResult.headers["x-mad4b-mcp-client-profile"], "anthropic_claude");
  assert.deepEqual(claudeResult.body.result.tools.map((tool) => tool.name), [
    "list_accessible_workspaces",
    "list_accessible_brands",
  ]);
}

{
  const genericNoOriginResult = await handleRemoteMcpConnectorRequest({
    body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    headers: {
      ...baseHeaders,
      "mcp-protocol-version": REMOTE_MCP_PROTOCOL_VERSION,
    },
    env: remoteEnv,
    pool: createPool(),
  });
  assert.equal(genericNoOriginResult.status, 200);
  assert.equal(genericNoOriginResult.headers["x-mad4b-mcp-client-profile"], "generic_remote_mcp_client");
}

{
  const denied = await handleRemoteMcpConnectorRequest({
    body: { jsonrpc: "2.0", id: 4, method: "initialize", params: {} },
    headers: { ...baseHeaders, origin: "https://unapproved.example.test" },
    env: remoteEnv,
    pool: createPool(),
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, -32001);
}

{
  const tools = listRemoteMcpTools();
  assert(tools.length > 0);
  assert(tools.every((tool) => tool.annotations.readOnlyHint === true));
  assert(tools.every((tool) => tool.annotations.destructiveHint === false));
}

console.log("remote MCP multi-client profile tests passed");
