import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/271_sprint68_activation_expanded_authorized_surfaces.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

const manifests = [
  "agent_skill_grants.json",
  "connected_app_connections.json",
  "workflow_runtime_bindings.json",
  "plugin_contributions.json",
  "pending_tasks.json",
  "tenant_tools.json",
  "app_action_grants.json",
  "tenant_integration_policies.json",
];

for (const viewName of [
  "v_activation_agent_skill_grants",
  "v_activation_connected_app_connections",
  "v_activation_workflow_runtime_bindings",
  "v_activation_plugin_contributions",
  "v_activation_pending_tasks",
  "v_activation_tenant_tools",
  "v_activation_app_action_grants",
  "v_activation_tenant_integration_policies",
  "v_activation_expanded_authorized_surface_readiness",
]) {
  assert.match(migration, new RegExp(viewName));
}

assert.match(migration, /CREATE OR REPLACE VIEW/);
assert.match(migration, /secrets_included/);
assert.match(migration, /auth_material_present/);
assert.doesNotMatch(migration, /SELECT\s+\*/i);
assert.doesNotMatch(migration, /encrypted_credentials\s*,|credential_ref\s*,|credential_env_var\s*,|n8n_webhook_url\s*,|system_prompt\s*,|capability_json\s*,|manifest_json\s*,|credential_policy_json\s*,|activation_prompt\s*,|context_json\s*,|input_schema\s*,|fixed_body\s*,/i);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.match(runner, /271_sprint68_activation_expanded_authorized_surfaces\.sql/);

for (const file of manifests) {
  const manifest = JSON.parse(readFileSync(new URL(`./activation-surfaces/${file}`, import.meta.url), "utf8"));
  assert.match(manifest.source_table, /^v_activation_/);
  assert.equal(manifest.include_for_admin, true);
  assert.equal(manifest.include_for_tenant, true);
  assert.ok(manifest.tenant_column || manifest.user_column, `${file} must have tenant/user scope`);
  assert.ok(Array.isArray(manifest.result_columns) && manifest.result_columns.length > 0, `${file} must define result columns`);
  const text = JSON.stringify(manifest);
  assert.doesNotMatch(text, /encrypted_credentials|credential_ref|credential_env_var|n8n_webhook_url|system_prompt|capability_json|manifest_json|credential_policy_json|activation_prompt|context_json|input_schema|fixed_body|password|private_key|token_value|secret_value|value_ciphertext/i, `${file} exposes blocked fields`);
}

console.log("Activation expanded authorized surfaces guard passed");
