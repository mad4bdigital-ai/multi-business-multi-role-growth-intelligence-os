import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  analyzePhase1CapabilityRecords,
  buildPhase1CapabilityDiscoveryReport,
  PHASE1_CAPABILITY_DISCOVERY_REPORT_VERSION,
} from "./phase1CapabilityDiscoveryReport.js";

function source(overrides) {
  return {
    source: "unknown",
    table: "unknown",
    surface_family: "unknown",
    key_candidates: ["key"],
    parent_candidates: [],
    method_candidates: ["method"],
    path_candidates: ["path"],
    tag_candidates: ["tags"],
    exposure_candidates: ["exposure_scope"],
    status_candidates: ["status"],
    extra_candidates: [],
    source_status: "ready",
    total_active: 0,
    scanned_count: 0,
    truncated: false,
    rows: [],
    ...overrides,
  };
}

const fixtures = [
  source({
    source: "actions",
    table: "actions",
    surface_family: "action",
    key_candidates: ["action_key"],
    method_candidates: [],
    path_candidates: [],
    total_active: 1,
    scanned_count: 1,
    rows: [{ action_key: "github.write_file", tags: "mutation,capability_envelope,readback", status: "active" }],
  }),
  source({
    source: "endpoints",
    table: "endpoints",
    surface_family: "endpoint",
    key_candidates: ["endpoint_key"],
    parent_candidates: ["parent_action_key"],
    method_candidates: ["http_method"],
    path_candidates: ["http_path"],
    total_active: 1,
    scanned_count: 1,
    rows: [{ endpoint_key: "github_write_file", parent_action_key: "github.write_file", http_method: "POST", http_path: "/repos/{owner}/{repo}/contents/{path}", tags: "mutation,capability_envelope,readback", status: "active" }],
  }),
  source({
    source: "admin_tools",
    table: "admin_platform_endpoint_tools",
    surface_family: "admin_tool",
    key_candidates: ["tool_key"],
    method_candidates: ["http_method"],
    path_candidates: ["http_path"],
    exposure_candidates: [],
    exposure_default: "admin",
    status_candidates: ["is_enabled"],
    total_active: 3,
    scanned_count: 3,
    rows: [
      { tool_key: "capability_resolution_dry_run", http_method: "POST", http_path: "/admin/control", tags: "admin,capability_resolution,dry_run,no_execution,no_secrets", is_enabled: 1 },
      { tool_key: "repo_patch_apply", http_method: "VIRTUAL", http_path: "internal://repo-patch-apply", tags: "admin,mutation,capability_envelope,readback", is_enabled: 1 },
      { tool_key: "shared_status", http_method: "GET", http_path: "/status/shared", tags: "admin,diagnostics,read_only", is_enabled: 1 },
    ],
  }),
  source({
    source: "tenant_tools",
    table: "tenant_platform_endpoint_tools",
    surface_family: "tenant_tool",
    key_candidates: ["tool_key"],
    method_candidates: ["http_method"],
    path_candidates: ["http_path"],
    exposure_candidates: [],
    exposure_default: "tenant",
    status_candidates: ["is_enabled"],
    total_active: 2,
    scanned_count: 2,
    rows: [
      { tool_key: "repo_patch_apply", http_method: "VIRTUAL", http_path: "/tenant/repo-patch", tags: "tenant,mutation,capability_envelope,readback", is_enabled: 1 },
      { tool_key: "shared_status", http_method: "GET", http_path: "/status/shared", tags: "tenant,read_only", is_enabled: 1 },
    ],
  }),
  source({
    source: "app_tool_bindings",
    table: "app_integration_tool_bindings",
    surface_family: "app_tool_binding",
    key_candidates: ["tool_key"],
    parent_candidates: ["app_key"],
    method_candidates: [],
    path_candidates: [],
    exposure_candidates: ["exposure_scope"],
    extra_candidates: ["tool_surface", "binding_role"],
    total_active: 1,
    scanned_count: 1,
    rows: [{ app_key: "powershell", tool_key: "connector_ps", tool_surface: "admin_platform_tool", binding_role: "device_control", exposure_scope: "tenant", status: "active" }],
  }),
];

const analysis = analyzePhase1CapabilityRecords(fixtures, { limit: 50 });
assert.equal(analysis.inventory.complete, true);
assert.equal(analysis.inventory.active_surface_count, 8);
assert.equal(analysis.task_evidence.T011.status, "complete");
assert.ok(analysis.task_evidence.T012.items.some((item) => item.capability_identity === "github.write_file" && item.parity_status === "aligned"));
assert.ok(analysis.task_evidence.T012.items.some((item) => item.capability_identity === "repo_patch_apply"));
assert.ok(analysis.task_evidence.T013.items.some((item) => item.key === "connector_ps" && item.reasons.includes("admin_or_device_tool_bound_to_tenant_scope")));
assert.ok(analysis.task_evidence.T013.items.some((item) => item.key === "repo_patch_apply" && item.reasons.includes("admin_tool_key_overlap")));
assert.equal(analysis.task_evidence.T014.mutation_policy_gap_count, 1);
assert.equal(analysis.task_evidence.T014.gaps[0].key, "capability_resolution_dry_run");
assert.equal(analysis.task_evidence.T014.gaps[0].classification, "conservative_state_changing_default");

const report = await buildPhase1CapabilityDiscoveryReport(
  { limit: 25, scan_limit: 5000 },
  { now: () => "2026-06-25T00:00:00.000Z", loadSourceInventories: async () => fixtures },
);
assert.equal(report.ok, true);
assert.equal(report.report_version, PHASE1_CAPABILITY_DISCOVERY_REPORT_VERSION);
assert.equal(report.report_version, "phase1-capability-discovery-report-v1");
assert.equal(report.separation_guarantees.runtime_dispatch_performed, false);
assert.equal(report.separation_guarantees.provider_calls_performed, false);
assert.equal(report.separation_guarantees.credential_payloads_read, false);
assert.equal(report.separation_guarantees.mutations_performed, false);
assert.equal(report.secrets_included, false);
assert.equal(report.source_of_truth.registry, "mysql_primary");

const cliSource = await readFile(new URL("./scripts/phase1-capability-discovery-report.mjs", import.meta.url), "utf8");
assert.match(cliSource, /buildPhase1CapabilityDiscoveryReport/);
assert.doesNotMatch(cliSource, /\bfetch\s*\(|axios|child_process|execFile|spawn\s*\(/);

console.log("phase1 capability discovery report tests passed");
