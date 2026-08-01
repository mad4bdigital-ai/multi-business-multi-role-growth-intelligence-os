import assert from "node:assert/strict";
import {
  CHATGPT_MCP_PROTOCOL_VERSION,
  buildChatGptMcpWwwAuthenticate,
  buildChatGptProtectedResourceMetadata,
  handleChatGptMcpRequest,
  listChatGptMcpTools,
  validateChatGptMcpOrigin,
} from "./chatgptMcpRuntime.js";

const enabledEnv = {
  CHATGPT_MCP_ENABLED: "true",
  CHATGPT_MCP_LEGACY_USER_JWT_ENABLED: "true",
  CHATGPT_MCP_RESOURCE_URL: "https://mcp.example.test",
  CHATGPT_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test",
  CHATGPT_MCP_ALLOWED_ORIGINS: "https://chatgpt.com,https://work.example.test",
  JWT_SECRET: "test-only-secret",
};

const transportHeaders = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  origin: "https://chatgpt.com",
};

function validAuthorization() {
  return {
    ok: true,
    claims: {
      user_id: "user-1",
      tenant_id: "workspace-1",
      email: "user@example.test",
    },
  };
}

function createPool(queryHandler) {
  return {
    async query(sql, params) {
      return queryHandler(String(sql), params);
    },
  };
}

{
  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    headers: transportHeaders,
    env: {},
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "MCP_DISABLED");
}

{
  const metadata = buildChatGptProtectedResourceMetadata(enabledEnv);
  assert.equal(metadata.resource, "https://mcp.example.test");
  assert.deepEqual(metadata.authorization_servers, ["https://auth.example.test"]);
  assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  assert(metadata.scopes_supported.includes("workspaces.read"));
  assert(metadata.scopes_supported.includes("brands.read"));

  const challenge = buildChatGptMcpWwwAuthenticate(enabledEnv, {
    scope: "brands.read",
    description: "Link the account.",
  });
  assert(challenge.includes('resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource"'));
  assert(challenge.includes('scope="brands.read"'));
}

{
  assert.equal(validateChatGptMcpOrigin({}, enabledEnv).ok, true);
  assert.equal(validateChatGptMcpOrigin({ origin: "https://chatgpt.com" }, enabledEnv).ok, true);
  assert.equal(validateChatGptMcpOrigin({ origin: "https://evil.example" }, enabledEnv).ok, false);
}

{
  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      origin: "https://evil.example",
    },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, -32001);
}

{
  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 406);
}

{
  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: CHATGPT_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    },
    headers: transportHeaders,
    env: enabledEnv,
    pool: createPool(() => [[], []]),
    requestId: "request-init",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.protocolVersion, CHATGPT_MCP_PROTOCOL_VERSION);
  assert.equal(result.body.result.capabilities.tools.listChanged, false);
  assert(result.body.result.instructions.includes("read-only"));
  assert.equal(result.headers["x-request-id"], "request-init");
}

{
  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
    headers: {
      ...transportHeaders,
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 202);
  assert.equal(result.body, null);
}

{
  const tools = listChatGptMcpTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_accessible_workspaces",
    "list_accessible_brands",
  ]);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.securitySchemes[0].type, "oauth2");
  }

  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    headers: {
      ...transportHeaders,
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.tools.length, 2);
}

{
  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_accessible_workspaces", arguments: {} },
    },
    headers: {
      ...transportHeaders,
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: { ...enabledEnv, CHATGPT_MCP_LEGACY_USER_JWT_ENABLED: "false" },
    pool: createPool(() => [[], []]),
    requestId: "request-auth",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.result.isError, true);
  assert.equal(result.body.result.structuredContent.error.code, "MCP_AUTH_REQUIRED");
  assert(Array.isArray(result.body.result._meta["mcp/www_authenticate"]));
}

{
  const pool = createPool((sql, params) => {
    assert(sql.includes("FROM memberships m"));
    assert.deepEqual(params, ["user-1", 25]);
    return [[
      {
        workspace_id: "workspace-1",
        display_name: "Primary Workspace",
        role: "owner",
        membership_status: "active",
        workspace_status: "active",
      },
      {
        workspace_id: "workspace-2",
        display_name: "Client Workspace",
        role: "member",
        membership_status: "active",
        workspace_status: "active",
      },
    ], []];
  });

  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "list_accessible_workspaces", arguments: {} },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-token",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool,
    verifyAuthorization: validAuthorization,
    requestId: "request-workspaces",
  });
  assert.equal(result.body.result.isError, undefined);
  assert.equal(result.body.result.structuredContent.count, 2);
  assert.equal(result.body.result.structuredContent.workspaces[0].workspace_id, "workspace-1");
  assert.equal(result.body.result.structuredContent.secrets_included, false);
}

{
  const pool = createPool((sql) => {
    if (sql.includes("m.tenant_id = ?")) return [[], []];
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "list_accessible_brands",
        arguments: { workspace_id: "workspace-other" },
      },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-token",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool,
    verifyAuthorization: validAuthorization,
    requestId: "request-denied",
  });
  assert.equal(result.body.result.isError, true);
  assert.equal(result.body.result.structuredContent.error.code, "MCP_CONTEXT_DENIED");
  assert(!JSON.stringify(result.body).includes("workspace-other"));
}

{
  let queryIndex = 0;
  const pool = createPool((sql, params) => {
    queryIndex += 1;
    if (queryIndex === 1) {
      assert(sql.includes("m.tenant_id = ?"));
      assert.deepEqual(params, ["user-1", "workspace-1"]);
      return [[{
        workspace_id: "workspace-1",
        role: "owner",
        status: "active",
        workspace_status: "active",
      }], []];
    }
    if (queryIndex === 2) {
      assert(sql.includes("v_workspace_resource_grant_effective"));
      assert.deepEqual(params, ["workspace-1", 200]);
      return [[
        { resource_ref: "brand:alpha", permission: "admin", source: "role", granted_at: "2026-08-01" },
        { resource_ref: "brand:alpha", permission: "view", source: "duplicate", granted_at: "2026-07-01" },
        { resource_ref: "brand:beta", permission: "view", source: "grant", granted_at: "2026-08-01" },
      ], []];
    }
    if (queryIndex === 3) {
      assert(sql.includes("FROM brands"));
      return [[
        {
          brand_name: "Alpha Brand",
          normalized_brand_name: "alpha",
          brand_domain: "alpha.example.test",
          target_key: "alpha",
          base_url: "https://alpha.example.test",
          status: "active",
          brand_core_ready: 1,
        },
        {
          brand_name: "Beta Brand",
          normalized_brand_name: "beta",
          brand_domain: "beta.example.test",
          target_key: "beta",
          base_url: "https://beta.example.test",
          status: "active",
          brand_core_ready: 0,
        },
      ], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "list_accessible_brands",
        arguments: { workspace_id: "workspace-1", limit: 50 },
      },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-token",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool,
    verifyAuthorization: validAuthorization,
    requestId: "request-brands",
  });
  assert.equal(queryIndex, 3);
  assert.equal(result.body.result.structuredContent.count, 2);
  assert.equal(result.body.result.structuredContent.brands[0].display_name, "Alpha Brand");
  assert.equal(result.body.result.structuredContent.brands[1].brand_core_ready, 0);
}

{
  const result = await handleChatGptMcpRequest({
    body: { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
    headers: {
      ...transportHeaders,
      "mcp-protocol-version": "2099-01-01",
    },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, -32600);
}

{
  const result = await handleChatGptMcpRequest({
    method: "GET",
    headers: { origin: "https://chatgpt.com", accept: "text/event-stream" },
    env: enabledEnv,
    pool: createPool(() => [[], []]),
  });
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, "POST");
}

console.log("chatgpt MCP read-only runtime tests passed");
