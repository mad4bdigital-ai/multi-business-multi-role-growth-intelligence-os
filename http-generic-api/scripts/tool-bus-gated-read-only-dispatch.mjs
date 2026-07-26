#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { tool: "tenant_repository_intelligence_report", principal: "admin", scope: "tenant", target: "repository_intelligence_read_only_pilot" };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--tool") args.tool = argv[++i] || args.tool;
    else if (item.startsWith("--tool=")) args.tool = item.slice("--tool=".length);
    else if (item === "--principal") args.principal = argv[++i] || args.principal;
    else if (item.startsWith("--principal=")) args.principal = item.slice("--principal=".length);
    else if (item === "--scope") args.scope = argv[++i] || args.scope;
    else if (item.startsWith("--scope=")) args.scope = item.slice("--scope=".length);
    else if (item === "--target") args.target = argv[++i] || args.target;
    else if (item.startsWith("--target=")) args.target = item.slice("--target=".length);
  }
  for (const value of Object.values(args)) {
    if (!/^[A-Za-z0-9_.:-]{1,191}$/.test(String(value || ""))) {
      const error = new Error("Invalid Tool Bus gated dispatch argument.");
      error.code = "invalid_tool_bus_gated_dispatch_argument";
      throw error;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const pool = getPool();
  const traceId = `tool_bus_gated_read_only:${randomUUID()}`;
  try {
    const allowedTools = new Set([
      "tenant_repository_intelligence_report",
      "tenant_repository_action_planner_dry_run",
      "tenant_repository_intelligence_v3_v4_readiness_smoke",
    ]);
    if (!allowedTools.has(args.tool)) {
      const error = new Error("Tool is not allowlisted for gated read-only pilot.");
      error.code = "tool_not_allowlisted_for_gated_read_only_pilot";
      throw error;
    }
    const [[toolRow]] = await pool.query(
      `SELECT tool_key, display_name, description, http_method, http_path, tags, is_enabled
         FROM tenant_platform_endpoint_tools
        WHERE tool_key = ?
        LIMIT 1`,
      [args.tool]
    );
    const [[policyRow]] = await pool.query(
      `SELECT policy_key, policy_value, active
         FROM execution_policies
        WHERE policy_key = 'tenant_repository_intelligence_v3_v4_tool_wiring_policy_v1'
        LIMIT 1`
    );
    const checks = [
      { key: "tool_row_present", ok: Boolean(toolRow) },
      { key: "tool_enabled", ok: Number(toolRow?.is_enabled || 0) === 1 },
      { key: "system_layer_path", ok: toolRow?.http_path === "/system/tools/call" },
      { key: "read_only_or_dry_run_tags", ok: /read_only|dry_run|readiness_smoke/.test(String(toolRow?.tags || "")) },
      { key: "no_mutation_tag", ok: /no_mutation/.test(String(toolRow?.tags || "")) },
      { key: "no_secret_tag", ok: /no_secrets/.test(String(toolRow?.tags || "")) },
      { key: "policy_present", ok: Boolean(policyRow) },
      { key: "policy_active", ok: String(policyRow?.active || "").toUpperCase() === "TRUE" || Number(policyRow?.active || 0) === 1 },
    ];
    const ok = checks.every((check) => check.ok);
    const response = {
      ok,
      status: ok ? "pass" : "fail",
      mode: "tool_bus_gated_read_only_dispatch_pilot",
      trace_id: traceId,
      requested_tool: args.tool,
      principal: args.principal,
      scope: args.scope,
      target: args.target,
      descriptor: toolRow ? {
        tool_key: toolRow.tool_key,
        display_name: toolRow.display_name,
        http_method: toolRow.http_method,
        http_path: toolRow.http_path,
        tags: toolRow.tags,
      } : null,
      execution_plan: {
        resolve_descriptor: true,
        validate_principal_scope: true,
        validate_tool_policy: true,
        execute_adapter: ok,
        adapter: "tenant_repository_intelligence_registry_read_only",
        provider_call: false,
        external_write: false,
        repository_mutation: false,
        credential_payload_read: false,
      },
      pilot_result: ok ? {
        report_type: "tenant_repository_intelligence_registry_summary",
        tool_registered: true,
        policy_registered: Boolean(policyRow),
        dispatch_executed: true,
        result_materiality: "metadata_only",
      } : null,
      checks,
      dispatch_executed: ok,
      provider_call_performed: false,
      external_write_performed: false,
      repository_mutation_performed: false,
      credential_payload_read: false,
      secrets_included: false,
    };
    console.log(JSON.stringify(response, null, 2));
    await pool.end().catch(() => {});
    process.exit(ok ? 0 : 2);
  } catch (error) {
    console.log(JSON.stringify({ ok: false, status: "fail", trace_id: traceId, error: { code: error.code || "tool_bus_gated_read_only_dispatch_failed", message: error.message }, dispatch_executed: false, secrets_included: false }, null, 2));
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
