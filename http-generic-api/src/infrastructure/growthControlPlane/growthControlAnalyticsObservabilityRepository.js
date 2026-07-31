import { randomUUID } from "node:crypto";
import { getPool } from "../../../db.js";

function executor(value) {
  if (!value || typeof value.query !== "function") throw new TypeError("Growth Control analytics repository requires a SQL executor.");
  return value;
}
function limit(value, fallback = 1000) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5000) throw new TypeError("limit must be an integer from 1 to 5000.");
  return normalized;
}
function json(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
function unique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}
function filter(conditions, params, column, values) {
  const normalized = unique(values);
  if (!normalized.length) return;
  conditions.push(`${column} IN (?)`);
  params.push(normalized);
}
function one(rows, entity) {
  const normalized = Array.isArray(rows) ? rows : [];
  if (normalized.length > 1) throw new Error(`${entity} lookup returned more than one row.`);
  return normalized[0] || null;
}

function definitionRow(row) {
  return row && Object.freeze({
    kpiDefinitionId: row.kpi_definition_id,
    normalizedKpiKey: row.normalized_kpi_key,
    displayName: row.display_name,
    description: row.description || null,
    valueType: row.value_type,
    unitKey: row.unit_key,
    aggregation: row.aggregation,
    direction: row.direction,
    definitionVersion: Number(row.definition_version),
    freshnessSeconds: Number(row.freshness_seconds),
    status: row.status,
    revision: Number(row.revision),
    metadata: json(row.metadata_json, {}),
    checksumSha256: row.checksum_sha256,
    secretsIncluded: false,
  });
}
function bindingRow(row) {
  return row && Object.freeze({
    activityKpiBindingId: row.activity_kpi_binding_id,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    brandKey: row.brand_key || null,
    activityBindingId: row.activity_binding_id,
    activityTypeKey: row.activity_type_key,
    activityPackKey: row.activity_pack_key,
    nativeKpiKey: row.native_kpi_key,
    normalizedKpiKey: row.normalized_kpi_key,
    definitionVersion: Number(row.definition_version),
    nativeUnitKey: row.native_unit_key,
    normalizedUnitKey: row.normalized_unit_key,
    conversionKind: row.conversion_kind,
    scaleMultiplier: Number(row.scale_multiplier),
    mappingConfidence: Number(row.mapping_confidence),
    status: row.status,
    revision: Number(row.revision),
    bindingSha256: row.binding_sha256,
    secretsIncluded: false,
  });
}
function observationRow(row) {
  return row && Object.freeze({
    observationId: row.observation_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityBindingId: row.activity_binding_id,
    activityTypeKey: row.activity_type_key,
    normalizedKpiKey: row.normalized_kpi_key,
    nativeKpiKey: row.native_kpi_key,
    definitionVersion: Number(row.definition_version),
    nativeUnitKey: row.native_unit_key,
    normalizedUnitKey: row.normalized_unit_key,
    nativeValue: Number(row.native_value),
    normalizedValue: Number(row.normalized_value),
    weight: Number(row.weight_value),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    observedAt: row.observed_at,
    confidence: Number(row.confidence),
    freshnessAgeSeconds: Number(row.freshness_age_seconds),
    freshnessStatus: row.freshness_status,
    lineage: json(row.lineage_json, {}),
    observationSha256: row.observation_sha256,
    idempotencyKey: row.idempotency_key,
    secretsIncluded: false,
  });
}
function sampleRow(row) {
  return row && Object.freeze({
    sampleId: row.sample_id,
    metricKey: row.metric_key,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    brandKey: row.brand_key || null,
    environment: row.environment,
    value: Number(row.value_number),
    weight: Number(row.weight_value),
    observedAt: row.observed_at,
    sourceEvidenceSha256: row.source_evidence_sha256,
    sampleSha256: row.sample_sha256,
    idempotencyKey: row.idempotency_key,
    secretsIncluded: false,
  });
}
function findingRow(row) {
  return row && Object.freeze({
    findingId: row.finding_id,
    findingType: row.finding_type,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    brandKey: row.brand_key || null,
    severity: row.severity,
    status: row.status,
    reasonCode: row.reason_code,
    authorityRef: row.authority_ref || null,
    evidenceRef: row.evidence_ref || null,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at || null,
    findingSha256: row.finding_sha256,
    secretsIncluded: false,
  });
}
function evidenceRow(row) {
  return row && Object.freeze({
    evidenceId: row.evidence_id,
    requestId: row.request_id,
    traceId: row.trace_id,
    tenantId: row.tenant_id || null,
    workspaceId: row.workspace_id || null,
    brandKey: row.brand_key || null,
    activityBindingId: row.activity_binding_id || null,
    planId: row.plan_id || null,
    runId: row.run_id || null,
    capabilityKey: row.capability_key || null,
    workflowVersion: row.workflow_version == null ? null : Number(row.workflow_version),
    configSnapshotId: row.config_snapshot_id || null,
    policySnapshotId: row.policy_snapshot_id || null,
    selectedAdapterKey: row.selected_adapter_key || null,
    gateResults: json(row.gate_results_json, []),
    reasonCodes: json(row.reason_codes_json, []),
    durationMs: Number(row.duration_ms),
    resultClassification: row.result_classification,
    readbackStatus: row.readback_status,
    evidenceSha256: row.evidence_sha256,
    idempotencyKey: row.idempotency_key,
    secretsIncluded: false,
  });
}

export function createGrowthControlAnalyticsObservabilityRepository({ pool = null, resolvePool = async () => getPool(), uuid = randomUUID } = {}) {
  if (pool != null) executor(pool);
  async function db() { return executor(pool || await resolvePool()); }
  async function transaction(work) {
    const target = await db();
    if (typeof target.getConnection !== "function") return work(target);
    const connection = await target.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }

  async function resolveTenantWorkspaceScope({ tenantId, userId, workspaceId, brandKey }) {
    const target = await db();
    const [rows] = await target.query(
      `SELECT m.tenant_id,m.role AS tenant_role,wr.workspace_id,wr.workspace_key,wr.bootstrap_status,wr.linked_brand_key
         FROM memberships m JOIN tenants t ON t.tenant_id=m.tenant_id AND t.status='active'
         JOIN workspace_registry wr ON wr.tenant_id=m.tenant_id
        WHERE m.user_id=? AND m.tenant_id=? AND m.status='active'
          AND wr.workspace_id=? AND wr.linked_brand_key=?
          AND wr.bootstrap_status IN ('ready','degraded') LIMIT 2`,
      [userId, tenantId, workspaceId, brandKey],
    );
    const row = one(rows, "Tenant analytics scope");
    return row ? Object.freeze({ tenantId: row.tenant_id, tenantRole: row.tenant_role, workspaceId: row.workspace_id, workspaceKey: row.workspace_key, bootstrapStatus: row.bootstrap_status, brandKey: row.linked_brand_key }) : null;
  }

  async function listKpiDefinitions({ normalizedKpiKeys = [], statuses = [], limit: rowLimit = 1000 } = {}) {
    const conditions = ["1=1"]; const params = [];
    filter(conditions, params, "normalized_kpi_key", normalizedKpiKeys);
    filter(conditions, params, "status", statuses);
    const target = await db();
    const [rows] = await target.query(
      `SELECT kpi_definition_id,normalized_kpi_key,display_name,description,value_type,unit_key,aggregation,direction,definition_version,freshness_seconds,status,revision,metadata_json,checksum_sha256
         FROM growth_control_kpi_definitions WHERE ${conditions.join(" AND ")}
        ORDER BY normalized_kpi_key,definition_version DESC,kpi_definition_id LIMIT ${limit(rowLimit)}`,
      params,
    );
    return Object.freeze(rows.map(definitionRow));
  }

  async function getKpiDefinition({ normalizedKpiKey, definitionVersion }) {
    const target = await db();
    const [rows] = await target.query(
      `SELECT kpi_definition_id,normalized_kpi_key,display_name,description,value_type,unit_key,aggregation,direction,definition_version,freshness_seconds,status,revision,metadata_json,checksum_sha256
         FROM growth_control_kpi_definitions WHERE normalized_kpi_key=? AND definition_version=? LIMIT 2`,
      [normalizedKpiKey, definitionVersion],
    );
    return definitionRow(one(rows, "KPI definition"));
  }

  async function listActivityKpiBindings({ tenantId = null, workspaceIds = [], brandKeys = [], activityBindingIds = [], normalizedKpiKeys = [], statuses = [], limit: rowLimit = 5000 } = {}) {
    const conditions = ["1=1"]; const params = [];
    if (tenantId != null) { conditions.push("(tenant_id IS NULL OR tenant_id=?)"); params.push(tenantId); }
    filter(conditions, params, "workspace_id", workspaceIds);
    filter(conditions, params, "brand_key", brandKeys);
    filter(conditions, params, "activity_binding_id", activityBindingIds);
    filter(conditions, params, "normalized_kpi_key", normalizedKpiKeys);
    filter(conditions, params, "status", statuses);
    const target = await db();
    const [rows] = await target.query(
      `SELECT activity_kpi_binding_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,activity_pack_key,native_kpi_key,normalized_kpi_key,definition_version,native_unit_key,normalized_unit_key,conversion_kind,scale_multiplier,mapping_confidence,status,revision,binding_sha256
         FROM growth_control_activity_kpi_bindings WHERE ${conditions.join(" AND ")}
        ORDER BY normalized_kpi_key,activity_binding_id,native_kpi_key,definition_version DESC LIMIT ${limit(rowLimit, 5000)}`,
      params,
    );
    return Object.freeze(rows.map(bindingRow));
  }

  async function getActivityKpiBinding({ activityBindingId, nativeKpiKey }) {
    const target = await db();
    const [rows] = await target.query(
      `SELECT activity_kpi_binding_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,activity_pack_key,native_kpi_key,normalized_kpi_key,definition_version,native_unit_key,normalized_unit_key,conversion_kind,scale_multiplier,mapping_confidence,status,revision,binding_sha256
         FROM growth_control_activity_kpi_bindings
        WHERE activity_binding_id=? AND native_kpi_key=? AND status IN ('ready','active','deprecated')
        ORDER BY definition_version DESC LIMIT 2`,
      [activityBindingId, nativeKpiKey],
    );
    return bindingRow(one(rows, "Activity KPI binding"));
  }

  async function listNormalizedMetricObservations({ tenantId, workspaceIds = [], brandKeys = [], normalizedKpiKeys = [], periodStart = null, periodEnd = null, limit: rowLimit = 5000 } = {}) {
    const conditions = ["tenant_id=?"]; const params = [tenantId];
    filter(conditions, params, "workspace_id", workspaceIds);
    filter(conditions, params, "brand_key", brandKeys);
    filter(conditions, params, "normalized_kpi_key", normalizedKpiKeys);
    if (periodStart) { conditions.push("period_end>=?"); params.push(periodStart); }
    if (periodEnd) { conditions.push("period_start<=?"); params.push(periodEnd); }
    const target = await db();
    const [rows] = await target.query(
      `SELECT observation_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,normalized_kpi_key,native_kpi_key,definition_version,native_unit_key,normalized_unit_key,native_value,normalized_value,weight_value,period_start,period_end,observed_at,confidence,freshness_age_seconds,freshness_status,lineage_json,observation_sha256,idempotency_key
         FROM growth_control_normalized_metric_observations WHERE ${conditions.join(" AND ")}
        ORDER BY observed_at DESC,observation_id LIMIT ${limit(rowLimit, 5000)}`,
      params,
    );
    return Object.freeze(rows.map(observationRow));
  }

  async function listObservabilitySamples({ tenantId = null, workspaceIds = [], brandKeys = [], environment = null, windowStart, windowEnd, limit: rowLimit = 5000 } = {}) {
    const conditions = ["observed_at>=?", "observed_at<=?"]; const params = [windowStart, windowEnd];
    if (tenantId != null) { conditions.push("tenant_id=?"); params.push(tenantId); }
    filter(conditions, params, "workspace_id", workspaceIds);
    filter(conditions, params, "brand_key", brandKeys);
    if (environment != null) { conditions.push("environment=?"); params.push(environment); }
    const target = await db();
    const [rows] = await target.query(
      `SELECT sample_id,metric_key,tenant_id,workspace_id,brand_key,environment,value_number,weight_value,observed_at,source_evidence_sha256,sample_sha256,idempotency_key
         FROM growth_control_observability_samples WHERE ${conditions.join(" AND ")}
        ORDER BY observed_at,sample_id LIMIT ${limit(rowLimit, 5000)}`,
      params,
    );
    return Object.freeze(rows.map(sampleRow));
  }

  async function listReconciliationFindings({ tenantId = null, workspaceIds = [], brandKeys = [], statuses = [], limit: rowLimit = 1000 } = {}) {
    const conditions = ["1=1"]; const params = [];
    if (tenantId != null) { conditions.push("tenant_id=?"); params.push(tenantId); }
    filter(conditions, params, "workspace_id", workspaceIds);
    filter(conditions, params, "brand_key", brandKeys);
    filter(conditions, params, "status", statuses);
    const target = await db();
    const [rows] = await target.query(
      `SELECT finding_id,finding_type,tenant_id,workspace_id,brand_key,severity,status,reason_code,authority_ref,evidence_ref,detected_at,resolved_at,finding_sha256
         FROM growth_control_reconciliation_findings WHERE ${conditions.join(" AND ")}
        ORDER BY detected_at DESC,finding_id LIMIT ${limit(rowLimit)}`,
      params,
    );
    return Object.freeze(rows.map(findingRow));
  }

  async function appendNormalizedMetricObservation({ observation, idempotencyKey }) {
    return transaction(async (connection) => {
      const [existingRows] = await connection.query(
        `SELECT observation_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,normalized_kpi_key,native_kpi_key,definition_version,native_unit_key,normalized_unit_key,native_value,normalized_value,weight_value,period_start,period_end,observed_at,confidence,freshness_age_seconds,freshness_status,lineage_json,observation_sha256,idempotency_key
           FROM growth_control_normalized_metric_observations WHERE idempotency_key=? LIMIT 2 FOR UPDATE`,
        [idempotencyKey],
      );
      const existing = observationRow(one(existingRows, "Metric observation idempotency"));
      if (existing) {
        if (existing.observationSha256 !== observation.observationSha256) { const error = new Error("Metric observation idempotency conflict."); error.code = "GROWTH_CONTROL_KPI_IDEMPOTENCY_CONFLICT"; error.status = 409; throw error; }
        return Object.freeze({ ...existing, idempotentReplay: true });
      }
      await connection.query(
        `INSERT INTO growth_control_normalized_metric_observations
          (observation_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,normalized_kpi_key,native_kpi_key,definition_version,native_unit_key,normalized_unit_key,native_value,normalized_value,weight_value,period_start,period_end,observed_at,confidence,freshness_age_seconds,freshness_status,lineage_json,observation_sha256,idempotency_key,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        [observation.observationId, observation.tenantId, observation.workspaceId, observation.brandKey, observation.activityBindingId, observation.activityTypeKey, observation.normalizedKpiKey, observation.nativeKpiKey, observation.definitionVersion, observation.nativeUnitKey, observation.normalizedUnitKey, observation.nativeValue, observation.normalizedValue, observation.weight, observation.periodStart, observation.periodEnd, observation.observedAt, observation.confidence, observation.freshnessAgeSeconds, observation.freshnessStatus, JSON.stringify(observation.lineage), observation.observationSha256, idempotencyKey],
      );
      const [rows] = await connection.query(
        `SELECT observation_id,tenant_id,workspace_id,brand_key,activity_binding_id,activity_type_key,normalized_kpi_key,native_kpi_key,definition_version,native_unit_key,normalized_unit_key,native_value,normalized_value,weight_value,period_start,period_end,observed_at,confidence,freshness_age_seconds,freshness_status,lineage_json,observation_sha256,idempotency_key
           FROM growth_control_normalized_metric_observations WHERE observation_id=? LIMIT 2`,
        [observation.observationId],
      );
      return observationRow(one(rows, "Metric observation readback"));
    });
  }

  async function appendObservabilitySample({ sample, idempotencyKey }) {
    return transaction(async (connection) => {
      const [existingRows] = await connection.query(
        `SELECT sample_id,metric_key,tenant_id,workspace_id,brand_key,environment,value_number,weight_value,observed_at,source_evidence_sha256,sample_sha256,idempotency_key
           FROM growth_control_observability_samples WHERE idempotency_key=? LIMIT 2 FOR UPDATE`,
        [idempotencyKey],
      );
      const existing = sampleRow(one(existingRows, "Observability sample idempotency"));
      if (existing) {
        if (existing.sampleSha256 !== sample.sampleSha256) { const error = new Error("Observability sample idempotency conflict."); error.code = "GROWTH_CONTROL_OBSERVABILITY_IDEMPOTENCY_CONFLICT"; error.status = 409; throw error; }
        return Object.freeze({ ...existing, idempotentReplay: true });
      }
      await connection.query(
        `INSERT INTO growth_control_observability_samples
          (sample_id,metric_key,tenant_id,workspace_id,brand_key,environment,value_number,weight_value,observed_at,source_evidence_sha256,sample_sha256,idempotency_key,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        [sample.sampleId, sample.metricKey, sample.tenantId, sample.workspaceId, sample.brandKey, sample.environment, sample.value, sample.weight, sample.observedAt, sample.sourceEvidenceSha256, sample.sampleSha256, idempotencyKey],
      );
      const [rows] = await connection.query(
        `SELECT sample_id,metric_key,tenant_id,workspace_id,brand_key,environment,value_number,weight_value,observed_at,source_evidence_sha256,sample_sha256,idempotency_key
           FROM growth_control_observability_samples WHERE sample_id=? LIMIT 2`,
        [sample.sampleId],
      );
      return sampleRow(one(rows, "Observability sample readback"));
    });
  }

  async function appendDecisionEvidence({ evidence, span, idempotencyKey }) {
    return transaction(async (connection) => {
      const [existingRows] = await connection.query(
        `SELECT evidence_id,request_id,trace_id,tenant_id,workspace_id,brand_key,activity_binding_id,plan_id,run_id,capability_key,workflow_version,config_snapshot_id,policy_snapshot_id,selected_adapter_key,gate_results_json,reason_codes_json,duration_ms,result_classification,readback_status,evidence_sha256,idempotency_key
           FROM growth_control_decision_evidence WHERE idempotency_key=? LIMIT 2 FOR UPDATE`,
        [idempotencyKey],
      );
      const existing = evidenceRow(one(existingRows, "Decision evidence idempotency"));
      if (existing) {
        if (existing.evidenceSha256 !== evidence.evidenceSha256) { const error = new Error("Decision evidence idempotency conflict."); error.code = "GROWTH_CONTROL_DECISION_EVIDENCE_IDEMPOTENCY_CONFLICT"; error.status = 409; throw error; }
        return Object.freeze({ ...existing, idempotentReplay: true });
      }
      const evidenceId = uuid();
      await connection.query(
        `INSERT INTO growth_control_decision_evidence
          (evidence_id,request_id,trace_id,tenant_id,workspace_id,brand_key,activity_binding_id,plan_id,run_id,capability_key,workflow_version,config_snapshot_id,policy_snapshot_id,selected_adapter_key,gate_results_json,reason_codes_json,duration_ms,result_classification,readback_status,evidence_sha256,idempotency_key,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        [evidenceId, evidence.requestId, evidence.traceId, evidence.tenantId, evidence.workspaceId, evidence.brandKey, evidence.activityBindingId, evidence.planId, evidence.runId, evidence.capabilityKey, evidence.workflowVersion, evidence.configSnapshotId, evidence.policySnapshotId, evidence.selectedAdapterKey, JSON.stringify(evidence.gateResults), JSON.stringify(evidence.reasonCodes), evidence.durationMs, evidence.resultClassification, evidence.readbackStatus, evidence.evidenceSha256, idempotencyKey],
      );
      await connection.query(
        `INSERT INTO telemetry_spans
          (span_id,trace_id,tenant_id,workspace_id,run_id,brand_key,request_id,correlation_id,execution_context_json,span_name,span_type,service_mode,status,duration_ms,attributes_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uuid(), span.trace_id, span.tenant_id, span.workspace_id, span.run_id, span.brand_key, span.request_id, span.trace_id, JSON.stringify({ source: "growth_control_plane", evidence_sha256: evidence.evidenceSha256, secrets_included: false }), span.span_name, span.span_type, "system", span.status, span.duration_ms, JSON.stringify(span.attributes_json)],
      );
      const [rows] = await connection.query(
        `SELECT evidence_id,request_id,trace_id,tenant_id,workspace_id,brand_key,activity_binding_id,plan_id,run_id,capability_key,workflow_version,config_snapshot_id,policy_snapshot_id,selected_adapter_key,gate_results_json,reason_codes_json,duration_ms,result_classification,readback_status,evidence_sha256,idempotency_key
           FROM growth_control_decision_evidence WHERE evidence_id=? LIMIT 2`,
        [evidenceId],
      );
      return evidenceRow(one(rows, "Decision evidence readback"));
    });
  }

  return Object.freeze({ resolveTenantWorkspaceScope, listKpiDefinitions, getKpiDefinition, listActivityKpiBindings, getActivityKpiBinding, listNormalizedMetricObservations, listObservabilitySamples, listReconciliationFindings, appendNormalizedMetricObservation, appendObservabilitySample, appendDecisionEvidence });
}

export const _testingGrowthControlAnalyticsObservabilityRepository = Object.freeze({ executor, limit, json, unique, filter, one, definitionRow, bindingRow, observationRow, sampleRow, findingRow, evidenceRow });
