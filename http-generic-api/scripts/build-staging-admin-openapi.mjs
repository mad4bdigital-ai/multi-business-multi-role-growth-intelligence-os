import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const here = path.dirname(new URL(import.meta.url).pathname);
const apiRoot = path.resolve(here, "..");
const sourcePath = path.join(apiRoot, "openapi", "openapi.custom-gpt.auth-dispatcher.yaml");
const targetPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.staging-admin.yaml");
const stagingHost = "https://dev.mad4b.com";
const forbiddenHosts = ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com", "activation-dev.mad4b.com"];
const allowedReadOnlyPaths = new Set([
  "/system/connectors",
  "/system/connectors/{system_id}",
  "/system/tools",
  "/system/tools/catalog-observability",
  "/system/tools/{toolName}",
  "/admin/system/connectors",
  "/admin/system/connectors/{system_id}",
  "/admin/system/tools",
  "/admin/apis-services/google-auth-platform",
  "/admin/apis-services/google-auth-platform/{tab}",
  "/admin/apis-services/credentials",
  "/gpt/tools",
  "/device/tools",
  "/admin/schema-import/jobs",
  "/admin/cli/data-source/census"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(message) {
  throw new Error(`STAGING_ADMIN_OPENAPI_FAIL_CLOSED: ${message}`);
}

function replaceStagingHosts(value) {
  if (typeof value === "string") {
    return value
      .replaceAll("https://auth.mad4b.com", stagingHost)
      .replaceAll("auth.mad4b.com", "dev.mad4b.com")
      .replaceAll("https://activation.mad4b.com", stagingHost)
      .replaceAll("activation.mad4b.com", "dev.mad4b.com")
      .replaceAll("https://mcp.mad4b.com", "https://mcp-dev.mad4b.com")
      .replaceAll("mcp.mad4b.com", "mcp-dev.mad4b.com")
      .replaceAll("activation-dev.mad4b.com", "dev.mad4b.com");
  }
  if (Array.isArray(value)) return value.map(replaceStagingHosts);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceStagingHosts(child)]));
  return value;
}

if (!fs.existsSync(sourcePath)) fail(`missing source schema: ${sourcePath}`);
const source = YAML.parse(fs.readFileSync(sourcePath, "utf8"));
const document = clone(source);
const paths = {};
for (const pathKey of allowedReadOnlyPaths) {
  const sourcePathDefinition = source.paths?.[pathKey];
  if (!sourcePathDefinition?.get) fail(`source schema is missing required GET path: ${pathKey}`);
  paths[pathKey] = { get: replaceStagingHosts(clone(sourcePathDefinition.get)) };
}

document.paths = paths;
document.servers = [{ url: stagingHost, description: "Staging Admin read-only Custom GPT surface" }];
const apiKeyScheme = {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "Staging Admin Custom GPT API key. Runtime still requires the admin-principal guard; no user or Production credential is accepted.",
};
document.components = {
  ...document.components,
  securitySchemes: { backendApiKeyAuth: clone(apiKeyScheme) },
};
document.security = [{ backendApiKeyAuth: [] }];
for (const operation of Object.values(document.paths).flatMap((methods) => Object.values(methods))) {
  operation.security = [{ backendApiKeyAuth: [] }];
}
document.info = {
  ...document.info,
  title: "Growth Intelligence Platform - Staging Admin Read-only Actions",
  version: "3.0.0-staging-admin",
  summary: "Independent Staging Admin Custom GPT/OpenAPI read-only contract.",
  description: "A separately generated Staging Admin schema. It has one server URI, advertises only GET operations, and is never paired with Production hosts or credentials. Admin writes remain shadow/blocked outside this read-only contract."
};
document["x-mad4b-environment"] = "staging";
document["x-mad4b-surface"] = "admin-custom-gpt-read-only";
document["x-mad4b-staging-boundary"] = {
  resource: stagingHost,
  server_uri_count: 1,
  authorization_mode: "backend_api_key_only",
  production_hosts_forbidden_policy: "http-generic-api/config/domain-family-policy.json",
  mutation_contract: "read_only_schema_only",
  admin_write_activation: false,
  remote_mcp_write_activation: false,
  database_mutation: false,
  secrets_included: false
};
document["x-staging-generation"] = {
  source_artifact: "http-generic-api/openapi/openapi.custom-gpt.auth-dispatcher.yaml",
  source_surface: "admin_core",
  path_policy: "GET_only_allowlist",
  allowed_paths: [...allowedReadOnlyPaths],
  secrets_included: false
};

const output = YAML.stringify(document, { lineWidth: -1, aliasDuplicateObjects: false });
if (!Array.isArray(document.servers) || document.servers.length !== 1 || document.servers[0]?.url !== stagingHost) {
  fail("generated schema must have exactly one dev server URI");
}
if ([...Object.values(document.paths)].some((methods) => Object.keys(methods).some((method) => method !== "get"))) {
  fail("generated Admin Staging schema contains a non-GET operation");
}
const securitySchemes = document.components?.securitySchemes || {};
if (Object.keys(securitySchemes).length !== 1 || !securitySchemes.backendApiKeyAuth) {
  fail("generated Admin Staging schema must expose exactly one security scheme: backendApiKeyAuth");
}
if (JSON.stringify(document.security) !== JSON.stringify([{ backendApiKeyAuth: [] }])) {
  fail("generated Admin Staging schema must use backendApiKeyAuth globally");
}
for (const operation of Object.values(document.paths).flatMap((methods) => Object.values(methods))) {
  if (JSON.stringify(operation.security) !== JSON.stringify([{ backendApiKeyAuth: [] }])) {
    fail("generated Admin Staging operations must use backendApiKeyAuth only");
  }
}
for (const host of forbiddenHosts) if (output.includes(host)) fail(`forbidden host leaked: ${host}`);
if (output.includes("CLOUDFLARE_TUNNEL_TOKEN") || output.includes("TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET")) fail("secret reference leaked into Admin schema");
fs.writeFileSync(targetPath, output, "utf8");
console.log(JSON.stringify({ ok: true, target: targetPath, server_uri: stagingHost, path_count: Object.keys(paths).length, method_policy: "GET_only", secrets_included: false }));
