// frontend-surface-operation: DELETE /local-connector/uninstall
// Owns runtime guard discovery, canonical OpenAPI parity, and secret-rotation behavior.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import { parseRoutesFromFile } from "./scripts/frontend-surface-dispatch.mjs";

const source = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
const routeStart = source.indexOf('router.delete("/local-connector/uninstall"');
const routeEnd = source.indexOf("return router;", routeStart);
assert(routeStart >= 0 && routeEnd > routeStart, "local connector uninstall route must be present");

const route = source.slice(routeStart, routeEnd);

for (const expected of [
  "is_enabled = 0",
  "cf_token = NULL",
  "connector_secret = NULL",
  "connector_local_api_key = NULL",
  "updated_at = NOW()",
]) {
  assert(route.includes(expected), `uninstall must apply ${expected}`);
}

assert(
  route.includes("hasConnectorLocalApiKeyColumn(pool)") &&
    route.includes("localApiKeyColumnSupported") &&
    route.includes("secretAssignments"),
  "uninstall must clear the optional local API key through the schema compatibility guard",
);
assert(
  route.includes("disabled: true") && route.includes("rotated: true") && route.includes("secrets_included: false"),
  "uninstall response must report disable+rotation without returning secrets",
);
assert.doesNotMatch(
  route,
  /connector_secret\s*:\s*|cf_token\s*:\s*|connector_local_api_key\s*:\s*/,
  "uninstall response must not serialize connector secrets",
);

const discoveredUninstall = parseRoutesFromFile(
  source,
  "routes/localConnectorInstallRoutes.js",
).find((entry) => entry.signature === "DELETE /local-connector/uninstall");
assert(discoveredUninstall, "frontend surface discovery must include Local Connector uninstall");
assert.deepEqual(
  discoveredUninstall.route_guards,
  ["requireBackendApiKey"],
  "uninstall must expose only its real backend guard to runtime auth discovery",
);

const aliasSafetyRoutes = parseRoutesFromFile(`
  const adminGuard = requireAdminPrincipal || ((_req, _res, next) => next());
  const device = await requireFreshLocalManagerDeviceForPrivilegedInstaller(req);
  router.get("/admin/aliased", requireBackendApiKey, adminGuard, handler);
  router.delete("/local-connector/uninstall", requireBackendApiKey, async (_req, res) => res.json({ message: "device disabled" }));
`, "routes/aliasSafetyRoutes.js");
assert.deepEqual(
  aliasSafetyRoutes.find((entry) => entry.signature === "GET /admin/aliased")?.route_guards,
  ["requireAdminPrincipal", "requireBackendApiKey"],
  "middleware guard references must remain discoverable through aliases",
);
assert.deepEqual(
  aliasSafetyRoutes.find((entry) => entry.signature === "DELETE /local-connector/uninstall")?.route_guards,
  ["requireBackendApiKey"],
  "invoked guard results must not become file-global middleware aliases",
);

const uninstallOpenApi = YAML.parse(readFileSync("openapi/local-connector-uninstall.yaml", "utf8"));
const uninstallContract = uninstallOpenApi.paths["/local-connector/uninstall"].delete;
assert.deepEqual(
  uninstallContract.security,
  [{ backendBearerAuth: [] }, { backendApiKeyAuth: [] }],
  "canonical security must match requireBackendApiKey OR semantics",
);
assert.deepEqual(
  uninstallContract.requestBody.content["application/json"].schema.dependentRequired,
  { user_id: ["tenant_id"], tenant_id: ["user_id"] },
  "admin and service principal identifiers must be supplied as a pair",
);
assert.deepEqual(
  uninstallOpenApi.components.schemas.ErrorEnvelope.properties.error.required,
  ["code"],
  "the canonical error envelope must allow the runtime 404 response without a message",
);

console.log("local connector uninstall rotates secrets and canonical contract guard passed");
