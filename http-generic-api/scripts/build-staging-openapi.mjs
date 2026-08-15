import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const source = path.join(apiRoot, "openapi", "openapi.tenant-gpt.auth.yaml");
const target = path.join(apiRoot, "openapi", "openapi.tenant-gpt.staging.yaml");
const productionHosts = [/https:\/\/auth\.mad4b\.com/gu, /https:\/\/activation\.mad4b\.com/gu];
const stagingHost = "https://dev.mad4b.com";
const BACKEND_ONLY_PATHS = new Set([
  "/local/tools",
  "/system/tools",
  "/system/tools/call",
  "/gpt/sessions/{id}/turn",
  "/gpt/sessions/{id}/end"
]);

function replaceHostname(value) {
  return String(value)
    .replaceAll("https://auth.mad4b.com", stagingHost)
    .replaceAll("https://activation.mad4b.com", stagingHost)
    .replaceAll("auth.mad4b.com", "dev.mad4b.com")
    .replaceAll("activation.mad4b.com", "dev.mad4b.com");
}

function replaceDeep(value) {
  if (typeof value === "string") {
    return replaceHostname(value);
  }
  if (Array.isArray(value)) return value.map(replaceDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [replaceHostname(key), replaceDeep(child)]));
  }
  return value;
}

if (!fs.existsSync(source)) throw new Error(`Missing generated Tenant Core source: ${source}`);
const document = replaceDeep(YAML.parse(fs.readFileSync(source, "utf8")));
for (const pathKey of BACKEND_ONLY_PATHS) delete document.paths?.[pathKey];
document.servers = [{ url: stagingHost, description: "Staging Tenant Core surface" }];
document.info = {
  ...document.info,
  title: "Growth Intelligence Platform - Staging Tenant Core Actions",
  summary: "Staging-only Tenant Core Custom GPT/OpenAPI actions.",
  description: "Staging artifact generated from the Tenant Core source artifact. It uses the dev.mad4b.com resource and must never be paired with a Production OAuth client or Production host."
};
document["x-mad4b-environment"] = "staging";
document["x-mad4b-staging-boundary"] = {
  resource: stagingHost,
  authorization_server: `${stagingHost}/auth/oauth`,
  client_id_env: "TENANT_GPT_STAGING_OAUTH_CLIENT_ID",
  client_secret_env: "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET",
  production_hosts_forbidden_policy: "http-generic-api/config/domain-family-policy.json",
  backend_only_paths_excluded: [...BACKEND_ONLY_PATHS]
};
if (document["x-gpt-action-auth-preset"]) {
  document["x-gpt-action-auth-preset"].authorization_url = `${stagingHost}/auth/oauth/authorize`;
  document["x-gpt-action-auth-preset"].token_url = `${stagingHost}/auth/oauth/token`;
  document["x-gpt-action-auth-preset"].client_id = "<TENANT_GPT_STAGING_OAUTH_CLIENT_ID>";
  document["x-gpt-action-auth-preset"].client_secret = "<TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET>";
  document["x-gpt-action-auth-preset"].client_secret_ref = "env:TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET";
}
document["x-staging-generation"] = {
  source_artifact: "http-generic-api/openapi/openapi.tenant-gpt.auth.yaml",
  production_replacement_policy: "auth_and_activation_hosts_rewritten_to_dev",
  secrets_included: false
};
const output = YAML.stringify(document, { lineWidth: -1, aliasDuplicateObjects: false });
const forbiddenMatches = ["auth.mad4b.com", "activation.mad4b.com", "mcp.mad4b.com"].filter((host) => output.includes(host));
if (productionHosts.some((pattern) => pattern.test(output)) || forbiddenMatches.length > 0) {
  throw new Error(`Staging OpenAPI artifact contains forbidden Production hostnames: ${forbiddenMatches.join(",")}`);
}
fs.writeFileSync(target, output, "utf8");
console.log(`Generated ${target}`);
