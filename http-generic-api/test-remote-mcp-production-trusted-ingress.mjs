import assert from "node:assert/strict";
import express from "express";
import { buildTenantGptOAuthMetadataRoutes } from "./routes/tenantGptOAuthMetadataRoutes.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function getJson(baseUrl, path, forwardedHost) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: forwardedHost ? { "x-forwarded-host": forwardedHost } : {},
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    REMOTE_MCP_ENVIRONMENT: "production",
    REMOTE_MCP_ENABLED: "true",
    REMOTE_MCP_OAUTH_ENABLED: "true",
    REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
    REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
    ...overrides,
  };
}

async function withMetadataServer(env, callback) {
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({ env }));
  const { server, baseUrl } = await startServer(app);
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

for (const overrides of [
  {},
  { REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true" },
  { REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true" },
]) {
  await withMetadataServer(productionEnv(overrides), async (baseUrl) => {
    const resource = await getJson(
      baseUrl,
      "/.well-known/oauth-protected-resource",
      "mcp.example.test",
    );
    assert.equal(resource.status, 503);
    assert.equal(resource.body.error.code, "TRUSTED_INGRESS_ATTESTATION_REQUIRED");
    assert.equal(resource.body.trusted_ingress.production_like, true);
    assert.equal(resource.body.trusted_ingress.ready, false);

    const authorization = await getJson(
      baseUrl,
      "/.well-known/oauth-authorization-server/auth/mcp",
      "auth.example.test",
    );
    assert.equal(authorization.status, 503);
    assert.equal(authorization.body.error.code, "TRUSTED_INGRESS_ATTESTATION_REQUIRED");
  });
}

await withMetadataServer(productionEnv({
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
}), async (baseUrl) => {
  const resource = await getJson(
    baseUrl,
    "/.well-known/oauth-protected-resource",
    "mcp.example.test",
  );
  assert.equal(resource.status, 200);
  assert.equal(resource.body.resource, "https://mcp.example.test");
  assert.deepEqual(resource.body.authorization_servers, ["https://auth.example.test/auth/mcp"]);
  assert.equal(resource.body.trusted_ingress.ready, true);
  assert.equal(resource.body.trusted_ingress.production_like, true);

  const authorization = await getJson(
    baseUrl,
    "/.well-known/oauth-authorization-server/auth/mcp",
    "auth.example.test",
  );
  assert.equal(authorization.status, 200);
  assert.equal(authorization.body.issuer, "https://auth.example.test/auth/mcp");
  assert.equal(authorization.body.authorization_endpoint, "https://auth.example.test/auth/mcp/oauth/authorize");
  assert.equal(authorization.body.token_endpoint, "https://auth.example.test/auth/mcp/oauth/token");
  assert.equal(authorization.body.trusted_ingress.ready, true);

  const wrongResourceHost = await getJson(
    baseUrl,
    "/.well-known/oauth-protected-resource",
    "auth.example.test",
  );
  assert.equal(wrongResourceHost.status, 404);
  assert.equal(wrongResourceHost.body.error.code, "OAUTH_RESOURCE_NOT_FOUND");

  const wrongAuthorizationHost = await getJson(
    baseUrl,
    "/.well-known/oauth-authorization-server/auth/mcp",
    "mcp.example.test",
  );
  assert.equal(wrongAuthorizationHost.status, 404);
  assert.equal(wrongAuthorizationHost.body.error.code, "MCP_AUTHORIZATION_SERVER_NOT_FOUND");
});

console.log(JSON.stringify({
  ok: true,
  gate: "remote_mcp_production_trusted_ingress",
  production_fail_closed: true,
  protected_resource_guarded: true,
  authorization_server_guarded: true,
  canonical_host_enforced: true,
  secrets_included: false,
}));
