import { getPool } from "./db.js";

export const PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION = "platform-capability-contract-report-v2";
export const PLATFORM_CAPABILITY_LIVE_REPORT_VERSION = "platform-capability-live-report-v2";

const CONTRACT_OBJECTS = Object.freeze([
  "v_platform_capabilities_current",
  "v_platform_bindings_current",
  "v_platform_exports_current",
  "v_platform_capability_maturity",
  "v_platform_capability_gaps",
  "platform_plugins",
  "platform_plugin_capabilities",
  "platform_plugin_bindings",
  "platform_plugin_capability_exports",
  "platform_capability_source_links",
  "platform_evidence_events",
  "platform_capability_envelope_evidence_links",
  "platform_capability_envelope_binding_links",
  "platform_capability_certifications",
  "platform_capability_debt",
  "platform_closure_threads",
  "platform_secret_movement_ledger",
  "v_effective_platform_resource_authority_bindings",
  "v_platform_capability_readiness_vector",
  "v_platform_capability_assurance_gaps",
  "v_platform_capability_assurance_summary",
  "capability_resolution_envelope_ledger",
  "platform_resource_authority_requirements",
  "runtime_dispatch_certification_registry",
  "platform_plugin_smoke_certifications",
]);

const CONTRACT_TOOLS = Object.freeze([
  "capability_resolution_dry_run",
  "capability_resolution_envelope_create",
  "capability_resolution_envelope_approve",
  "platform_capability_assurance_reconcile",
]);

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

async function queryRows(pool, sql, params = []) {
  return rowsOf(await pool.query(sql, params));
}

function contractCheck({ key, title, required = [], alternatives = [], objectSet, toolSet, notes = [] }) {
  const requiredMissing = required.filter((name) => !objectSet.has(name) && !toolSet.has(name));
  const alternativesPresent = alternatives.filter((name) => objectSet.has(name) || toolSet.has(name));
  const status = requiredMissing.length === 0
    ? "implemented"
    : alternativesPresent.length > 0
      ? "partial"
      : "proposed_not_implemented";
  return {
    contract_key: key,
    title,
    status,
    required_surfaces: required,
    missing_required_surfaces: requiredMissing,
    specialized_alternatives_present: alternativesPresent,
    notes,
  };
}

export async function buildPlatformCapabilityContractReport(_args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const [objects, tools, nowRows] = await Promise.all([
    queryRows(
      pool,
      `SELECT TABLE_NAME, TABLE_TYPE
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${CONTRACT_OBJECTS.map(() => "?").join(",")})
        ORDER BY TABLE_NAME`,
      [...CONTRACT_OBJECTS]
    ),
    queryRows(
      pool,
      `SELECT tool_key
         FROM admin_platform_endpoint_tools
        WHERE tool_key IN (${CONTRACT_TOOLS.map(() => "?").join(",")})
          AND is_enabled = 1
        ORDER BY tool_key`,
      [...CONTRACT_TOOLS]
    ),
    queryRows(pool, "SELECT UTC_TIMESTAMP() AS evaluated_at"),
  ]);
  const objectSet = new Set(objects.map((row) => row.TABLE_NAME));
  const toolSet = new Set(tools.map((row) => row.tool_key));
  const checks = [
    contractCheck({
      key: "canonical_capability_graph",
      title: "Canonical plugin, capability, binding, and export graph",
      required: ["platform_plugins", "platform_plugin_capabilities", "platform_plugin_bindings", "platform_plugin_capability_exports"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "capability_assurance_projection",
      title: "Independent readiness vector and typed assurance gaps",
      required: ["v_platform_capability_readiness_vector", "v_platform_capability_assurance_gaps", "v_platform_capability_assurance_summary"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "envelope_governed_execution",
      title: "Envelope-governed capability resolution foundation",
      required: ["capability_resolution_envelope_ledger", "capability_resolution_dry_run", "capability_resolution_envelope_create", "capability_resolution_envelope_approve"],
      objectSet,
      toolSet,
      notes: ["The envelope is invocation-scoped evidence; it is not a permanent capability property."],
    }),
    contractCheck({
      key: "resource_authority_contract",
      title: "Resource authority requirements and capability-specific effective bindings",
      required: ["platform_resource_authority_requirements", "v_effective_platform_resource_authority_bindings", "platform_capability_envelope_binding_links"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "generic_evidence_event_contract",
      title: "Generic capability evidence events and envelope links",
      required: ["platform_evidence_events", "platform_capability_envelope_evidence_links"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "generic_capability_certification_contract",
      title: "Generic capability certification registry",
      required: ["platform_capability_certifications"],
      alternatives: ["runtime_dispatch_certification_registry", "platform_plugin_smoke_certifications"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "capability_provenance_contract",
      title: "Canonical capability provenance and source resolution",
      required: ["platform_capability_source_links"],
      objectSet,
      toolSet,
      notes: ["Specialized repository and upload candidate tables remain valid for their own ingestion workflows."],
    }),
    contractCheck({
      key: "capability_debt_contract",
      title: "Persistent capability debt and closure lifecycle",
      required: ["platform_capability_debt", "platform_closure_threads"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "secret_movement_contract",
      title: "No-plaintext secret movement ledger",
      required: ["platform_secret_movement_ledger"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "assurance_reconciliation_contract",
      title: "Envelope-gated capability assurance reconciliation",
      required: ["platform_capability_assurance_reconcile"],
      objectSet,
      toolSet,
      notes: ["Dry-run is the default; apply requires a ready capability envelope."],
    }),
  ];
  return {
    ok: true,
    report_type: "contractual",
    report_version: PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION,
    evaluated_at: nowRows[0]?.evaluated_at || null,
    selection: { tool_key: "platform_capability_contract_report", independent_from: "platform_capability_live_report" },
    separation_guarantees: {
      live_metrics_included: false,
      historical_numeric_snapshots_verified: false,
      runtime_dispatch_performed: false,
      mutations_performed: false,
    },
    contract_summary: {
      implemented: checks.filter((item) => item.status === "implemented").length,
      partial: checks.filter((item) => item.status === "partial").length,
      proposed_not_implemented: checks.filter((item) => item.status === "proposed_not_implemented").length,
    },
    checks,
    limitations: [
      "This report verifies declared contract surfaces as they exist now; it does not certify past CI states or deployment parity.",
      "Use platform_capability_live_report separately for current operational metrics.",
    ],
    secrets_included: false,
  };
}

async function groupedCounts(pool, table, keyColumns) {
  const select = keyColumns.map((key) => `\`${key}\``).join(", ");
  const group = keyColumns.map((key) => `\`${key}\``).join(", ");
  return queryRows(pool, `SELECT ${select}, COUNT(*) AS count_rows FROM \`${table}\` GROUP BY ${group} ORDER BY ${group}`);
}

export async function buildPlatformCapabilityLiveReport(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const limit = Math.max(1, Math.min(Number(args.limit || 25), 100));
  const [clock, totals, maturity, gaps, envelopeStatuses, executionStatuses, certifications, sourceResolutions, debtStatuses, gapRows] = await Promise.all([
    queryRows(pool, "SELECT UTC_TIMESTAMP() AS observed_at, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) AS expires_at"),
    queryRows(pool, `SELECT COUNT(*) AS capability_count,
                            SUM(authority_requirement_type IN ('resource','combined','approval','quota')) AS authority_required_count,
                            SUM(dispatchable = 1) AS dispatch_allowed_count,
                            SUM(applyable = 1) AS apply_allowed_count,
                            SUM(certified = 1) AS certified_count,
                            SUM(provenance_ready = 1) AS provenance_ready_count,
                            SUM(resource_binding_ready = 1) AS resource_binding_ready_count,
                            SUM(hard_block_count > 0) AS hard_blocked_count
                       FROM v_platform_capability_readiness_vector`),
    groupedCounts(pool, "v_platform_capability_maturity", ["maturity_status"]),
    groupedCounts(pool, "v_platform_capability_assurance_gaps", ["gap_key", "gap_severity"]),
    groupedCounts(pool, "capability_resolution_envelope_ledger", ["envelope_status"]),
    groupedCounts(pool, "capability_resolution_envelope_ledger", ["execution_status"]),
    groupedCounts(pool, "platform_capability_certifications", ["certification_status"]),
    groupedCounts(pool, "platform_capability_source_links", ["source_kind", "resolution_status"]),
    groupedCounts(pool, "platform_capability_debt", ["status", "severity"]),
    queryRows(
      pool,
      `SELECT capability_key, gap_key, gap_severity, gap_description
         FROM v_platform_capability_assurance_gaps
        ORDER BY FIELD(gap_severity, 'critical', 'high', 'medium', 'low'), gap_key, capability_key
        LIMIT ?`,
      [limit]
    ),
  ]);
  const totalRow = totals[0] || {};
  const gapCount = gaps.reduce((sum, row) => sum + Number(row.count_rows || 0), 0);
  return {
    ok: true,
    report_type: "operational_live",
    report_version: PLATFORM_CAPABILITY_LIVE_REPORT_VERSION,
    observed_at: clock[0]?.observed_at || null,
    expires_at: clock[0]?.expires_at || null,
    freshness_class: "mysql_primary_live_query_5m",
    selection: { tool_key: "platform_capability_live_report", independent_from: "platform_capability_contract_report" },
    separation_guarantees: {
      contractual_conclusions_included: false,
      historical_claims_included: false,
      runtime_dispatch_performed: false,
      mutations_performed: false,
    },
    totals: {
      capability_count: Number(totalRow.capability_count || 0),
      gap_count: gapCount,
      authority_required_count: Number(totalRow.authority_required_count || 0),
      dispatch_allowed_count: Number(totalRow.dispatch_allowed_count || 0),
      apply_allowed_count: Number(totalRow.apply_allowed_count || 0),
      certified_count: Number(totalRow.certified_count || 0),
      provenance_ready_count: Number(totalRow.provenance_ready_count || 0),
      resource_binding_ready_count: Number(totalRow.resource_binding_ready_count || 0),
      hard_blocked_count: Number(totalRow.hard_blocked_count || 0),
    },
    maturity_distribution: maturity,
    gap_distribution: gaps,
    envelope_status_distribution: envelopeStatuses,
    envelope_execution_distribution: executionStatuses,
    generic_certification_distribution: certifications,
    source_resolution_distribution: sourceResolutions,
    debt_distribution: debtStatuses,
    highest_priority_gaps: gapRows,
    source_of_truth: {
      registry: "mysql_primary",
      views: ["v_platform_capability_readiness_vector", "v_platform_capability_assurance_gaps", "v_platform_capability_maturity"],
      ledgers: ["capability_resolution_envelope_ledger", "platform_evidence_events", "platform_capability_certifications", "platform_capability_source_links", "platform_capability_debt"],
    },
    limitations: [
      "This snapshot expires after five minutes or earlier when the underlying registries change.",
      "A capability readiness vector is not a substitute for a fresh invocation envelope.",
      "Run platform_capability_contract_report separately for contract coverage.",
    ],
    secrets_included: false,
  };
}
