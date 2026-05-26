import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/openapi-route-coverage.mjs", "utf8");
const allowlist = JSON.parse(readFileSync("openapi-route-coverage.allowlist.json", "utf8"));

assert(script.includes("openapi_route_coverage_failed"), "route coverage script must fail with a structured error code");
assert(script.includes("openapi.yaml"), "route coverage script must compare against main OpenAPI");
assert(Array.isArray(allowlist.prefixes), "allowlist must define prefixes array");
assert(Array.isArray(allowlist.exact), "allowlist must define exact array");
assert(Array.isArray(allowlist.files), "allowlist must define files array");

const output = execFileSync(process.execPath, ["scripts/openapi-route-coverage.mjs"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const result = JSON.parse(output.trim());
assert.equal(result.ok, true);
assert(result.route_count > 0, "route coverage guard must inspect Express routes");
assert(result.openapi_operation_count > 0, "route coverage guard must inspect openapi.yaml operations");

console.log("openapi route coverage tests passed");
