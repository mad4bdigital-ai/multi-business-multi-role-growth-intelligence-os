import assert from "node:assert/strict";

import { deviceToolsDiagnostics, signedDeviceRegistryScope } from "./routes/deviceToolsRoutes.js";

assert.deepEqual(
  deviceToolsDiagnostics("sql", 0),
  {
    catalog_source: "sql_registry",
    dispatch_available: false,
    reason_code: "device_tool_projection_empty",
  },
);

assert.deepEqual(
  deviceToolsDiagnostics("github_snapshot", 0),
  {
    catalog_source: "runtime_recovery_snapshot",
    dispatch_available: false,
    reason_code: "runtime_recovery_snapshot_read_only",
  },
);

assert.deepEqual(
  deviceToolsDiagnostics("repository_snapshot", 0),
  {
    catalog_source: "runtime_recovery_snapshot",
    dispatch_available: false,
    reason_code: "runtime_recovery_snapshot_read_only",
  },
);

assert.deepEqual(
  deviceToolsDiagnostics("sql", 2),
  {
    catalog_source: "sql_registry",
    dispatch_available: true,
    reason_code: null,
  },
);

assert.equal(signedDeviceRegistryScope({}), null);
assert.equal(signedDeviceRegistryScope({ auth: { mode: "api_credential",
  user_id: "alice", tenant_id: "tenant1" }, query: { device_id: "other" } }), null);
assert.equal(signedDeviceRegistryScope({ auth: { mode: "user_jwt", user_id: "", tenant_id: "t" } }), null);
assert.equal(signedDeviceRegistryScope({ auth: { mode: "user_jwt", user_id: "u", tenant_id: "" } }), null);
assert.deepEqual(signedDeviceRegistryScope({
  auth: { mode: "user_jwt", user_id: "user-a", tenant_id: "tenant-a" },
  query: { user_id: "victim", tenant_id: "other-tenant" },
}), { user_id: "user-a", tenant_id: "tenant-a" });
// Discovery data stays read-only; the route does not dispatch remote commands.

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.device-tools.catalog-diagnostics.v1",
  no_connected_systems_causal_claim: true,
  projection_reconciliation_requires_live_sql_empty_readback: true,
  secrets_included: false,
}));
