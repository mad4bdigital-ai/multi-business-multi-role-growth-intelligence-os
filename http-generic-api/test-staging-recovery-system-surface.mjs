import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT,
  STAGING_RECOVERY_SYSTEM_TOOLS,
  isStagingRecoverySystemEnvironment,
  stagingRecoverySurfaceReadinessSmoke,
} from "./stagingRecoverySystemSurface.js";

const names = STAGING_RECOVERY_SYSTEM_TOOLS.map((tool) => tool.name);

test("Staging Recovery system surface is bounded, admin-only, environment-scoped, and secret-safe", () => {
  assert.equal(STAGING_RECOVERY_SYSTEM_SURFACE_CONTRACT, "mad4b.staging-recovery-system-surface.v1");
  assert.deepEqual(names, [
    "staging_certification_canary_plan_create",
    "staging_recovery_access_repair_prepare",
    "staging_recovery_access_repair_approve",
    "staging_recovery_surface_readiness_smoke",
  ]);
  for (const tool of STAGING_RECOVERY_SYSTEM_TOOLS) {
    assert.equal(tool.requires_admin, true);
    assert.deepEqual(tool.environments, ["staging"]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.doesNotMatch(JSON.stringify(tool.inputSchema), /raw_sql|command|script|credential|database_name|production-runtime/iu);
  }
});

test("Staging environment classification fails closed for Production signals", () => {
  assert.equal(isStagingRecoverySystemEnvironment({ NODE_ENV: "staging" }), true);
  assert.equal(isStagingRecoverySystemEnvironment({ DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker" }), true);
  assert.equal(isStagingRecoverySystemEnvironment({ NODE_ENV: "production", REMOTE_MCP_ENVIRONMENT: "staging" }), false);
  assert.equal(isStagingRecoverySystemEnvironment({ NODE_ENV: "test" }), false);
});

test("readiness smoke is non-mutating and reports environment scoping", async () => {
  const result = await stagingRecoverySurfaceReadinessSmoke();
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.environment_scope, "staging_only");
  assert.equal(result.control_plane_state_write_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.production_mutation_performed, false);
  assert.equal(result.secrets_included, false);
});
