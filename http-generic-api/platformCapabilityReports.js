import { getPool } from "./db.js";

export const PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION = "platform-capability-contract-report-v1";
export const PLATFORM_CAPABILITY_LIVE_REPORT_VERSION = "platform-capability-live-report-v1";

const CONTRACT_OBJECTS = Object.freeze([
  "v_platform_capabilities_current",
  "v_platform_bindings_current",
  "v_platform_exports_current",
  "v_platform_capability_maturity",
  "v_platform_capability_gaps",
  "capability_resolution_envelope_ledger",
  "platform_resource_authority_requirements",
  "runtime_dispatch_certification_registry",
  "platform_plugin_smoke_certifications",
  "platform_capability_source_resolutions",
  "platform_evidence_events",
  "platform_capability_certifications",
  "platform_capability_debt",
]);

const CONTRACT_TOOLS = Object.freeze([
  "capability_resolution_dry_run",
  "capability_resolution_envelope_create",
  "capability_resolution_envelope_approve",
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
      key: "capability_inventory_graph",
      title: "Capability inventory, binding, export, maturity, and gap projections",
      required: [
        "v_platform_capabilities_current",
        "v_platform_bindings_current",
        "v_platform_exports_current",
        "v_platform_capability_maturity",
        "v_platform_capability_gaps",
      ],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "envelope_governed_execution",
      title: "Envelope-governed capability resolution foundation",
      required: [
        "capability_resolution_envelope_ledger",
        "capability_resolution_dry_run",
        "capability_resolution_envelope_create",
        "capability_resolution_envelope_approve",
      ],
      objectSet,
      toolSet,
      notes: ["This proves the envelope foundation exists; it does not prove every route uses it."],
    }),
    contractCheck({
      key: "resource_authority_contract",
      title: "Resource authority requirements",
      required: ["platform_resource_authority_requirements"],
      objectSet,
      toolSet,
    }),
    contractCheck({
      key: "generic_evidence_event_contract",
      title: "Generic capability evidence event ledger",
      required: ["platform_evidence_events"],
      alternatives: ["capability_resolution_envelope_ledger", "platform_capability_source_resolutions"],
      objectSet,
      toolSet,
      notes: ["Specialized evidence surfaces exist, but the proposed generic platform_evidence_events contract is not present."],
    }),
    contractCheck({
      key: "generic_capability_certification_contract",
      title: "Generic capability certification registry",
      required: ["platform_capability_certifications"],
      alternatives: ["runtime_dispatch_certification_registry", "platform_plugin_smoke_certifications"],
      objectSet,
      toolSet,
      notes: ["Certification exists through specialized registries, not the proposed generic table."],
    }),
    contractCheck({
      key: "capability_debt_contract",
      title: "Persistent capability debt register",
      required: ["platform_capability_debt"],
      alternatives: ["v_platform_capability_gaps"],
      objectSet,
      toolSet,
      notes: ["The gap view is implemented; a persistent generic debt register remains proposed."],
    }),
  ];
  return {
    ok: true,
    report_type: "contractual",
    report_version: PLATFORM_CAPABILITY_CONTRACT_REPORT_VERSION,
    evaluated_at: nowRows[0]?.evaluated_at || null,
    selection: {
      tool_key: "platform_capability_contract_report",
      independent_from: "platform_capability_live_report",
    },
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
      "This report verifies declared contract surfaces as they exist now; it does not certify past CI states, past counts, or past deployment parity.",
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
  const [clock, totals, maturity, gaps, envelopeStatuses, executionStatuses, certifications, sourceResolutions, gapRows] = await Promise.all([
    queryRows(pool, "SELECT UTC_TIMESTAMP() AS observed_at, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) AS expires_at"),
    queryRows(pool, `SELECT COUNT(*) AS capability_count,
                            SUM(resource_authority_required = 1) AS authority_required_count,
                            SUM(dispatch_allowed = 1) AS dispatch_allowed_count,
                            SUM(apply_allowed = 1) AS apply_allowed_count
                       FROM v_platform_capability_maturity`),
    groupedCounts(pool, "v_platform_capability_maturity", ["maturity_status"]),
    groupedCounts(pool, "v_platform_capability_gaps", ["gap_key", "gap_severity"]),
    groupedCounts(pool, "capability_resolution_envelope_ledger", ["envelope_status"]),
    groupedCounts(pool, "capability_resolution_envelope_ledger", ["execution_status"]),
    groupedCounts(pool, "runtime_dispatch_certification_registry", ["certification_status"]),
    groupedCounts(pool, "platform_capability_source_resolutions", ["status"]),
    queryRows(
      pool,
      `SELECT capability_key, gap_key, gap_severity, gap_description
         FROM v_platform_capability_gaps
        ORDER BY FIELD(gap_severity, 'high', 'medium', 'low'), gap_key, capability_key
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
    selection: {
      tool_key: "platform_capability_live_report",
      independent_from: "platform_capability_contract_report",
    },
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
    },
    maturity_distribution: maturity,
    gap_distribution: gaps,
    envelope_status_distribution: envelopeStatuses,
    envelope_execution_distribution: executionStatuses,
    runtime_certification_distribution: certifications,
    source_resolution_distribution: sourceResolutions,
    highest_priority_gaps: gapRows,
    source_of_truth: {
      registry: "mysql_primary",
      views: ["v_platform_capability_maturity", "v_platform_capability_gaps"],
      ledgers: ["capability_resolution_envelope_ledger", "runtime_dispatch_certification_registry", "platform_capability_source_resolutions"],
    },
    limitations: [
      "This snapshot expires after five minutes or earlier when the underlying registries change.",
      "It does not verify historical report numbers, historical CI status, or historical deployment state.",
      "Run platform_capability_contract_report separately for contract coverage and proposed-vs-implemented classification.",
    ],
    secrets_included: false,
  };
}
