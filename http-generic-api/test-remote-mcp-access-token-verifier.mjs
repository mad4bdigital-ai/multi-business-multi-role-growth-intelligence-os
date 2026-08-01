import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { verifyRemoteMcpBearerAuthorization } from "./remoteMcpAccessTokenVerifier.js";

const env = {
  REMOTE_MCP_OAUTH_SIGNING_SECRET: "remote-mcp-verifier-test-secret-32",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
};

function token(overrides = {}) {
  const userId = overrides.user_id ?? "user-1";
  const tenantId = Object.prototype.hasOwnProperty.call(overrides, "tenant_id")
    ? overrides.tenant_id
    : "workspace-1";
  const clientId = overrides.client_id ?? "mcp_client_1";
  const subject = overrides.sub ?? (tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`);
  return jwt.sign(
    {
      azp: clientId,
      client_id: clientId,
      resource: env.REMOTE_MCP_RESOURCE_URL,
      sub: subject,
      user_id: userId,
      tenant_id: tenantId,
      scope: "workspaces.read brands.read",
      purpose: "remote_mcp_access",
      ...overrides,
    },
    env.REMOTE_MCP_OAUTH_SIGNING_SECRET,
    {
      algorithm: "HS256",
      issuer: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
      audience: env.REMOTE_MCP_RESOURCE_URL,
      expiresIn: 3600,
      jwtid: overrides.jti || "access-jti-1",
    },
  );
}

function activePool({ active = true, subjectActiveCount = 1, grant = {} } = {}) {
  return {
    async query(sqlValue, params) {
      const sql = String(sqlValue);
      if (sql.includes("FROM remote_mcp_oauth_grants")) {
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
          ...grant,
        }] : [], []];
      }
      if (sql.includes("FROM memberships m")) {
        assert(sql.includes("COUNT(*) AS active_count"));
        assert.deepEqual(params, ["user-1", "workspace-1"]);
        return [[{ active_count: subjectActiveCount }], []];
      }
      if (sql.includes("FROM users")) {
        assert(sql.includes("COUNT(*) AS active_count"));
        assert.deepEqual(params, ["user-1"]);
        return [[{ active_count: subjectActiveCount }], []];
      }
      throw new Error(`Unexpected verifier query: ${sql}`);
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
  assert.equal(result.claims.tenant_id, "workspace-1");
  assert.equal(result.claims.client_id, "mcp_client_1");
  assert.equal(result.claims.auth_mode, "remote_mcp_oauth_2_1");
  assert.equal(result.grant.tenant_id, "workspace-1");
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
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token()}`, {
    env,
    pool: activePool({ subjectActiveCount: 0 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "MCP_SUBJECT_INACTIVE");
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token()}`, {
    env,
    pool: activePool({ subjectActiveCount: 2 }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, "MCP_SUBJECT_INACTIVE");
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token({ tenant_id: "workspace-2" })}`, {
    env,
    pool: activePool(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_TOKEN_INVALID");
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token({ sub: "user:user-1" })}`, {
    env,
    pool: activePool(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_TOKEN_INVALID");
}

{
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token({ azp: "other-client" })}`, {
    env,
    pool: activePool(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_TOKEN_INVALID");
}

{
  const wrongAudience = jwt.sign(
    {
      azp: "mcp_client_1",
      client_id: "mcp_client_1",
      resource: "https://other.example.test",
      sub: "tenant:workspace-1:user:user-1",
      user_id: "user-1",
      tenant_id: "workspace-1",
      scope: "workspaces.read",
      purpose: "remote_mcp_access",
    },
    env.REMOTE_MCP_OAUTH_SIGNING_SECRET,
    {
      algorithm: "HS256",
      issuer: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
      audience: "https://other.example.test",
      expiresIn: 3600,
      jwtid: "access-jti-1",
    },
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
  const result = await verifyRemoteMcpBearerAuthorization(`Bearer ${token()}`, {
    env: { ...env, REMOTE_MCP_OAUTH_SIGNING_SECRET: "" },
    pool: activePool(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, "MCP_AUTH_UNAVAILABLE");
}

{
  const result = await verifyRemoteMcpBearerAuthorization("");
  assert.equal(result.ok, false);
  assert.equal(result.code, "MCP_AUTH_REQUIRED");
}

console.log("remote MCP access token verifier tests passed");
