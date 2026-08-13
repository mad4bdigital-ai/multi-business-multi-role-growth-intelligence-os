import assert from "node:assert/strict";
import { buildTenantGptOperationalReadiness } from "./tenantGptOperationalReadiness.js";

const env = {
  NODE_ENV: "staging",
  REMOTE_MCP_ENVIRONMENT: "staging",
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
const readyPool = {
  async query(sql) {
    if (String(sql).includes("information_schema.tables")) return [[{ present: 1 }]];
    if (String(sql).includes("information_schema.statistics")) return [[{ index_count: 5 }]];
    throw new Error(`unexpected readiness query: ${sql}`);
  },
  async getConnection() {
    return { async beginTransaction() {}, async rollback() {}, release() {} };
  },
};
const refreshReady = await buildTenantGptOperationalReadiness({ env: { ...env, TENANT_GPT_REFRESH_TOKENS_ENABLED: "true" }, pool: readyPool });
assert.equal(refreshReady.refresh_readiness.ready, true);
assert.equal(refreshReady.refresh_readiness.migration_present, true);
assert.equal(refreshReady.refresh_readiness.indexes_present, true);
assert.equal(refreshReady.refresh_readiness.transaction_probe_ready, true);
assert.equal(readiness.checks.openapi_coverage_ready, true);
assert.equal(readiness.checks.mutation_governance_ready, false);
assert.ok(readiness.blocking_checks.includes("external_canary_ready"));
assert.ok(readiness.blocking_checks.includes("chatgpt_client_evidence_ready"));
assert.equal(readiness.openapi_mutation_registry.operation_count, 29);
assert.equal(readiness.openapi_mutation_registry.unbound_operation_count, 29);
assert.equal(readiness.openapi_mutation_registry.all_operations_accounted_for, true);
console.log("Tenant GPT operational readiness contract tests passed.");
