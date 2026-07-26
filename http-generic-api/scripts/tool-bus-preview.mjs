#!/usr/bin/env node
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { name: "runtime_endpoint_call", principal: "admin", scope: "admin", target: "preview_only" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--name") args.name = argv[++i] || args.name;
    else if (item.startsWith("--name=")) args.name = item.slice("--name=".length);
    else if (item === "--principal") args.principal = argv[++i] || args.principal;
    else if (item.startsWith("--principal=")) args.principal = item.slice("--principal=".length);
    else if (item === "--scope") args.scope = argv[++i] || args.scope;
    else if (item.startsWith("--scope=")) args.scope = item.slice("--scope=".length);
    else if (item === "--target") args.target = argv[++i] || args.target;
    else if (item.startsWith("--target=")) args.target = item.slice("--target=".length);
  }
  for (const [key, value] of Object.entries(args)) {
    if (!/^[a-zA-Z0-9_.:-]{1,191}$/.test(String(value || ""))) {
      const error = new Error(`Invalid ${key}.`);
      error.code = `invalid_${key}`;
      throw error;
    }
  }
  return args;
}

async function rows(pool, sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result || [];
}

function kernelDescriptor(name) {
  if (name !== "runtime_endpoint_call") return null;
  return {
    tool_name: "runtime_endpoint_call",
    source_table: "SYSTEM_LAYER_TOOLS",
    surface: "system_layer_kernel_tool",
    status: "active",
    http_method: "POST",
    http_path: "/system/tools/call",
    dispatch_mode: "preview_only_no_dispatch",
    self_recursive: false,
  };
}

async function registryMatches(pool, name) {
  return [
    ...await rows(pool, `SELECT tool_key AS tool_name, 'admin_platform_endpoint_tools' AS source_table, CASE WHEN is_enabled=1 THEN 'active' ELSE 'disabled' END AS status, http_method, http_path, tags FROM admin_platform_endpoint_tools WHERE tool_key=?`, [name]),
    ...await rows(pool, `SELECT tool_key AS tool_name, 'tenant_platform_endpoint_tools' AS source_table, CASE WHEN is_enabled=1 THEN 'active' ELSE 'disabled' END AS status, http_method, http_path, tags FROM tenant_platform_endpoint_tools WHERE tool_key=?`, [name]),
    ...await rows(pool, `SELECT tool_name, 'platform_endpoint_tool_exports' AS source_table, status, NULL AS http_method, NULL AS http_path, NULL AS tags FROM platform_endpoint_tool_exports WHERE tool_name=? OR export_key=?`, [name, name]),
  ];
}

async function main() {
  const args = parseArgs();
  const pool = getPool();
  try {
    const kernel = kernelDescriptor(args.name);
    const matches = await registryMatches(pool, args.name);
    const activeMatches = matches.filter((row) => String(row.status || "").toLowerCase() === "active");
    const tenantRecursive = await rows(pool, `SELECT tool_key FROM tenant_platform_endpoint_tools WHERE is_enabled=1 AND http_path IN ('/system/tools/call','/gpt/tools/call')`);
    const descriptor = kernel || activeMatches[0] || matches[0] || null;
    const checks = [
      { key: "descriptor_resolved", ok: Boolean(descriptor) },
      { key: "principal_present", ok: Boolean(args.principal) },
      { key: "scope_present", ok: Boolean(args.scope) },
      { key: "target_present", ok: Boolean(args.target) },
      { key: "no_active_self_recursive_tenant_wrappers", ok: tenantRecursive.length === 0 },
      { key: "preview_mode_only", ok: true },
      { key: "provider_call_disabled", ok: true },
      { key: "target_write_disabled", ok: true },
    ];
    const ok = checks.every((check) => check.ok);
    console.log(JSON.stringify({
      ok,
      mode: "tool_bus_preview_only",
      descriptor,
      registry_match_count: matches.length,
      active_registry_match_count: activeMatches.length,
      principal: args.principal,
      scope: args.scope,
      target: args.target,
      preview_plan: {
        resolve_descriptor: true,
        validate_principal_scope: true,
        validate_input_schema: "schema_contract_placeholder_no_payload",
        validate_credential_binding_presence: "metadata_only_not_secret_payload",
        validate_resource_authority: "preview_only_required_before_live_dispatch",
        execute_adapter: false,
        provider_call: false,
        target_write: false,
      },
      checks,
      dispatch_executed: false,
      provider_call_performed: false,
      external_write_performed: false,
      credential_payload_read: false,
      secrets_included: false,
    }, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: { code: error.code || "tool_bus_preview_failed", message: error.message }, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
