import { getPool } from "./db.js";
import { runGrowthIntelligencePilot } from "./growthIntelligencePilot.js";
import {
  getGrowthIntelligenceReport,
  persistGrowthIntelligencePilot,
  persistGrowthIntelligenceReadinessAssessment,
} from "./growthIntelligenceRegistry.js";

const DEFAULT_ACTIVITY_KEY = "business_and_industrial_products";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function truthy(value) {
  return ["1", "true", "yes", "active", "ready"].includes(text(value).toLowerCase());
}

function active(value) {
  return ["active", "ready", "validated", "registered"].includes(text(value).toLowerCase());
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function assertGrowthIntelligencePilotAdminSafety(args = {}) {
  const persistenceMode = text(args.persistence_mode, "internal_registry");
  if (persistenceMode !== "internal_registry") {
    throw fail(
      "growth_pilot_admin_persistence_mode_invalid",
      "The governed admin pilot only supports persistence_mode=internal_registry."
    );
  }
  if (
    args.apply === true
    || args.live_execution === true
    || args.provider_write === true
    || Number(args.provider_writes || 0) > 0
    || args.external_send === true
    || Number(args.external_sends || 0) > 0
  ) {
    throw fail(
      "growth_pilot_admin_execution_boundary_violation",
      "Growth Intelligence pilot execution is read-only analysis with dry-run actions only."
    );
  }
}

export async function resolveGrowthIntelligencePilotAdminContext({
  pool,
  tenantId,
  brandKey,
  businessActivityTypeKey = DEFAULT_ACTIVITY_KEY,
  evidenceLimit = 20,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw fail("growth_pilot_admin_pool_required", "A database pool is required.", 500);
  }
  if (!text(tenantId) || !text(brandKey)) {
    throw fail("growth_pilot_admin_scope_required", "tenant_id and brand_key are required.");
  }

  const [tenantRows] = await pool.query(
    `SELECT tenant_id, tenant_type, display_name, status
       FROM tenants
      WHERE tenant_id = ?
      LIMIT 1`,
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) throw fail("growth_pilot_admin_tenant_not_found", `Tenant not found: ${tenantId}`, 404);
  if (!active(tenant.status)) {
    throw fail("growth_pilot_admin_tenant_not_active", `Tenant is not active: ${tenantId}`, 409);
  }

  const [brandRows] = await pool.query(
    `SELECT id, brand_name, normalized_brand_name, target_key, base_url,
            brand_core_ready, write_allowed, status, governance_readiness_status
       FROM brands
      WHERE LOWER(COALESCE(target_key, '')) = LOWER(?)
         OR LOWER(COALESCE(normalized_brand_name, '')) = LOWER(?)
         OR LOWER(COALESCE(brand_name, '')) = LOWER(?)
      ORDER BY (LOWER(COALESCE(target_key, '')) = LOWER(?)) DESC, id ASC
      LIMIT 1`,
    [brandKey, brandKey, brandKey, brandKey]
  );
  const brand = brandRows[0];
  if (!brand) throw fail("growth_pilot_admin_brand_not_found", `Brand not found: ${brandKey}`, 404);
  if (!active(brand.status)) {
    throw fail("growth_pilot_admin_brand_not_active", `Brand is not active: ${brandKey}`, 409);
  }
  if (!truthy(brand.brand_core_ready)) {
    throw fail("growth_pilot_admin_brand_core_not_ready", `Brand Core is not ready: ${brandKey}`, 409);
  }

  const resolvedBrandKey = text(brand.target_key, brandKey);
  const [coreRows] = await pool.query(
    `SELECT brand_key, asset_key, doc_key, doc_id, file_id, google_doc_id,
            status, validation_status, active_status
       FROM brand_core
      WHERE LOWER(brand_key) = LOWER(?)
        AND LOWER(COALESCE(status, 'active')) IN ('active', 'ready', 'validated')
      ORDER BY COALESCE(asset_key, doc_key), id`,
    [resolvedBrandKey]
  );
  if (!coreRows.length) {
    throw fail("growth_pilot_admin_brand_core_missing", `No active Brand Core rows found: ${resolvedBrandKey}`, 409);
  }

  const [activityRows] = await pool.query(
    `SELECT business_activity_type_key, activity_key, business_type_key, label,
            parent_activity_type, default_knowledge_profile_key,
            supported_engine_categories, supported_route_keys, supported_workflows,
            brand_core_required, status, active, notes
       FROM business_activity_types
      WHERE LOWER(business_activity_type_key) = LOWER(?)
        AND (LOWER(COALESCE(status, '')) IN ('active', 'ready', 'validated', 'registered')
          OR LOWER(COALESCE(active, '')) IN ('active', 'true', '1', 'yes'))
      LIMIT 1`,
    [businessActivityTypeKey]
  );
  const activity = activityRows[0];
  if (!activity) {
    throw fail(
      "growth_pilot_admin_activity_not_found",
      `Active Business Activity Type not found: ${businessActivityTypeKey}`,
      404
    );
  }

  const limit = boundedInteger(evidenceLimit, 20, 1, 50);
  const evidence = coreRows.slice(0, limit).map((row) => ({
    evidence_id: `brand_core_registry:${resolvedBrandKey}:${text(row.asset_key || row.doc_key, "asset")}`,
    source: "brand_core_registry",
    summary: `Active Brand Core asset: ${text(row.asset_key || row.doc_key, "registered_asset")}.`,
    assumption: false,
    secrets_included: false,
  }));

  return {
    tenant,
    brand,
    activity,
    resolved_brand_key: resolvedBrandKey,
    pilot_input: {
      tenant_id: tenantId,
      brand_key: resolvedBrandKey,
      business_activity_type_key: activity.business_activity_type_key,
      brand_registry_rows: [{
        brand_key: resolvedBrandKey,
        target_key: resolvedBrandKey,
        brand_name: brand.brand_name,
        normalized_brand_name: brand.normalized_brand_name,
        base_url: brand.base_url,
        business_type_key: activity.business_type_key,
        knowledge_profile_key: activity.default_knowledge_profile_key,
        brand_core_required: "true",
        is_readable: "true",
        is_writable: brand.write_allowed,
        status: brand.status,
      }],
      brand_core_registry_rows: coreRows,
      activity_type_registry_rows: [{
        business_activity_type_key: activity.business_activity_type_key,
        activity_type_name: activity.label,
        parent_activity: activity.parent_activity_type,
        default_knowledge_profile_key: activity.default_knowledge_profile_key,
        compatible_engines: activity.supported_engine_categories,
        brand_core_required: activity.brand_core_required,
        status: activity.status || activity.active,
        notes: activity.notes,
      }],
      evidence,
    },
    resolution: {
      tenant_status: tenant.status,
      brand_status: brand.status,
      brand_core_ready: true,
      brand_core_asset_count: coreRows.length,
      business_activity_type_key: activity.business_activity_type_key,
      business_activity_registry_backed: true,
      secrets_included: false,
    },
  };
}

export async function runGrowthIntelligencePilotAdmin(args = {}, dependencies = {}) {
  assertGrowthIntelligencePilotAdminSafety(args);
  const pool = dependencies.pool || getPool();
  const runPilot = dependencies.runPilot || runGrowthIntelligencePilot;
  const persistPilot = dependencies.persistPilot || persistGrowthIntelligencePilot;
  const readReport = dependencies.readReport || getGrowthIntelligenceReport;
  const persistAssessment = dependencies.persistAssessment || persistGrowthIntelligenceReadinessAssessment;
  const tenantId = text(args.tenant_id);
  const brandKey = text(args.brand_key);
  const activityKey = text(args.business_activity_type_key, DEFAULT_ACTIVITY_KEY);
  const requestedBy = text(args.requested_by, "gpt_admin_growth_intelligence_pilot");

  const context = await resolveGrowthIntelligencePilotAdminContext({
    pool,
    tenantId,
    brandKey,
    businessActivityTypeKey: activityKey,
    evidenceLimit: args.evidence_limit,
  });
  const result = runPilot({
    ...context.pilot_input,
    report_id: text(args.report_id) || undefined,
  });
  if (
    result?.ok !== true
    || result?.secrets_included !== false
    || Number(result?.readback?.provider_writes || 0) !== 0
    || Number(result?.readback?.external_sends || 0) !== 0
  ) {
    throw fail(
      "growth_pilot_admin_safety_readback_failed",
      "Pilot result did not satisfy the no-provider-write, no-external-send, no-secret boundary.",
      500
    );
  }

  const tenantStage = result.workflow?.stages?.find((stage) => stage.stage === "tenant_activation");
  if (tenantStage) {
    tenantStage.status = "pass";
    delete tenantStage.reason;
  }
  result.registry = await persistPilot(result, { pool, requestedBy });
  const approvalStage = result.workflow?.stages?.find((stage) => stage.stage === "approval_hold");
  if (approvalStage) {
    approvalStage.status = "pass";
    delete approvalStage.reason;
  }
  result.readback.approval_hold_count = result.registry.approval_holds.length;
  result.readback.executed_stage_count = result.workflow.stages.filter((stage) => stage.status === "pass").length;
  result.readback.planned_stage_count = result.workflow.stages.filter((stage) => stage.status === "planned").length;
  result.readback.not_executed_stage_count = result.workflow.stages.filter((stage) => stage.status === "not_executed").length;
  result.readback.all_stages_passed = result.workflow.stages.every((stage) => stage.status === "pass");

  const record = await readReport({
    pool,
    tenantId,
    reportId: result.report.report_id,
  });
  if (!record) {
    throw fail("growth_pilot_admin_readback_missing", "Persisted Growth Intelligence report readback was not found.", 500);
  }
  const assessment = await persistAssessment({
    pool,
    tenantId,
    reportId: result.report.report_id,
    assessedBy: requestedBy,
  });

  return {
    ok: true,
    tool: "growth_intelligence_pilot_run",
    classification: "growth_intelligence_pilot_persisted_approval_pending",
    tenant_id: tenantId,
    brand_key: context.resolved_brand_key,
    business_activity_type_key: context.activity.business_activity_type_key,
    resolution: context.resolution,
    workflow: result.workflow,
    report: result.report,
    markdown_report: result.markdown_report,
    registry: result.registry,
    readback: {
      ...result.readback,
      persisted_report_found: true,
      persisted_insight_count: record.insights?.length || 0,
      persisted_action_count: record.actions?.length || 0,
      persisted_readiness_assessment_count: (record.readiness_assessments?.length || 0) + 1,
    },
    readiness_assessment: assessment,
    approval_holds: result.registry.approval_holds,
    apply_allowed: false,
    execution_allowed: false,
    provider_writes: 0,
    external_sends: 0,
    mutations_executed: false,
    secrets_included: false,
  };
}
