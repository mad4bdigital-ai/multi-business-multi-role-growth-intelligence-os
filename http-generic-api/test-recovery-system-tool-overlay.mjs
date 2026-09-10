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
  assert.equal(staging.staging_tool_count, 5);
  assert.deepEqual(
    SYSTEM_LAYER_TOOLS.filter((entry) => entry.source_key === "staging_recovery_system_surface_v1").map((entry) => entry.name),
    [
      "staging_recovery_certification_canary_plan_create",
      "staging_recovery_access_repair_prepare",
      "staging_recovery_access_repair_execute",
      "staging_recovery_access_repair_approve",
      "staging_recovery_system_surface_readiness",
    ],
  );

  synchronizeRecoverySystemToolDescriptors(PRODUCTION_ENV);
  assert.equal(SYSTEM_LAYER_TOOLS.some((entry) => entry.source_key === "staging_recovery_system_surface_v1"), false);
});

test("Staging capability reporting separates kernel discovery from bounded System control-plane writes", () => {
  const staging = projectRecoveryCapabilitiesForSystemSurface(STAGING_ENV);
  assert.equal(staging.environment_view, "staging_bounded_control_plane");
  assert.equal(staging.kernel_environment_view, "staging_discovery_only");
  assert.deepEqual(staging.control_plane_state_write_capabilities, [
    "staging_certification_canary_plan_create",
    "staging_database_access_repair",
  ]);
  assert.deepEqual(staging.target_database_mutation_capabilities, []);
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
