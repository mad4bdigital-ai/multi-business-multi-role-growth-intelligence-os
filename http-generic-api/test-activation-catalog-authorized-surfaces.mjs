import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/273_sprint68_activation_catalog_authorized_surfaces.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

const manifests = [
  "agent_catalog.json",
  "agent_skill_catalog.json",
  "agent_tool_catalog.json",
  "agent_bindings_catalog.json",
  "workflow_catalog.json",
  "task_route_catalog.json",
  "app_integration_catalog.json",
  "app_binding_catalog.json",
  "platform_plugin_catalog.json",
  "skill_manifest_catalog.json",
  "skill_package_catalog.json",
  "logic_pack_catalog.json",
  "local_gateway_tool_catalog.json",
];

for (const viewName of [
  "v_activation_agent_catalog",
  "v_activation_agent_skill_catalog",
  "v_activation_agent_tool_catalog",
  "v_activation_agent_bindings_catalog",
  "v_activation_workflow_catalog",
  "v_activation_task_route_catalog",
  "v_activation_app_integration_catalog",
  "v_activation_app_binding_catalog",
  "v_activation_platform_plugin_catalog",
  "v_activation_skill_manifest_catalog",
  "v_activation_skill_package_catalog",
  "v_activation_logic_pack_catalog",
  "v_activation_local_gateway_tool_catalog",
  "v_activation_catalog_authorized_surface_readiness",
]) {
  assert.match(migration, new RegExp(viewName));
}

assert.match(migration, /CREATE OR REPLACE VIEW/);
assert.match(migration, /JOIN `tenants`/);
assert.match(migration, /secrets_included/);
assert.doesNotMatch(migration, /SELECT\s+\*/i);
assert.doesNotMatch(migration, /system_prompt\s*,|capability_json\s*,|tool_manifest_json\s*,|deferred_search_tags_json\s*,|oauth_authorize_url\s*,|oauth_token_url\s*,|oauth_revoke_url\s*,|mcp_server_info\s*,|default_action_grants\s*,|manifest_json\s*,|safety_contract_json\s*,|tool_policy_json\s*,|task_classes_json\s*,|required_tools_json\s*,|forbidden_tools_json\s*,|validator_commands_json\s*,|success_criteria_json\s*,|fallback_behavior_json\s*,|prompt_template\s*,|contents_json\s*,|input_schema\s*,|fixed_args_json\s*,/i);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.match(runner, /273_sprint68_activation_catalog_authorized_surfaces\.sql/);

for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(new URL(`./activation-surfaces/${file}`, import.meta.url), "utf8"));
  assert.match(manifest.source_table, /^v_activation_/);
  assert.equal(manifest.include_for_admin, true);
  assert.equal(manifest.include_for_tenant, true);
  assert.ok(manifest.tenant_column || manifest.user_column, `${file} must have tenant/user scope`);
  assert.ok(Array.isArray(manifest.result_columns) && manifest.result_columns.length > 0, `${file} must define result columns`);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json|system_prompt|capability_json|tool_manifest_json|manifest_json|input_schema|fixed_args_json|prompt_template|contents_json/i, `${file} exposes blocked fields`);
}

console.log("Activation catalog authorized surfaces guard passed");
