import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPlatformCapabilityContractReport,
  buildPlatformCapabilityLiveReport,
  PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION,
  PLATFORM_CAPABILITY_LIVE_REPORT_VERSION,
} from "./platformCapabilityReports.js";

function createFakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes("FROM information_schema.TABLES")) {
        return [[
          { TABLE_NAME: "v_platform_capabilities_current", TABLE_TYPE: "VIEW" },
          { TABLE_NAME: "v_platform_bindings_current", TABLE_TYPE: "VIEW" },
          { TABLE_NAME: "v_platform_exports_current", TABLE_TYPE: "VIEW" },
          { TABLE_NAME: "v_platform_capability_maturity", TABLE_TYPE: "VIEW" },
          { TABLE_NAME: "v_platform_capability_gaps", TABLE_TYPE: "VIEW" },
          { TABLE_NAME: "capability_resolution_envelope_ledger", TABLE_TYPE: "BASE TABLE" },
          { TABLE_NAME: "platform_resource_authority_requirements", TABLE_TYPE: "BASE TABLE" },
          { TABLE_NAME: "runtime_dispatch_certification_registry", TABLE_TYPE: "BASE TABLE" },
          { TABLE_NAME: "platform_plugin_smoke_certifications", TABLE_TYPE: "BASE TABLE" },
          { TABLE_NAME: "platform_capability_source_resolutions", TABLE_TYPE: "BASE TABLE" },
        ]];
      }
      if (normalized.includes("FROM admin_platform_endpoint_tools")) {
        return [[
          { tool_key: "capability_resolution_dry_run" },
          { tool_key: "capability_resolution_envelope_create" },
          { tool_key: "capability_resolution_envelope_approve" },
        ]];
      }
      if (normalized === "SELECT UTC_TIMESTAMP() AS evaluated_at") {
        return [[{ evaluated_at: "2026-06-14 12:00:00" }]];
      }
      if (normalized.includes("AS observed_at") && normalized.includes("AS expires_at")) {
        return [[{ observed_at: "2026-06-14 12:00:00", expires_at: "2026-06-14 12:05:00" }]];
      }
      if (normalized.includes("COUNT(*) AS capability_count")) {
        return [[{ capability_count: 594, authority_required_count: 386, dispatch_allowed_count: 300, apply_allowed_count: 150 }]];
      }
      if (normalized.includes("FROM `v_platform_capability_maturity`") && normalized.includes("`maturity_status`")) {
        return [[{ maturity_status: "mature", count_rows: 200 }, { maturity_status: "partial", count_rows: 394 }]];
      }
      if (normalized.includes("FROM `v_platform_capability_gaps`") && normalized.includes("GROUP BY")) {
        return [[
          { gap_key: "active_export_missing", gap_severity: "low", count_rows: 68 },
          { gap_key: "authority_evidence_missing", gap_severity: "high", count_rows: 237 },
          { gap_key: "authority_evidence_missing", gap_severity: "medium", count_rows: 149 },
          { gap_key: "dispatch_not_allowed", gap_severity: "high", count_rows: 9 },
          { gap_key: "dispatch_not_allowed", gap_severity: "medium", count_rows: 48 },
        ]];
      }
      if (normalized.includes("FROM `capability_resolution_envelope_ledger`") && normalized.includes("`envelope_status`")) {
        return [[{ envelope_status: "ready_for_dispatch", count_rows: 10 }, { envelope_status: "expired", count_rows: 2 }]];
      }
      if (normalized.includes("FROM `capability_resolution_envelope_ledger`") && normalized.includes("`execution_status`")) {
        return [[{ execution_status: "executed", count_rows: 8 }, { execution_status: "not_executed", count_rows: 4 }]];
      }
      if (normalized.includes("FROM `runtime_dispatch_certification_registry`")) {
        return [[{ certification_status: "certified", count_rows: 17 }]];
      }
      if (normalized.includes("FROM `platform_capability_source_resolutions`")) {
        return [[{ status: "resolved", count_rows: 5 }, { status: "blocked", count_rows: 1 }]];
      }
      if (normalized.includes("FROM v_platform_capability_gaps") && normalized.includes("LIMIT ?")) {
        return [[{ capability_key: "example", gap_key: "authority_evidence_missing", gap_severity: "high", gap_description: "missing evidence" }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
}

const contractPool = createFakePool();
const contract = await buildPlatformCapabilityContractReport({}, { pool: contractPool });
assert.equal(contract.report_type, "contractual");
assert.equal(contract.report_version, PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION);
assert.equal(contract.selection.tool_key, "platform_capability_contract_report");
assert.equal(contract.selection.independent_from, "platform_capability_live_report");
assert.equal(contract.separation_guarantees.live_metrics_included, false);
assert.equal(Object.hasOwn(contract, "totals"), false);
assert.equal(Object.hasOwn(contract, "gap_distribution"), false);
assert.deepEqual(contract.contract_summary, { implemented: 3, partial: 3, proposed_not_implemented: 0 });
assert.equal(contract.checks.find((item) => item.contract_key === "generic_evidence_event_contract")?.status, "partial");
assert.equal(contract.checks.find((item) => item.contract_key === "capability_debt_contract")?.missing_required_surfaces[0], "platform_capability_debt");
assert.equal(contractPool.calls.some((call) => /COUNT\(\*\)|GROUP BY/i.test(call.sql)), false, "contract report must not query live counts");

const livePool = createFakePool();
const live = await buildPlatformCapabilityLiveReport({ limit: 10 }, { pool: livePool });
assert.equal(live.report_type, "operational_live");
assert.equal(live.report_version, PLATFORM_CAPABILITY_LIVE_REPORT_VERSION);
assert.equal(live.selection.tool_key, "platform_capability_live_report");
assert.equal(live.selection.independent_from, "platform_capability_contract_report");
assert.equal(live.separation_guarantees.contractual_conclusions_included, false);
assert.equal(live.separation_guarantees.historical_claims_included, false);
assert.deepEqual(live.totals, {
  capability_count: 594,
  gap_count: 511,
  authority_required_count: 386,
  dispatch_allowed_count: 300,
  apply_allowed_count: 150,
});
assert.equal(live.highest_priority_gaps.length, 1);
assert.equal(Object.hasOwn(live, "checks"), false);
assert.equal(Object.hasOwn(live, "contract_summary"), false);
assert.equal(livePool.calls.some((call) => call.sql.includes("information_schema.TABLES")), false, "live report must not query contract schema inventory");
assert.equal(livePool.calls.some((call) => call.sql.includes("admin_platform_endpoint_tools")), false, "live report must not query contract tool declarations");

const routes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.equal((routes.match(/name: "platform_capability_contract_report"/g) || []).length, 1);
assert.equal((routes.match(/name: "platform_capability_live_report"/g) || []).length, 1);
assert.match(routes, /buildPlatformCapabilityContractReport/);
assert.match(routes, /buildPlatformCapabilityLiveReport/);
assert.match(routes, /no_live_metrics/);
assert.match(routes, /freshness_bounded/);

console.log("platform capability split reports tests passed");