#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildMcpRoutes } from "./routes/mcpRoutes.js";

function middleware(_req, _res, next) {
  next();
}

let disabledPoolCalls = 0;
const disabledRouter = buildMcpRoutes({
  env: {
    REMOTE_MCP_ENABLED: "false",
    REMOTE_MCP_OAUTH_ENABLED: "false",
    REMOTE_MCP_OAUTH_DCR_ENABLED: "false"
  },
  getPool() {
    disabledPoolCalls += 1;
    throw new Error("disabled OAuth must not resolve the database pool during route construction");
  },
  requireMcpToken: middleware,
  requireMcpAcceptHeader: middleware
});

assert.ok(disabledRouter, "the MCP router should construct while OAuth is disabled");
assert.equal(disabledPoolCalls, 0, "disabled OAuth must not bootstrap the database dependency");

let enabledPoolCalls = 0;
const fakePool = {
  async query() {
    return [[]];
  },
  async getConnection() {
    throw new Error("not used during route construction");
  }
};
const enabledRouter = buildMcpRoutes({
  env: {
    REMOTE_MCP_ENABLED: "false",
    REMOTE_MCP_OAUTH_ENABLED: "true",
    REMOTE_MCP_OAUTH_DCR_ENABLED: "false"
  },
  getPool() {
    enabledPoolCalls += 1;
    return fakePool;
  },
  requireMcpToken: middleware,
  requireMcpAcceptHeader: middleware
});

assert.ok(enabledRouter, "the MCP router should construct when OAuth is enabled and a pool is available");
assert.equal(enabledPoolCalls, 1, "enabled OAuth should resolve its database pool exactly once during route construction");

console.log(JSON.stringify({
  ok: true,
  tests: 2,
  gate: "remote_mcp_disabled_startup_boundary",
  disabled_pool_resolution_count: disabledPoolCalls,
  enabled_pool_resolution_count: enabledPoolCalls,
  secrets_included: false
}));
