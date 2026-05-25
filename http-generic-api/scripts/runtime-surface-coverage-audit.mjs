#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const API_ROOT = path.resolve(path.dirname(__filename), "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");

const LEGACY_SURFACES = [
  {
    table: "execution_policies",
    sheet: "Execution Policy Registry",
    priority: "P0",
    intended_role: "blocking/degraded policy authority for governed execution, tool use, retries, mutation safety, and repair routing",
    current_gap: "data is loaded and counted for readiness, but policy_key/policy_value/blocking are not enforced by the generic tool dispatch path",
    required_services: ["runtimePolicyLoader", "runtimePolicyEnforcer", "governedExecutionPreflight"],
    enforcement_points: ["gptToolsRoutes.js", "adminCliRoutes.js", "connectorExecutor.js", "agentLoopRunner.js", "appAdapters/index.js"],
  },
  {
    table: "registry_surfaces_catalog",
    sheet: "Registry Surfaces Catalog",
    priority: "P0",
    intended_role: "surface authority, backend adapter, required-for-execution, read/write role, and schema binding resolver",
    current_gap: "catalog rows exist, but most runtime reads/writes do not pass a unified surface authority resolver",
    required_services: ["surfaceAuthorityResolver", "governedExecutionPreflight"],
    enforcement_points: ["registryMutations.js", "execution.js", "sessionSummaryService.js", "gptToolsRoutes.js"],
  },
  {
    table: "validation_repair",
    sheet: "Validation & Repair Registry",
    priority: "P0",
    intended_role: "repair routing, readback requirements, schema/header drift handling, and recovery classification authority",
    current_gap: "some loaders read the table, but repair decisions are mostly hardcoded in route/script code",
    required_services: ["repairPolicyRouter", "postToolUseReadbackVerifier", "governedExecutionPreflight"],
    enforcement_points: ["connectorProxyRoutes.js", "adminCliRoutes.js", "endpointRegistryAuthorityLayer.js", "registryMutations.js"],
  },
  {
    table: "task_routes",
    sheet: "Task Routes",
    priority: "P0",
    intended_role: "prompt routing authority for intent_key, route_mode, allowed states, degraded/blocked actions, and actor/governance constraints",
    current_gap: "rows are used in selected loaders, but there is no single prompt_router equivalent enforcing all routing columns before dispatch",
    required_services: ["runtimePromptRouter", "contextResolutionGate"],
    enforcement_points: ["connectorExecutor.js", "agentLoopRunner.js", "workflowOrchestrationRoutes.js"],
  },
  {
    table: "workflows",
    sheet: "Workflow Registry",
    priority: "P0",
    intended_role: "workflow authority for executable lifecycle, model/ingress compatibility, review requirement, and target module binding",
    current_gap: "agentLoopRunner and connectorExecutor load workflows, but not all governance columns are enforced consistently",
    required_services: ["workflowAuthorityResolver", "runtimePromptRouter"],
    enforcement_points: ["agentLoopRunner.js", "connectorExecutor.js", "workflowOrchestrationRoutes.js"],
  },
  {
    table: "actions",
    sheet: "Actions Registry",
    priority: "P0",
    intended_role: "action authority for runtime_callable, executor binding, variable contracts, actor roles, and governance levels",
    current_gap: "some action metadata is used, but tool dispatch can still rely on tool registry or virtual tools without action authority checks",
    required_services: ["actionAuthorityResolver", "toolManifestBuilder"],
    enforcement_points: ["gptToolsRoutes.js", "adminCliRoutes.js", "connectorExecutor.js", "agentLoopRunner.js"],
  },
  {
    table: "endpoints",
    sheet: "API Actions Endpoint Registry",
    priority: "P0",
    intended_role: "endpoint authority for provider route, auth validation, privacy validation, execution readiness, and transport binding",
    current_gap: "endpoint authority exists for some HTTP paths, but admin/virtual/app tools need a unified endpoint gate where applicable",
    required_services: ["endpointExecutionGate", "actionAuthorityResolver"],
    enforcement_points: ["gptToolsRoutes.js", "adminCliRoutes.js", "appAdapters/index.js", "connectorExecutor.js"],
  },
  {
    table: "brand_core",
    sheet: "Brand Core Registry",
    priority: "P1",
    intended_role: "brand writing and strategy context gate before brand-specific generation or external publication",
    current_gap: "context resolution uses brand core in places, but there is no universal preflight gate for every brand-writing workflow/tool",
    required_services: ["brandCoreGate", "contextResolutionGate"],
    enforcement_points: ["agentLoopRunner.js", "connectorExecutor.js", "appAdapters/index.js"],
  },
  {
    table: "brand_paths",
    sheet: "Brand Path Resolver",
    priority: "P1",
    intended_role: "brand-under-business-type path and target resolution authority",
    current_gap: "pathResolverDbLoader reads rows, but execution dispatch does not universally require resolved brand path evidence",
    required_services: ["contextResolutionGate"],
    enforcement_points: ["agentLoopRunner.js", "connectorExecutor.js", "executionPreparation.js"],
  },
  {
    table: "business_activity_types",
    sheet: "Business Activity Type Registry",
    priority: "P1",
    intended_role: "activity-first compatibility for knowledge profiles, engines, routes, workflows, and brand core requirements",
    current_gap: "available to loaders, but not always required before model/tool selection",
    required_services: ["contextResolutionGate", "toolManifestBuilder"],
    enforcement_points: ["agentLoopRunner.js", "connectorExecutor.js"],
  },
  {
    table: "business_type_profiles",
    sheet: "Business Type Knowledge Profiles",
    priority: "P1",
    intended_role: "knowledge profile and route/workflow compatibility authority for business-type-specific context",
    current_gap: "used by graph/path loaders, but not always enforced as compatibility gate",
    required_services: ["contextResolutionGate", "toolManifestBuilder"],
    enforcement_points: ["agentLoopRunner.js", "platformKnowledgeGraphResolver.js"],
  },
  {
    table: "hosting_accounts",
    sheet: "Hosting Account Registry",
    priority: "P2",
    intended_role: "hosting account resolver for Hostinger/API/SSH/WP-CLI readiness",
    current_gap: "Hostinger control often resolves via env or app connections; hosting_accounts is not the main execution resolver",
    required_services: ["hostingAccountResolver", "siteRuntimePreflightService"],
    enforcement_points: ["adminCliRoutes.js", "localGatewayToolsRoutes.js"],
  },
  {
    table: "site_runtime_inventory",
    sheet: "Site Runtime Inventory Registry",
    priority: "P2",
    intended_role: "site runtime preflight for supported CPTs, taxonomies, generated endpoints, and validation status",
    current_gap: "used mostly as readiness fallback or advisory inventory, not a universal preflight before site execution",
    required_services: ["siteRuntimePreflightService"],
    enforcement_points: ["connectorExecutor.js", "wordpress/phaseA.js"],
  },
  {
    table: "site_settings_inventory",
    sheet: "Site Settings Inventory Registry",
    priority: "P2",
    intended_role: "settings compatibility for permalink, language, timezone, theme, and content/site updates",
    current_gap: "not generally enforced before permalink/language-sensitive execution",
    required_services: ["siteRuntimePreflightService"],
    enforcement_points: ["connectorExecutor.js", "wordpress/phaseA.js"],
  },
  {
    table: "plugins",
    sheet: "Plugin Inventory Registry",
    priority: "P2",
    intended_role: "plugin capability gate for CPT/taxonomy/WooCommerce/SEO/translation operations",
    current_gap: "plugin inventory exists, but capability gating is not unified before WordPress/site tools",
    required_services: ["pluginCapabilityResolver", "siteRuntimePreflightService"],
    enforcement_points: ["connectorExecutor.js", "wordpress/phaseA.js"],
  },
  {
    table: "json_assets",
    sheet: "JSON Asset Registry",
    priority: "P3",
    intended_role: "portable memory/knowledge/artifact authority with validation and lifecycle status",
    current_gap: "used by graph/session summary code, but asset validation/active status is not a universal context gate",
    required_services: ["assetAuthorityGate", "contextResolutionGate"],
    enforcement_points: ["agentLoopRunner.js", "sessionSummaryService.js", "platformGraphMemoryResolver.js"],
  },
  {
    table: "execution_log",
    sheet: "Execution Log Unified",
    priority: "P3",
    intended_role: "execution evidence sink and compliance validator for route/logic/engine/artifact/recovery evidence",
    current_gap: "rows are written/read, but compliance validation is not a universal post-run gate",
    required_services: ["executionLogComplianceValidator"],
    enforcement_points: ["connectorExecutor.js", "agentLoopRunner.js", "execution.js"],
  },
];

const EXCLUDED_REF_PATTERNS = [
  /\/migrations\//,
  /\/docs\//,
  /\/test[^/]*\.mjs$/,
  /\/tests\//,
  /schema\.sql$/,
  /sqlAdapter\.js$/,
  /sqlCache\.js$/,
  /registrySource\.js$/,
  /releaseReadiness\.js$/,
  /check-runtime-tables\.mjs$/,
  /smoke-test-data-flow\.mjs$/,
  /migrate-legacy-to-platform\.mjs$/,
  /seed-/,
];

const TARGET_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts"]);
const CODE_DIRS = ["http-generic-api"];

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    json: args.has("--json"),
    markdown: args.has("--markdown"),
    includeSamples: !args.has("--no-samples"),
  };
}

function normalizeBoolean(value) {
  return ["true", "1", "yes", "global", "active"].includes(String(value || "").trim().toLowerCase());
}

async function pathExists(filePath) {
  try { await stat(filePath); return true; } catch { return false; }
}

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if ([".git", "node_modules", "coverage", "dist", "build", ".next"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (TARGET_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

async function collectCodeFiles() {
  const files = [];
  for (const dir of CODE_DIRS) {
    const absolute = path.join(REPO_ROOT, dir);
    if (await pathExists(absolute)) files.push(...await walk(absolute));
  }
  return files;
}

async function collectRefs(files, table) {
  const refs = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replaceAll(path.sep, "/");
    const content = await readFile(file, "utf8").catch(() => "");
    if (!content.includes(table)) continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(table)) refs.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 220) });
    }
  }
  const runtimeRefs = refs.filter((ref) => !EXCLUDED_REF_PATTERNS.some((pattern) => pattern.test(`/${ref.file}`)));
  return { total_refs: refs.length, runtime_refs: runtimeRefs.length, samples: runtimeRefs.slice(0, 8) };
}

async function tableColumns(pool, table) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function tableStats(pool, table) {
  const columns = await tableColumns(pool, table);
  if (!columns.length) return { exists: false, row_count: 0, last_write_at: null, columns: [] };
  const lastWriteExpr = columns.includes("updated_at")
    ? "MAX(updated_at)"
    : columns.includes("last_updated")
      ? "MAX(last_updated)"
      : columns.includes("last_validated_at")
        ? "MAX(last_validated_at)"
        : "NULL";
  const [rows] = await pool.query(`SELECT COUNT(*) AS row_count, ${lastWriteExpr} AS last_write_at FROM \`${table}\``);
  return {
    exists: true,
    row_count: Number(rows[0]?.row_count || 0),
    last_write_at: rows[0]?.last_write_at || null,
    columns,
  };
}

function inferCurrentStatus(surface, refs) {
  if (!refs.runtime_refs) return "registry_data_only";
  if (surface.priority === "P0" && ["execution_policies", "registry_surfaces_catalog", "validation_repair"].includes(surface.table)) {
    return "partial_or_readiness_only";
  }
  if (surface.priority === "P0") return "partial_runtime_use";
  return "partial_or_advisory_runtime_use";
}

function inferRecoveryNeed(surface, refs) {
  if (surface.table === "execution_policies") return "Add policy loader/enforcer and call it before tool dispatch, PR merge/delete, app actions, connector dispatch, and model tool loops.";
  if (surface.table === "registry_surfaces_catalog") return "Add surfaceAuthorityResolver and require read/write surface authority for governed registry, artifact, and Google Workspace targets.";
  if (surface.table === "validation_repair") return "Add repairPolicyRouter and post-tool readback verifier so failures route to registry-defined repair handlers.";
  if (surface.table === "task_routes") return "Recreate prompt_router semantics as runtimePromptRouter before selecting workflows/tools.";
  if (surface.table === "workflows") return "Add workflowAuthorityResolver to enforce lifecycle, model/ingress compatibility, review_required, and target module binding.";
  if (surface.table === "actions") return "Add actionAuthorityResolver and feed allowed actions into toolManifestBuilder.";
  if (surface.table === "endpoints") return "Add endpointExecutionGate for provider route/readiness/auth/privacy checks before HTTP/admin/app-provider execution.";
  if (surface.priority === "P1") return "Connect to contextResolutionGate before model/tool selection and brand-specific outputs.";
  if (surface.priority === "P2") return "Connect to siteRuntimePreflightService before WordPress/site/hosting operations.";
  return "Connect to post-run evidence, memory, and compliance validators.";
}

function buildAgentRuntimeBridge() {
  return {
    target: "Governed Canonical Agent Runtime",
    reason: "Claude/Anthropic-style agents require provider adapters, content-block messages, native tool_use/tool_result loops, permissions, pre/post hooks, deferred tool search, session compaction, cost accounting, and audit.",
    registry_dependency_chain: [
      "execution_policies -> PreToolUse/PostToolUse policy classification",
      "actions/endpoints/workflows -> tool manifest and executable authority",
      "task_routes/business profiles/brand paths -> prompt routing and context gates",
      "registry_surfaces_catalog -> read/write surface authority",
      "validation_repair -> repair routing and readback requirements",
      "execution_log/json_assets -> durable evidence and memory",
    ],
    proposed_services: [
      "modelProviderAdapters",
      "canonicalMessageProtocol",
      "toolManifestBuilder",
      "deferredToolSearch",
      "governedToolUseLoop",
      "runtimePolicyLoader",
      "surfaceAuthorityResolver",
      "repairPolicyRouter",
      "governedExecutionPreflight",
      "sessionCompactor",
      "usageCostLedger",
    ],
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Runtime Surface Coverage Audit");
  lines.push("");
  lines.push(`Generated at: ${report.generated_at}`);
  lines.push(`Runtime authority: ${report.data_source.runtime_authority}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const item of report.summary) lines.push(`- ${item.priority}: ${item.count} surfaces`);
  lines.push("");
  lines.push("## Agent Runtime Bridge");
  lines.push("");
  lines.push(report.agent_runtime_bridge.reason);
  lines.push("");
  lines.push("## Surfaces");
  lines.push("");
  for (const surface of report.surfaces) {
    lines.push(`### ${surface.table}`);
    lines.push("");
    lines.push(`- Sheet: ${surface.sheet}`);
    lines.push(`- Priority: ${surface.priority}`);
    lines.push(`- Rows: ${surface.row_count}`);
    lines.push(`- Current status: ${surface.current_status}`);
    lines.push(`- Gap: ${surface.current_gap}`);
    lines.push(`- Recovery: ${surface.recovery_need}`);
    lines.push(`- Required services: ${surface.required_services.join(", ")}`);
    lines.push(`- Enforcement points: ${surface.enforcement_points.join(", ")}`);
    if (surface.samples?.length) {
      lines.push("- Runtime refs:");
      for (const ref of surface.samples.slice(0, 3)) lines.push(`  - ${ref.file}:${ref.line}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv);
  const pool = getPool();
  const files = await collectCodeFiles();
  const surfaces = [];

  for (const surface of LEGACY_SURFACES) {
    const [stats, refs] = await Promise.all([
      tableStats(pool, surface.table),
      collectRefs(files, surface.table),
    ]);
    surfaces.push({
      ...surface,
      exists: stats.exists,
      row_count: stats.row_count,
      last_write_at: stats.last_write_at,
      column_count: stats.columns.length,
      refs: { total: refs.total_refs, runtime: refs.runtime_refs },
      samples: options.includeSamples ? refs.samples : [],
      current_status: inferCurrentStatus(surface, refs),
      recovery_need: inferRecoveryNeed(surface, refs),
      enforcement_missing: surface.required_services,
    });
  }

  const priorities = new Map();
  for (const s of surfaces) priorities.set(s.priority, (priorities.get(s.priority) || 0) + 1);

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    secrets_included: false,
    data_source: {
      runtime_authority: "sql",
      sheets_role: "async_mirror_and_recovery",
    },
    summary: [...priorities.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([priority, count]) => ({ priority, count })),
    agent_runtime_bridge: buildAgentRuntimeBridge(),
    surfaces,
  };

  if (options.markdown && !options.json) console.log(toMarkdown(report));
  else console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "runtime_surface_coverage_audit_failed", message: error.message }, secrets_included: false }, null, 2));
  process.exit(1);
});
