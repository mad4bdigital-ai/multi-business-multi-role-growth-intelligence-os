import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

const [routesIndex, consoleRoutes, consoleService, openapi, migration] = await Promise.all([
  read("routes/index.js"),
  read("routes/operationalConsoleRoutes.js"),
  read("operationalConsoleService.js"),
  read("openapi.yaml"),
  read("migrations/306_sprint69_operational_console_api.sql"),
]);

assert.match(routesIndex, /buildOperationalConsoleRoutes/, "operational console routes must be imported and mounted");
assert.match(consoleRoutes, /\/operational\/console/, "operational console route must exist");
assert.match(consoleRoutes, /\/operational\/console\/evidence/, "operational console evidence route must exist");
assert.match(consoleService, /getRuntimeParity/, "console must include runtime parity");
assert.match(consoleService, /buildActivationHardRunSummary/, "console must include activation summary");
assert.match(consoleService, /activation_operational_tile_registry/, "console must read operational tiles");
assert.match(consoleService, /activation_callback_registry/, "console must read callbacks");
assert.match(consoleService, /runtime_gap_remediation_registry/, "console must include remediation runbooks");
assert.match(consoleService, /activation_freshness_policy_registry/, "console must include freshness policies");
assert.match(consoleService, /SENSITIVE_KEY_PATTERN/, "console must strip sensitive keys");
assert.match(consoleService, /secrets_included: false/, "console must declare secret-safe output");
assert.match(openapi, /operationId: getOperationalConsole/, "OpenAPI must document console overview");
assert.match(openapi, /operationId: getOperationalConsoleEvidence/, "OpenAPI must document console evidence");
assert.match(openapi, /OperationalConsoleResponse/, "OpenAPI must include OperationalConsoleResponse schema");
assert.match(migration, /operational_console_read_api/, "migration must seed admin tool for console readback");
assert.match(migration, /operational_console_overview/, "migration must seed dashboard tile");

console.log("operational console contract tests passed");
