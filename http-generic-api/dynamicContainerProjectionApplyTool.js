import { getPool } from "./db.js";
import {
  applyLegacyContainerProjection,
  buildLegacyContainerProjectionPlan,
} from "./dynamicContainerProjectionService.js";

const COUNT_INPUTS = Object.freeze({
  expected_projected_container_count: "projectedContainerCount",
  expected_projected_relationship_count: "projectedRelationshipCount",
  expected_projected_role_assignment_count: "projectedRoleAssignmentCount",
  expected_projected_resource_binding_count: "projectedResourceBindingCount",
  expected_held_issue_count: "heldIssueCount",
  expected_high_risk_issue_count: "highRiskIssueCount",
});

function projectionError(code, message, details = undefined, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function normalizedSha(value = "") {
  return String(value || "").trim().toLowerCase();
}

function integerInput(value, key) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw projectionError(
      "dynamic_container_projection_expected_count_invalid",
      `${key} must be a non-negative integer.`,
      { field: key, received: value },
      400
    );
  }
  return parsed;
}

export function dynamicContainerProjectionApplyConfirmation(snapshotSha256 = "") {
  const snapshot = normalizedSha(snapshotSha256);
  if (!/^[0-9a-f]{64}$/.test(snapshot)) return "";
  return `APPLY_DYNAMIC_CONTAINER_PROJECTION_${snapshot.slice(0, 12).toUpperCase()}`;
}

function expectedCounts(input = {}) {
  return Object.fromEntries(
    Object.entries(COUNT_INPUTS).map(([inputKey, summaryKey]) => [summaryKey, integerInput(input[inputKey], inputKey)])
  );
}

function assertPinnedPlan(plan, input = {}) {
  const expectedSnapshot = normalizedSha(input.expected_source_snapshot_sha256);
  if (!/^[0-9a-f]{64}$/.test(expectedSnapshot)) {
    throw projectionError(
      "dynamic_container_projection_expected_snapshot_invalid",
      "expected_source_snapshot_sha256 must be a lowercase SHA-256 value.",
      { field: "expected_source_snapshot_sha256" },
      400
    );
  }
  if (normalizedSha(plan.sourceSnapshotSha256) !== expectedSnapshot) {
    throw projectionError(
      "dynamic_container_projection_source_snapshot_mismatch",
      "Projection source snapshot changed after review.",
      { expected_source_snapshot_sha256: expectedSnapshot, actual_source_snapshot_sha256: plan.sourceSnapshotSha256 }
    );
  }
  const expected = expectedCounts(input);
  const mismatches = Object.entries(expected)
    .filter(([summaryKey, expectedValue]) => Number(plan.summary?.[summaryKey] ?? -1) !== expectedValue)
    .map(([summaryKey, expectedValue]) => ({
      field: summaryKey,
      expected: expectedValue,
      actual: Number(plan.summary?.[summaryKey] ?? -1),
    }));
  if (mismatches.length) {
    throw projectionError(
      "dynamic_container_projection_expected_counts_mismatch",
      "Projection counts changed after review.",
      { mismatches }
    );
  }
  return expected;
}

function publicPlan(plan, requiredConfirmation) {
  return {
    projection_run_id: plan.projectionRunId,
    source_snapshot_sha256: plan.sourceSnapshotSha256,
    summary: plan.summary,
    issue_count: plan.issues.length,
    required_confirmation: requiredConfirmation,
    provider_calls: false,
    credential_payload_reads: false,
    external_writes: false,
    secrets_included: false,
  };
}

async function countIds(pool, table, idColumn, ids) {
  if (!ids.length) return 0;
  let count = 0;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200);
    const placeholders = chunk.map(() => "?").join(",");
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS row_count FROM ${table} WHERE ${idColumn} IN (${placeholders})`,
      chunk
    );
    count += Number(row?.row_count || 0);
  }
  return count;
}

async function readActiveOrphanReferences(pool, tenantIds) {
  const tenants = [...new Set(tenantIds.map(String).filter(Boolean))];
  if (!tenants.length) {
    return { relationships: 0, role_assignments: 0, resource_bindings: 0, graph_nodes: 0, total: 0 };
  }
  const placeholders = tenants.map(() => "?").join(",");
  const [[relationshipRow]] = await pool.query(
    `SELECT COUNT(*) AS row_count
       FROM container_relationships r
       LEFT JOIN containers source_container ON source_container.container_id = r.from_container_id
       LEFT JOIN containers target_container ON target_container.container_id = r.to_container_id
      WHERE r.status = 'active'
        AND r.tenant_id IN (${placeholders})
        AND (source_container.container_id IS NULL OR target_container.container_id IS NULL)`,
    tenants
  );
  const [[roleRow]] = await pool.query(
    `SELECT COUNT(*) AS row_count
       FROM container_role_assignments a
       LEFT JOIN containers c ON c.container_id = a.container_id
      WHERE a.status = 'active'
        AND a.tenant_id IN (${placeholders})
        AND c.container_id IS NULL`,
    tenants
  );
  const [[bindingRow]] = await pool.query(
    `SELECT COUNT(*) AS row_count
       FROM container_resource_bindings b
       LEFT JOIN containers c ON c.container_id = b.container_id
      WHERE b.status = 'active'
        AND b.tenant_id IN (${placeholders})
        AND c.container_id IS NULL`,
    tenants
  );
  const [[graphRow]] = await pool.query(
    `SELECT COUNT(*) AS row_count
       FROM platform_graph_nodes n
       LEFT JOIN containers c ON c.container_id = n.source_pk
      WHERE n.lifecycle_status = 'active'
        AND n.source_table = 'containers'
        AND n.source_pk IS NOT NULL
        AND c.container_id IS NULL`
  );
  const counts = {
    relationships: Number(relationshipRow?.row_count || 0),
    role_assignments: Number(roleRow?.row_count || 0),
    resource_bindings: Number(bindingRow?.row_count || 0),
    graph_nodes: Number(graphRow?.row_count || 0),
  };
  return { ...counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

export async function readDynamicContainerProjectionApply(plan, { pool = getPool() } = {}) {
  const [[run]] = await pool.query(
    `SELECT projection_run_id, mode, status, source_snapshot_sha256,
            projected_container_count, projected_relationship_count, held_issue_count,
            summary_json, completed_at, secrets_included
       FROM container_projection_runs
      WHERE projection_run_id = ?
      LIMIT 1`,
    [plan.projectionRunId]
  );
  let runSummary = {};
  try {
    runSummary = typeof run?.summary_json === "object" ? run.summary_json : JSON.parse(run?.summary_json || "{}");
  } catch {
    runSummary = {};
  }
  const actual = {
    projectedContainerCount: await countIds(pool, "containers", "container_id", plan.containers.map((row) => row.container_id)),
    projectedRelationshipCount: await countIds(pool, "container_relationships", "relationship_id", plan.relationships.map((row) => row.relationship_id)),
    projectedRoleAssignmentCount: await countIds(pool, "container_role_assignments", "assignment_id", plan.roleAssignments.map((row) => row.assignment_id)),
    projectedResourceBindingCount: await countIds(pool, "container_resource_bindings", "binding_id", plan.resourceBindings.map((row) => row.binding_id)),
  };
  const expected = {
    projectedContainerCount: plan.containers.length,
    projectedRelationshipCount: plan.relationships.length,
    projectedRoleAssignmentCount: plan.roleAssignments.length,
    projectedResourceBindingCount: plan.resourceBindings.length,
  };
  const countMismatches = Object.keys(expected)
    .filter((key) => actual[key] !== expected[key])
    .map((key) => ({ field: key, expected: expected[key], actual: actual[key] }));
  const runMatches = Boolean(
    run &&
    run.mode === "apply" &&
    run.status === "completed" &&
    normalizedSha(run.source_snapshot_sha256) === normalizedSha(plan.sourceSnapshotSha256) &&
    Number(run.projected_container_count || 0) === plan.summary.projectedContainerCount &&
    Number(run.projected_relationship_count || 0) === plan.summary.projectedRelationshipCount &&
    Number(run.held_issue_count || 0) === plan.summary.heldIssueCount &&
    Number(runSummary.projectedRoleAssignmentCount || 0) === plan.summary.projectedRoleAssignmentCount &&
    Number(runSummary.projectedResourceBindingCount || 0) === plan.summary.projectedResourceBindingCount &&
    Number(run.secrets_included || 0) === 0
  );
  return {
    ok: runMatches && countMismatches.length === 0,
    projection_run: run ? {
      projection_run_id: run.projection_run_id,
      mode: run.mode,
      status: run.status,
      source_snapshot_sha256: run.source_snapshot_sha256,
      completed_at: run.completed_at || null,
    } : null,
    expected_counts: expected,
    actual_counts: actual,
    count_mismatches: countMismatches,
    secrets_included: false,
  };
}

export async function inspectDynamicContainerProjectionApply(input = {}, deps = {}) {
  const buildPlan = deps.buildPlan || buildLegacyContainerProjectionPlan;
  const plan = await buildPlan({ createdBy: "dynamic_container_projection_apply" });
  assertPinnedPlan(plan, input);
  const requiredConfirmation = dynamicContainerProjectionApplyConfirmation(plan.sourceSnapshotSha256);
  return { plan, requiredConfirmation, inspection: publicPlan(plan, requiredConfirmation) };
}

export async function runDynamicContainerProjectionApply(input = {}, deps = {}) {
  const mode = String(input.mode || "dry_run").trim().toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) {
    throw projectionError(
      "dynamic_container_projection_mode_invalid",
      "mode must be dry_run or apply.",
      { mode },
      400
    );
  }
  const inspected = await inspectDynamicContainerProjectionApply(input, deps);
  if (mode === "dry_run") {
    return {
      ok: true,
      mode,
      applies_projection: false,
      same_cycle_readback_verified: true,
      ...inspected.inspection,
    };
  }
  if (String(input.confirm || "").trim() !== inspected.requiredConfirmation) {
    throw projectionError(
      "dynamic_container_projection_apply_confirmation_required",
      "Exact typed confirmation is required before projection apply.",
      { required_confirmation: inspected.requiredConfirmation },
      400
    );
  }
  const envelopeId = String(input.capability_envelope_id || "").trim();
  if (!envelopeId) {
    throw projectionError(
      "dynamic_container_projection_apply_envelope_required",
      "A capability resolution envelope is required before projection apply.",
      undefined,
      403
    );
  }
  const resolveEnvelope = deps.resolveEnvelope;
  if (typeof resolveEnvelope !== "function") {
    throw projectionError(
      "dynamic_container_projection_apply_authorizer_unavailable",
      "Projection apply authorization is unavailable.",
      undefined,
      503
    );
  }
  const resolvedEnvelope = await resolveEnvelope({ envelopeId, input, plan: inspected.plan });
  if (!resolvedEnvelope?.ok || resolvedEnvelope.apply_allowed !== true) {
    throw projectionError(
      resolvedEnvelope?.status || "dynamic_container_projection_apply_not_authorized",
      "Capability envelope does not permit projection apply.",
      { envelope_id: envelopeId },
      403
    );
  }
  if (typeof deps.markReferenced === "function") {
    await deps.markReferenced({ envelopeId, executionRef: inspected.plan.projectionRunId });
  }
  const applyPlan = deps.applyPlan || applyLegacyContainerProjection;
  const applyResult = await applyPlan(inspected.plan, { createdBy: "dynamic_container_projection_apply" });
  const readback = deps.readback
    ? await deps.readback(inspected.plan, applyResult)
    : await readDynamicContainerProjectionApply(inspected.plan, { pool: deps.pool || getPool() });
  if (!readback?.ok) {
    throw projectionError(
      "dynamic_container_projection_apply_readback_failed",
      "Projection apply completed but same-cycle readback did not match the pinned plan.",
      { projection_run_id: inspected.plan.projectionRunId, readback },
      500
    );
  }
  if (typeof deps.consumeEnvelope !== "function") {
    throw projectionError(
      "dynamic_container_projection_apply_envelope_consumer_unavailable",
      "Projection was applied and verified, but envelope consumption is unavailable.",
      { projection_run_id: inspected.plan.projectionRunId, applied: true },
      500
    );
  }
  const consumed = await deps.consumeEnvelope({
    envelopeId,
    executionRef: inspected.plan.projectionRunId,
    reason: "dynamic_container_projection_apply_completed",
  });
  if (!consumed?.ok) {
    throw projectionError(
      "dynamic_container_projection_apply_envelope_consume_failed",
      "Projection was applied and verified, but the capability envelope was not consumed.",
      { projection_run_id: inspected.plan.projectionRunId, applied: true, consumed },
      500
    );
  }
  return {
    ok: true,
    mode,
    applies_projection: true,
    projection_run_id: inspected.plan.projectionRunId,
    source_snapshot_sha256: inspected.plan.sourceSnapshotSha256,
    summary: inspected.plan.summary,
    apply_result: applyResult,
    readback,
    envelope: {
      envelope_id: envelopeId,
      execution_status: consumed.after?.execution_status || "executed",
      consumed: true,
    },
    same_cycle_readback_verified: true,
    provider_calls: false,
    credential_payload_reads: false,
    external_writes: false,
    secrets_included: false,
  };
}
