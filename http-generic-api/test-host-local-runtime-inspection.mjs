import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHostLocalRoleInspectionRequest,
  executeHostLocalRoleInspection,
  _testingHostLocalRuntimeInspection,
} from "./hostLocalRuntimeInspection.js";

const SHA = "a".repeat(40);
const MANIFEST = JSON.stringify({
  repository: _testingHostLocalRuntimeInspection.CANONICAL_REPOSITORY,
  branch: _testingHostLocalRuntimeInspection.PRODUCTION_BRANCH,
  commit_sha: SHA,
  source: "test-manifest",
  secrets_included: false,
});

function validInput(overrides = {}) {
  return {
    expected_sha: SHA,
    target_key: _testingHostLocalRuntimeInspection.PRODUCTION_TARGET_KEY,
    ...overrides,
  };
}

function validEnv(overrides = {}) {
  return {
    DEPLOYMENT_MANIFEST_JSON: MANIFEST,
    DB_NAME: "runtime-test",
    DB_USER: "runtime-user",
    ...overrides,
  };
}

test("host-local adapter binds exact identity before invoking bootstrap", async () => {
  let invocation;
  const result = await executeHostLocalRoleInspection(validInput(), {
    env: validEnv(),
    contractReader: () => ({ contract: "test" }),
    bootstrapRunner: async ({ env }) => {
      invocation = { ...env };
      return {
        ok: true,
        status: "dry_run_complete",
        database_connection_performed: true,
        database_mutation_performed: false,
        migration_apply_performed: false,
        grant_mutation_performed: false,
        secrets_included: false,
      };
    },
  });

  assert.equal(result.contract, "mad4b.host-breakglass-host-local-inspection.v1");
  assert.equal(result.status, "host_local_inspection_complete");
  assert.equal(result.target_source, "host_local_role_env");
  assert.equal(result.migration, null);
  assert.equal(result.migration_selected, false);
  assert.equal(result.migration_selection, "full_inspection_catalog");
  assert.equal(result.database_connection_performed, true);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.migration_apply_performed, false);
  assert.equal(result.grant_mutation_performed, false);
  assert.equal(result.workflow_dispatch_performed, false);
  assert.equal(invocation.BOOTSTRAP_MODE, "dry_run");
  assert.equal(invocation.BOOTSTRAP_TARGET_SOURCE, "host_local_role_env");
  assert.equal(invocation.BOOTSTRAP_EXPECTED_SHA, SHA);
  assert.equal(invocation.BOOTSTRAP_EXPECTED_BRANCH, "Production");
  assert.equal(invocation.BOOTSTRAP_EXPECTED_REPOSITORY, _testingHostLocalRuntimeInspection.CANONICAL_REPOSITORY);
  assert.equal(invocation.BOOTSTRAP_TARGET_KEY, "production-runtime");
  assert.equal(invocation.HOST_BREAKGLASS_OPERATION, "database.inspect");
  assert.equal(invocation.HOST_BREAKGLASS_ENVIRONMENT_KEY, "production_hostinger_autodeploy");
  assert.equal(invocation.HOST_BREAKGLASS_HOST_LOCAL_ROLE_CREDENTIALS, "true");
  assert.equal(Object.hasOwn(invocation, "BOOTSTRAP_MIGRATION"), false);
  assert.equal(Object.hasOwn(invocation, "BOOTSTRAP_MIGRATION_CONFIRMATION"), false);
});

test("host-local adapter rejects credentials and database controls from the request", () => {
  assert.throws(
    () => buildHostLocalRoleInspectionRequest({ expected_sha: SHA, password: "not-used" }),
    (error) => error.code === "host_local_inspection_request_field_forbidden",
  );
  assert.throws(
    () => buildHostLocalRoleInspectionRequest({ expected_sha: SHA, database: "not-used" }),
    (error) => error.code === "host_local_inspection_request_field_forbidden",
  );
});

test("host-local adapter fails closed on identity mismatch before bootstrap or database connection", async () => {
  let called = false;
  await assert.rejects(
    executeHostLocalRoleInspection(validInput(), {
      env: validEnv({ DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ repository: _testingHostLocalRuntimeInspection.CANONICAL_REPOSITORY, branch: "main", commit_sha: SHA }) }),
      bootstrapRunner: async () => { called = true; },
    }),
    (error) => error.status === 412 && error.code === "host_local_runtime_branch_mismatch" && error.details.database_connection_performed === undefined,
  );
  assert.equal(called, false);
});

test("host-local adapter requires migration omission and dry-run full inspection", () => {
  assert.throws(
    () => _testingHostLocalRuntimeInspection.normalizeInspectionPlan({
      environment_key: "production_hostinger_autodeploy",
      operation_key: "database.inspect",
      runbook_key: "database.full_inspection",
      action: "apply_migration",
      expected_sha: SHA,
      target_source: "host_local_role_env",
      target_key: "production-runtime",
    }),
    (error) => error.code === "host_local_inspection_mode_denied",
  );
  assert.throws(
    () => _testingHostLocalRuntimeInspection.normalizeInspectionPlan({
      environment_key: "production_hostinger_autodeploy",
      operation_key: "database.inspect",
      runbook_key: "database.full_inspection",
      action: "dry_run",
      expected_sha: SHA,
      target_source: "host_local_role_env",
      target_key: "production-runtime",
      migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
    }),
    (error) => error.code === "host_local_inspection_migration_forbidden",
  );
});

test("host-local adapter sanitizes bootstrap failures and never authorizes mutation", async () => {
  await assert.rejects(
    executeHostLocalRoleInspection(validInput(), {
      env: validEnv(),
      bootstrapRunner: async () => {
        const error = new Error("connection failed with password=hidden");
        error.code = "bootstrap_credentials_missing";
        error.details = { database_connection_performed: false, password: "hidden", sql: "SELECT secret" };
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.status, 412);
      assert.equal(error.code, "host_local_inspection_failed");
      assert.equal(error.details.database_mutation_performed, false);
      assert.equal(error.details.migration_apply_performed, false);
      assert.equal(error.details.grant_mutation_performed, false);
      assert.equal(Object.hasOwn(error.details.runtime_error.details, "password"), false);
      assert.equal(Object.hasOwn(error.details.runtime_error.details, "sql"), false);
      assert.doesNotMatch(JSON.stringify(error), /hidden|SELECT secret/i);
      return true;
    },
  );
});

test("host-local adapter rejects unsafe mutation flags from an injected runner", async () => {
  await assert.rejects(
    executeHostLocalRoleInspection(validInput(), {
      env: validEnv(),
      bootstrapRunner: async () => ({
        ok: true,
        database_connection_performed: true,
        database_mutation_performed: true,
        migration_apply_performed: false,
        grant_mutation_performed: false,
      }),
    }),
    (error) => error.status === 500 && error.code === "host_local_inspection_mutation_flagged",
  );
});
