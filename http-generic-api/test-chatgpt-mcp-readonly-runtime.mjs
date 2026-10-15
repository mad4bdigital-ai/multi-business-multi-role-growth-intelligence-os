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
  assert.equal(result.status, 401);
  assert.equal(result.headers["www-authenticate"]?.startsWith("Bearer resource_metadata="), true);
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
        { resource_ref: "brand-uuid-beta", permission: "view", source: "grant", granted_at: "2026-08-01" },
      ], []];
    }
    if (queryIndex === 3) {
      assert(sql.includes("FROM brands"));
      assert(sql.includes("brand_id IN (?)"));
      assert.equal(params.length, 5);
      return [[
        {
          brand_id: "brand-uuid-alpha",
          brand_name: "Alpha Brand",
          normalized_brand_name: "alpha",
          brand_domain: "alpha.example.test",
          target_key: "alpha",
          base_url: "https://alpha.example.test",
          status: "active",
          brand_core_ready: 1,
        },
        {
          brand_id: "brand-uuid-beta",
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
  assert.equal(result.body.result.structuredContent.brands[0].brand_id, "brand-uuid-alpha");
  assert.equal(result.body.result.structuredContent.brands[0].identity_read_mode, "canonical_brand_id_with_legacy_compatibility");
  assert.equal(result.body.result.structuredContent.brands[1].brand_id, "brand-uuid-beta");
  assert.equal(result.body.result.structuredContent.brands[1].brand_core_ready, 0);
}

{
  // Two different canonical Brands can have the same legacy target key/name.
  // The current Tenant's grant is not permission to reveal another Brand's
  // global metadata, and canonical-ID grants must retain exact identity.
  let queryIndex = 0;
  const pool = createPool((sql, params) => {
    queryIndex += 1;
    if (queryIndex === 1) {
      assert(sql.includes("m.tenant_id = ?"));
      assert.deepEqual(params, ["user-1", "workspace-1"]);
      return [[{
        workspace_id: "workspace-1", role: "owner", status: "active", workspace_status: "active",
      }], []];
    }
    if (queryIndex === 2) {
      assert(sql.includes("v_workspace_resource_grant_effective"));
      return [[
        { resource_ref: "brand:shared", permission: "view", source: "tenant-1", granted_at: "2026-10-15" },
        { resource_ref: "brand-uuid-tenant1", permission: "view", source: "tenant-1", granted_at: "2026-10-15" },
      ], []];
    }
    if (queryIndex === 3) {
      assert(sql.includes("FROM brands"));
      return [[
        {
          brand_id: "brand-uuid-tenant1", brand_name: "Shared",
          normalized_brand_name: "shared", target_key: "shared",
          brand_domain: "tenant1.example.test", base_url: "https://tenant1.example.test",
          status: "active", brand_core_ready: 1,
        },
        {
          brand_id: "brand-uuid-tenant2", brand_name: "Shared",
          normalized_brand_name: "shared", target_key: "shared",
          brand_domain: "private-tenant2.example.test",
          base_url: "https://private-tenant2.example.test",
          status: "active", brand_core_ready: 0,
        },
      ], []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0", id: 61, method: "tools/call",
      params: { name: "list_accessible_brands", arguments: { workspace_id: "workspace-1" } },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-token",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool,
    verifyAuthorization: validAuthorization,
    requestId: "request-ambiguous-brand-boundary",
  });
  assert.equal(queryIndex, 3);
  assert.equal(result.status, 200);
  assert.equal(result.body.result.structuredContent.ok, true);
  const brands = result.body.result.structuredContent.brands;
  assert.equal(brands.length, 2);
  const aliasGrant = brands.find((entry) => entry.brand_ref === "brand:shared");
  assert.equal(aliasGrant.brand_id, null);
  assert.equal(aliasGrant.brand_domain, null);
  assert.equal(aliasGrant.base_url, null);
  assert.equal(aliasGrant.identity_read_mode, "legacy_resource_ref_only");
  const exactGrant = brands.find((entry) => entry.brand_ref === "brand-uuid-tenant1");
  assert.equal(exactGrant.brand_id, "brand-uuid-tenant1");
  assert.equal(exactGrant.brand_domain, "tenant1.example.test");
  assert(!JSON.stringify(result.body).includes("private-tenant2.example.test"));
}

{
  // One user may be a member of Tenant A and B, but an OAuth grant that is
  // explicitly tenant:A must not enumerate or access Tenant B.
  const verifiedTenantA = () => ({
    ok: true,
    claims: {
      user_id: "user-1",
      tenant_id: "workspace-1",
      auth_mode: "remote_mcp_oauth_2_1",
      client_id: "mcp_stg_client-a",
    },
  });
  const tenantOnlyPool = createPool((sql, params) => {
    assert(sql.includes("FROM memberships m"));
    assert(sql.includes("AND m.tenant_id = ?"));
    assert.deepEqual(params, ["user-1", "workspace-1", 25]);
    return [[{
      workspace_id: "workspace-1",
      display_name: "Tenant A",
      role: "member",
      membership_status: "active",
      workspace_status: "active",
    }], []];
  });
  const workspaces = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0", id: 62, method: "tools/call",
      params: { name: "list_accessible_workspaces", arguments: {} },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-tenant-a-oauth",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool: tenantOnlyPool,
    verifyAuthorization: verifiedTenantA,
    requestId: "request-oauth-tenant-a-workspace-list",
  });
  assert.equal(workspaces.body.result.structuredContent.ok, true);
  assert.deepEqual(workspaces.body.result.structuredContent.workspaces.map((x) => x.workspace_id), ["workspace-1"]);

  // Deny before any DB access to the other workspace, including when
  // the same user has a separate active membership in Tenant B.
  let dbCalls = 0;
  const denied = await handleChatGptMcpRequest({
    body: {
      jsonrpc: "2.0", id: 63, method: "tools/call",
      params: { name: "list_accessible_brands", arguments: { workspace_id: "workspace-2" } },
    },
    headers: {
      ...transportHeaders,
      authorization: "Bearer test-tenant-a-oauth",
      "mcp-protocol-version": CHATGPT_MCP_PROTOCOL_VERSION,
    },
    env: enabledEnv,
    pool: createPool(() => { dbCalls += 1; throw new Error("Tenant B query must be denied"); }),
    verifyAuthorization: verifiedTenantA,
    requestId: "request-oauth-tenant-a-cross-tenant-denial",
  });
  assert.equal(dbCalls, 0);
  assert.equal(denied.body.result.isError, true);
  assert.equal(denied.body.result.structuredContent.error.code, "MCP_CONTEXT_DENIED");
  assert(!JSON.stringify(denied.body).includes("workspace-2"));
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
