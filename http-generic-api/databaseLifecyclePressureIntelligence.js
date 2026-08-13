import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { classifyDatabaseTableLifecycle } from "./databaseTableLifecycle.js";

export const DATABASE_LIFECYCLE_PRESSURE_INTELLIGENCE_VERSION = "database_lifecycle_pressure_intelligence_v1";
export const DATABASE_LIFECYCLE_PRESSURE_PLAN_VERSION = "database_lifecycle_immutable_plan_v1";

const DOMAIN_ADAPTERS = Object.freeze({
  governed_tool_response_chunks: {
    table_names: ["governed_tool_response_chunks"],
    semantic_class: "authoritative_ttl",
    policy_key: "database.response_chunks.expired_cleanup",
    recipe_key: "database.response_chunks.expired_cleanup",
    default_risk_class: "medium",
    preservation_rules: ["preserve_rows_after_immutable_cutoff", "preserve_post_plan_rows", "no_automatic_compaction"],
  },
  repo_file_audit_findings: {
    table_names: ["repo_file_audit_findings"],
    semantic_class: "superseded_observation_history",
    policy_key: "database.repo_audit.superseded_findings_cleanup",
    recipe_key: "database.repo_audit.superseded_findings_cleanup",
    default_risk_class: "high",
    preservation_rules: ["preserve_latest_observation_per_file", "preserve_parent_audit_runs", "preserve_non_terminal_runs"],
  },
  platform_engine_execution_runs: {
    table_names: ["platform_engine_execution_runs"],
    semantic_class: "unknown_retention_lineage_sensitive",
    policy_key: "database.engine_runs.retention_assessment",
    recipe_key: "database.engine_runs.retention_assessment",
    default_risk_class: "high",
    preservation_rules: ["preserve_run_identity_and_lineage", "preserve_audit_evidence", "no_archive_without_explicit_policy"],
  },
});

function text(value = "") {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value) {
  return value === true || value === 1 || value === "1";
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Math.min(Math.max(integer(value, fallback), minimum), maximum);
}

function parseDateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value, fallback = null) {
  const parsed = parseDateMs(value);
  return parsed === null ? fallback : new Date(parsed).toISOString();
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableRowKey(row = {}) {
  return text(row.candidate_key || row.resource_key || row.table_name || row.id || row.primary_key || "unknown");
}

function normalizeTableRow(row = {}) {
  const sizeBytes = Math.max(0, integer(row.size_bytes ?? row.data_length ?? (number(row.size_mb) * 1024 * 1024), 0));
  const dataFreeBytes = Math.max(0, integer(row.data_free_bytes ?? row.data_free ?? 0, 0));
  return {
    table_name: text(row.table_name || row.TABLE_NAME),
    approx_rows: Math.max(0, integer(row.approx_rows ?? row.table_rows ?? row.TABLE_ROWS, 0)),
    size_bytes: sizeBytes,
    size_mb: Number((sizeBytes / 1024 / 1024).toFixed(3)),
    data_free_bytes: dataFreeBytes,
    data_free_mb: Number((dataFreeBytes / 1024 / 1024).toFixed(3)),
    update_time: isoDate(row.update_time || row.UPDATE_TIME),
    create_time: isoDate(row.create_time || row.CREATE_TIME),
    lifecycle_registered: boolean(row.lifecycle_registered),
    linked_by_policy: boolean(row.linked_by_policy || row.inventory_registered),
    policy_key: text(row.policy_key),
    eligible_cleanup_bytes: Math.max(0, integer(row.eligible_cleanup_bytes, 0)),
    estimated_reclaimable_bytes: Math.max(0, integer(row.estimated_reclaimable_bytes ?? row.data_free_bytes ?? row.data_free ?? 0, 0)),
  };
}

function pressureState(usedPercent, thresholds = {}) {
  const warning = number(thresholds.warning_used_percent, 80);
  const plan = number(thresholds.plan_used_percent, 85);
  const emergency = number(thresholds.emergency_used_percent, 95);
  if (usedPercent >= emergency) return "emergency_observation";
  if (usedPercent >= plan) return "plan_review_required";
  if (usedPercent >= warning) return "warning";
  return "normal";
}

function growthFromPrevious(current, previous) {
  const currentBytes = Math.max(0, integer(current?.used_bytes, 0));
  const previousBytes = Math.max(0, integer(previous?.used_bytes, 0));
  const currentAt = parseDateMs(current?.observed_at);
  const previousAt = parseDateMs(previous?.observed_at);
  if (currentAt === null || previousAt === null || currentAt <= previousAt) {
    return { bytes_per_day: null, percent_per_day: null, time_to_full_days: null, basis: "insufficient_previous_observation" };
  }
  const days = (currentAt - previousAt) / 86400000;
  const bytesPerDay = (currentBytes - previousBytes) / days;
  const percentPerDay = previousBytes > 0 ? ((currentBytes - previousBytes) / previousBytes * 100) / days : null;
  const freeBytes = Math.max(0, integer(current?.free_bytes, 0));
  return {
    bytes_per_day: Number(bytesPerDay.toFixed(3)),
    percent_per_day: percentPerDay === null ? null : Number(percentPerDay.toFixed(6)),
    time_to_full_days: bytesPerDay > 0 && freeBytes > 0 ? Number((freeBytes / bytesPerDay).toFixed(3)) : null,
    basis: "previous_observation_delta",
  };
}

export function classifyDatabaseLifecycleDomain(row = {}) {
  const tableName = text(row.table_name || row.resource_key || row.domain_key);
  const explicitDomain = text(row.domain_key);
  const adapter = Object.entries(DOMAIN_ADAPTERS)
    .map(([domainKey, value]) => ({ domain_key: domainKey, ...value }))
    .find((candidate) => candidate.domain_key === explicitDomain || candidate.table_names.includes(tableName));
  if (adapter) {
    return {
      domain_key: adapter.domain_key,
      table_name: tableName,
      semantic_class: adapter.semantic_class,
      policy_key: adapter.policy_key,
      recipe_key: adapter.recipe_key,
      risk_class: adapter.default_risk_class,
      preservation_rules: [...adapter.preservation_rules],
      policy_status: "requires_policy_resolution",
      execution_allowed: false,
      classification_source: "spec019_registered_domain_adapter",
    };
  }
  const base = classifyDatabaseTableLifecycle(row);
  return {
    domain_key: text(row.domain_key) || "unclassified_database_resource",
    table_name: tableName,
    semantic_class: base.table_family === "uncategorized" ? "unknown_retention" : base.table_family,
    policy_key: null,
    recipe_key: null,
    risk_class: base.risk_level || "high",
    preservation_rules: ["require_explicit_domain_policy", "preserve_unknown_lineage"],
    policy_status: "blocked_policy_missing",
    execution_allowed: false,
    classification_source: "existing_database_table_lifecycle_classifier",
    base_classification: base,
  };
}

export function resolveDatabaseLifecycleDomainPolicy({ domain = {}, policies = {} } = {}) {
  const policyKey = text(domain.policy_key);
  const policy = policies && typeof policies === "object" ? policies[policyKey] : null;
  if (!policyKey || !policy || typeof policy !== "object") {
    return {
      ok: false,
      policy_status: "blocked_policy_missing",
      domain_key: domain.domain_key || "unknown",
      policy_key: policyKey || null,
      execution_allowed: false,
      blockers: ["DATABASE_LIFECYCLE_POLICY_MISSING"],
    };
  }
  const policyVersion = text(policy.policy_version || policy.version);
  const retentionBasis = text(policy.retention_basis);
  const preservationRules = Array.isArray(policy.preservation_rules) ? policy.preservation_rules.filter((value) => text(value)) : [];
  const approved = policy.approved === true || policy.status === "approved";
  const complete = Boolean(policyVersion && retentionBasis && preservationRules.length && approved);
  return {
    ok: complete,
    policy_status: complete ? "resolved" : "blocked_policy_incomplete",
    domain_key: domain.domain_key || "unknown",
    policy_key: policyKey,
    policy_version: policyVersion || null,
    retention_basis: retentionBasis || null,
    cutoff_strategy: text(policy.cutoff_strategy) || null,
    preservation_rules: preservationRules,
    approved,
    execution_allowed: false,
    blockers: complete ? [] : ["DATABASE_LIFECYCLE_POLICY_INCOMPLETE"],
  };
}

export function buildDatabaseLifecyclePressureSummary({ capacity = {}, tables = [], previous_observation = null, thresholds = {}, observed_at = null, policy_coverage = {} } = {}) {
  const normalizedTables = tables.map(normalizeTableRow).filter((row) => row.table_name);
  const usedBytes = Math.max(0, integer(capacity.used_bytes ?? capacity.data_bytes ?? 0, 0));
  const freeBytes = Math.max(0, integer(capacity.free_bytes ?? capacity.available_bytes ?? 0, 0));
  const quotaBytes = Math.max(0, integer(capacity.quota_bytes ?? capacity.max_bytes ?? 0, 0));
  const capacityBytes = quotaBytes > 0 ? quotaBytes : (freeBytes > 0 ? usedBytes + freeBytes : 0);
  const usedPercent = capacityBytes > 0 ? (usedBytes / capacityBytes) * 100 : null;
  const sortedTables = [...normalizedTables].sort((left, right) => (
    right.size_bytes - left.size_bytes || right.approx_rows - left.approx_rows || left.table_name.localeCompare(right.table_name)
  ));
  const totalEligibleCleanupBytes = normalizedTables.reduce((sum, row) => sum + row.eligible_cleanup_bytes, 0);
  const totalEstimatedReclaimableBytes = normalizedTables.reduce((sum, row) => sum + row.estimated_reclaimable_bytes, 0);
  const current = {
    used_bytes: usedBytes,
    free_bytes: freeBytes,
    quota_bytes: capacityBytes,
    observed_at: isoDate(observed_at, new Date(0).toISOString()),
  };
  const growth = growthFromPrevious(current, previous_observation);
  return {
    ok: true,
    pressure_report_type: DATABASE_LIFECYCLE_PRESSURE_INTELLIGENCE_VERSION,
    observed_at: current.observed_at,
    capacity: {
      used_bytes: usedBytes,
      free_bytes: freeBytes,
      quota_bytes: capacityBytes,
      used_percent: usedPercent === null ? null : Number(usedPercent.toFixed(6)),
      data_free_bytes: Math.max(0, integer(capacity.data_free_bytes ?? capacity.data_free, 0)),
      pressure_state: usedPercent === null ? "capacity_unknown" : pressureState(usedPercent, thresholds),
      thresholds: {
        warning_used_percent: number(thresholds.warning_used_percent, 80),
        plan_used_percent: number(thresholds.plan_used_percent, 85),
        emergency_used_percent: number(thresholds.emergency_used_percent, 95),
      },
    },
    growth,
    largest_tables: sortedTables.slice(0, boundedInteger(capacity.top_n ?? 20, 20, 1, 100)),
    policy_coverage: {
      status: text(policy_coverage.status) || "unknown",
      registered_table_count: Math.max(0, integer(policy_coverage.registered_table_count, 0)),
      observed_table_count: Math.max(0, integer(policy_coverage.observed_table_count ?? normalizedTables.length, normalizedTables.length)),
      covered_table_count: Math.max(0, integer(policy_coverage.covered_table_count, 0)),
      coverage_percent: policy_coverage.coverage_percent == null ? null : Number(number(policy_coverage.coverage_percent).toFixed(6)),
      blockers: Array.isArray(policy_coverage.blockers) ? policy_coverage.blockers.filter((value) => text(value)) : [],
    },
    cleanup_estimates: {
      eligible_cleanup_bytes: totalEligibleCleanupBytes,
      estimated_physical_reclaimable_bytes: totalEstimatedReclaimableBytes,
      logical_cleanup_separate_from_physical_reclaim: true,
    },
    safety: {
      dry_run: true,
      will_write: false,
      will_execute: false,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
    },
  };
}

export function buildDatabaseLifecycleImmutablePlan({ resource_uri, resource_version, recipe_key, policy, cutoff_at, candidates = [], risk_class = "plan_only", batch_size = 1, max_batches = 1, preservation_rules = [] } = {}) {
  const normalizedResourceUri = text(resource_uri);
  const normalizedRecipe = text(recipe_key);
  const policyVersion = text(policy?.policy_version || policy?.version);
  const blockers = [];
  if (!/^mysql:\/\/[^/]+\/[^*]+$/.test(normalizedResourceUri)) blockers.push("DATABASE_RESOURCE_NOT_REGISTERED");
  if (!normalizedRecipe || !/^database\.[a-z0-9_.-]+$/.test(normalizedRecipe)) blockers.push("DATABASE_RECIPE_NOT_EXECUTABLE");
  if (!policy || policy.ok !== true) blockers.push("DATABASE_LIFECYCLE_POLICY_MISSING");
  if (!policyVersion) blockers.push("DATABASE_LIFECYCLE_POLICY_INCOMPLETE");
  const cutoff = isoDate(cutoff_at);
  if (!cutoff) blockers.push("DATABASE_CUTOFF_MISMATCH");
  const normalizedCandidates = candidates.map((candidate) => canonicalize(candidate)).sort((left, right) => stableRowKey(left).localeCompare(stableRowKey(right)));
  const planBody = {
    plan_version: DATABASE_LIFECYCLE_PRESSURE_PLAN_VERSION,
    resource_uri: normalizedResourceUri,
    resource_version: text(resource_version) || null,
    recipe_key: normalizedRecipe || null,
    policy_version: policyVersion || null,
    cutoff_at: cutoff,
    candidates: normalizedCandidates,
    candidate_count: normalizedCandidates.length,
    risk_class: text(risk_class) || "plan_only",
    batch_size: boundedInteger(batch_size, 1, 1, 5000),
    max_batches: boundedInteger(max_batches, 1, 1, 1000),
    preservation_rules: [...new Set([...preservation_rules, ...(policy?.preservation_rules || [])].map(text).filter(Boolean))].sort(),
    authority_requirement: "exact_resource_and_recipe",
    requires_typed_confirmation: true,
    requires_same_cycle_readback: true,
  };
  const planFingerprint = `sha256:${sha256(planBody)}`;
  return {
    ok: blockers.length === 0,
    plan_id: `dbplan_${planFingerprint.slice(7, 23)}`,
    plan_fingerprint: planFingerprint,
    ...planBody,
    status: blockers.length ? "blocked" : "ready_for_review",
    blockers: [...new Set(blockers)],
    execution_allowed: false,
    dry_run: true,
    will_write: false,
    will_execute: false,
    no_drop: true,
    no_delete: true,
    no_archive_execution: true,
    no_compaction_execution: true,
    secrets_included: false,
  };
}

export function buildDatabaseLifecyclePressureIntelligence({ capacity = {}, tables = [], previous_observation = null, thresholds = {}, policy_coverage = {}, policies = {}, domains = [], plan_requests = [], observed_at = null } = {}) {
  const pressure = buildDatabaseLifecyclePressureSummary({ capacity, tables, previous_observation, thresholds, policy_coverage, observed_at });
  const domainRows = (domains.length ? domains : tables).map(classifyDatabaseLifecycleDomain);
  const policyResolutions = domainRows.map((domain) => ({ domain, policy: resolveDatabaseLifecycleDomainPolicy({ domain, policies }) }));
  const plans = plan_requests.map((request) => {
    const domain = domainRows.find((row) => row.domain_key === text(request.domain_key)) || classifyDatabaseLifecycleDomain(request);
    const policy = resolveDatabaseLifecycleDomainPolicy({ domain, policies });
    return buildDatabaseLifecycleImmutablePlan({ ...request, recipe_key: request.recipe_key || domain.recipe_key, policy, preservation_rules: [...(domain.preservation_rules || []), ...(request.preservation_rules || [])] });
  });
  return {
    ok: true,
    intelligence_type: DATABASE_LIFECYCLE_PRESSURE_INTELLIGENCE_VERSION,
    pressure,
    domains: policyResolutions,
    plans,
    safety: pressure.safety,
    secrets_included: false,
  };
}

async function readPolicyCoverage(pool, observedTableCount) {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS registered_table_count,
              SUM(CASE WHEN status IN ('active','review') THEN 1 ELSE 0 END) AS covered_table_count
         FROM database_table_lifecycle_registry`
    );
    const row = rows?.[0] || {};
    const registered = Math.max(0, integer(row.registered_table_count, 0));
    const covered = Math.max(0, integer(row.covered_table_count, 0));
    return {
      status: "available",
      registered_table_count: registered,
      observed_table_count: observedTableCount,
      covered_table_count: covered,
      coverage_percent: observedTableCount > 0 ? (covered / observedTableCount) * 100 : null,
      blockers: [],
    };
  } catch (error) {
    return {
      status: "unavailable",
      registered_table_count: 0,
      observed_table_count: observedTableCount,
      covered_table_count: 0,
      coverage_percent: null,
      blockers: ["DATABASE_LIFECYCLE_POLICY_REGISTRY_UNAVAILABLE"],
      diagnostic_code: error.code || "DATABASE_LIFECYCLE_POLICY_REGISTRY_READ_FAILED",
    };
  }
}

export async function collectDatabaseLifecyclePressureEvidence({ limit = 100, observed_at = null, previous_observation = null, thresholds = {}, plan_requests = [] } = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const boundedLimit = boundedInteger(limit, 100, 1, 500);
  const [capacityRows] = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(data_length, 0) + COALESCE(index_length, 0)), 0) AS used_bytes,
            COALESCE(SUM(COALESCE(data_free, 0)), 0) AS data_free_bytes,
            COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
  );
  const [tableRows] = await pool.query(
    `SELECT table_name,
            COALESCE(table_rows, 0) AS approx_rows,
            COALESCE(data_length, 0) + COALESCE(index_length, 0) AS size_bytes,
            COALESCE(data_free, 0) AS data_free_bytes,
            update_time, create_time
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
      ORDER BY size_bytes DESC, approx_rows DESC, table_name ASC
      LIMIT ?`,
    [boundedLimit]
  );
  const rows = (tableRows || []).map(normalizeTableRow);
  const policyCoverage = await readPolicyCoverage(pool, integer(capacityRows?.[0]?.table_count, rows.length));
  return buildDatabaseLifecyclePressureIntelligence({
    capacity: capacityRows?.[0] || {},
    tables: rows,
    previous_observation,
    thresholds,
    policy_coverage: policyCoverage,
    plan_requests,
    observed_at: observed_at || new Date().toISOString(),
  });
}
