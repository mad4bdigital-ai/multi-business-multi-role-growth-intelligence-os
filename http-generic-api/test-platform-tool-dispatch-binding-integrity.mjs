import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migrationName = "311_sprint69_platform_tool_dispatch_binding_integrity.sql";
const migration = readFileSync(`migrations/${migrationName}`, "utf8");
const scopeFixMigrationName = "312_sprint69_platform_tool_dispatch_integrity_scope_fix.sql";
const scopeFixMigration = readFileSync(`migrations/${scopeFixMigrationName}`, "utf8");
const toolsRoute = readFileSync("routes/gptToolsRoutes.js", "utf8");
const adminCliRoute = readFileSync("routes/adminCliRoutes.js", "utf8");
const lifecycle = readFileSync("githubRepositoryLifecycle.js", "utf8");
const health = readFileSync("localConnectorCompositeHealth.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const adminSchema = readFileSync("openapi.custom-gpt.auth-dispatcher.yaml", "utf8");
const tenantSchema = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_tool_dispatch_bindings/);
assert.match(migration, /CREATE OR REPLACE VIEW v_platform_tool_dispatch_integrity/);
assert.match(migration, /github_api_mcp__.*github_delete_reference|github_delete_reference/);
assert.match(migration, /github_branch_delete/);
assert.match(migration, /github_pr_ci_gate/);
assert.match(migration, /repo_patch_batch_apply/);
assert.match(migration, /readback_policy_key/);
assert.match(migration, /partial_success_policy_key/);
assert.match(migration, /atomicity_mode/);
assert.match(migration, /database_table_lifecycle_registry/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
assert.doesNotMatch(migration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

const preflight = assessMigrationSqlPreflight(migrationName, migration);
assert.equal(preflight.status, "pass", JSON.stringify(preflight, null, 2));
const scopeFixPreflight = assessMigrationSqlPreflight(scopeFixMigrationName, scopeFixMigration);
assert.equal(scopeFixPreflight.status, "pass", JSON.stringify(scopeFixPreflight, null, 2));
assert.match(scopeFixMigration, /CREATE OR REPLACE VIEW v_platform_tool_dispatch_integrity/);
assert.match(scopeFixMigration, /FROM platform_tool_dispatch_bindings b/);
assert.match(scopeFixMigration, /LEFT JOIN endpoints e\s+ON e\.id = b\.source_endpoint_id/);
assert.match(scopeFixMigration, /LEFT JOIN platform_endpoint_tool_exports x\s+ON x\.export_key = b\.export_key/);
assert.doesNotMatch(scopeFixMigration, /FROM endpoints e/);
assert.doesNotMatch(scopeFixMigration, /x\.source_endpoint_id = e\.id\s+OR/);
assert.match(scopeFixMigration, /db_callable_surface_missing/);
assert.doesNotMatch(scopeFixMigration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

for (const toolName of [
  "admin_tool_catalog_search",
  "github_pr_ci_gate",
  "github_pr_finalize",
  "github_branch_delete",
  "repo_patch_batch_apply",
  "platform_tool_binding_integrity_audit",
]) {
  assert.match(toolsRoute, new RegExp(`name: \\"${toolName}\\"`));
  assert.match(toolsRoute, new RegExp(`toolKey === \\"${toolName}\\"`));
}

assert.match(toolsRoute, /requireGithubPrFinalizeEnvelope/);
assert.match(toolsRoute, /requireGithubBranchDeleteEnvelope/);
assert.match(toolsRoute, /github_repo_cleanup/);
assert.match(toolsRoute, /github_repo_patch/);
assert.match(toolsRoute, /auditPlatformToolBindings/);
assert.match(toolsRoute, /FROM platform_tool_dispatch_bindings b/);
assert.match(toolsRoute, /LEFT JOIN endpoints e ON e\.id = b\.source_endpoint_id/);
assert.doesNotMatch(toolsRoute, /FROM endpoints e[\s\S]*?LEFT JOIN platform_tool_dispatch_bindings b/);
assert.match(toolsRoute, /authority: "platform_tool_dispatch_bindings"/);
assert.match(toolsRoute, /paginateItems\(tools, args \|\| \{\}\)/);

assert.match(adminCliRoute, /closeGithubPullRequest/);
assert.match(adminCliRoute, /githubBranchDeleteConfirmation/);
assert.match(adminCliRoute, /status: completed \? "completed" : "partial_success"/);
assert.match(adminCliRoute, /exit_code: completed \? 0 : 2/);
assert.match(adminCliRoute, /hasCliFlag\(args, "--delete-branch"\)/);
assert.match(adminCliRoute, /parseCliFlag\(args, "--expected-head-sha"\)/);
assert.match(lifecycle, /github_pr_finalize_gate_blocked/);
assert.match(lifecycle, /github_pr_finalize_sha_mismatch/);
assert.match(lifecycle, /github_pr_finalize_confirmation_required/);
assert.match(lifecycle, /github_branch_delete_sha_mismatch/);
assert.match(lifecycle, /github_branch_delete_open_pr/);
assert.match(lifecycle, /github_branch_delete_readback_failed/);
assert.match(lifecycle, /github_change_set_base_moved/);
assert.match(lifecycle, /github_change_set_branch_not_pristine/);
assert.match(lifecycle, /github_change_set_readback_failed/);
assert.match(health, /degraded_local_service/);
assert.match(health, /degraded_tunnel/);
assert.match(health, /authorization_gated/);
assert.match(adminCliRoute, /probeLocalConnectorPublicHealth/);
assert.match(adminCliRoute, /classifyLocalConnectorCompositeHealth/);
assert.match(adminCliRoute, /alias_resolution_applied: configSource === "db_alias"/);
assert.match(adminCliRoute, /installer_generated: false/);
assert.match(openapi, /operationId: sessionInsightTargetWriteReadbackCreate[\s\S]*?x-custom-gpt-exclude: true/);
assert.match(openapi, /operationId: sessionInsightTargetWriteReadbackList[\s\S]*?x-custom-gpt-exclude: true/);
assert.match(openapi, /Governed DB-backed or virtual tool key returned by listAdminTools/);
assert.match(tenantSchema, /Tool key returned by listTools; runtime validates registration/);
assert.doesNotMatch(adminSchema, /sessionInsightTargetWriteReadbackCreate/);
assert.doesNotMatch(adminSchema, /sessionInsightTargetWriteReadbackList/);
const adminOperationCount = (adminSchema.match(/\n    (?:get|post|put|patch|delete):\n/g) || []).length;
assert(adminOperationCount <= 30, `Admin Custom GPT schema exceeds operation cap: ${adminOperationCount}`);

console.log("platform tool dispatch binding integrity tests passed");
