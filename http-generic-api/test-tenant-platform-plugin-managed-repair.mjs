import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTenantPlatformPluginEligibility,
  TenantCapabilityRepairClass,
  TenantPlatformPluginManagedRepairContract,
} from "./tenantPlatformPluginEligibility.js";

function resultWithGate(key, reason, overrides = {}) {
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
    ...overrides,
  };
}

const bindingEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "action_binding_not_found"),
);
assert.equal(bindingEligibility.status, "blocked");
assert.equal(bindingEligibility.blockers[0].blocker_code, "missing_action_binding");
assert.equal(
  bindingEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
);
assert.equal(bindingEligibility.managed_repair.available, false);
assert.equal(bindingEligibility.managed_repair.reason, "canonical_plugin_operation_identity_required");
assert(!Object.hasOwn(bindingEligibility.managed_repair, "affected_operation"));
assert(!Object.hasOwn(bindingEligibility.managed_repair, "repair_operations"));
assert.equal(bindingEligibility.managed_repair.mutation_executed, false);
assert.equal(bindingEligibility.managed_repair.secrets_included, false);

const differentlyCasedMissingBinding = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "action_binding_not_found", {
    selector: { type: "action_key", value: "GITHUB_CREATE_ISSUE_COMMENT" },
    requested_action_key: "GITHUB_CREATE_ISSUE_COMMENT",
  }),
);
assert.equal(differentlyCasedMissingBinding.managed_repair.available, false);
assert.equal(differentlyCasedMissingBinding.managed_repair.reason, "canonical_plugin_operation_identity_required");
assert(!Object.hasOwn(differentlyCasedMissingBinding.managed_repair, "affected_operation"));

const inactiveBinding = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "binding_not_active", {
    binding: { action_key: "github_create_issue_comment", status: "disabled" },
  }),
);
assert.equal(inactiveBinding.blockers[0].blocker_code, "binding_not_active");
assert.equal(inactiveBinding.blockers[0].repair_class, TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED);
assert.equal(inactiveBinding.blockers[0].safe_action, "review_runtime_binding_state");
assert.equal(inactiveBinding.managed_repair.available, false);
assert.equal(inactiveBinding.managed_repair.reason, "no_allowlisted_managed_repair_for_current_blockers");

const toolBinding = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "tool_binding_not_found", {
    selector: { type: "tool_key", value: "github_comment_tool" },
    requested_action_key: null,
    requested_tool_key: "github_comment_tool",
  }),
);
assert.equal(toolBinding.blockers[0].blocker_code, "missing_tool_binding");
assert.equal(toolBinding.managed_repair.available, false);
assert.equal(toolBinding.managed_repair.reason, "canonical_plugin_operation_identity_required");
assert(!Object.hasOwn(toolBinding.managed_repair, "affected_operation"));

const certificationEligibility = buildTenantPlatformPluginEligibility(
  resultWithGate("smoke_certification", "smoke_certification_missing", {
    binding: { action_key: "github_create_issue_comment", status: "active" },
  }),
);
assert.equal(certificationEligibility.blockers[0].blocker_code, "missing_smoke_certification");
assert.equal(
  certificationEligibility.blockers[0].repair_class,
  TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
);
assert.equal(certificationEligibility.managed_repair.available, false);
assert.equal(certificationEligibility.managed_repair.reason, "managed_repair_executor_not_registered");
assert.equal(certificationEligibility.managed_repair.mode, "staged_dry_run_candidate");
assert.deepEqual(certificationEligibility.managed_repair.repair_operations, ["certify_platform_plugin_operation"]);
assert.equal(certificationEligibility.managed_repair.affected_operation.plugin_key, "github");
assert.equal(certificationEligibility.managed_repair.affected_operation.selector.type, "action_key");
assert.equal(certificationEligibility.managed_repair.affected_operation.selector.value, "github_create_issue_comment");
assert.deepEqual(certificationEligibility.managed_repair.affected_operation.blocker_codes, ["missing_smoke_certification"]);
assert.match(certificationEligibility.managed_repair.affected_operation.identity_sha256, /^[0-9a-f]{64}$/);
assert(certificationEligibility.managed_repair.activation_requirements.includes("dedicated_executor_registered"));
assert(certificationEligibility.managed_repair.activation_requirements.includes("capability_specific_dry_run_enforcement"));
assert(certificationEligibility.managed_repair.activation_requirements.includes("jwt_bound_principal_injection"));
assert(certificationEligibility.managed_repair.activation_requirements.includes("workspace_context_persisted_for_readback"));
assert(!Object.hasOwn(certificationEligibility.managed_repair, "execution"));
assert(!Object.hasOwn(certificationEligibility.managed_repair, "request_template"));

const canonicalSelectorIdentity = buildTenantPlatformPluginEligibility(
  resultWithGate("smoke_certification", "smoke_certification_missing", {
    plugin_key: "GITHUB",
    plugin: { plugin_key: "github", status: "active" },
    selector: { type: "action_key", value: "GITHUB_CREATE_ISSUE_COMMENT" },
    requested_action_key: "GITHUB_CREATE_ISSUE_COMMENT",
    binding: { action_key: "github_create_issue_comment", status: "active" },
  }),
);
assert.equal(canonicalSelectorIdentity.managed_repair.affected_operation.plugin_key, "github");
assert.equal(canonicalSelectorIdentity.managed_repair.affected_operation.selector.value, "github_create_issue_comment");
assert.equal(
  canonicalSelectorIdentity.managed_repair.affected_operation.identity_sha256,
  certificationEligibility.managed_repair.affected_operation.identity_sha256,
);

const expiredCertification = buildTenantPlatformPluginEligibility(
  resultWithGate("smoke_certification", "smoke_certification_expired", {
    binding: { action_key: "github_create_issue_comment", status: "active" },
  }),
);
assert.equal(expiredCertification.blockers[0].blocker_code, "expired_smoke_certification");
assert.equal(expiredCertification.managed_repair.available, false);
assert.equal(expiredCertification.managed_repair.reason, "managed_repair_executor_not_registered");
assert.deepEqual(expiredCertification.managed_repair.affected_operation.blocker_codes, ["expired_smoke_certification"]);
assert.equal(
  expiredCertification.managed_repair.affected_operation.identity_sha256,
  certificationEligibility.managed_repair.affected_operation.identity_sha256,
);

const unavailablePlugin = buildTenantPlatformPluginEligibility(
  resultWithGate("binding_state", "action_binding_not_found", {
    plugin: { plugin_key: "github", status: "disabled" },
  }),
);
assert.equal(unavailablePlugin.status, "unavailable");
assert.equal(unavailablePlugin.managed_repair.available, false);
assert.equal(unavailablePlugin.managed_repair.reason, "plugin_not_executable");

const deprecatedPlugin = buildTenantPlatformPluginEligibility(
  resultWithGate("smoke_certification", "smoke_certification_missing", {
    plugin: { plugin_key: "github", status: "deprecated" },
    binding: { action_key: "github_create_issue_comment", status: "active" },
  }),
);
assert.equal(deprecatedPlugin.status, "deprecated");
assert.equal(deprecatedPlugin.managed_repair.available, false);
assert.equal(deprecatedPlugin.managed_repair.reason, "plugin_not_executable");

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
    gates: [{ key: "smoke_certification", required: true, state: "deny", reason: "smoke_certification_missing" }],
  },
  execution: { will_execute: false },
});
assert.equal(
  incompleteCanonicalIdentity.blockers[0].repair_class,
  TenantCapabilityRepairClass.PLATFORM_ADMIN_REQUIRED,
);
assert.equal(incompleteCanonicalIdentity.managed_repair.available, false);
assert.equal(incompleteCanonicalIdentity.managed_repair.reason, "canonical_plugin_operation_identity_required");

assert.equal(TenantPlatformPluginManagedRepairContract.create_route, "/managed-execution-runs");
assert.equal(TenantPlatformPluginManagedRepairContract.readback_route, "/tenant/platform/plugins/resolve");

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
  "managed_repair_executor_not_registered",
  "executor_registered",
]) {
  assert(migration.includes(required), `missing managed repair migration contract: ${required}`);
}
assert.match(migration, /apply_allowed_default[\s\S]*?0[\s\S]*?'baseline_registered'/);
assert.match(migration, /apply_allowed_default=0/);
assert.match(migration, /enforcement_status='baseline_registered'/);
assert(!migration.includes("enforcement_status='certified'"));
assert(!migration.includes("apply_allowed_default=1"));
assert(!/^\s*(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|PREPARE\b|EXECUTE\b)/im.test(migration));
assert(migration.includes("provider_call_executed=false"));
assert(migration.includes("external_write_executed=false"));
assert(migration.includes("managed_repair_executed=false"));
assert(migration.includes("resource_grant_created=false"));
assert(migration.includes("secrets_included=false"));

console.log("tenant Platform Plugin staged managed repair tests passed");
