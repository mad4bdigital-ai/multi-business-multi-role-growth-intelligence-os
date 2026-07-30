import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const openapi = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

const platformBindingBlock = routes.match(
  /async function callPlatformEndpointToolIfAvailable[\s\S]*?async function callTenantEndpointRegistryToolIfAvailable/u,
)?.[0] || "";
assert(platformBindingBlock, "platform endpoint tool dispatch block must exist");
assert.match(platformBindingBlock, /LIMIT 2`/u, "platform endpoint binding lookup must read enough rows to prove uniqueness");
assert.match(platformBindingBlock, /platform_endpoint_tool_binding_ambiguous/u);
assert.doesNotMatch(platformBindingBlock, /const row = rows\[0\]/u);

const connectorGetBlock = routes.match(
  /async function connectorRegistryGet[\s\S]*?async function activationDriveProbe/u,
)?.[0] || "";
assert(connectorGetBlock, "connector registry exact-read block must exist");
assert.match(connectorGetBlock, /WHERE cs\.system_id = \?[\s\S]*?LIMIT 2`/u);
assert.match(connectorGetBlock, /connector_system_ambiguous/u);
assert.doesNotMatch(connectorGetBlock, /const row = rows\[0\]/u);

assert.doesNotMatch(
  openapi,
  /system_id:\s*\{\s*type:\s*string,\s*default:\s*"98d6a18b-5578-11f1-9baf-8e76a7e1749f"\s*\}/u,
  "runtime OpenAPI must not embed a fixed platform system identifier",
);
assert.match(
  openapi,
  /system_id:\s*\{\s*type:\s*string,\s*description:\s*Governed connected-system registry identifier/u,
);

console.log("Spec 013 runtime ratchet contract tests passed");
