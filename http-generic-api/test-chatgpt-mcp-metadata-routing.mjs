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

async function getJson(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    body: await response.json(),
  };
}

async function getProtectedResourceMetadata(baseUrl, host) {
  return getJson(baseUrl, "/.well-known/oauth-protected-resource", {
    "x-forwarded-host": host,
  });
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      CHATGPT_MCP_ENABLED: "true",
      CHATGPT_MCP_RESOURCE_URL: "https://mcp.example.test",
      CHATGPT_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const mcp = await getProtectedResourceMetadata(baseUrl, "mcp.example.test");
    assert.equal(mcp.status, 200);
    assert.equal(mcp.body.resource, "https://mcp.example.test");
    assert.deepEqual(mcp.body.authorization_servers, ["https://auth.example.test"]);
    assert.deepEqual(mcp.body.scopes_supported, ["workspaces.read", "brands.read"]);
    assert.deepEqual(mcp.body.bearer_methods_supported, ["header"]);
    assert(mcp.cacheControl.includes("max-age=300"));

    const activation = await getProtectedResourceMetadata(baseUrl, "activation.mad4b.com");
    assert.equal(activation.status, 200);
    assert.equal(activation.body.resource, "https://activation.mad4b.com");
    assert(activation.body.scopes_supported.includes("https://auth.mad4b.com/scopes/tenant.links"));
    assert.notDeepEqual(activation.body.scopes_supported, mcp.body.scopes_supported);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      CHATGPT_MCP_ENABLED: "false",
      CHATGPT_MCP_RESOURCE_URL: "https://mcp.example.test",
      CHATGPT_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const disabled = await getProtectedResourceMetadata(baseUrl, "mcp.example.test");
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.error.code, "MCP_DISABLED");
    assert.equal(disabled.body.secrets_included, false);

    const activation = await getProtectedResourceMetadata(baseUrl, "activation.mad4b.com");
    assert.equal(activation.status, 200);
    assert.equal(activation.body.resource, "https://activation.mad4b.com");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      REMOTE_MCP_OAUTH_ENABLED: "false",
      REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const disabled = await getJson(baseUrl, "/.well-known/oauth-authorization-server/auth/mcp");
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.error.code, "MCP_OAUTH_DISABLED");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      REMOTE_MCP_OAUTH_ENABLED: "true",
      REMOTE_MCP_OAUTH_DCR_ENABLED: "false",
      REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const metadata = await getJson(baseUrl, "/.well-known/oauth-authorization-server/auth/mcp");
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.issuer, "https://auth.example.test/auth/mcp");
    assert.equal(metadata.body.authorization_endpoint, "https://auth.example.test/auth/mcp/oauth/authorize");
    assert.equal(metadata.body.token_endpoint, "https://auth.example.test/auth/mcp/oauth/token");
    assert.equal(metadata.body.revocation_endpoint, "https://auth.example.test/auth/mcp/oauth/revoke");
    assert.equal(metadata.body.registration_endpoint, undefined);
    assert.deepEqual(metadata.body.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.body.scopes_supported, ["workspaces.read", "brands.read"]);
    assert(metadata.cacheControl.includes("max-age=300"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      REMOTE_MCP_OAUTH_ENABLED: "true",
      REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
      REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const metadata = await getJson(baseUrl, "/.well-known/oauth-authorization-server/auth/mcp");
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.registration_endpoint, undefined, "DCR must not be advertised without a usable redirect policy");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const app = express();
  app.use(buildTenantGptOAuthMetadataRoutes({
    env: {
      REMOTE_MCP_OAUTH_ENABLED: "true",
      REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
      REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://claude.ai",
      REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    },
  }));
  const { server, baseUrl } = await startServer(app);
  try {
    const metadata = await getJson(baseUrl, "/.well-known/oauth-authorization-server/auth/mcp");
    assert.equal(metadata.status, 200);
    assert.equal(metadata.body.registration_endpoint, "https://auth.example.test/auth/mcp/oauth/register");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

console.log("chatgpt MCP metadata routing tests passed");
