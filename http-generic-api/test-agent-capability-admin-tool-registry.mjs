import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/1007_sprint69_agent_capability_coverage_admin_tools.sql", "utf8");
const routes = readFileSync("routes/agentGovernanceRoutes.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

const tools = [
  ["agent_governance_logic_coverage", "GET", "/platform/agent-governance/logic-coverage"],
  ["agent_governance_engine_coverage", "GET", "/platform/agent-governance/engine-coverage"],
];

for (const [toolKey, method, path] of tools) {
  assert(migration.includes(`'${toolKey}'`), `missing admin tool migration row: ${toolKey}`);
  assert(migration.includes(`'${method}', '${path}'`), `migration method/path mismatch for ${toolKey}`);
  assert(routes.includes(`\"${path}\"`), `missing live route: ${path}`);
  assert(openapi.includes(`  ${path}:`), `missing OpenAPI path: ${path}`);
}

assert.equal((migration.match(/'agent_governance_(logic|engine)_coverage'/g) || []).length, 2);
assert(migration.includes("inventory alone is not reported as usage"));
assert(migration.includes("Textual references alone are not reported as usage"));
assert(migration.includes("never_retrieved"));
assert(migration.includes("verified"));
assert(migration.includes("additionalProperties',false"));
assert(migration.includes("ON DUPLICATE KEY UPDATE"));
assert(!migration.includes("client_secret"));
assert(!migration.includes("access_token"));

console.log("Agent capability Admin tool registry parity tests passed");
