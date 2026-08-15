import assert from "node:assert/strict";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID = "mad4b-tenant-gpt-staging";
process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_RESOURCE_URL = "https://dev.mad4b.com";
process.env.REMOTE_MCP_RESOURCE_URL = "https://mcp_dev.mad4b.com";
process.env.REMOTE_MCP_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com/auth/mcp";

const preset = await import("./tenantGptOAuthPreset.js");
const profile = await import("./tenantGptOAuthResourceProfile.js");
const clientConfig = await import("./tenantGptOAuthClientConfig.js");
const remoteMcp = await import("./remoteMcpOAuthProfile.js");

assert.equal(preset.TENANT_GPT_IS_STAGING_RUNTIME, true);
assert.equal(preset.TENANT_GPT_OAUTH_CLIENT_ID, "mad4b-tenant-gpt-staging");
assert.equal(preset.TENANT_GPT_BASE_URL, "https://dev.mad4b.com");
assert.deepEqual(preset.TENANT_GPT_SCOPE_LINKS, [
  "https://dev.mad4b.com/scopes/tenant.links",
  "https://dev.mad4b.com/scopes/tenant.status",
  "https://dev.mad4b.com/scopes/tenant.activation",
  "https://dev.mad4b.com/scopes/tenant.install",
  "https://dev.mad4b.com/scopes/tenant.system-tools",
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
  requestHost: "activation_dev.mad4b.com",
}).ok, false);
assert.equal(clientConfig.TENANT_GPT_OAUTH_CLIENT_SECRET_ENV, "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET");
assert.equal(clientConfig.TENANT_GPT_OAUTH_CLIENT_SECRET_REF, "platform_secret:TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET");
assert.equal(remoteMcp.resolveRemoteMcpOAuthResource(), "https://mcp_dev.mad4b.com");
assert.equal(remoteMcp.resolveRemoteMcpAuthorizationIssuer(), "https://dev.mad4b.com/auth/mcp");

console.log("staging_runtime_oauth_profile=PASS");
