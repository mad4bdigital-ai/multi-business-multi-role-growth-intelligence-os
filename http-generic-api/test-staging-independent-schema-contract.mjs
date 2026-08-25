import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import YAML from "yaml";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID = "mad4b-tenant-gpt-staging";
process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_RESOURCE_URL = "https://dev.mad4b.com";
process.env.REMOTE_MCP_RESOURCE_URL = "https://mcp_dev.mad4b.com";
process.env.REMOTE_MCP_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com/auth/mcp";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const stagingAuthDispatcher = read("http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml");
assert.doesNotMatch(stagingAuthDispatcher, /host_local_role_env|host_local_role_inspection_dry_run|production_activation_readiness_probe|admin\/recovery\/kernel/u, "Staging OpenAPI must not advertise Production-only Recovery controls");
const productionAuthDispatcher = read("http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.production.yaml");
assert.doesNotMatch(productionAuthDispatcher, /host_local_role_inspection_dry_run|production_activation_readiness_probe|admin\/recovery\/kernel/u, "Shared Production Admin Core must not advertise the private Recovery surface");
const privateRecoveryProduction = read("http-generic-api/openapi/openapi.custom-gpt.recovery-admin.production.yaml");
assert.match(privateRecoveryProduction, /host_local_role_env|database_full_inspection|production_activation_readiness/u, "Private Production Recovery schema must expose the fixed read-only capabilities");
assert.doesNotMatch(privateRecoveryProduction, /https:\/\/dev\.mad4b\.com/u, "Private Production Recovery schema must not use a Staging host");
const schemaDefinitions = [
  {
    name: "tenant",
    file: "http-generic-api/openapi/openapi.tenant-gpt.staging.yaml",
    host: "https://dev.mad4b.com",
    surface: "tenant-custom-gpt",
  },
  {
    name: "admin",
    file: "http-generic-api/openapi/openapi.custom-gpt.staging-admin.yaml",
    host: "https://dev.mad4b.com",
    surface: "admin-custom-gpt-read-only",
  },
  {
    name: "remote_mcp",
    file: "http-generic-api/openapi/openapi.remote-mcp.staging.yaml",
    host: "https://mcp_dev.mad4b.com",
    surface: "remote-mcp",
  },
];
const forbidden = /https:\/\/(?:auth|mcp|activation)\.mad4b\.com(?:\/(?!scopes\/)|$)|activation-dev\.mad4b\.com/;
for (const definition of schemaDefinitions) {
  const document = YAML.parse(read(definition.file));
  assert.equal(document.servers?.length, 1, `${definition.name} schema must have exactly one server`);
  assert.equal(document.servers[0]?.url, definition.host, `${definition.name} server URI mismatch`);
  assert.equal(document["x-mad4b-environment"], "staging");
  assert.equal(document["x-mad4b-surface"], definition.surface);
  assert.equal(document["x-mad4b-staging-boundary"]?.server_uri_count, 1);
  assert.equal(document["x-mad4b-staging-boundary"]?.secrets_included, false);
  assert.doesNotMatch(read(definition.file), forbidden, `${definition.name} schema contains a forbidden production host`);
}

const tenant = YAML.parse(read(schemaDefinitions[0].file));
const tenantToolScopes = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];
for (const [route, method] of [["/local/tools", "get"], ["/system/tools", "get"], ["/system/tools/call", "post"]]) {
  assert.deepEqual(tenant.paths?.[route]?.[method]?.security, [{ userBearerAuth: tenantToolScopes }], `${method.toUpperCase()} ${route} must use the shared Tenant OAuth security contract`);
}
const admin = YAML.parse(read(schemaDefinitions[1].file));
const remoteMcp = YAML.parse(read(schemaDefinitions[2].file));
assert.ok(Object.keys(tenant.paths ?? {}).length > 0);
assert.ok(Object.keys(admin.paths ?? {}).length > 0);
assert.ok(Object.keys(remoteMcp.paths ?? {}).includes("/mcp"));
assert.ok(Object.values(admin.paths ?? {}).every((methods) => Object.keys(methods).every((method) => method === "get")), "Admin Staging schema must be GET-only");
assert.deepEqual(Object.keys(admin.components?.securitySchemes ?? {}), ["backendApiKeyAuth"], "Admin Staging schema must expose exactly one security scheme");
assert.deepEqual(admin.components.securitySchemes.backendApiKeyAuth, {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "Staging Admin Custom GPT API key. Runtime still requires the admin-principal guard; no user or Production credential is accepted."
});
assert.deepEqual(admin.security, [{ backendApiKeyAuth: [] }], "Admin Staging schema must use x-api-key globally");
assert.ok(Object.values(admin.paths ?? {}).every((methods) => methods.get?.security?.length === 1 && methods.get.security[0]?.backendApiKeyAuth), "Admin Staging operations must use the single x-api-key scheme");
assert.equal(remoteMcp["x-mad4b-staging-boundary"]?.write_activation, false);
assert.equal(admin["x-mad4b-staging-boundary"]?.admin_write_activation, false);
assert.notEqual(tenant.info?.title, admin.info?.title);
assert.notEqual(tenant.info?.title, remoteMcp.info?.title);
assert.notEqual(admin.info?.title, remoteMcp.info?.title);

const { buildRootDiscoveryRoutes } = await import("./routes/rootDiscoveryRoutes.js");
const app = express();
app.use(buildRootDiscoveryRoutes());
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  async function get(host, schema) {
    return fetch(`http://127.0.0.1:${port}/${schema}`, { headers: { "x-forwarded-host": host } });
  }
  for (const schema of ["openapi.tenant-gpt.staging.yaml", "openapi.custom-gpt.staging-admin.yaml"]) {
    const response = await get("dev.mad4b.com", schema);
    assert.equal(response.status, 200, `dev must expose ${schema}`);
    const body = await response.text();
    assert.match(body, /servers:/);
    assert.match(body, /https:\/\/dev\.mad4b\.com/);
  }
  const remoteResponse = await get("mcp_dev.mad4b.com", "openapi.remote-mcp.staging.yaml");
  assert.equal(remoteResponse.status, 200);
  assert.match(await remoteResponse.text(), /https:\/\/mcp_dev\.mad4b\.com/);
  for (const [host, schema] of [
    ["dev.mad4b.com", "openapi.remote-mcp.staging.yaml"],
    ["mcp_dev.mad4b.com", "openapi.tenant-gpt.staging.yaml"],
    ["mcp_dev.mad4b.com", "openapi.custom-gpt.staging-admin.yaml"],
  ]) {
    const response = await get(host, schema);
    assert.equal(response.status, 404, `${host} must not expose ${schema}`);
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log(JSON.stringify({
  ok: true,
  independent_schema_count: schemaDefinitions.length,
  tenant_server: "https://dev.mad4b.com",
  admin_server: "https://dev.mad4b.com",
  remote_mcp_server: "https://mcp_dev.mad4b.com",
  each_schema_has_one_server: true,
  discovery_isolation: true,
  production_hosts_included: false,
  shared_admin_recovery_leakage: false,
  private_production_recovery_surface: true,
}));
