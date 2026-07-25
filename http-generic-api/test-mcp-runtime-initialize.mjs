import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMcpHandlers, mcpInitialize } from "./mcpRuntime.js";

// frontend-surface-operation: POST /mcp/initialize
// frontend-read-action-proof: POST /mcp/initialize

let payload = null;
const response = {
  json(value) {
    payload = value;
    return value;
  },
};
await mcpInitialize({}, response);
assert.equal(payload.protocolVersion, "2024-11-05");
assert.equal(payload.capabilities.tools.listChanged, true);
assert.equal(payload.serverInfo.name, "multi-business-growth-intelligence-os");

const handlers = buildMcpHandlers({});
assert.equal(handlers.mcpInitialize, mcpInitialize, "live MCP handler factory must bind the proven non-mutating initialize handler");

const routes = readFileSync("routes/mcpRoutes.js", "utf8");
assert(routes.includes('router.post("/mcp/initialize"'));
assert(routes.includes("requireMcpToken"));
assert(routes.includes("requireMcpAcceptHeader"));

console.log("MCP initialize tests passed");
