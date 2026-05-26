import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/openapi-route-coverage.mjs", "utf8");
const allowlist = JSON.parse(readFileSync("openapi-route-coverage.allowlist.json", "utf8"));

assert(script.includes("openapi_route_coverage_failed"), "route coverage script must fail with a structured error code");
assert(script.includes("openapi.yaml"), "route coverage script must compare against main OpenAPI");
assert(Array.isArray(allowlist.required_files), "allowlist must define required_files array");
assert(allowlist.required_files.includes("routes/platformPluginRoutes.js"), "stage 1 coverage must include Platform Plugin routes");

const output = execFileSync(process.execPath, ["scripts/openapi-route-coverage.mjs"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const result = JSON.parse(output.trim());
assert.equal(result.ok, true);
assert(result.route_count > 0, "route coverage guard must inspect Express routes");
assert(result.openapi_operation_count > 0, "route coverage guard must inspect openapi.yaml operations");
assert(Array.isArray(result.coverage_scope), "route coverage result must include active coverage scope");

console.log("openapi route coverage tests passed");
