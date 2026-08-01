import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { verifyRemoteMcpBearerAuthorization } from "./remoteMcpAccessTokenVerifier.js";

const env = {
  JWT_SECRET: "remote-mcp-verifier-test-secret",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
};

function token(overrides = {}) {
  return jwt.sign(
    {
      iss: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
      aud: env.REMOTE_MCP_RESOURCE_URL,
      azp: "mcp_client_1",
      client_id: "mcp_client_1",
      resource: env.REMOTE_MCP_RESOURCE_URL,
      sub: "tenant:workspace-1:user:user-1",
      user_id: "user-1",
      tenant_id: "workspace-1",
      scope: "workspaces.read brands.read",
      purpose: "remote_mcp_access",
      ...overrides,
    },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: 3600, jwtid: overrides.jti || "access-jti-1" },
  );
}

function activePool({ active = true } = {}) {
  return {
    async query(sql, params) {
      assert(String(sql).includes("FROM remote_mcp_oauth_grants"));
      assert.deepEqual(params, ["access-jti-1"]);
      return [active ? [{
        grant_id: "grant-1",
        access_jti: "access-jti-1",
        refresh_token_hash: "hash",
        client_id: "mcp_client_1",
        user_id: "user-1",
        tenant_id: "workspace-1",
        resource: env.REMOTE_MCP_RESOURCE_URL,
        scopes_json: JSON.stringify(["workspaces.read", "brands.read"]),
        status: "active",
        access_expires_at: new Date(Date.now() + 60000),
        refresh_expires_at: new Date(Date.now() + 3600000),
      }] : [], []];
    },
  };
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token()}`, {
    env,
    pool: activePool(),
    requiredScopes: ["brands.read"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.claims.user_id, "user-1");
  assert.equal(result.claims.client_id, "mcp_client_1");
  assert.equal(result.claims.auth_mode, "remote_mcp_oauth_2_1");
  assert.equal(result.grant.secrets_included, false);
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token({ scope: "workspaces.read" })}`, {
    env,
    pool: activePool(),
    requiredScopes: ["brands.read"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "MCP_SCOPE_INSUFFICIENT");
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token()}`, {
    env,
    pool: activePool({ active: false }),
    requiredScopes: ["workspaces.read"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_TOKEN_REVOKED");
}

{
  const wrongAudience = jwt.sign(
    {
      iss: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
      aud: "https://other.example.test",
      user_id: "user-1",
      client_id: "mcp_client_1",
      resource: "https://other.example.test",
      scope: "workspaces.read",
      purpose: "remote_mcp_access",
    },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: 3600, jwtid: "access-jti-1" },
  );
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${wrongAudience}`, {
    env,
    pool: activePool(),
    requiredScopes: ["workspaces.read"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_TOKEN_INVALID");
}

{
  const result = await verifyRemoteMcpBearerAuthorization("", { env, pool: activePool() });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_AUTH_REQUIRED");
}

console.log("remote MCP access token verifier tests passed");
