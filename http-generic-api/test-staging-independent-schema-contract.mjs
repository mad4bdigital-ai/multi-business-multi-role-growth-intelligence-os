import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import YAML from "yaml";

process.env.DEPLOYMENT_ENVIRONMENT = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.NODE_ENV = "staging";
process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID = "mad4b-tenant-gpt-staging";
process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_RESOURCE_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_ACTIVATION_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com";
process.env.TENANT_GPT_STAGING_ACTIVATION_RESOURCE_URL = "https://activation-dev.mad4b.com";
process.env.REMOTE_MCP_RESOURCE_URL = "https://mcp_dev.mad4b.com";
process.env.REMOTE_MCP_AUTHORIZATION_SERVER_URL = "https://dev.mad4b.com/auth/mcp";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));
const parseYaml = (relative) => YAML.parse(read(relative));

const stagingContract = readJson("http-generic-api/config/host-breakglass-staging-contract.json");
const breakglassCatalog = readJson("http-generic-api/config/host-breakglass-catalog.json");
assert.equal(stagingContract.execution_authority, "staging_local_windows_docker");
assert.equal(stagingContract.production_admin_execution.available, false);
assert.equal(stagingContract.local_connector.status, "deferred");
assert.equal(stagingContract.local_connector.required_for_production_reconstruction, false);
assert.equal(stagingContract.local_connector.required_for_staging_reconstruction, false);
assert.equal(stagingContract.local_connector.fallback_to_production_admin_path, false);
assert.equal(breakglassCatalog.production_reconstruction_authority.local_connector.required_for_production_reconstruction, false);
assert.equal(breakglassCatalog.production_reconstruction_authority.local_connector.fallback_to_local_connector_allowed, false);

const productionAuthDispatcher = read("http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.production.yaml");
assert.doesNotMatch(productionAuthDispatcher, /host_local_role_inspection_dry_run|production_activation_readiness_probe|admin\/recovery\/kernel/u);
const privateRecoveryProduction = read("http-generic-api/openapi/openapi.custom-gpt.recovery-admin.production.yaml");
assert.match(privateRecoveryProduction, /host_local_role_env|database_full_inspection|production_activation_readiness/u);
assert.doesNotMatch(privateRecoveryProduction, /https:\/\/dev\.mad4b\.com/u);

const schemaDefinitions = [
  { name: "tenant_core", file: "http-generic-api/openapi/openapi.tenant-gpt.auth.staging.yaml", host: "https://dev.mad4b.com" },
  { name: "admin_core", file: "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.staging.yaml", host: "https://dev.mad4b.com" },
  { name: "tenant_activation", file: "http-generic-api/openapi/openapi.tenant-gpt.activation.staging.yaml", host: "https://activation-dev.mad4b.com", registration_set: "tenant_activation_staging" },
  { name: "admin_activation", file: "http-generic-api/openapi/openapi.custom-gpt.activation-admin.staging.yaml", host: "https://activation-dev.mad4b.com", registration_set: "admin_activation_staging" },
  { name: "remote_mcp", file: "http-generic-api/openapi/openapi.remote-mcp.staging.yaml", host: "https://mcp_dev.mad4b.com", surface: "remote-mcp" },
];
const forbiddenProductionHost = /https:\/\/(?:auth|activation|mcp)\.mad4b\.com(?:\/(?!scopes\/)|$)/u;
for (const definition of schemaDefinitions) {
  const document = parseYaml(definition.file);
  assert.equal(document.servers?.length, 1, `${definition.name} schema must have exactly one server`);
  assert.equal(document.servers[0]?.url, definition.host, `${definition.name} server URI mismatch`);
  if (definition.surface) {
    assert.equal(document["x-mad4b-environment"], "staging");
    assert.equal(document["x-mad4b-surface"], definition.surface);
  } else {
    assert.equal(document["x-custom-gpt-generation"]?.environment, "staging");
    if (definition.registration_set) {
      assert.equal(document["x-mad4b-registration"]?.registration_set, definition.registration_set);
      assert.equal(document["x-mad4b-registration"]?.environment, "staging");
    }
  }
  if (document["x-mad4b-staging-boundary"]) assert.equal(document["x-mad4b-staging-boundary"]?.secrets_included, false);
  assert.doesNotMatch(read(definition.file), forbiddenProductionHost, `${definition.name} schema contains a Production host`);
}

const tenantCore = parseYaml(schemaDefinitions[0].file);
const tenantActivation = parseYaml(schemaDefinitions[2].file);
const adminCore = parseYaml(schemaDefinitions[1].file);
const adminActivation = parseYaml(schemaDefinitions[3].file);
const remoteMcp = parseYaml(schemaDefinitions[4].file);
const tenantToolScopes = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];
for (const [route, method] of [["/local/tools", "get"], ["/system/tools", "get"], ["/system/tools/call", "post"]]) {
  assert.deepEqual(tenantCore.paths?.[route]?.[method]?.security, [{ userBearerAuth: tenantToolScopes }]);
}
assert.ok(Object.keys(tenantCore.paths ?? {}).length > 0);
assert.ok(Object.keys(tenantActivation.paths ?? {}).length > 0);
assert.ok(Object.keys(adminCore.paths ?? {}).length > 0);
assert.ok(Object.keys(adminActivation.paths ?? {}).length > 0);
assert.ok(Object.keys(remoteMcp.paths ?? {}).includes("/mcp"));
assert.equal(adminActivation["x-mad4b-registration"]?.registration_set, "admin_activation_staging");
assert.equal(adminActivation["x-mad4b-registration"]?.audience, "admin_service");
assert.deepEqual(adminActivation["x-mad4b-registration"]?.members, ["activation_admin_staging", "admin_recovery_staging"]);
assert.equal(adminActivation["x-custom-gpt-generation"]?.operation_count, 12);
for (const pathname of ["/admin/recovery/staging/contract", "/admin/recovery/staging/readiness", "/admin/recovery/staging/certification"]) {
  assert.equal(adminActivation.paths[pathname]?.get?.["x-openai-isConsequential"], false, pathname);
  assert.equal(adminActivation.paths[pathname]?.get?.security?.[0]?.backendBearerAuth?.length, 0, pathname);
  assert.equal(adminActivation.paths[pathname]?.post, undefined, pathname);
}
assert.equal(tenantActivation["x-mad4b-registration"]?.registration_set, "tenant_activation_staging");
assert.equal(tenantActivation["x-mad4b-registration"]?.audience, "tenant");
assert.equal(adminActivation.components?.securitySchemes?.backendBearerAuth?.scheme, "bearer");
assert.equal(remoteMcp["x-mad4b-staging-boundary"]?.write_activation, false);
assert.notEqual(tenantCore.info?.title, adminCore.info?.title);
assert.notEqual(adminCore.info?.title, adminActivation.info?.title);

const { buildRootDiscoveryRoutes } = await import("./routes/rootDiscoveryRoutes.js");
const app = express();
app.use(buildRootDiscoveryRoutes({ env: process.env }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  async function get(host, schema) {
    return fetch(`http://127.0.0.1:${port}/${schema}`, { headers: { "x-forwarded-host": host } });
  }
  for (const schema of ["openapi.tenant-gpt.auth.staging.yaml", "openapi.custom-gpt.auth-dispatcher.staging.yaml"]) {
    const response = await get("dev.mad4b.com", schema);
    assert.equal(response.status, 200, `dev must expose ${schema}`);
    assert.match(await response.text(), /https:\/\/dev\.mad4b\.com/u);
  }
  for (const schema of ["openapi.tenant-gpt.activation.staging.yaml", "openapi.custom-gpt.activation-admin.staging.yaml"]) {
    const response = await get("activation-dev.mad4b.com", schema);
    assert.equal(response.status, 200, `activation-dev must expose ${schema}`);
    assert.match(await response.text(), /https:\/\/activation-dev\.mad4b\.com/u);
  }
  const remoteResponse = await get("mcp_dev.mad4b.com", "openapi.remote-mcp.staging.yaml");
  assert.equal(remoteResponse.status, 200);
  assert.match(await remoteResponse.text(), /https:\/\/mcp_dev\.mad4b\.com/u);
  for (const [host, schema] of [
    ["dev.mad4b.com", "openapi.tenant-gpt.activation.staging.yaml"],
    ["dev.mad4b.com", "openapi.custom-gpt.activation-admin.staging.yaml"],
    ["activation-dev.mad4b.com", "openapi.tenant-gpt.auth.staging.yaml"],
    ["activation-dev.mad4b.com", "openapi.custom-gpt.auth-dispatcher.staging.yaml"],
    ["mcp_dev.mad4b.com", "openapi.custom-gpt.activation-admin.staging.yaml"],
  ]) {
    const response = await get(host, schema);
    assert.equal(response.status, 404, `${host} must not expose ${schema}`);
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

console.log(JSON.stringify({
  ok: true,
  registration_graph: "admin_activation_staging_composite_plus_tenant_activation_staging",
  admin_activation_staging_server: "https://activation-dev.mad4b.com",
  admin_activation_staging_operation_count: 12,
  tenant_activation_staging_server: "https://activation-dev.mad4b.com",
  recovery_routes_embedded_get_only: true,
  production_recovery_surface_standalone: true,
  discovery_isolation: true,
  production_hosts_included: false,
  secrets_included: false,
}));
