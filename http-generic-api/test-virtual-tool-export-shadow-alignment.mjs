import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260719_virtual_tool_export_shadow_alignment.sql", import.meta.url),
  "utf8",
);
const reconciler = readFileSync(
  new URL("./platformVirtualToolCapabilityReconciler.js", import.meta.url),
  "utf8",
);

for (const marker of [
  "CREATE OR REPLACE VIEW v_platform_virtual_tool_exports_current",
  "'shadow' AS export_status",
  "platform_tool_dispatch_bindings",
  "platform_plugin_capability_exports",
  "export_status=VALUES(export_status)",
  "no_provider_call=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.doesNotMatch(migration, /'active'\s+AS\s+export_status/i);
assert.doesNotMatch(migration, /admin_platform_endpoint_tools|tenant_platform_endpoint_tools/i);
assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);
assert.match(reconciler, /FROM v_platform_virtual_tool_exports_current/);
assert.doesNotMatch(reconciler, /'active'\s+AS\s+export_status/i);

console.log("virtual tool export shadow alignment tests passed");
