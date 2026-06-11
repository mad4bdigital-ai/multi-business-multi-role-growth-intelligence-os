#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { name: "runtime_endpoint_call", principal: "admin", scope: "admin" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--name") args.name = argv[++i] || args.name;
    else if (item.startsWith("--name=")) args.name = item.slice("--name=".length);
    else if (item === "--principal") args.principal = argv[++i] || args.principal;
    else if (item.startsWith("--principal=")) args.principal = item.slice("--principal=".length);
    else if (item === "--scope") args.scope = argv[++i] || args.scope;
    else if (item.startsWith("--scope=")) args.scope = item.slice("--scope=".length);
  }
  args.name = String(args.name || "").trim();
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(args.name)) {
    const err = new Error("Invalid tool descriptor name.");
    err.code = "invalid_tool_descriptor_name";
    throw err;
  }
  return args;
}

async function query(pool, sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows || [];
}

function kernelDescriptor(name) {
  const kernel = {
    runtime_endpoint_call: {
      tool_name: "runtime_endpoint_call",
      source_table: "SYSTEM_LAYER_TOOLS",
      surface: "system_layer_kernel_tool",
      exposure_scope: "admin_or_tenant_with_principal_guard",
      status: "active",
      http_method: "POST",
      http_path: "/system/tools/call",
      self_recursive: false,
      dispatch_mode: "kernel_dispatch_dry_run_capable",
      requires_descriptor_validation: true,
      secrets_included: false,
    },
    runtime_endpoint_preview: {
      tool_name: "runtime_endpoint_preview",
      source_table: "SYSTEM_LAYER_TOOLS",
      surface: "system_layer_kernel_tool",
      exposure_scope: "admin_or_tenant_with_principal_guard",
      status: "active",
      http_method: "POST",
      http_path: "/system/tools/call",
      self_recursive: false,
      dispatch_mode: "kernel_preview_only",
      requires_descriptor_validation: true,
      secrets_included: false,
    },
  };
  return kernel[name] || null;
}

async function registryDescriptors(pool, name) {
  const rows = [];
  rows.push(...await query(pool, `SELECT tool_key AS tool_name, 'admin_platform_endpoint_tools' AS source_table, 'admin_platform_tool' AS surface, 'admin' AS exposure_scope, CASE WHEN is_enabled=1 THEN 'active' ELSE 'disabled' END AS status, http_method, http_path, tags, description AS notes FROM admin_platform_endpoint_tools WHERE tool_key = ?`, [name]));
  rows.push(...await query(pool, `SELECT tool_key AS tool_name, 'tenant_platform_endpoint_tools' AS source_table, 'tenant_platform_tool' AS surface, 'tenant' AS exposure_scope, CASE WHEN is_enabled=1 THEN 'active' ELSE 'disabled' END AS status, http_method, http_path, tags, description AS notes FROM tenant_platform_endpoint_tools WHERE tool_key = ?`, [name]));
  rows.push(...await query(pool, `SELECT tool_name, 'platform_endpoint_tool_exports' AS source_table, 'platform_endpoint_tool_export' AS surface, scope_class AS exposure_scope, status, NULL AS http_method, NULL AS http_path, NULL AS tags, notes FROM platform_endpoint_tool_exports WHERE tool_name = ? OR export_key = ?`, [name, name]));
  rows.push(...await query(pool, `SELECT source_key AS tool_name, source_table, export_surface AS surface, exposure_scope, export_status AS status, http_method, http_path, NULL AS tags, notes FROM v_platform_exports_current_v2 WHERE source_key = ? OR capability_key = ?`, [name, name]));
  return rows;
}

async function collisionReport(pool) {
  const [rows] = await pool.query(`
    SELECT tool_name, COUNT(*) AS active_surface_count, GROUP_CONCAT(source_table ORDER BY source_table SEPARATOR ',') AS sources
      FROM (
        SELECT tool_key AS tool_name, 'admin_platform_endpoint_tools' AS source_table FROM admin_platform_endpoint_tools WHERE is_enabled=1
        UNION ALL
        SELECT tool_key AS tool_name, 'tenant_platform_endpoint_tools' AS source_table FROM tenant_platform_endpoint_tools WHERE is_enabled=1
        UNION ALL
        SELECT tool_name, 'platform_endpoint_tool_exports' AS source_table FROM platform_endpoint_tool_exports WHERE status='active'
      ) x
     GROUP BY tool_name
    HAVING COUNT(*) > 1
     ORDER BY active_surface_count DESC, tool_name
     LIMIT 50
  `);
  return rows || [];
}

async function selfRecursiveTenantWrappers(pool) {
  return await query(pool, `SELECT tool_key, is_enabled, http_path, tags FROM tenant_platform_endpoint_tools WHERE http_path IN ('/system/tools/call','/gpt/tools/call') AND is_enabled=1 ORDER BY tool_key`);
}

async function main() {
  const args = parseArgs();
  const pool = getPool();
  try {
    const kernel = kernelDescriptor(args.name);
    const registry = await registryDescriptors(pool, args.name);
    const collisions = await collisionReport(pool);
    const recursiveWrappers = await selfRecursiveTenantWrappers(pool);
    const activeRegistry = registry.filter((row) => String(row.status || "").toLowerCase() === "active");
    const descriptor = kernel || activeRegistry[0] || registry[0] || null;
    const descriptorStatus = descriptor ? "resolved" : "not_found";
    const selfRecursiveBlocked = recursiveWrappers.length === 0;
    const safeCollisionCount = collisions.filter((row) => row.tool_name !== args.name).length;
    const ok = descriptorStatus === "resolved" && selfRecursiveBlocked && safeCollisionCount === 0;
    console.log(JSON.stringify({
      ok,
      dry_run: true,
      requested_name: args.name,
      principal: args.principal,
      scope: args.scope,
      descriptor_status: descriptorStatus,
      descriptor,
      registry_match_count: registry.length,
      active_registry_match_count: activeRegistry.length,
      self_recursive_tenant_wrapper_count: recursiveWrappers.length,
      self_recursive_tenant_wrappers: recursiveWrappers,
      collision_count: collisions.length,
      collisions,
      dispatch_executed: false,
      provider_call_performed: false,
      external_write_performed: false,
      credential_payload_read: false,
      secrets_included: false,
    }, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: { code: error.code || "tool_bus_descriptor_dry_run_failed", message: error.message }, dispatch_executed: false, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
