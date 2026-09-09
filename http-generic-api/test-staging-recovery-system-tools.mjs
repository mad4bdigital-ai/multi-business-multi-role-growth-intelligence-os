import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStagingRecoverySystemTools,
  isStagingRecoverySystemEnvironment,
  stagingRecoveryAccessRepairApprove,
  stagingRecoveryAccessRepairPrepare,
  stagingRecoveryCertificationCanaryPlanCreate,
  stagingRecoverySystemSurfaceReadiness,
} from "./stagingRecoverySystemTools.js";

const STAGING_ENV = Object.freeze({
  NODE_ENV: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});
const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_ENVIRONMENT: "production",
  REMOTE_MCP_ENVIRONMENT: "production",
});
const CONFLICTING_ENV = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});

const BUSINESS_TOOLS = [
  "staging_recovery_certification_canary_plan_create",
  "staging_recovery_access_repair_prepare",
  "staging_recovery_access_repair_execute",
  "staging_recovery_access_repair_approve",
];
const FORBIDDEN_CALLER_FIELDS = new Set([
  "target_key",
  "target_fingerprint",
  "operation",
  "raw_sql",
  "sql",
  "query",
  "command",
  "script",
  "credentials",
  "credential",
  "approval_token",
  "execution_ticket_id",
  "execution_ticket_hash",
  "signature",
  "grant_binding_hash",
  "repository_path",
  "ref",
]);

test("Staging Recovery System Tool descriptors are advertised only for unambiguous Staging", () => {
  assert.equal(isStagingRecoverySystemEnvironment(STAGING_ENV), true);
  assert.equal(isStagingRecoverySystemEnvironment(PRODUCTION_ENV), false);
  assert.equal(isStagingRecoverySystemEnvironment(CONFLICTING_ENV), false);
  assert.deepEqual(buildStagingRecoverySystemTools(PRODUCTION_ENV), []);
  assert.deepEqual(buildStagingRecoverySystemTools(CONFLICTING_ENV), []);

  const tools = buildStagingRecoverySystemTools(STAGING_ENV);
  assert.deepEqual(tools.map((tool) => tool.name), [
    ...BUSINESS_TOOLS,
    "staging_recovery_system_surface_readiness",
  ]);
  for (const tool of tools) {
    assert.equal(tool.requires_admin, true);
    assert.equal(tool.catalog_level, "private_recovery");
    assert.equal(tool.source_key, "staging_recovery_system_surface_v1");
  }
});

test("bounded Staging Recovery schemas never accept caller-selected execution or target authority", () => {
  const tools = buildStagingRecoverySystemTools(STAGING_ENV);
  for (const name of BUSINESS_TOOLS) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(tool.inputSchema.additionalProperties, false);
    const properties = new Set(Object.keys(tool.inputSchema.properties || {}));
    for (const forbidden of FORBIDDEN_CALLER_FIELDS) {
      assert.equal(properties.has(forbidden), false, `${name} must not expose ${forbidden}`);
    }
  }
  const prepare = tools.find((entry) => entry.name === "staging_recovery_access_repair_prepare");
  assert.deepEqual(prepare.inputSchema.required, ["expected_sha", "idempotency_key"]);
});

test("Production and conflicting-environment calls fail before any Staging recovery authority can be constructed", async () => {
  for (const env of [PRODUCTION_ENV, CONFLICTING_ENV]) {
    const attempts = [
      () => stagingRecoveryCertificationCanaryPlanCreate({ expected_sha: "a".repeat(40) }, { env }),
      () => stagingRecoveryAccessRepairPrepare({
        expected_sha: "a".repeat(40),
        idempotency_key: "staging-recovery-test-001",
      }, { env }),
      () => stagingRecoveryAccessRepairApprove({
        plan_id: `plan:${"1".repeat(32)}`,
        plan_hash: "2".repeat(64),
        step_id: `step:${"3".repeat(32)}`,
        idempotency_key: "staging-recovery-test-002",
        approval_confirmation: "APPROVE_STAGING_DATABASE_ACCESS_REPAIR:bounded",
      }, { env }),
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt, (error) => error?.code === "STAGING_RECOVERY_SYSTEM_SURFACE_UNAVAILABLE" && error?.status === 404);
    }
  }
});

test("surface readiness outside Staging is a no-mutation not-advertised verdict", async () => {
  const result = await stagingRecoverySystemSurfaceReadiness({}, { env: PRODUCTION_ENV });
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.available, false);
  assert.equal(result.production_authority, false);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
});

console.log("staging recovery system tool contract tests loaded");
