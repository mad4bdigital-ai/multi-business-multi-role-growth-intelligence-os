import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { resolveEffectiveContainerContext } from "./dynamicContainerAuthorityResolver.js";

function samplerError(code, message, details = []) {
  const error = new Error(message);
  error.code = code;
  error.status = code === "dynamic_container_shadow_samples_unavailable" ? 409 : 422;
  error.details = details;
  return error;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function concreteOperationFromBinding(binding = {}) {
  const patterns = parseArray(binding.operation_patterns_json);
  const exact = patterns.find((pattern) => pattern && !String(pattern).includes("*"));
  if (exact) return String(exact);
  const wildcard = patterns.find((pattern) => pattern && String(pattern) !== "*");
  if (wildcard) return String(wildcard).replaceAll("*", "sample");
  const permissionKey = String(binding.permission_key || "").trim();
  if (permissionKey && permissionKey !== "*") return permissionKey;
  return "read";
}

function firstCapabilityKey(binding = {}) {
  return parseArray(binding.capability_keys_json).map(String).find(Boolean) || null;
}

export function buildShadowSampleInput(candidate, { runId, sampleIndex }) {
  const legacyDecision = String(candidate.effect || "").toLowerCase() === "deny" ? "deny" : "allow";
  const evidenceRef = `dynamic-container-shadow-sampler:${runId}:${sampleIndex}:${candidate.binding_id}`;
  return {
    principal: {
      type: String(candidate.principal_type),
      id: String(candidate.principal_id),
    },
    tenantId: String(candidate.tenant_id),
    targetContainerId: String(candidate.container_id),
    dimensionRequests: [{
      dimension: String(candidate.dimension_key),
      resourceType: String(candidate.resource_type),
      resourceRef: String(candidate.resource_ref),
      operation: concreteOperationFromBinding(candidate),
      capabilityKey: firstCapabilityKey(candidate),
    }],
    mode: "shadow",
    legacyDecision,
    legacyEvidenceRef: evidenceRef,
    requestId: `${runId}:${sampleIndex}`,
    idempotencyKey: `shadow-sample-${runId}-${sampleIndex}`,
  };
}

async function loadEligibleCandidates(pool, { tenantId = null, limit = 500 } = {}) {
  const params = [];
  const tenantClause = tenantId ? " AND c.tenant_id = ?" : "";
  if (tenantId) params.push(String(tenantId));
  params.push(Math.max(1, Math.min(1000, Number(limit || 500))));
  const [rows] = await pool.query(
    `SELECT
       c.tenant_id,
       c.container_id,
       c.container_key,
       a.assignment_id,
       a.principal_type,
       a.principal_id,
       b.binding_id,
       b.dimension_key,
       b.resource_type,
       b.resource_ref,
       b.effect,
       b.permission_key,
       b.operation_patterns_json,
       b.capability_keys_json
     FROM containers c
     JOIN container_role_assignments a
       ON a.container_id = c.container_id
      AND a.status = 'active'
     JOIN container_resource_bindings b
       ON b.container_id = c.container_id
      AND b.status = 'active'
     WHERE c.status = 'active'
       AND b.effect IN ('allow','deny')
       AND b.resource_ref IS NOT NULL
       AND b.resource_ref <> ''
       AND b.resource_ref <> '*'
       ${tenantClause}
     ORDER BY c.tenant_id,c.container_id,a.principal_type,a.principal_id,b.binding_id
     LIMIT ?`,
    params
  );
  const distinct = new Map();
  for (const row of rows || []) {
    const key = [
      row.tenant_id,
      row.container_id,
      row.principal_type,
      row.principal_id,
      row.dimension_key,
      row.resource_type,
      row.resource_ref,
      row.permission_key || "",
      row.effect,
    ].map(String).join("|");
    if (!distinct.has(key)) distinct.set(key, row);
  }
  return [...distinct.values()];
}

async function readSamplerEvidence(pool, runId) {
  const prefix = `dynamic-container-shadow-sampler:${runId}:%`;
  const [[comparison]] = await pool.query(
    `SELECT
       COUNT(*) AS comparison_count,
       SUM(comparison_status = 'match') AS match_count,
       SUM(comparison_status = 'mismatch') AS mismatch_count,
       SUM(comparison_status = 'not_comparable') AS not_comparable_count,
       MAX(latency_ms) AS max_latency_ms,
       AVG(latency_ms) AS avg_latency_ms
     FROM container_shadow_comparisons
     WHERE legacy_evidence_ref LIKE ?`,
    [prefix]
  );
  const [[performance]] = await pool.query(
    `SELECT
       COUNT(*) AS performance_sample_count,
       SUM(p.within_budget = 1) AS within_budget_count,
       MAX(p.duration_ms) AS max_duration_ms,
       AVG(p.duration_ms) AS avg_duration_ms
     FROM container_resolution_performance_samples p
     JOIN container_shadow_comparisons c ON c.resolution_id = p.resolution_id
     WHERE c.legacy_evidence_ref LIKE ?
       AND p.mode = 'shadow'`,
    [prefix]
  );
  return {
    comparisonCount: Number(comparison?.comparison_count || 0),
    matchCount: Number(comparison?.match_count || 0),
    mismatchCount: Number(comparison?.mismatch_count || 0),
    notComparableCount: Number(comparison?.not_comparable_count || 0),
    maxLatencyMs: Number(comparison?.max_latency_ms || 0),
    avgLatencyMs: Number(comparison?.avg_latency_ms || 0),
    performanceSampleCount: Number(performance?.performance_sample_count || 0),
    withinBudgetCount: Number(performance?.within_budget_count || 0),
    maxDurationMs: Number(performance?.max_duration_ms || 0),
    avgDurationMs: Number(performance?.avg_duration_ms || 0),
  };
}

export async function runDynamicContainerShadowSampler(input = {}, dependencies = {}) {
  const sampleCount = Number(input.sampleCount ?? input.sample_count ?? 100);
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) {
    throw samplerError(
      "dynamic_container_shadow_sample_count_invalid",
      "sampleCount must be an integer between 1 and 100.",
      [{ field: "sampleCount", issue: "out_of_range" }]
    );
  }
  const tenantId = input.tenantId || input.tenant_id || null;
  const pool = dependencies.pool || getPool();
  const resolver = dependencies.resolve || resolveEffectiveContainerContext;
  const loadCandidates = dependencies.loadCandidates || loadEligibleCandidates;
  const readEvidence = dependencies.readEvidence || readSamplerEvidence;
  const runId = dependencies.runId || randomUUID();
  const candidates = await loadCandidates(pool, { tenantId, limit: 1000 });
  if (!candidates.length) {
    throw samplerError(
      "dynamic_container_shadow_samples_unavailable",
      "No active direct authority cases are available for shadow sampling."
    );
  }

  const resolutionIds = [];
  const failures = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const candidate = candidates[index % candidates.length];
    const sampleInput = buildShadowSampleInput(candidate, { runId, sampleIndex: index + 1 });
    try {
      const resolution = await resolver(sampleInput);
      resolutionIds.push(String(resolution.resolutionId));
    } catch (error) {
      failures.push({
        sampleIndex: index + 1,
        bindingId: String(candidate.binding_id),
        code: String(error?.code || "dynamic_container_shadow_sample_failed"),
      });
    }
  }

  const evidence = await readEvidence(pool, runId);
  const completedCount = resolutionIds.length;
  const readbackOk = failures.length === 0
    && completedCount === sampleCount
    && evidence.comparisonCount === sampleCount
    && evidence.performanceSampleCount === sampleCount;
  if (!readbackOk) {
    throw samplerError(
      "dynamic_container_shadow_sampler_readback_failed",
      "Shadow sampler completed without matching same-cycle comparison and performance evidence.",
      [{
        runId,
        requestedSampleCount: sampleCount,
        completedCount,
        failureCount: failures.length,
        comparisonCount: evidence.comparisonCount,
        performanceSampleCount: evidence.performanceSampleCount,
        failures,
      }]
    );
  }

  return {
    ok: true,
    runId,
    requestedSampleCount: sampleCount,
    completedSampleCount: completedCount,
    distinctCandidateCount: candidates.length,
    repeatedRoundCount: Math.max(0, Math.ceil(sampleCount / candidates.length) - 1),
    evidence,
    providerCallMade: false,
    credentialPayloadRead: false,
    externalWriteMade: false,
    enforcementApplied: false,
    secretsIncluded: false,
  };
}

export const _testingDynamicContainerShadowSampler = {
  parseArray,
  loadEligibleCandidates,
  readSamplerEvidence,
};
