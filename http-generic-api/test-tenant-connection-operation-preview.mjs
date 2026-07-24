import assert from "node:assert/strict";

import {
  buildTenantConnectionOperationPreview,
  TENANT_CONNECTION_OPERATION_PREVIEW_CONTRACT,
} from "./tenantConnectionOperationPreview.js";

const connection = {
  connection_id: "conn-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  app_key: "wordpress_rest",
  auth_type: "basic_auth",
  status: "active",
  validation_status: "validated",
  last_validated_at: "2026-07-22T00:00:00.000Z",
  last_used_at: null,
  is_primary: 1,
  password: "must-never-be-returned",
};

const tool = {
  tool_key: "tenant_connection_validate_adapter_smoke",
  http_method: "POST",
  http_path: "/me/connections/{connection_id}/validate-adapter-smoke",
  is_enabled: 0,
};

const result = await buildTenantConnectionOperationPreview({
  tenant_id: "tenant-1",
  user_id: "user-1",
  connection_id: "conn-1",
  tool_key: "tenant_connection_validate_adapter_smoke",
  adapter_key: "wordpress_rest",
}, {
  pool: {},
  loadConnectionMetadata: async () => connection,
  loadTenantToolContract: async () => tool,
  certificationPreview: async () => ({
    ok: true,
    adapter: { state: "pass" },
    certification: { state: "pass" },
    readback_contract: { state: "pass" },
    blockers: [],
    secrets_included: false,
  }),
});

assert.equal(result.ok, true);
assert.equal(result.status, "ready_for_read_only_preview");
assert.equal(result.connection.connection_id, "conn-1");
assert.equal(result.connection.secret_present, false);
assert.equal("password" in result.connection, false);
assert.equal(JSON.stringify(result).includes("must-never-be-returned"), false);
assert.equal(result.provider_call_performed, false);
assert.equal(result.credential_payload_read, false);
assert.equal(result.operation.execution_allowed, false);
assert.equal(result.secrets_included, false);
assert.equal(TENANT_CONNECTION_OPERATION_PREVIEW_CONTRACT.supported_operation_count, 9);

const missingConnection = await buildTenantConnectionOperationPreview({
  tenant_id: "tenant-1",
  connection_id: "missing",
  tool_key: "tenant_connection_effective_credential_plan_view",
}, {
  pool: {},
  loadConnectionMetadata: async () => null,
  loadTenantToolContract: async () => ({
    tool_key: "tenant_connection_effective_credential_plan_view",
    http_method: "GET",
    http_path: "/me/connections/{connection_id}/effective-credential-plan",
    is_enabled: 0,
  }),
  certificationPreview: async () => {
    throw new Error("must not run without connection metadata");
  },
});
assert.deepEqual(missingConnection.blockers, ["TENANT_CONNECTION_NOT_FOUND"]);
assert.equal(missingConnection.provider_call_performed, false);

const providerWrite = await buildTenantConnectionOperationPreview({
  tenant_id: "tenant-1",
  connection_id: "conn-1",
  tool_key: "tenant_connection_bounded_mutation_execute",
  adapter_key: "wordpress_rest",
}, {
  pool: {},
  loadConnectionMetadata: async () => connection,
  loadTenantToolContract: async () => ({
    tool_key: "tenant_connection_bounded_mutation_execute",
    http_method: "POST",
    http_path: "/me/connections/{connection_id}/mutations/execute",
    is_enabled: 0,
  }),
  certificationPreview: async () => ({ ok: true, blockers: [], secrets_included: false }),
});
assert.equal(providerWrite.blockers.includes("PROVIDER_WRITE_PREVIEW_ONLY"), true);
assert.equal(providerWrite.operation.provider_write_allowed, false);
assert.equal(providerWrite.execution_performed, false);

await assert.rejects(
  () => buildTenantConnectionOperationPreview({
    tenant_id: "tenant-1",
    connection_id: "conn-1",
    tool_key: "unknown_operation",
  }, { pool: {} }),
  (error) => error.code === "tenant_connection_operation_preview_unknown_tool" && error.status === 404
);

console.log("tenant connection operation preview tests passed");
