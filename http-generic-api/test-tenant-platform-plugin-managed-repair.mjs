import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTenantPlatformPluginEligibility,
  TenantCapabilityRepairClass,
  TenantPlatformPluginManagedRepairContract,
} from "./tenantPlatformPluginEligibility.js";

function resultWithGate(key, reason) {
  return {
    ok: true,
    allowed: false,
    plugin_key: "github",
    selector: { type: "action_key", value: "github_create_issue_comment" },
    requested_action_key: "github_create_issue_comment",
    requested_tool_key: null,
    plugin: { plugin_key: "github", status: "active" },
    security_decision: {
      gates: [{ key, required: true, state: "deny", reason }],
    },
    approval: { approval_required: false },
    execution: { will_execute: false },
    secrets_included: false,
  };
}

const bindingEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "action_binding_not_found"),
);
assert.equal(bindingEligibility.status, "blocked");
assert.equal(bindingEligibility.blockers[0].blocker_code, "missing_action_binding");
assert.equal(
  bindingEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.MANAGED_REPAIR_AVAILABLE,
);
assert.equal(bindingEligibility.managed_repair.available, true);
assert.deepEqual(bindingEligibility.managed_repair.repair_operations, ["register_runtime_binding"]);
assert.equal(
  bindingEligibility.managed_repair.execution.request_template.capability_key,
  TenantPlatformPluginManagedRepairContract.capability_key,
);
assert.equal(
  bindingEligibility.managed_repair.execution.request_template.workflow_key,
  TenantPlatformPluginManagedRepairContract.workflow_key,
);
assert.equal(bindingEligibility.managed_repair.execution.request_template.effect_class, "managed_operation");
assert.equal(bindingEligibility.managed_repair.execution.request_template.input_json.mode, "dry_run");
assert.equal(bindingEligibility.managed_repair.execution.request_template.input_json.provider_mutation_allowed, false);
assert.equal(bindingEligibility.managed_repair.execution.parent_ticket_id_required, true);
assert.equal(bindingEligibility.managed_repair.execution.approval_policy, "managed_handoff");
assert.equal(bindingEligibility.managed_repair.execution.approval_role, "managed_operator");
assert.equal(bindingEligibility.managed_repair.execution.apply_authorized_by_projection, false);
assert.equal(bindingEligibility.managed_repair.readback.required, true);
assert.equal(bindingEligibility.managed_repair.mutation_executed, false);
assert.equal(bindingEligibility.managed_repair.secrets_included, false);
assert(!Object.hasOwn(bindingEligibility.managed_repair.execution.request_template, "tenant_id"));
assert(!Object.hasOwn(bindingEligibility.managed_repair.execution.request_template, "user_id"));
assert.match(
  bindingEligibility.managed_repair.execution.request_template.resource_ref,
  /^platform_plugin_operation:[0-9a-f]{64}$/,
);
assert.match(
  bindingEligibility.managed_repair.execution.request_template.idempotency_key,
  /^tenant-platform-plugin-repair:[0-9a-f]{64}$/,
);

const stableRepeat = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "action_binding_not_found"),
);
assert.equal(
  stableRepeat.managed_repair.execution.request_template.idempotency_key,
  bindingEligibility.managed_repair.execution.request_template.idempotency_key,
);
assert.equal(
  stableRepeat.managed_repair.execution.request_template.resource_ref,
  bindingEligibility.managed_repair.execution.request_template.resource_ref,
);

const certificationEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("smoke_certification", "smoke_certification_missing"),
);
assert.equal(certificationEligibility.blockers[0].blocker_code, "missing_smoke_certification");
assert.equal(
  certificationEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.MANAGED_REPAIR_AVAILABLE,
);
assert.deepEqual(certificationEligibility.managed_repair.repair_operations, ["certify_platform_plugin_operation"]);

const targetAuthorityEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("target_authority", "credential_target_not_authorized"),
);
assert.equal(
  targetAuthorityEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
);
assert.equal(targetAuthorityEligibility.managed_repair.available, false);

const credentialEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("credential", "credential_required"),
);
assert.equal(
  credentialEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.USER_ACTION_REQUIRED,
);
assert.equal(credentialEligibility.managed_repair.available, false);

const incompleteCanonicalIdentity = buildTenantPlatformPluginEligibility({
  allowed: false,
  plugin: { status: "active" },
  security_decision: {
    gates: [{ key: "binding_state", required: true, state: "deny", reason: "action_binding_not_found" }],
  },
  execution: { will_execute: false },
});
assert.equal(
  incompleteCanonicalIdentity.blockers[0].repair_class,
  TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
);
assert.equal(incompleteCanonicalIdentity.managed_repair.available, false);
assert.equal(incompleteCanonicalIdentity.managed_repair.reason, "canonical_plugin_operation_identity_required");

const migration = readFileSync(
  "migrations/1052_tenant_platform_plugin_managed_repair_authority.sql",
  "utf8",
);
for (const required of [
  "tenant_platform_plugin_managed_repair",
  "resource_authority_route_family.tenant_platform_plugin_managed_repair",
  "managed_repair",
  "managedExecutionRoutes.js",
  "v_tenant_platform_plugin_managed_repair_readiness",
  "v_platform_capabilities_effective_evidence",
  "managed_execution_revalidates_resource_grant_before_run_creation",
  "governed_migration_authorization_registry",
  "requires_confirmation",
]) {
  assert(migration.includes(required), `missing managed repair migration contract: ${required}`);
}
assert.match(migration, /apply_allowed_default[\s\S]*?1[\s\S]*?'certified'/);
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|PREPARE\s|EXECUTE\s/i.test(migration));
assert(migration.includes("provider_call_executed=false"));
assert(migration.includes("external_write_executed=false"));
assert(migration.includes("managed_repair_executed=false"));
assert(migration.includes("resource_grant_created=false"));
assert(migration.includes("secrets_included=false"));

console.log("tenant Platform Plugin managed repair tests passed");
