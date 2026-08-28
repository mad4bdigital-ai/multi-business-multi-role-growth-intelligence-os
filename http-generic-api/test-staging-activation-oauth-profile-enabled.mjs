import assert from "node:assert/strict";
import express from "express";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.ACTIVATION_STAGING_GATEWAY_ENABLED = "true";
process.env.TENANT_GPT_STAGING_ACTIVATION_RESOURCE_URL = "https://activation-dev.mad4b.com";
process.env.TENANT_GPT_STAGING_ACTIVATION_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";

const profile = await import("./tenantGptOAuthResourceProfile.js");
const preset = await import("./tenantGptOAuthPreset.js");
const { buildTenantGptOAuthMetadataRoutes } = await import("./routes/tenantGptOAuthMetadataRoutes.js");

assert.equal(preset.TENANT_GPT_IS_STAGING_RUNTIME, true);
assert.equal(profile.TENANT_GPT_CORE_RESOURCE, "https://dev.mad4b.com");
assert.equal(profile.TENANT_GPT_AUTHORIZATION_SERVER, "https://dev.mad4b.com");
assert.equal(profile.TENANT_GPT_ACTIVATION_RESOURCE, "https://activation-dev.mad4b.com");
assert.equal(profile.TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER, "https://dev.mad4b.com");
assert.equal(profile.resolveTenantGptOAuthIssuer(profile.TENANT_GPT_CORE_RESOURCE), "https://dev.mad4b.com");
assert.equal(profile.resolveTenantGptOAuthIssuer(profile.TENANT_GPT_ACTIVATION_RESOURCE), "https://dev.mad4b.com");

const app = express();
app.use(buildTenantGptOAuthMetadataRoutes({ env: process.env, getPool: () => null }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  const headers = (host) => ({ "x-forwarded-host": host });
  const activationAuthorization = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`, { headers: headers("activation-dev.mad4b.com") });
  assert.equal(activationAuthorization.status, 200);
  const activationAuthorizationBody = await activationAuthorization.json();
  assert.equal(activationAuthorizationBody.issuer, "https://dev.mad4b.com");
  assert.equal(activationAuthorizationBody.authorization_endpoint, "https://dev.mad4b.com/auth/oauth/authorize");
  assert.equal(activationAuthorizationBody.token_endpoint, "https://dev.mad4b.com/auth/oauth/token");
  assert.equal(activationAuthorizationBody["x-mad4b-oauth-compatibility"]?.profile, "tenant_activation");
  assert.equal(activationAuthorizationBody["x-mad4b-oauth-compatibility"]?.resource, "https://activation-dev.mad4b.com");

  const activationProtected = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`, { headers: headers("activation-dev.mad4b.com") });
  assert.equal(activationProtected.status, 200);
  const activationProtectedBody = await activationProtected.json();
  assert.equal(activationProtectedBody.resource, "https://activation-dev.mad4b.com");
  assert.deepEqual(activationProtectedBody.authorization_servers, ["https://dev.mad4b.com"]);

  const coreAuthorization = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`, { headers: headers("dev.mad4b.com") });
  assert.equal(coreAuthorization.status, 200);
  const coreAuthorizationBody = await coreAuthorization.json();
  assert.equal(coreAuthorizationBody.issuer, "https://dev.mad4b.com");
  assert.equal(coreAuthorizationBody["x-mad4b-oauth-compatibility"]?.profile, "tenant_core");

  const unknown = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`, { headers: headers("mcp_dev.mad4b.com") });
  assert.equal(unknown.status, 404);
} finally {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

console.log("staging_activation_oauth_profile_enabled=PASS");
