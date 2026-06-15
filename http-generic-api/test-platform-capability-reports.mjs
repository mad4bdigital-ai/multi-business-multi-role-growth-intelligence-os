import assert from "node:assert/strict";
import {
  buildPlatformCapabilityContractReport,
  buildPlatformCapabilityLiveReport,
  PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION,
  PLATFORM_CAPABILITY_LIVE_REPORT_VERSION,
} from "./platformCapabilityReports.js";

const contractObjects = [
  "v_platform_capabilities_current", "v_platform_bindings_current", "v_platform_exports_current", "v_platform_capability_maturity", "v_platform_capability_gaps",
  "platform_plugins", "platform_plugin_capabilities", "platform_plugin_bindings", "platform_plugin_capability_exports", "platform_capability_source_links",
  "platform_evidence_events", "platform_capability_envelope_evidence_links", "platform_capability_envelope_binding_links", "platform_capability_certifications",
  "platform_capability_debt", "platform_closure_threads", "platform_secret_movement_ledger", "v_effective_platform_resource_authority_bindings",
  "v_platform_capability_readiness_vector", "v_platform_capability_assurance_gaps", "v_platform_capability_assurance_summary",
  "capability_resolution_envelope_ledger", "platform_resource_authority_requirements", "runtime_dispatch_certification_registry",
  "platform_plugin_smoke_certifications", "platform_capability_source_resolutions", "repo_capability_candidates",
];

function createFakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes("FROM information_schema.TABLES"))
        return [contractObjects.map((TABLE_NAME) => ({ TABLE_NAME, TABLE_TYPE: TABLE_NAME.startsWith("v_") ? "VIEW" : "BASE TABLE" }))];
      if (normalized.includes("FROM admin_platform_endpoint_tools")) return [[
        { tool_key: "capability_resolution_dry_run" }, { tool_key: "capability_resolution_envelope_create" },
        { tool_key: "capability_resolution_envelope_approve" }, { tool_key: "platform_capability_assurance_reconcile" },
      ]];
      if (normalized === "SELECT UTC_TIMESTAMP() AS evaluated_at") return [[{ evaluated_at: "2026-06-15 00:00:00" }]];
      if (normalized.includes("AS observed_at") && normalized.includes("AS expires_at"))
        return [[{ observed_at: "2026-06-15 00:00:00", expires_at: "2026-06-15 00:05:00" }]];
      if (normalized.includes("FROM v_platform_capability_readiness_vector") && normalized.includes("COUNT(*) AS capability_count")) return [[{
        capability_count: 607, authority_required_count: 31, dispatch_allowed_count: 550, apply_allowed_count: 14,
        certified_count: 45, provenance_ready_count: 607, resource_binding_ready_count: 590, hard_blocked_count: 17,
      }]];
      if (normalized.includes("FROM `v_platform_capability_maturity`") && normalized.includes("`maturity_status`"))
        return [[{ maturity_status: "exported", count_rows: 532 }, { maturity_status: "certified", count_rows: 45 }]];
      if (normalized.includes("FROM `v_platform_capability_assurance_gaps`") && normalized.includes("GROUP BY")) return [[
        { gap_key: "resource_binding_missing", gap_severity: "high", count_rows: 7 },
        { gap_key: "dispatch_not_allowed", gap_severity: "medium", count_rows: 10 },
        { gap_key: "active_export_missing", gap_severity: "low", count_rows: 4 },
      ]];
      if (normalized.includes("FROM `capability_resolution_envelope_ledger`") && normalized.includes("`envelope_status`"))
        return [[{ envelope_status: "ready_for_dispatch", count_rows: 10 }]];
      if (normalized.includes("FROM `capability_resolution_envelope_ledger`") && normalized.includes("`execution_status`"))
        return [[{ execution_status: "referenced", count_rows: 9 }, { execution_status: "executed", count_rows: 1 }]];
      if (normalized.includes("FROM `platform_capability_certifications`")) return [[{ certification_status: "certified", count_rows: 45 }]];
      if (normalized.includes("FROM `platform_capability_source_links`")) return [[{ resolution_status: "resolved", count_rows: 607 }]];
      if (normalized.includes("FROM `platform_capability_debt`")) return [[{ status: "open", severity: "high", count_rows: 7 }]];
      if (normalized.includes("FROM v_platform_capability_assurance_gaps") && normalized.includes("LIMIT ?")) return [[{
        capability_key: "resource_authority_route_family.github_write", gap_key: "resource_binding_missing",
        gap_severity: "high", gap_description: "missing effective resource binding",
      }]];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
}

const contractPool = createFakePool();
const contract = await buildPlatformCapabilityContractReport({}, { pool: contractPool });
assert.equal(contract.report_type, "contractual");
assert.equal(contract.report_version, PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION);
assert.equal(contract.report_version, "platform-capability-contract-report-v2");
assert.deepEqual(contract.contract_summary, { implemented: 10, partial: 0, proposed_not_implemented: 0 });
assert.equal(contract.checks.find((item) => item.contract_key === "generic_evidence_event_contract")?.status, "implemented");
assert.equal(contract.checks.find((item) => item.contract_key === "capability_debt_contract")?.status, "implemented");
assert.equal(contractPool.calls.some((call) => /COUNT\(\*\)|GROUP BY/i.test(call.sql)), false);

const livePool = createFakePool();
const live = await buildPlatformCapabilityLiveReport({ limit: 10 }, { pool: livePool });
assert.equal(live.report_type, "operational_live");
assert.equal(live.report_version, PLATFORM_CAPABILITY_LIVE_REPORT_VERSION);
assert.equal(live.report_version, "platform-capability-live-report-v2");
assert.deepEqual(live.totals, {
  capability_count: 607, gap_count: 21, authority_required_count: 31, dispatch_allowed_count: 550, apply_allowed_count: 14,
  certified_count: 45, provenance_ready_count: 607, resource_binding_ready_count: 590, hard_blocked_count: 17,
});
assert.equal(live.highest_priority_gaps[0].gap_key, "resource_binding_missing");
assert.equal(live.source_of_truth.views.includes("v_platform_capability_assurance_gaps"), true);
assert.equal(livePool.calls.some((call) => call.sql.includes("information_schema.TABLES")), false);
assert.equal(livePool.calls.some((call) => call.sql.includes("admin_platform_endpoint_tools")), false);
console.log("platform capability assurance reports tests passed");
