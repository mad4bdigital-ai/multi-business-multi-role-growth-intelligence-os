import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_LAYER_TOOLS,
  callSystemLayerTool,
} from "./routes/systemLayerRoutes.js";

const ADMIN = { is_admin: true, mode: "backend_api_key" };
const TENANT = { is_admin: false, mode: "backend_api_key" };

function descriptor(name) {
  return SYSTEM_LAYER_TOOLS.find((tool) => tool.name === name);
}

test("shared system layer exposes only database-independent generic recovery discovery tools", () => {
  for (const name of ["recovery_kernel_capabilities", "system_tool_get", "system_tools_search"]) {
    assert.ok(descriptor(name), `${name} must be registered`);
    assert.equal(descriptor(name).requires_admin, true);
  }
  assert.equal(descriptor("host_local_role_inspection_dry_run"), undefined, "Production host-local inspection must not leak into shared catalog");
  assert.equal(descriptor("production_activation_readiness_probe"), undefined, "Production readiness probe must not leak into shared catalog");
  assert.deepEqual(Object.keys(descriptor("system_tool_get").inputSchema.properties), ["tool_name"]);
  assert.equal(descriptor("system_tool_get").inputSchema.additionalProperties, false);
  assert.equal(descriptor("system_tools_search").inputSchema.additionalProperties, false);
});

test("recovery capability matrix dispatches directly without generic endpoint facade", async () => {
  const calls = [];
  const result = await callSystemLayerTool(
    "recovery_kernel_capabilities",
    {},
    ADMIN,
    {
      executionFacade: { execute: async () => { calls.push("generic_facade"); } },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.catalog_source, "repository_static_contract");
  assert.ok(result.capabilities.some((entry) => entry.capability_key === "database_full_inspection"));
  assert.equal(result.secrets_included, false);
  assert.deepEqual(calls, []);
});

test("static system_tool_get and system_tools_search do not query the database", async () => {
  const lookup = await callSystemLayerTool("system_tool_get", { tool_name: "recovery_kernel_capabilities" }, ADMIN);
  assert.equal(lookup.tool.name, "recovery_kernel_capabilities");
  assert.equal(lookup.secrets_included, false);

  const search = await callSystemLayerTool("system_tools_search", { q: "recovery", limit: 10 }, ADMIN);
  assert.equal(search.catalog_mode, "repository_static_system_layer");
  assert.equal(search.database_query_performed, false);
  assert.ok(search.items.some((item) => item.name === "recovery_kernel_capabilities"));
  assert.equal(search.secrets_included, false);
});

test("generic fixed discovery tools remain admin-only before any handler or facade invocation", async () => {
  for (const name of ["recovery_kernel_capabilities", "system_tool_get", "system_tools_search"]) {
    let invoked = false;
    await assert.rejects(
      () => callSystemLayerTool(name, name === "system_tool_get" ? { tool_name: "recovery_kernel_capabilities" } : {}, TENANT, {
        executionFacade: { execute: async () => { invoked = true; } },
      }),
      (error) => error?.code === "admin_system_tool_required" && error?.status === 403,
    );
    assert.equal(invoked, false);
  }
});

test("shared dispatcher rejects the removed Production-specific names instead of reaching a generic facade", async () => {
  for (const name of ["host_local_role_inspection_dry_run", "production_activation_readiness_probe"]) {
    const calls = [];
    await assert.rejects(
      () => callSystemLayerTool(name, {}, ADMIN, {
        executionFacade: { execute: async () => { calls.push("generic_facade"); } },
      }),
      (error) => error?.code === "unknown_tool" && error?.status === 400,
    );
    assert.deepEqual(calls, []);
  }
});

test("Staging recovery capability view is discovery-only and omits Production private names", async () => {
  const staging = await callSystemLayerTool("recovery_kernel_capabilities", {}, ADMIN, { recoveryKernelEnv: { NODE_ENV: "staging" } });
  assert.equal(staging.environment_view, "staging_discovery_only");
  assert.deepEqual(staging.capabilities.map((entry) => entry.capability_key).sort(), ["recovery_capabilities", "system_tool_get", "system_tools_search"]);
  assert.equal(staging.secrets_included, false);
});

test("fixed recovery_kernel_call is available through the existing Admin dispatcher with environment fail-closed", async () => {
  const calls = [];
  const production = await callSystemLayerTool(
    "recovery_kernel_call",
    { capability_key: "recovery_capabilities", input: {} },
    ADMIN,
    {
      recoveryKernelEnv: { NODE_ENV: "production", GITHUB_REF_NAME: "Production" },
      executionFacade: { execute: async () => calls.push("generic_facade") },
    },
  );
  assert.equal(production.catalog_source, "repository_static_contract");
  assert.deepEqual(calls, []);

  let inspectionInvoked = false;
  await assert.rejects(
    () => callSystemLayerTool(
      "recovery_kernel_call",
      { capability_key: "database_full_inspection", input: { expected_sha: "a".repeat(40) } },
      ADMIN,
      {
        recoveryKernelEnv: { NODE_ENV: "staging" },
        hostLocalInspectionExecutor: async () => { inspectionInvoked = true; return {}; },
      },
    ),
    (error) => error?.code === "recovery_kernel_production_only" && error?.status === 404,
  );
  assert.equal(inspectionInvoked, false);
});
