import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";

const routes = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const facade = fs.readFileSync(new URL("./platformEndpointToolFacade.js", import.meta.url), "utf8");
const openapiSource = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const openapi = YAML.parse(openapiSource);

const platformDiscoveryBlock = routes.match(
  /async function listPlatformEndpointToolsForPrincipal[\s\S]*?function isTenantRegistryToolAllowedInSystemFacade/u,
)?.[0] || "";
assert(platformDiscoveryBlock, "platform endpoint tool discovery block must exist");
assert.match(platformDiscoveryBlock, /platformEndpointToolScopeClassesForPrincipal\(auth\)/u);
assert.match(platformDiscoveryBlock, /platformEndpointToolTenantClauseForPrincipal\(auth, "x"\)/u);
assert.match(platformDiscoveryBlock, /x\.scope_class IN \(\?, \?\)/u);
assert.match(platformDiscoveryBlock, /isAdminPrincipal\(auth\) \|\| !TENANT_BLOCKED_SYSTEM_TOOL_NAMES\.has\(row\.tool_name\)/u);
assert.match(platformDiscoveryBlock, /buildPlatformEndpointToolDescriptors\(visibleRows/u);
assert.match(platformDiscoveryBlock, /normalizeInputSchema: normalizePlatformEndpointInputSchema/u);
assert.doesNotMatch(platformDiscoveryBlock, /\.map\(\(row\) => \(\{[\s\S]*?name: row\.tool_name/u);

const platformBindingBlock = routes.match(
  /async function callPlatformEndpointToolIfAvailable[\s\S]*?async function callTenantEndpointRegistryToolIfAvailable/u,
)?.[0] || "";
assert(platformBindingBlock, "platform endpoint tool dispatch block must exist");
assert.match(platformBindingBlock, /TENANT_BLOCKED_SYSTEM_TOOL_NAMES\.has/u);
assert.match(platformBindingBlock, /platformEndpointToolScopeClassesForPrincipal\(auth\)/u);
assert.match(platformBindingBlock, /platformEndpointToolTenantClauseForPrincipal\(auth, "x"\)/u);
assert.match(
  platformBindingBlock,
  /ORDER BY x\.endpoint_key, x\.parent_action_key\s+LIMIT 200`/u,
  "platform endpoint binding lookup must load the bounded ordered candidate set",
);
assert.match(platformBindingBlock, /selectPlatformEndpointToolBinding\(rows, args, name\)/u);
assert.match(platformBindingBlock, /row\.scope_class === "admin" && !isAdminPrincipal\(auth\)/u);
assert.doesNotMatch(platformBindingBlock, /LIMIT 2`/u);
assert.doesNotMatch(platformBindingBlock, /const row = rows\[0\]/u);
assert.doesNotMatch(platformBindingBlock, /if \(rows\.length > 1\)/u);

assert.match(facade, /platform_endpoint_tool_endpoint_key_required/u);
assert.match(facade, /platform_endpoint_tool_endpoint_key_unknown/u);
assert.match(facade, /platform_endpoint_tool_binding_ambiguous/u);
assert.match(facade, /if \(selected\.length !== 1\)/u);
assert.match(facade, /if \(candidates\.length === 1\)/u);

const errorBlock = routes.match(
  /function sendError\(res, err, fallbackCode\)[\s\S]*?export function buildSystemLayerRoutes/u,
)?.[0] || "";
assert(errorBlock, "system-layer structured error block must exist");
assert.match(errorBlock, /err\?\.details !== undefined/u, "selection error details must reach Admin and Tenant callers");

const connectorGetBlock = routes.match(
  /async function getConnectorRegistrySystem[\s\S]*?function clampDriveToolLimit/u,
)?.[0] || "";
assert(connectorGetBlock, "connector registry exact-read block must exist");
assert.match(connectorGetBlock, /WHERE cs\.system_id = \?[\s\S]*?LIMIT 2`/u);
assert.match(connectorGetBlock, /connector_system_ambiguous/u);
assert.doesNotMatch(connectorGetBlock, /const row = rows\[0\]/u);

const systemIdSchemas = [];
function collectSystemIdSchemas(value) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && Object.hasOwn(value, "system_id")) {
    systemIdSchemas.push(value.system_id);
  }
  for (const nested of Object.values(value)) collectSystemIdSchemas(nested);
}
collectSystemIdSchemas(openapi);

assert(systemIdSchemas.length > 0, "runtime OpenAPI must expose at least one system_id schema");
assert(
  systemIdSchemas.every((schema) => schema?.default !== "98d6a18b-5578-11f1-9baf-8e76a7e1749f"),
  "runtime OpenAPI must not embed a fixed platform system identifier",
);
assert(
  systemIdSchemas.some((schema) =>
    schema?.type === "string"
    && String(schema?.description || "").startsWith("Governed connected-system registry identifier")
  ),
  "runtime OpenAPI must preserve the governed connected-system identifier contract",
);

console.log("Spec 013 runtime ratchet contract tests passed");
