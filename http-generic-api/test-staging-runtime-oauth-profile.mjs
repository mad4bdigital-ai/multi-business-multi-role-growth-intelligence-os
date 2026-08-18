import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID = "mad4b-tenant-gpt-staging";
process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_RESOURCE_URL = "https://dev.mad4b.com";
process.env.REMOTE_MCP_RESOURCE_URL = "https://mcp_dev.mad4b.com";
process.env.REMOTE_MCP_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com/auth/mcp";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";

const preset = await import("./tenantGptOAuthPreset.js");
const profile = await import("./tenantGptOAuthResourceProfile.js");
const clientConfig = await import("./tenantGptOAuthClientConfig.js");
const remoteMcp = await import("./remoteMcpOAuthProfile.js");
const { buildTenantGptOAuthMetadataRoutes } = await import("./routes/tenantGptOAuthMetadataRoutes.js");

assert.equal(preset.TENANT_GPT_IS_STAGING_RUNTIME, true);
assert.equal(preset.TENANT_GPT_OAUTH_CLIENT_ID, "mad4b-tenant-gpt-staging");
assert.equal(preset.TENANT_GPT_BASE_URL, "https://dev.mad4b.com");
const stagingEnvTemplate = readFileSync(new URL("./.env.staging.example", import.meta.url), "utf8");
assert.match(stagingEnvTemplate, /^TENANT_GPT_STAGING_OAUTH_CLIENT_ID=mad4b-tenant-gpt-staging$/m);
assert.match(stagingEnvTemplate, /^TENANT_GPT_ACTIONS_CONFIDENTIAL_CLIENT_COMPAT_ENABLED=true$/m);
const stagingEnvKeys = [...stagingEnvTemplate.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]);
assert.equal(new Set(stagingEnvKeys).size, stagingEnvKeys.length);
assert.deepEqual(preset.TENANT_GPT_SCOPE_LINKS, [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
]);
assert.equal(profile.TENANT_GPT_AUTHORIZATION_SERVER, "https://dev.mad4b.com");
assert.equal(profile.TENANT_GPT_CORE_RESOURCE, "https://dev.mad4b.com");
assert.equal(profile.TENANT_GPT_ACTIVATION_RESOURCE, "");
assert.equal(profile.resolveTenantGptOAuthResourceProfile({
  clientId: "mad4b-tenant-gpt-staging",
  requestHost: "dev.mad4b.com",
  requestedResource: "https://dev.mad4b.com",
}).ok, true);
assert.equal(profile.resolveTenantGptOAuthResourceProfile({
  clientId: "mad4b-tenant-gpt-staging",
  requestHost: "activation-dev.mad4b.com",
}).ok, false);
assert.equal(clientConfig.TENANT_GPT_OAUTH_CLIENT_SECRET_ENV, "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET");
assert.equal(clientConfig.TENANT_GPT_OAUTH_CLIENT_SECRET_REF, "platform_secret:TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET");
assert.equal(remoteMcp.resolveRemoteMcpOAuthResource(), "https://mcp_dev.mad4b.com");
assert.equal(remoteMcp.resolveRemoteMcpAuthorizationIssuer(), "https://dev.mad4b.com/auth/mcp");

const { buildRootDiscoveryRoutes } = await import("./routes/rootDiscoveryRoutes.js");
const app = express();
app.use(buildRootDiscoveryRoutes());
app.use(buildTenantGptOAuthMetadataRoutes({ env: process.env, getPool: () => null }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  const stagingResponse = await fetch(`http://127.0.0.1:${port}/tenant-gpt/oauth-preset`, { headers: { "x-forwarded-host": "dev.mad4b.com" } });
  assert.equal(stagingResponse.status, 200);
  const stagingBody = await stagingResponse.json();
  assert.equal(stagingBody.preset.client_id, "mad4b-tenant-gpt-staging");
  assert.equal(stagingBody.preset.authorization_url, "https://dev.mad4b.com/auth/oauth/authorize");
  assert.equal(stagingBody.preset.token_url, "https://dev.mad4b.com/auth/oauth/token");

  const authorizationMetadataResponse = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`, { headers: { "x-forwarded-host": "dev.mad4b.com" } });
  assert.equal(authorizationMetadataResponse.status, 200);
  const authorizationMetadata = await authorizationMetadataResponse.json();
  assert.equal(authorizationMetadata.issuer, "https://dev.mad4b.com");
  assert.equal(authorizationMetadata.authorization_endpoint, "https://dev.mad4b.com/auth/oauth/authorize");
  assert.equal(authorizationMetadata.token_endpoint, "https://dev.mad4b.com/auth/oauth/token");
  assert.equal(authorizationMetadata["x-mad4b-oauth-compatibility"]?.environment, "staging");
  assert.equal(authorizationMetadata["x-mad4b-oauth-compatibility"]?.confidential_client_id, "mad4b-tenant-gpt-staging");

  const protectedResourceResponse = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`, { headers: { "x-forwarded-host": "dev.mad4b.com" } });
  assert.equal(protectedResourceResponse.status, 200);
  const protectedResource = await protectedResourceResponse.json();
  assert.equal(protectedResource.resource, "https://dev.mad4b.com");
  assert.deepEqual(protectedResource.authorization_servers, ["https://dev.mad4b.com"]);

  for (const host of ["mcp_dev.mad4b.com", "activation-dev.mad4b.com"]) {
    const blocked = await fetch(`http://127.0.0.1:${port}/tenant-gpt/oauth-preset`, { headers: { "x-forwarded-host": host } });
    assert.equal(blocked.status, 404, `preset must remain unavailable for ${host}`);
  }
} finally {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

console.log("staging_runtime_oauth_profile=PASS");
