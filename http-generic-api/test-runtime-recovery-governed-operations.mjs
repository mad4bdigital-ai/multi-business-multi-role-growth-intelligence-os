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
  assertMigrationModeAllowed,
  buildTableScopedGrant,
  evaluatePrivilegeSnapshot,
  expectedConfirmation,
  resolveProfile,
} from "../.github/ops/runtime-recovery-governed-operations.mjs";

const workflow = readFileSync(new URL("../.github/workflows/github-repository-policy-1049-governed-rollout.yml", import.meta.url), "utf8");
const operator = readFileSync(new URL("../.github/ops/runtime-recovery-governed-operations.mjs", import.meta.url), "utf8");
const productionSha = "f".repeat(40);

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
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: [...readyPrivileges, { TABLE_SCHEMA: "growth_runtime", TABLE_NAME: "customer_sessions", PRIVILEGE_TYPE: "DELETE", IS_GRANTABLE: "NO" }] }).ready, false);
assert.equal(evaluatePrivilegeSnapshot({ database: "growth_runtime", profile: "session_continuity_writer", tablePrivileges: readyPrivileges.map((row, index) => index === 0 ? { ...row, IS_GRANTABLE: "YES" } : row) }).ready, false);

assert.match(workflow, /workflow_dispatch:/u);
assert.match(workflow, /runtime_recovery:\s*\n\s*name:/u);
assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/u);
assert.match(workflow, /environment: Production/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /ref: \$\{\{ inputs\.expected_production_sha \}\}/u);
assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
assert.match(workflow, /RUNTIME_DB_OPERATOR_PASSWORD: \$\{\{ secrets\.RUNTIME_DB_OPERATOR_PASSWORD \}\}/u);
assert.match(operator, /migration_apply_retried: false/u);
assert.match(operator, /verification_only_migrations_never_applied: true/u);
assert.match(operator, /live_schema_preflight_skipped !== true/u);
assert.match(operator, /multipleStatements: false/u);
assert.doesNotMatch(operator, /GRANT\s+ALL|WITH\s+GRANT\s+OPTION|REVOKE\s+/u);

console.log("runtime recovery governed operations contract tests passed");
