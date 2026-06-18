import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  route.includes("disabled: true") &&
    route.includes("rotated: true") &&
    route.includes("secrets_included: false"),
  "uninstall response must report disable+rotation without returning secrets"
);

assert.doesNotMatch(
  route,
  /connector_secret\s*:\s*|cf_token\s*:\s*|connector_local_api_key\s*:\s*/,
  "uninstall response must not serialize connector secrets"
);

console.log("local connector uninstall rotates secrets guard passed");
