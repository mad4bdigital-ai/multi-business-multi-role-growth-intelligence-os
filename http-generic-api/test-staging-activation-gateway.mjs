import assert from "node:assert/strict";
import express from "express";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.ACTIVATION_STAGING_GATEWAY_ENABLED = "true";
const { buildActivationHostGatewayRoutes } = await import("./routes/activationHostGatewayRoutes.js");

const app = express();
app.use(buildActivationHostGatewayRoutes({ enabled: true }));
app.use((req, res) => res.status(404).json({ ok: false, code: "downstream_not_reached" }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  const get = (path, host) => fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "x-forwarded-host": host },
  });
  const getWithHeaders = (path, headers) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const schema = await get("/openapi.tenant-gpt.activation.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(schema.status, 200);
  const schemaText = await schema.text();
  assert.match(schemaText, /https:\/\/activation-dev\.mad4b\.com/);
  assert.doesNotMatch(schemaText, /https:\/\/auth\.mad4b\.com|https:\/\/activation\.mad4b\.com/);
  const alternateHost = await getWithHeaders("/openapi.tenant-gpt.activation.staging.yaml", {
    "x-forwarded-host": "untrusted.invalid",
    "x-original-host": "activation-dev.mad4b.com",
  });
  assert.equal(alternateHost.status, 200, "gateway must choose the first trusted non-empty host candidate");
  const wrongHost = await get("/openapi.tenant-gpt.activation.staging.yaml", "dev.mad4b.com");
  assert.equal(wrongHost.status, 404);
  const forbidden = await get("/auth/login", "activation-dev.mad4b.com");
  assert.equal(forbidden.status, 404);
  const health = await get("/health", "activation-dev.mad4b.com");
  assert.equal(health.status, 404, "gateway must not impersonate app health without downstream route");
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("staging_activation_gateway=PASS");
