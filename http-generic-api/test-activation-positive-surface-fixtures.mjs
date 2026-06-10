import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/275_sprint68_activation_positive_surface_fixtures.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const tenantSmoke = readFileSync(new URL("./scripts/activation-authorized-access-tenant-smoke.mjs", import.meta.url), "utf8");

for (const token of [
  "activation_smoke_agent",
  "activation_smoke_skill",
  "activation_smoke_app",
  "activation_smoke_workflow",
  "activation_smoke_plugin_contribution",
  "activation_smoke_positive_fixture_task",
  "tenant_integration_policies",
  "agent_skill_grants",
  "user_app_connections",
  "workflow_runtime_bindings",
  "platform_plugin_contributions",
  "platform_pending_tasks",
  "app_action_grants",
]) {
  assert.match(migration, new RegExp(token));
}

assert.match(migration, /encrypted_credentials` = NULL/);
assert.match(migration, /credential_ref` = NULL/);
assert.match(migration, /n8n_webhook_url` = NULL/);
assert.match(migration, /credential_env_var` = NULL/);
assert.match(migration, /manifest_json` = NULL/);
assert.match(migration, /credential_policy_json` = NULL/);
assert.match(migration, /activation_prompt` = NULL/);
assert.match(migration, /secrets_included/);
assert.doesNotMatch(migration, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
assert.doesNotMatch(migration, /value_ciphertext|secret_value|token_value|password|private_key/i);

assert.match(runner, /275_sprint68_activation_positive_surface_fixtures\.sql/);
assert.match(tenantSmoke, /positiveRequiredSurfaceKeys/);
assert.match(tenantSmoke, /missingPositiveSurfaces/);
assert.match(tenantSmoke, /missing_positive_surfaces/);
for (const surface of [
  "agent_skill_grants",
  "connected_app_connections",
  "workflow_runtime_bindings",
  "plugin_contributions",
  "pending_tasks",
  "app_action_grants",
  "tenant_integration_policies",
]) {
  assert.match(tenantSmoke, new RegExp(`"${surface}"`));
}

console.log("Activation positive surface fixtures guard passed");
