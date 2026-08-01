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

async function getMetadata(baseUrl, host) {
  const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`, {
    headers: { "x-forwarded-host": host },
  });
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control") || "",
    body: await response.json(),
  };
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
    const mcp = await getMetadata(baseUrl, "mcp.example.test");
    assert.equal(mcp.status, 200);
    assert.equal(mcp.body.resource, "https://mcp.example.test");
    assert.deepEqual(mcp.body.authorization_servers, ["https://auth.example.test"]);
    assert.deepEqual(mcp.body.scopes_supported, ["workspaces.read", "brands.read"]);
    assert.deepEqual(mcp.body.bearer_methods_supported, ["header"]);
    assert(mcp.cacheControl.includes("max-age=300"));

    const activation = await getMetadata(baseUrl, "activation.mad4b.com");
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
    const disabled = await getMetadata(baseUrl, "mcp.example.test");
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.error.code, "MCP_DISABLED");
    assert.equal(disabled.body.secrets_included, false);

    const activation = await getMetadata(baseUrl, "activation.mad4b.com");
    assert.equal(activation.status, 200);
    assert.equal(activation.body.resource, "https://activation.mad4b.com");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

console.log("chatgpt MCP metadata routing tests passed");
