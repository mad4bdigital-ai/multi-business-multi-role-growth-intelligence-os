import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

const migration = readFileSync(
  new URL("./migrations/313_sprint69_session_summary_surface_authority_recovery.sql", import.meta.url),
  "utf8"
);
const service = readFileSync(new URL("./sessionSummaryService.js", import.meta.url), "utf8");

for (const surfaceKey of [SURFACE_KEYS.SESSION_SUMMARY_MEMORY, SURFACE_KEYS.PLATFORM_GRAPH_MEMORY]) {
  assert.match(migration, new RegExp(surfaceKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(migration, /'active', 'authoritative', 'TRUE'/);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert.match(migration, /`required_for_execution` = 'TRUE'/);
assert.match(migration, /secrets_included=false/);
assert.match(migration, /No provider calls/);
assert.match(service, /SURFACE_KEYS\.SESSION_SUMMARY_MEMORY/);
assert.match(service, /SURFACE_KEYS\.PLATFORM_GRAPH_MEMORY/);

function surfaceRow(surfaceKey) {
  return {
    surface_id: surfaceKey,
    logical_surface_key: surfaceKey,
    surface_name: surfaceKey,
    surface_type: "runtime_memory",
    surface_scope: "runtime",
    storage_type: "sql",
    active_status: "active",
    authority_status: "authoritative",
    required_for_execution: "TRUE",
    resolution_rule: "sql_primary",
    owner_layer: "session_summary_runtime",
    schema_ref: surfaceKey === SURFACE_KEYS.SESSION_SUMMARY_MEMORY
      ? "session_summaries"
      : "platform_graph_nodes|platform_graph_edges",
    schema_version: "1",
    binding_mode: "sql_runtime_authority",
    sheet_role: "runtime_memory",
    backend_type: "sql",
    backend_adapter: "test",
    authority_model: "sql_runtime_authority",
    portability_class: "runtime_memory",
    repair_candidate_types: "surface_authority|readback",
    repair_priority: "high",
    updated_at: "2026-06-15T00:00:00.000Z",
  };
}

const pool = {
  async query(sql, params) {
    assert.match(sql, /registry_surfaces_catalog/);
    return [[surfaceRow(params[0])]];
  },
};

for (const surfaceKey of [SURFACE_KEYS.SESSION_SUMMARY_MEMORY, SURFACE_KEYS.PLATFORM_GRAPH_MEMORY]) {
  const result = await resolveSurfaceAuthority(surfaceKey, { requireExecution: true }, { pool });
  assert.equal(result.ok, true);
  assert.equal(result.code, "surface_authorized");
  assert.equal(result.resolved_surface_key, surfaceKey);
}

console.log("session summary surface authority recovery tests passed");
