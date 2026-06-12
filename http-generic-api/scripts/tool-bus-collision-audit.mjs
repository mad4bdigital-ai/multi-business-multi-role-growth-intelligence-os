#!/usr/bin/env node
import { getPool } from "../db.js";

const INTENTIONAL_DUAL_SURFACES = new Set([
  "gpt_session_conversation_ref_capture_current",
  "gpt_session_conversation_ref_mark_primary",
  "gpt_session_conversation_ref_upsert",
  "local_gateway_tools_call",
  "local_gateway_tools_list",
]);
const INTENTIONAL_DUPLICATE_EXPORTS = new Map([
  ["google_docs_api__getDocument", "legacy_bootstrap_export_duplicate"],
  ["runtime_endpoint_call", "kernel_transition_export_duplicate"],
]);

async function query(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

function classify(row) {
  const sources = String(row.sources || "").split(",").filter(Boolean);
  const uniqueSources = new Set(sources);
  if (INTENTIONAL_DUAL_SURFACES.has(row.tool_name) && uniqueSources.has("admin_platform_endpoint_tools") && uniqueSources.has("tenant_platform_endpoint_tools")) {
    return { classification: "intentional_admin_tenant_dual_surface", blocking: false };
  }
  if (INTENTIONAL_DUPLICATE_EXPORTS.has(row.tool_name) && uniqueSources.size === 1 && uniqueSources.has("platform_endpoint_tool_exports")) {
    return { classification: INTENTIONAL_DUPLICATE_EXPORTS.get(row.tool_name), blocking: false };
  }
  return { classification: "actual_collision_requires_review", blocking: true };
}

async function main() {
  const pool = getPool();
  try {
    const collisions = await query(pool, `
      SELECT tool_name, COUNT(*) AS active_surface_count, GROUP_CONCAT(source_table ORDER BY source_table SEPARATOR ',') AS sources
        FROM (
          SELECT tool_key AS tool_name, 'admin_platform_endpoint_tools' AS source_table FROM admin_platform_endpoint_tools WHERE is_enabled=1
          UNION ALL SELECT tool_key AS tool_name, 'tenant_platform_endpoint_tools' AS source_table FROM tenant_platform_endpoint_tools WHERE is_enabled=1
          UNION ALL SELECT tool_name, 'platform_endpoint_tool_exports' AS source_table FROM platform_endpoint_tool_exports WHERE status='active'
        ) x
       GROUP BY tool_name
      HAVING COUNT(*) > 1
       ORDER BY active_surface_count DESC, tool_name
    `);
    const classified = collisions.map((row) => ({ ...row, ...classify(row) }));
    const blocking = classified.filter((row) => row.blocking);
    const tenantRecursive = await query(pool, `SELECT tool_key, http_path, tags FROM tenant_platform_endpoint_tools WHERE is_enabled=1 AND http_path IN ('/system/tools/call','/gpt/tools/call') ORDER BY tool_key`);
    const ok = blocking.length === 0 && tenantRecursive.length === 0;
    console.log(JSON.stringify({
      ok,
      mode: "read_only_classification_audit",
      collision_count: collisions.length,
      blocking_collision_count: blocking.length,
      classifications: classified,
      self_recursive_tenant_wrapper_count: tenantRecursive.length,
      self_recursive_tenant_wrappers: tenantRecursive,
      action_taken: "none",
      recommended_next_action: ok ? "record_classification_as_non_blocking" : "review_blocking_collisions_before_preview_or_dispatch",
      dispatch_executed: false,
      provider_call_performed: false,
      external_write_performed: false,
      credential_payload_read: false,
      secrets_included: false,
    }, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: { code: error.code || "tool_bus_collision_audit_failed", message: error.message }, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
