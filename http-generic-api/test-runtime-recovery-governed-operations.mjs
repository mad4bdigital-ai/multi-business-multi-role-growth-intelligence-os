import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALLOWED_TABLE_OPERATIONS,
  CATALOG_MIGRATION,
  CATALOG_MIGRATION_SHA256,
  CATALOG_STATEMENT_COUNT,
  PHASES,
  VERIFICATION_ONLY_MIGRATIONS,
  WRITE_AUTHORITY_PROFILES,
  assertCatalogAuthorizationReadback,
  assertFinalReadbackPayloads,
  assertMigrationModeAllowed,
  assertOperatorAccountIdentity,
  buildTableScopedGrant,
  evaluatePrivilegeSnapshot,
  expectedConfirmation,
  resolveProfile,
} from "../.github/ops/runtime-recovery-governed-operations.mjs";

const workflow = readFileSync(new URL("../.github/workflows/github-repository-policy-1049-governed-rollout.yml", import.meta.url), "utf8");
const operator = readFileSync(new URL("../.github/ops/runtime-recovery-governed-operations.mjs", import.meta.url), "utf8");
const productionSha = "f".repeat(40);
const constitution = JSON.parse(readFileSync(new URL("./config/repository-governance-constitution.json", import.meta.url), "utf8"));
const derivedGovernance = JSON.parse(readFileSync(new URL("../.github/derived-state-governance.json", import.meta.url), "utf8"));

assert.equal(CATALOG_MIGRATION, "20260815_custom_gpt_mcp_catalog_levels.sql");
assert.equal(CATALOG_MIGRATION_SHA256, "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681");
assert.equal(CATALOG_STATEMENT_COUNT, 7);
assert.deepEqual(VERIFICATION_ONLY_MIGRATIONS.map((entry) => entry.statement_count), [3, 34]);
assert.deepEqual(ALLOWED_TABLE_OPERATIONS, ["SELECT", "INSERT", "UPDATE"]);
assert.equal(PHASES.length, 8);

assert.equal(expectedConfirmation("deploy_readiness"), "PLAN_PRODUCTION_RUNTIME_DEPLOY");
assert.equal(expectedConfirmation("deploy_apply", { productionSha }), `APPLY_PRODUCTION_RUNTIME_DEPLOY_${productionSha.toUpperCase()}`);
assert.equal(expectedConfirmation("migration_readiness"), "AUTHORIZE_GOVERNED_MIGRATION_20260815_CUSTOM_GPT_MCP_CATALOG_LEVELS");
assert.equal(expectedConfirmation("migration_apply"), "APPLY_20260815_CUSTOM_GPT_MCP_CATALOG_LEVELS");
assert.equal(expectedConfirmation("grant_apply", { profile: "session_continuity_writer" }), "APPLY_RUNTIME_WRITE_AUTHORITY_SESSION_CONTINUITY_WRITER");
assert.notEqual(expectedConfirmation("grant_readiness", { profile: "session_continuity_writer" }), expectedConfirmation("grant_apply", { profile: "session_continuity_writer" }));
assert.throws(() => expectedConfirmation("deploy_apply", { productionSha: "main" }), (error) => error.code === "RUNTIME_RECOVERY_INPUT_INVALID");

assert.equal(assertMigrationModeAllowed(CATALOG_MIGRATION, "apply"), true);
for (const migration of VERIFICATION_ONLY_MIGRATIONS) {
  assert.equal(assertMigrationModeAllowed(migration.migration, "dry_run"), true);
  assert.throws(() => assertMigrationModeAllowed(migration.migration, "apply"), (error) => error.code === "RUNTIME_RECOVERY_MIGRATION_APPLY_FORBIDDEN");
}
assert.throws(() => assertMigrationModeAllowed("unreviewed.sql", "dry_run"), (error) => error.code === "RUNTIME_RECOVERY_MIGRATION_NOT_ALLOWLISTED");

assert.deepEqual(resolveProfile("session_continuity_writer").tables, ["customer_sessions", "gpt_session_turns"]);
assert.deepEqual(resolveProfile("observability_sink_writer").tables, ["execution_log", "json_assets"]);
assert.deepEqual(resolveProfile("runtime_inventory_writer").tables, ["actions", "endpoints", "dynamic_audit_scheduler_runs", "openapi_endpoint_inventory_sync_runs"]);
assert.throws(() => resolveProfile("root_writer"), (error) => error.code === "RUNTIME_RECOVERY_WRITER_PROFILE_INVALID");

const grant = buildTableScopedGrant({ database: "growth_runtime", principal: "runtime_writer", accountHost: "%", table: "customer_sessions" });
assert.equal(grant, "GRANT SELECT, INSERT, UPDATE ON `growth_runtime`.`customer_sessions` TO 'runtime_writer'@'%'");
assert.doesNotMatch(grant, /\*\.|WITH GRANT OPTION|DELETE|ALTER|DROP|CREATE/u);
assert.throws(() => buildTableScopedGrant({ database: "growth_runtime", principal: "runtime_writer", accountHost: "%", table: "customer_sessions;DROP" }), (error) => error.code === "RUNTIME_RECOVERY_INPUT_INVALID");
assert.throws(() => buildTableScopedGrant({ database: "growth_runtime", principal: "runtime_writer", accountHost: "%", table: "customer_sessions", operations: ["SELECT", "INSERT", "UPDATE", "DELETE"] }), (error) => error.code === "RUNTIME_RECOVERY_GRANT_OPERATION_FORBIDDEN");

const readyPrivileges = WRITE_AUTHORITY_PROFILES.session_continuity_writer.flatMap((table) => ALLOWED_TABLE_OPERATIONS.map((privilege) => ({
  TABLE_SCHEMA: "growth_runtime",
  TABLE_NAME: table,
  PRIVILEGE_TYPE: privilege,
  IS_GRANTABLE: "NO",
})));
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges }).ready, true);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges.slice(1) }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges, userPrivileges: [{ PRIVILEGE_TYPE: "INSERT" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges, schemaPrivileges: [{ TABLE_SCHEMA: "growth_runtime", PRIVILEGE_TYPE: "UPDATE" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges, userPrivileges: [{ PRIVILEGE_TYPE: "USAGE", IS_GRANTABLE: "YES" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges, schemaPrivileges: [{ TABLE_SCHEMA: "growth_runtime", PRIVILEGE_TYPE: "SELECT", IS_GRANTABLE: "YES" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: [...readyPrivileges, { TABLE_SCHEMA: "growth_runtime", TABLE_NAME: "customer_sessions", PRIVILEGE_TYPE: "DELETE", IS_GRANTABLE: "NO" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges.map((row, index) => index === 0 ? { ...row, IS_GRANTABLE: "YES" } : row) }).ready, false);

const validAuthorization = {
  candidate: { migration: CATALOG_MIGRATION, migration_checksum_sha256: CATALOG_MIGRATION_SHA256, statement_count: CATALOG_STATEMENT_COUNT },
  authorization: {
    authorization_status: "authorized",
    allow_apply: 1,
    recorded_checksum_sha256: CATALOG_MIGRATION_SHA256,
    metadata_json: { migration_checksum_sha256: CATALOG_MIGRATION_SHA256, expected_statement_count: CATALOG_STATEMENT_COUNT },
  },
  migration_sql_executed: false,
  applies_migration: false,
};
assert.equal(assertCatalogAuthorizationReadback({ result: validAuthorization }).checksum, CATALOG_MIGRATION_SHA256);
assert.deepEqual(assertOperatorAccountIdentity({ currentAccount: "'db_operator'@'db.example.com'", expectedUser: "db_operator", expectedHost: "db.example.com" }), { operator_identity_verified: true, operator_user: "db_operator", operator_account_host: "db.example.com" });
assert.throws(() => assertOperatorAccountIdentity({ currentAccount: "'db_operator'@'other.example.com'", expectedUser: "db_operator", expectedHost: "db.example.com" }), (error) => error.code === "RUNTIME_RECOVERY_OPERATOR_IDENTITY_MISMATCH");
assert.deepEqual(assertFinalReadbackPayloads({
  catalogPayload: { ok: true, tools: [{ tool_key: "catalog_readback" }] },
  sessionPayload: {
    ok: true,
    activation_layer: "session_context",
    session_id: "session-1",
    session_management: { status_written: "active" },
    platform_access: { access_scope: "platform_admin_all" },
    conversation_memory: { status: "available" },
  },
}), { catalog_tool_count: 1, session_context_required_fields: true });
assert.throws(() => assertFinalReadbackPayloads({
  catalogPayload: { ok: true, tools: [] },
  sessionPayload: { ok: true, activation_layer: "session_context", session_id: "session-1" },
}), (error) => error.code === "RUNTIME_RECOVERY_MCP_CATALOG_PAYLOAD_INVALID");
for (const invalid of [
  { ...validAuthorization, authorization: { ...validAuthorization.authorization, recorded_checksum_sha256: "0".repeat(64) } },
  { ...validAuthorization, authorization: { ...validAuthorization.authorization, metadata_json: { expected_statement_count: 8 } } },
  { ...validAuthorization, authorization: { ...validAuthorization.authorization, allow_apply: 0 } },
  { ...validAuthorization, migration_sql_executed: true },
]) {
  assert.throws(() => assertCatalogAuthorizationReadback(invalid), (error) => error.code === "RUNTIME_RECOVERY_MIGRATION_AUTHORIZATION_READBACK_INVALID");
}

for (const criticalPath of [".github/ops/runtime-recovery-governed-operations.mjs", ".github/workflows/github-repository-policy-1049-governed-rollout.yml"]) {
  assert.ok(constitution.control_plane_paths.includes(criticalPath), `${criticalPath} must be Constitution-registered`);
  assert.ok(derivedGovernance.convergence.automation_control_paths.includes(criticalPath), `${criticalPath} must be convergence-registered`);
}

assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /runtime_recovery:\s*\n\s*name:/u);
assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/u);
assert.match(workflow, /environment: Production/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /ref: \$\{\{ inputs\.expected_production_sha \}\}/u);
assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
assert.match(workflow, /RUNTIME_DB_OPERATOR_PASSWORD: \$\{\{ secrets\.RUNTIME_DB_OPERATOR_PASSWORD \}\}/u);
assert.match(workflow, /Execute one database-operator-authorized grant phase\s*\n\s*if: inputs\.phase == 'grant_readiness' \|\| inputs\.phase == 'grant_apply'/u);
assert.doesNotMatch(workflow.split("\n  readiness:")[0], /RUNTIME_BASE_URL:[^\n]*\n\s+BACKEND_API_KEY:/u);
assert.match(operator, /migration_apply_retried: false/u);
assert.match(operator, /verification_only_migrations_never_applied: true/u);
assert.match(operator, /live_schema_preflight_skipped !== true/u);
assert.match(operator, /multipleStatements: false/u);
assert.match(operator, /EXPECTED_SOURCE_PR_MERGE_SHA/u);
assert.match(operator, /RUNTIME_DB_OPERATOR_ACCOUNT_HOST/u);
assert.match(operator, /RUNTIME_DB_OPERATOR_TLS_MODE/u);
assert.match(operator, /ssl: \{ rejectUnauthorized: tlsMode === "required" \}/u);
assert.match(operator, /source_merge_sha_verified/u);
assert.match(operator, /collectBoundShas/u);
assert.doesNotMatch(operator, /GRANT\s+ALL|WITH\s+GRANT\s+OPTION|REVOKE\s+/u);
assert.match(workflow, /expected_source_pr_merge_sha:/u);
assert.match(workflow, /EXPECTED_SOURCE_PR_MERGE_SHA: \$\{\{ inputs\.expected_source_pr_merge_sha \}\}/u);
assert.match(workflow, /operator_account_host:/u);
assert.match(workflow, /operator_tls_mode:/u);
assert.match(workflow, /RUNTIME_DB_OPERATOR_ACCOUNT_HOST: \$\{\{ inputs\.operator_account_host \}\}/u);
assert.match(workflow, /RUNTIME_DB_OPERATOR_TLS_MODE: \$\{\{ inputs\.operator_tls_mode \}\}/u);
assert.doesNotMatch(workflow, /RUNTIME_DB_OPERATOR_ACCOUNT_HOST: \$\{\{ secrets\./u);
assert.doesNotMatch(workflow, /RUNTIME_DB_OPERATOR_TLS_MODE: \$\{\{ secrets\./u);

console.log("runtime recovery governed operations contract tests passed");
