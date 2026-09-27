import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_LAYER_TOOLS } from "./routes/systemLayerRoutes.js";
import {
  _testingRecoverySystemToolOverlay,
  projectRecoveryCapabilitiesForSystemSurface,
  synchronizeRecoverySystemToolDescriptors,
} from "./routes/recoverySystemToolOverlayRoutes.js";

const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_ENVIRONMENT: "production",
  REMOTE_MCP_ENVIRONMENT: "production",
});
const STAGING_ENV = Object.freeze({
  NODE_ENV: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});
const STAGING_REBUILD_ROLE_CAPABILITIES = Object.freeze([
  "runtime.baseline.rebuild_empty",
  "governance.baseline.rebuild_empty",
  "runtime_persistence.baseline.rebuild_empty",
]);

function tool(name) {
  return SYSTEM_LAYER_TOOLS.find((entry) => entry.name === name);
}

test("Recovery Action bridge descriptor is upgraded to the v2 server-managed confirmation contract", () => {
  synchronizeRecoverySystemToolDescriptors(PRODUCTION_ENV);
  const descriptor = tool("recovery_kernel_execute_approved_step");
  assert.ok(descriptor);
  assert.deepEqual(descriptor.inputSchema.required, ["plan_id", "plan_hash", "step_id", "idempotency_key"]);
  for (const key of ["approval_token", "approval_id", "expected_sha", "typed_confirmation", "idempotency_key"]) {
    assert.equal(Object.hasOwn(descriptor.inputSchema.properties, key), true, `${key} missing from bridge v2 descriptor`);
  }
  for (const key of ["execution_ticket_id", "execution_ticket_hash", "signature", "sql", "command"]) {
    assert.equal(Object.hasOwn(descriptor.inputSchema.properties, key), false, `${key} must remain server-controlled`);
  }
});

test("Staging Recovery tools are absent from Production catalog and present only in Staging", () => {
  synchronizeRecoverySystemToolDescriptors(PRODUCTION_ENV);
  assert.equal(SYSTEM_LAYER_TOOLS.some((entry) => entry.source_key === "staging_recovery_system_surface_v1"), false);

  const staging = synchronizeRecoverySystemToolDescriptors(STAGING_ENV);
  assert.equal(staging.staging_advertised, true);
  assert.equal(staging.staging_tool_count, 14);
  assert.deepEqual(
    SYSTEM_LAYER_TOOLS
      .filter((entry) => entry.source_key === "staging_recovery_system_surface_v1")
      .map((entry) => entry.name)
      .sort(),
    [
      "staging_recovery_certification_canary_plan_create",
      "staging_recovery_certification_canary_approve",
      "staging_recovery_certification_canary_execute",
      "prepareStagingActivationGatewayDarkDeployDryRun",
      "staging_recovery_access_repair_prepare",
      "staging_recovery_access_repair_execute",
      "staging_recovery_access_repair_approve",
      "staging_recovery_rebuild_empty_inspection_record",
      "staging_recovery_rebuild_empty_prepare",
      "staging_recovery_rebuild_empty_approve",
      "staging_recovery_system_surface_readiness",
      "staging_recovery_schema_repair_prepare",
      "staging_recovery_schema_repair_approve",
      "staging_recovery_schema_repair_execute",
    ].sort(),
  );

  synchronizeRecoverySystemToolDescriptors(PRODUCTION_ENV);
  assert.equal(SYSTEM_LAYER_TOOLS.some((entry) => entry.source_key === "staging_recovery_system_surface_v1"), false);
});

test("Staging Gateway dry-run dispatch stays on the server-resolved Recovery overlay", async () => {
  const input = {
    expected_source_commit: "a".repeat(40),
    expected_policy_hash: "b".repeat(64),
    environment_convergence_plan_sha256: "c".repeat(64),
  };
  let observed = null;
  const result = await _testingRecoverySystemToolOverlay.executeOverlayTool(
    "prepareStagingActivationGatewayDarkDeployDryRun",
    input,
    {
      env: STAGING_ENV,
      auth: { mode: "backend_api_key", principal_type: "admin", is_admin: true },
      gatewayPreflightDeps: {
        runtimePool: {},
        governancePool: {},
        runDarkDeploy: async (args, deps) => {
          observed = { args: { ...args }, auth: { ...(deps.auth || {}) } };
          return {
            ok: true,
            apply_ready: false,
            governance_state_mutation: false,
            provider_accessed: false,
            provider_mutation_performed: false,
            secrets_included: false,
          };
        },
      },
    },
  );
  assert.deepEqual(observed.args, { mode: "dry_run", ...input });
  assert.equal(observed.auth.is_admin, true);
  assert.equal(result.system_tool, "prepareStagingActivationGatewayDarkDeployDryRun");
  assert.equal(result.provider_accessed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.production_authority, false);
});

test("Staging capability reporting separates kernel discovery from bounded System control-plane writes", () => {
  const staging = projectRecoveryCapabilitiesForSystemSurface(STAGING_ENV);
  assert.equal(staging.environment_view, "staging_bounded_control_plane");
  assert.equal(staging.kernel_environment_view, "staging_discovery_only");
  assert.deepEqual(staging.control_plane_state_write_capabilities, [
    "staging_certification_canary_plan_create",
    "activation_gateway_dark_deploy_dry_run",
    "staging_database_access_repair",
    "staging_database_schema_repair",
    "database_full_inspection",
    "remediation_plan_create",
    "remediation_step_execute",
  ]);
  assert.deepEqual(staging.target_database_mutation_capabilities, []);
  assert.deepEqual(staging.rebuild_role_capability_keys, STAGING_REBUILD_ROLE_CAPABILITIES);
  assert.deepEqual(staging.local_handoff_mutation_capabilities, STAGING_REBUILD_ROLE_CAPABILITIES);
  assert.equal(staging.control_plane_state_write_capabilities.includes("staging_database_rebuild_empty"), false);
  assert.equal(staging.target_database_mutation_capabilities.includes("staging_database_rebuild_empty"), false);
  assert.equal(staging.system_surface_extensions.some((entry) => entry.capability_key === "staging_database_rebuild_empty"), false);
  assert.equal(staging.system_surface_extensions.find((entry) => entry.capability_key === "staging_database_schema_repair").state_scope, "allowlist_plan_approval_ticket_only");
  const gatewayDryRun = staging.system_surface_extensions.find((entry) => entry.capability_key === "activation_gateway_dark_deploy_dry_run");
  assert.equal(gatewayDryRun.state_scope, "short_lived_governance_execution_plan_only");
  assert.equal(gatewayDryRun.target_database_mutation, false);
  assert.equal(gatewayDryRun.provider_mutation, false);
  assert.equal(gatewayDryRun.production_authority, false);
  assert.equal(gatewayDryRun.caller_selected_target, false);
  assert.equal(gatewayDryRun.apply_authority_issued, false);
  assert.equal(staging.production_authority, false);
  assert.equal(staging.secrets_included, false);

  const production = projectRecoveryCapabilitiesForSystemSurface(PRODUCTION_ENV);
  assert.equal(production.environment_view, "production_private_recovery");
  assert.equal(Object.hasOwn(production, "system_surface_extensions"), false);
});

test("Staging access repair mutation is advertised only when execute and independent readback dependencies are complete", () => {
  const staging = projectRecoveryCapabilitiesForSystemSurface(STAGING_ENV, {
    hostBreakglassMutationExecutor: async () => ({ ok: true }),
    recoveryLock: { acquire() {} },
    readbackVerifier: { verify() {}, independent_authority: true, role_aware: true, mutation_authority: false },
    deploymentIdentityProvider: { readAttestation() {} },
    recoveryStore: { getPlan() {}, getExecutionTicket() {} },
  });
  assert.deepEqual(staging.target_database_mutation_capabilities, ["staging_database_access_repair"]);
  assert.equal(staging.system_surface_extensions.find((entry) => entry.capability_key === "staging_database_access_repair").state_scope, "plan_approval_execute_readback");
  assert.equal(staging.system_surface_extensions.find((entry) => entry.capability_key === "staging_database_schema_repair").state_scope, "allowlist_plan_approval_ticket_only");
});

test("Staging schema repair mutation is advertised only with fenced execution, durable ticket finalization, readback, and migration ledger", () => {
  const staging = projectRecoveryCapabilitiesForSystemSurface(STAGING_ENV, {
    hostBreakglassMutationExecutor: async () => ({ ok: true }),
    recoveryLock: { acquire() {}, heartbeat() {}, assertFence() {}, release() {} },
    readbackVerifier: { verify() {}, independent_authority: true, role_aware: true, mutation_authority: false },
    deploymentIdentityProvider: { readAttestation() {} },
    recoveryStore: { getPlan() {}, getExecutionTicket() {}, reserveExecutionTicket() {}, finalizeExecutionTicket() {}, markApprovalUsed() {} },
    migrationLedger: { finalize() {} },
  });
  assert.deepEqual(staging.target_database_mutation_capabilities, ["staging_database_access_repair", "staging_database_schema_repair"]);
  assert.equal(staging.system_surface_extensions.find((entry) => entry.capability_key === "staging_database_schema_repair").state_scope, "allowlist_plan_approval_execute_same_cycle_readback");
});

test("Bridge v2 validator accepts explicit server-managed confirmation fields and rejects caller tickets", () => {
  const explicit = {
    plan_id: `plan:${"1".repeat(32)}`,
    plan_hash: "2".repeat(64),
    step_id: `step:${"3".repeat(32)}`,
    approval_id: `approval:${"4".repeat(32)}`,
    expected_sha: "5".repeat(40),
    typed_confirmation: `APPROVE PRODUCTION RECOVERY approval:${"4".repeat(32)} step:${"3".repeat(32)} ${"5".repeat(40)}`,
    idempotency_key: "recovery-overlay-v2-001",
  };
  assert.equal(_testingRecoverySystemToolOverlay.validateBridgeArgs(explicit), explicit);
  assert.throws(
    () => _testingRecoverySystemToolOverlay.validateBridgeArgs({ ...explicit, execution_ticket_id: "ticket:caller-forbidden" }),
    (error) => error?.code === "recovery_kernel_execute_approved_step_field_forbidden" && error?.status === 400,
  );
});

console.log("recovery system tool overlay tests loaded");