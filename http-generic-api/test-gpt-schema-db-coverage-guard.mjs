import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/141_sprint65_gpt_schema_db_coverage_guard.sql", "utf8");

assert(sql.includes("gpt_schema_db_table_coverage"), "migration must install the GPT schema DB coverage execution policy");
assert(sql.includes("v_gpt_schema_db_coverage_issues"), "migration must create the DB coverage diagnostic view");
assert(sql.includes("tool_surface = 'virtual_tool'"), "GitHub facade tools must be classified as virtual_tool, not admin_platform_tool");
assert(sql.includes("repo_inspect"), "migration must cover repo_inspect virtual tool binding");
assert(sql.includes("repo_patch_apply"), "migration must cover repo_patch_apply virtual tool binding");

for (const table of [
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
  "platform_endpoint_tool_exports",
  "actions",
  "endpoints",
  "app_integrations",
  "app_integration_action_bindings",
  "app_integration_tool_bindings",
  "platform_plugin_contributions",
]) {
  assert(sql.includes(table), `coverage policy must mention ${table}`);
}

for (const issueType of [
  "admin_missing_method_or_path",
  "tenant_missing_method_or_path",
  "admin_duplicate_tool_key",
  "tenant_duplicate_tool_key",
  "platform_export_missing_endpoint",
  "platform_export_missing_action",
  "app_action_binding_unresolved",
  "app_tool_binding_missing_admin_tool",
  "app_tool_binding_missing_tenant_tool",
  "app_tool_binding_missing_platform_export",
]) {
  assert(sql.includes(issueType), `coverage view must emit issue type ${issueType}`);
}

assert(sql.includes("JSON_SEARCH(c.action_bindings_json"), "app action coverage must accept Platform Plugin contribution action bindings");
assert(sql.includes("facade-only tools should use virtual_tool"), "coverage view must document facade-only virtual tool handling");

for (const forbidden of [
  "api_key_value =",
  "access_token",
  "refresh_token",
  "client_secret",
  "encrypted_credentials",
  "GITHUB_TOKEN",
]) {
  assert(!sql.toLowerCase().includes(forbidden.toLowerCase()), `migration must not store or reference secret payload fields: ${forbidden}`);
}

console.log("gpt schema DB coverage guard migration tests passed");
