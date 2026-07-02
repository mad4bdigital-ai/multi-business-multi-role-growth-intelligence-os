import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveAppActionMutationRequirement } from "./appAdapters/index.js";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";

const migration = await readFile(
  new URL("./migrations/1033_sprint69_n8n_instance_mode_ownership_policy.sql", import.meta.url),
  "utf8",
);

const expectedActionClasses = {
  read: {
    list_workflows: false,
    get_workflow: false,
    list_executions: false,
  },
  run: {
    trigger_webhook: true,
    execute_workflow: true,
  },
  activation: {
    activate_workflow: true,
    deactivate_workflow: true,
  },
};

for (const [actionKey, expected] of Object.entries(expectedActionClasses.read)) {
  assert.equal(resolveAppActionMutationRequirement("n8n", actionKey, {}), expected, `n8n ${actionKey} must remain read-only`);
}
for (const [actionKey, expected] of Object.entries(expectedActionClasses.run)) {
  assert.equal(resolveAppActionMutationRequirement("n8n", actionKey, {}), expected, `n8n ${actionKey} must remain a run mutation`);
}
for (const [actionKey, expected] of Object.entries(expectedActionClasses.activation)) {
  assert.equal(resolveAppActionMutationRequirement("n8n", actionKey, {}), expected, `n8n ${actionKey} must remain an activation mutation`);
}

for (const expected of [
  "n8n Mutation Governance",
  "n8n_instance_mode_ownership_policy_v1",
  "read_actions",
  "run_actions",
  "activation_actions",
  "instance_mode_required",
  "accepted_instance_modes",
  "ownership_binding_required",
  "workflow_owner_tenant_match_required",
  "capability_envelope_required",
  "approval_hold_required",
  "reuse_existing_approval_path",
  "no_new_approval_path",
  "same_cycle_readback_required",
  "rollback_metadata_required_for_activation",
  "direct_provider_execution_enabled_by_policy', FALSE",
  "credential_payload_read_allowed', FALSE",
  "secrets_included', FALSE",
  "n8n_action_class_separation",
  "v_n8n_instance_mode_ownership_policy_readiness",
  "missing_n8n_instance_mode_ownership_policy_contract",
]) {
  assert(migration.includes(expected), `n8n policy migration must include ${expected}`);
}

assert.doesNotMatch(migration, /DROP\s+|DELETE\s+FROM|TRUNCATE\s+/i);
assert.doesNotMatch(migration, /fetch\s*\(|axios|n8n\.|\/api\/v1\/workflows/i);

const sqlPreflight = assessMigrationSqlPreflight("1033_sprint69_n8n_instance_mode_ownership_policy.sql", migration);
assert.equal(sqlPreflight.status, "pass");
assert.equal(sqlPreflight.risks.length, 0);

console.log("n8n instance-mode ownership policy tests passed");
