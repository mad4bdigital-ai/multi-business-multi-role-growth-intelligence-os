import assert from "node:assert/strict";

import { deviceToolsDiagnostics } from "./routes/deviceToolsRoutes.js";

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

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.device-tools.catalog-diagnostics.v1",
  no_connected_systems_causal_claim: true,
  projection_reconciliation_requires_live_sql_empty_readback: true,
  secrets_included: false,
}));
