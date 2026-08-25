import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_LAYER_TOOLS,
  callSystemLayerTool,
} from "./routes/systemLayerRoutes.js";

const SHA = "a".repeat(40);

function readOnlyResult() {
  return {
    ok: true,
    contract: "mad4b.host-breakglass-host-local-inspection.v1",
    status: "host_local_inspection_complete",
    mode: "dry_run",
    operation: "read_only",
    environment_key: "production_hostinger_autodeploy",
    target_key: "production-runtime",
    target_source: "host_local_role_env",
    migration: null,
    migration_selected: false,
    read_only: true,
    database_connection_performed: true,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    workflow_dispatch_performed: false,
    secrets_included: false,
  };
}

test("fixed host-local system tool is registered with a bounded admin-only schema", () => {
  const descriptor = SYSTEM_LAYER_TOOLS.find((tool) => tool.name === "host_local_role_inspection_dry_run");
  assert.ok(descriptor);
  assert.equal(descriptor.requires_admin, true);
  assert.deepEqual(descriptor.inputSchema.required, ["expected_sha"]);
  assert.equal(descriptor.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(descriptor.inputSchema.properties).sort(), ["expected_sha", "target_key"]);
});

test("fixed host-local system tool delegates directly to the injected read-only adapter", async () => {
  const calls = [];
  const result = await callSystemLayerTool(
    "host_local_role_inspection_dry_run",
    { expected_sha: SHA, target_key: "production-runtime" },
    { is_admin: true, mode: "backend_api_key" },
    {
      hostLocalInspectionExecutor: async (request, options) => {
        calls.push({ request, has_process_env: options.env === process.env, repoRoot: options.repoRoot });
        return readOnlyResult();
      },
    },
  );

  assert.deepEqual(result, readOnlyResult());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, { expected_sha: SHA, target_key: "production-runtime" });
  assert.equal(calls[0].has_process_env, true);
});

test("fixed host-local system tool rejects non-admin principals before adapter invocation", async () => {
  let invoked = false;
  await assert.rejects(
    () => callSystemLayerTool(
      "host_local_role_inspection_dry_run",
      { expected_sha: SHA },
      { is_admin: false, mode: "backend_api_key" },
      {
        hostLocalInspectionExecutor: async () => {
          invoked = true;
          return readOnlyResult();
        },
      },
    ),
    (error) => error?.code === "admin_system_tool_required" && error?.status === 403,
  );
  assert.equal(invoked, false);
});

test("fixed host-local system tool does not route to the generic endpoint facade", async () => {
  const calls = [];
  const result = await callSystemLayerTool(
    "host_local_role_inspection_dry_run",
    { expected_sha: SHA },
    { is_admin: true, mode: "backend_api_key" },
    {
      executionFacade: {
        execute: async () => {
          calls.push("generic_facade");
          throw new Error("generic facade must not be used");
        },
      },
      hostLocalInspectionExecutor: async () => readOnlyResult(),
    },
  );
  assert.equal(result.read_only, true);
  assert.deepEqual(calls, []);
});

test("production readiness probe delegates to a bounded read-only reader and accepts no arguments", async () => {
  const calls = [];
  const result = await callSystemLayerTool(
    "production_activation_readiness_probe",
    {},
    { is_admin: true, mode: "backend_api_key" },
    {
      productionActivationReadinessExecutor: async () => {
        calls.push("readiness");
        return {
          contract: "mad4b.production-activation-readiness.v1",
          status: "blocked",
          ok: false,
          ready: false,
          checks: {
            mcp_catalog_schema_ready: false,
            governance_db_privilege_ready: false,
            runtime_persistence_ready: false,
            mutation_attestation_complete: true,
          },
          read_only_probe: true,
          sql_mutation_performed: false,
          migration_apply_performed: false,
          provider_mutation_performed: false,
          deployment_performed: false,
          secrets_included: false,
        };
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(result.read_only_probe, true);
  assert.equal(result.sql_mutation_performed, false);
  await assert.rejects(
    () => callSystemLayerTool(
      "production_activation_readiness_probe",
      { unexpected: true },
      { is_admin: true, mode: "backend_api_key" },
      { productionActivationReadinessExecutor: async () => result },
    ),
    (error) => error?.code === "production_activation_readiness_arguments_forbidden" && error?.status === 400,
  );
});

test("production readiness probe rejects non-admin principals before invoking the reader", async () => {
  let invoked = false;
  await assert.rejects(
    () => callSystemLayerTool(
      "production_activation_readiness_probe",
      {},
      { is_admin: false, mode: "backend_api_key" },
      {
        productionActivationReadinessExecutor: async () => {
          invoked = true;
          return { ok: true };
        },
      },
    ),
    (error) => error?.code === "admin_system_tool_required" && error?.status === 403,
  );
  assert.equal(invoked, false);
});
