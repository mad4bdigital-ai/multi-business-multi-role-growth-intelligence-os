import assert from "node:assert/strict";
import { buildTenantGptOperationalReadiness } from "./tenantGptOperationalReadiness.js";

const env = {
  NODE_ENV: "staging",
  REMOTE_MCP_ENVIRONMENT: "staging",
  DB_NAME: "tenant_gpt_runtime",
  DB_USER: "tenant_runtime_reader",
  MCP_RUNTIME_EXPECTED_SQL_ACCOUNT: "tenant_runtime_reader@localhost",
  JWT_SECRET: "jwt_secret_for_operational_readiness_32_chars",
  TENANT_GPT_SSO_SIGNING_SECRET: "sso_secret_for_operational_readiness_32_chars",
  TENANT_GPT_SSO_TRUST_BOUNDARY_ATTESTED: "true",
  ACTIVATION_GATEWAY_POLICY_ATTESTED: "true",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  TENANT_GPT_EXTERNAL_CANARY_PASSED: "false",
  TENANT_GPT_CHATGPT_CLIENT_EVIDENCE_PASSED: "false",
  TENANT_GPT_REFRESH_TOKENS_ENABLED: "false",
};
const readiness = await buildTenantGptOperationalReadiness({ env, pool: null });
assert.equal(readiness.ready, false);
assert.equal(readiness.production_allowed, false);
assert.equal(readiness.write_scopes_enabled, false);
assert.equal(readiness.migrations_applied, false);
assert.ok(readiness.blocking_checks.includes("refresh_ready"));
assert.equal(readiness.production_ready, false);
assert.equal(readiness.discovery_ready, true);
assert.equal(readiness.data_plane_ready, false);
assert.equal(readiness.oauth_token_ready, false);
assert.equal(readiness.mutation_governance_ready, false);
assert.deepEqual(readiness.readiness_domains.mutation_governance.blocking_checks, ["mutation_governance_ready"]);
const readyPool = {
  async query(sql) {
    if (String(sql).includes("SELECT DATABASE()")) return [[{current_database: "tenant_gpt_runtime",current_account: "tenant_runtime_reader@localhost"}]];
    if (String(sql).includes("information_schema.tables")) return [[{ present: 1 }]];
    if (String(sql).includes("information_schema.statistics")) return [[{ index_count: 5 }]];
    if (String(sql).includes("information_schema.columns")) return [[{ column_count: 1 }]];
    if (/SELECT `mcp_catalog_level` FROM `(admin_platform_endpoint_tools|tenant_platform_endpoint_tools)` LIMIT 0/u.test(String(sql))) return [[], []];
    throw new Error(`unexpected readiness query: ${sql}`);
  },
  async getConnection() {
    return {
      async query(sql, params) { return readyPool.query(sql, params); },
      async beginTransaction() {}, async rollback() {}, release() {},
    };
  },
};
const refreshReady = await buildTenantGptOperationalReadiness({ env: { ...env, TENANT_GPT_REFRESH_TOKENS_ENABLED: "true" }, pool: readyPool });
assert.equal(refreshReady.refresh_readiness.ready, true);
assert.equal(refreshReady.refresh_readiness.migration_present, true);
assert.equal(refreshReady.refresh_readiness.indexes_present, true);
assert.equal(refreshReady.refresh_readiness.transaction_probe_ready, true);
assert.equal(refreshReady.checks.mcp_catalog_schema_ready, true);
assert.equal(refreshReady.mcp_catalog_schema.identity.ok, true);
assert.equal(refreshReady.mcp_catalog_schema.identity.database_matches, true);
assert.equal(refreshReady.mcp_catalog_schema.identity.principal_matches, true);
const wrongDatabasePool = {
  ...readyPool,
  async getConnection() {
    const session = await readyPool.getConnection();
    return {
      ...session,
      async query(sql, params) {
        if (String(sql).includes("SELECT DATABASE()")) return [[{
          current_database: "wrong_database",
          current_account: "tenant_runtime_reader@localhost",
        }]];
        return session.query(sql, params);
      },
    };
  },
};
const wrongDatabase = await buildTenantGptOperationalReadiness({
  env: { ...env, TENANT_GPT_REFRESH_TOKENS_ENABLED: "true" },
  pool: wrongDatabasePool,
});
assert.equal(wrongDatabase.checks.mcp_catalog_schema_ready, false,
  "Metadata from the wrong Runtime DB must not approve Tenant data-plane readiness");
assert.equal(wrongDatabase.data_plane_ready, false);
assert.equal(wrongDatabase.mcp_catalog_schema.identity.database_matches, false);

assert.equal(refreshReady.data_plane_ready, true);
assert.equal(refreshReady.oauth_token_ready, true);
assert.equal(refreshReady.readiness_domains.data_plane.ready, true);
assert.equal(readiness.checks.openapi_coverage_ready, true);
assert.ok(readiness.blocking_checks.includes("mcp_catalog_schema_ready"));
assert.equal(readiness.checks.mutation_governance_ready, false);
assert.ok(readiness.blocking_checks.includes("external_canary_ready"));
assert.ok(readiness.blocking_checks.includes("chatgpt_client_evidence_ready"));
  assert.equal(readiness.openapi_mutation_registry.operation_count, 36);
  assert.equal(readiness.openapi_mutation_registry.unbound_operation_count, 36);
assert.equal(readiness.openapi_mutation_registry.all_operations_accounted_for, true);
console.log("Tenant GPT operational readiness contract tests passed.");
