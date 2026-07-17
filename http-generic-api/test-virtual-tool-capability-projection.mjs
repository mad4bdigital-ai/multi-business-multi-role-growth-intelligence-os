import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projection = readFileSync(new URL("./migrations/20260717_virtual_tool_capability_projection.sql", import.meta.url), "utf8");
const readback = readFileSync(new URL("./migrations/20260717_virtual_tool_readback_readiness.sql", import.meta.url), "utf8");
const bindingMigration = readFileSync(new URL("./migrations/311_sprint69_platform_tool_dispatch_binding_integrity.sql", import.meta.url), "utf8");
const virtualReconciler = readFileSync(new URL("./platformVirtualToolCapabilityReconciler.js", import.meta.url), "utf8");

for (const view of [
  "v_platform_virtual_tool_bindings_classified",
  "v_platform_virtual_tool_identity_resolution",
  "v_platform_virtual_tool_capabilities_current",
  "v_platform_virtual_tool_bindings_current",
  "v_platform_virtual_tool_exports_current",
  "v_platform_governed_capabilities_current",
  "v_platform_governed_bindings_current",
  "v_platform_governed_exports_current",
  "v_platform_virtual_tool_capability_gaps",
]) assert.match(projection, new RegExp(`CREATE OR REPLACE VIEW ${view}`));

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
  "CAPABILITY_IDENTITY_MISSING",
  "CAPABILITY_AMBIGUOUS",
  "PROJECTION_SCOPE_AMBIGUOUS",
  "OPERATION_CLASS_AMBIGUOUS",
  "READBACK_CONTRACT_REQUIRED",
  "TENANT_TO_ADMIN_SURFACE_BLOCKED",
  "CANONICAL_SOURCE_COLLISION_REVIEW_REQUIRED",
  "apply_allowed,0",
]) assert.match(projection, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const marker of [
  "platform_capability_readback_contracts",
  "v_platform_capability_readback_readiness",
  "readiness_state IN ('ready','shadow_only')",
  "CREATE OR REPLACE VIEW v_platform_capability_readiness_vector",
  "'pending','shadow'",
]) assert.match(readback, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const marker of [
  "VIRTUAL_TOOL_RECONCILIATION_SQL",
  "v_platform_virtual_tool_capabilities_current",
  "v_platform_virtual_tool_bindings_current",
  "v_platform_virtual_tool_exports_current",
  "v_platform_virtual_tool_capability_gaps",
  "platform_capability_readback_contracts",
  "apply_allowed=LEAST",
  "external_writes_made: 0",
]) assert.match(virtualReconciler, new RegExp(marker));

for (const migration of [projection, readback]) {
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|DATABASE)|\bTRUNCATE\s+TABLE|\bDELETE\s+FROM/i);
}
assert.doesNotMatch(projection, /WHERE\s+[^;]*tool_key\s*=\s*['\"]repo_patch_batch_apply['\"]/i);
assert.match(bindingMigration, /'repo_patch_batch_apply'/);
assert.match(bindingMigration, /'github_file_patch_apply'/);
assert.match(bindingMigration, /'github_change_set_branch_head_v1'/);

console.log("virtual tool capability projection tests passed");
