#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  REMOTE_MCP_OAUTH_TABLES,
  REMOTE_MCP_SCOPE_CATALOG_TABLES,
  buildRemoteMcpReadiness,
} from "./remoteMcpReadiness.js";

function poolWithTables(tableNames) {
  return {
    async query(sql, params) {
      assert(String(sql).includes("information_schema.TABLES"));
        assert(params.length === REMOTE_MCP_OAUTH_TABLES.length || params.length === REMOTE_MCP_SCOPE_CATALOG_TABLES.length);
      return [tableNames.filter((TABLE_NAME) => params.includes(TABLE_NAME)).map((TABLE_NAME) => ({ TABLE_NAME }))];
    },
  };
}

const env = {
  REMOTE_MCP_ENABLED: "true",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
  REMOTE_MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://chatgpt.com",
  REMOTE_MCP_OAUTH_SIGNING_SECRET: "0123456789abcdef0123456789abcdef",
  JWT_SECRET: "different-platform-session-secret",
};

{
  const readiness = await buildRemoteMcpReadiness({
    env,
    pool: poolWithTables(REMOTE_MCP_OAUTH_TABLES),
  });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.runtime.resource, "https://mcp.example.test");
  assert.equal(readiness.runtime.resource_host, "mcp.example.test");
  assert.equal(readiness.runtime.authorization_server, "https://auth.example.test/auth/mcp");
  assert.equal(readiness.runtime.dcr_enabled, true);
  assert.equal(readiness.runtime.dcr_advertised, true);
  assert.equal(readiness.prerequisites.redirect_policy_ready, true);
  assert.equal(readiness.prerequisites.signing_secret_ready, true);
  assert.equal(readiness.prerequisites.persistence.ready, true);
  assert.equal(readiness.prerequisites.persistence.scope_catalog_ready, false);
  assert.equal(readiness.operational_ready, true);
  assert.equal(readiness.write_ready, false);
  assert.equal(readiness.registration_ready, true);
  assert.equal(readiness.secrets_included, false);
  assert.equal(JSON.stringify(readiness).includes(env.REMOTE_MCP_OAUTH_SIGNING_SECRET), false);
}

{
  const readiness = await buildRemoteMcpReadiness({
    env: {
      ...env,
      REMOTE_MCP_OAUTH_SIGNING_SECRET: "",
    },
    pool: poolWithTables(REMOTE_MCP_OAUTH_TABLES.slice(0, 2)),
  });
  assert.equal(readiness.prerequisites.signing_secret_ready, false);
  assert.equal(readiness.prerequisites.persistence.ready, false);
  assert.equal(readiness.prerequisites.persistence.tables.remote_mcp_oauth_grants, false);
  assert.equal(readiness.prerequisites.persistence.scope_catalog_ready, false);
  assert.equal(readiness.operational_ready, false);
  assert.equal(readiness.registration_ready, false);
  assert.equal(readiness.secrets_included, false);
}

{
  const readiness = await buildRemoteMcpReadiness({
    env,
    pool: poolWithTables([...REMOTE_MCP_OAUTH_TABLES, ...REMOTE_MCP_SCOPE_CATALOG_TABLES]),
  });
  assert.equal(readiness.prerequisites.persistence.scope_catalog_ready, true);
  assert.equal(readiness.write_ready, false, "shadow governance and unmapped routes must still block write readiness");
}

console.log(JSON.stringify({
  ok: true,
  gate: "remote_mcp_no_secret_readiness",
  persistence_tables_checked: REMOTE_MCP_OAUTH_TABLES.length,
  secrets_included: false,
}));
