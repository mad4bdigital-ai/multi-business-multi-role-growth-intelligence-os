import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/141_sprint65_gpt_schema_db_registry_coverage.sql", "utf8");
const lower = sql.toLowerCase();

assert(sql.includes("CREATE OR REPLACE VIEW v_gpt_schema_db_coverage_issues"), "migration must create GPT schema DB coverage view");
assert(sql.includes("repo_inspect"), "migration must classify repo_inspect coverage");
assert(sql.includes("repo_patch_apply"), "migration must classify repo_patch_apply coverage");
assert(sql.includes("tool_surface = 'virtual_tool'"), "repo tools must be classified as virtual_tool");
assert(sql.includes("crm.contact.list"), "migration must seed promoted CRM plugin action authority");
assert(sql.includes("platform_plugin_rest_adapter"), "CRM action should route through Platform Plugin REST adapter authority");
assert(sql.includes("platform_plugin_contribution_private_dispatch_rest"), "CRM endpoint should retain private/rest dispatch route target authority");

for (const issueType of [
  "admin_missing_method_or_path",
  "tenant_missing_method_or_path",
  "admin_duplicate_tool_key",
  "tenant_duplicate_tool_key",
  "admin_bad_path",
  "tenant_bad_path",
  "export_missing_key",
  "export_missing_endpoint",
  "export_missing_action",
  "app_action_binding_missing_action",
  "app_tool_binding_missing_admin_tool",
  "app_tool_binding_missing_tenant_tool",
  "app_tool_binding_missing_export",
]) {
  assert(sql.includes(issueType), `coverage view must include issue type ${issueType}`);
}

for (const tableName of [
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
  "platform_endpoint_tool_exports",
  "actions",
  "endpoints",
  "app_integration_action_bindings",
  "app_integration_tool_bindings",
]) {
  assert(sql.includes(tableName), `coverage migration must reference ${tableName}`);
}

for (const forbidden of [
  "github_token",
  "personal_access_token",
  "access_token",
  "refresh_token",
  "client_secret",
  "api_key_value =",
  "encrypted_credentials",
]) {
  assert(!lower.includes(forbidden), `migration must not write or reference secret material: ${forbidden}`);
}

assert(sql.includes("ON DUPLICATE KEY UPDATE"), "migration must be idempotent");

console.log("GPT schema DB coverage migration tests passed");
