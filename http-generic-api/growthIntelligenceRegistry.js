import { createHash, randomUUID } from "node:crypto";

const WORKFLOW_KEY = "tenant_brand_growth_intelligence_pilot_v1";

function json(value) {
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : json(value)).digest("hex");
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function qualityMetrics(report) {
  const insights = report.growth_opportunities || [];
  const actions = report.prioritized_backlog || [];
  const evidenceBacked = insights.filter((item) => item.evidence_status === "evidence_backed").length;
  const assumptions = insights.length - evidenceBacked;
  const evidenceCoverage = insights.length ? Number((evidenceBacked / insights.length).toFixed(4)) : 0;
  return {
    insight_count: insights.length,
    evidence_backed_count: evidenceBacked,
    assumption_count: assumptions,
    evidence_coverage: evidenceCoverage,
    action_count: actions.length,
    scored_action_count: actions.filter((item) => Number.isFinite(Number(item.priority_score))).length,
    readback_covered_action_count: actions.filter((item) => Array.isArray(item.readback_requirements) && item.readback_requirements.length > 0).length,
  };
}

async function withTransaction(pool, operation) {
  if (typeof pool.getConnection !== "function") return operation(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function persistGrowthIntelligencePilot(result, { pool, requestedBy = null } = {}) {
  if (!pool || typeof pool.query !== "function") throw new Error("A database pool is required.");
  if (!result?.ok || !result?.report?.report_id) throw new Error("A completed Growth Intelligence pilot result is required.");
  if (result.readback?.provider_writes !== 0 || result.readback?.external_sends !== 0 || result.secrets_included !== false) {
    const error = new Error("Only secret-free, no-provider-write, no-external-send pilots may be persisted.");
    error.code = "growth_pilot_persistence_boundary_failed";
    throw error;
  }

  return withTransaction(pool, async (connection) => {
    const report = result.report;
    const quality = qualityMetrics(report);
    const qualityStatus = quality.evidence_coverage >= 0.8 && quality.assumption_count === 0 ? "pass" : quality.evidence_coverage >= 0.5 ? "warn" : "fail";
    const runId = randomUUID();
    const correlationId = result.audit_evidence.audit_id;
    const holds = [];

    await connection.query(
      `INSERT INTO workflow_runs
        (run_id, tenant_id, brand_key, correlation_id, execution_context_json, workflow_key,
         service_mode, status, input_json, output_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'managed', 'awaiting_approval', ?, ?, NOW())`,
      [
        runId,
        report.tenant_id,
        report.brand_key,
        correlationId,
        json({ source: "growth_intelligence_registry", report_id: report.report_id, secrets_included: false }),
        WORKFLOW_KEY,
        json({ persistence_mode: "internal_registry", provider_writes: 0, external_sends: 0, secrets_included: false }),
        json({ report_id: report.report_id, audit_id: result.audit_evidence.audit_id, secrets_included: false }),
      ]
    );

    await connection.query(
      `INSERT INTO growth_intelligence_reports
        (report_id, tenant_id, brand_key, workflow_run_id, workflow_key, report_type, schema_version,
         status, executive_summary_json, report_json, markdown_report, readback_json, audit_evidence_json,
         quality_status, quality_metrics_json, freshness_expires_at,
         provider_writes, external_sends, secrets_included, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approval_pending', ?, ?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 30 DAY), 0, 0, 0, ?)`,
      [
        report.report_id,
        report.tenant_id,
        report.brand_key,
        runId,
        WORKFLOW_KEY,
        report.report_type,
        report.schema_version,
        json(report.executive_summary),
        json(report),
        result.markdown_report,
        json(result.readback),
        json(result.audit_evidence),
        qualityStatus,
        json(quality),
        new Date(report.generated_at),
        new Date(report.generated_at),
      ]
    );

    for (const insight of report.growth_opportunities) {
      const insightFingerprint = sha256(`${report.tenant_id}|${report.brand_key}|${insight.category}|${insight.title}`);
      const [priorRows] = await connection.query(
        `SELECT insight_record_id
           FROM growth_intelligence_insights
          WHERE tenant_id = ? AND brand_key = ? AND insight_fingerprint = ?
            AND status IN ('proposed','accepted','stale')
          ORDER BY created_at DESC LIMIT 1`,
        [report.tenant_id, report.brand_key, insightFingerprint]
      );
      const supersedesInsightRecordId = priorRows[0]?.insight_record_id || null;
      if (supersedesInsightRecordId) {
        await connection.query(
          `UPDATE growth_intelligence_insights SET status = 'superseded' WHERE insight_record_id = ?`,
          [supersedesInsightRecordId]
        );
      }
      await connection.query(
        `INSERT INTO growth_intelligence_insights
          (insight_record_id, insight_id, report_id, tenant_id, brand_key, category, title, rationale,
           evidence_status, evidence_refs_json, insight_fingerprint, supersedes_insight_record_id,
           score, risk, status, freshness_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', DATE_ADD(NOW(), INTERVAL 30 DAY))`,
        [
          randomUUID(), insight.opportunity_id, report.report_id, report.tenant_id, report.brand_key,
          insight.category, insight.title, insight.rationale, insight.evidence_status,
          json(insight.evidence_refs), insightFingerprint, supersedesInsightRecordId, insight.score, insight.risk,
        ]
      );
    }

    for (const action of report.prioritized_backlog) {
      const holdId = action.approval_required ? randomUUID() : null;
      if (holdId) {
        await connection.query(
          `INSERT INTO approval_holds
            (hold_id, run_id, tenant_id, brand_key, correlation_id, execution_context_json,
             hold_type, requested_by, required_role, status)
           VALUES (?, ?, ?, ?, ?, ?, 'supervisor_approval', ?, 'growth_operator', 'open')`,
          [
            holdId, runId, report.tenant_id, report.brand_key, correlationId,
            json({ source: "growth_intelligence_registry", report_id: report.report_id, action_id: action.action_id, secrets_included: false }),
            requestedBy,
          ]
        );
        holds.push({ hold_id: holdId, action_id: action.action_id });
      }
      await connection.query(
        `INSERT INTO growth_intelligence_actions
          (action_record_id, action_id, report_id, opportunity_id, tenant_id, brand_key, workflow_run_id,
           approval_hold_id, title, priority_score, risk, execution_class, execution_mode, approval_state,
           readback_requirements_json, provider_write, external_send, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dry_run', ?, ?, 0, 0, 0)`,
        [
          randomUUID(), action.action_id, report.report_id, action.opportunity_id, report.tenant_id,
          report.brand_key, runId, holdId, action.title, action.priority_score, action.risk,
          action.execution_class, holdId ? "held" : "not_required", json(action.readback_requirements),
        ]
      );
    }

    return {
      persistence_mode: "internal_registry",
      report_id: report.report_id,
      workflow_run_id: runId,
      insight_count: report.growth_opportunities.length,
      action_count: report.prioritized_backlog.length,
      approval_holds: holds,
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    };
  });
}

export function assessGrowthIntelligenceReadiness(record = {}) {
  const report = record.report || {};
  const insights = record.insights || [];
  const actions = record.actions || [];
  const requiredControls = [
    "report_approved",
    "all_actions_approved",
    "all_insights_accepted",
    "all_insights_evidence_backed",
    "all_actions_scored",
    "all_actions_have_readback_requirements",
    "no_provider_writes",
    "no_external_sends",
    "no_secrets",
  ];
  const satisfied = [];
  const gaps = [];
  const control = (name, ok, reason) => (ok ? satisfied.push(name) : gaps.push({ control: name, reason }));
  control("report_approved", report.status === "approved", "report_status_not_approved");
  control("all_actions_approved", actions.length > 0 && actions.every((item) => item.approval_state === "approved"), "actions_not_fully_approved");
  control("all_insights_accepted", insights.length > 0 && insights.every((item) => item.status === "accepted"), "insights_not_fully_accepted");
  control("all_insights_evidence_backed", insights.length > 0 && insights.every((item) => item.evidence_status === "evidence_backed"), "unsupported_or_assumption_insights_present");
  control("all_actions_scored", actions.length > 0 && actions.every((item) => Number.isFinite(Number(item.priority_score))), "unscored_actions_present");
  control(
    "all_actions_have_readback_requirements",
    actions.length > 0 && actions.every((item) => parseJsonArray(item.readback_requirements_json).length > 0),
    "readback_requirements_missing"
  );
  control("no_provider_writes", actions.every((item) => Number(item.provider_write || 0) === 0), "provider_write_flag_present");
  control("no_external_sends", actions.every((item) => Number(item.external_send || 0) === 0), "external_send_flag_present");
  control("no_secrets", Number(report.secrets_included || 0) === 0 && actions.every((item) => Number(item.secrets_included || 0) === 0), "secret_flag_present");
  const quality = {
    insight_count: insights.length,
    accepted_insight_count: insights.filter((item) => item.status === "accepted").length,
    evidence_backed_count: insights.filter((item) => item.evidence_status === "evidence_backed").length,
    action_count: actions.length,
    approved_action_count: actions.filter((item) => item.approval_state === "approved").length,
  };
  return {
    assessment_status: gaps.length === 0 ? "review_ready" : "blocked",
    blocking_gap_count: gaps.length,
    required_controls: requiredControls,
    satisfied_controls: satisfied,
    blocking_gaps: gaps,
    quality_metrics: quality,
    execution_allowed: false,
    provider_writes_allowed: false,
    external_sends_allowed: false,
    secrets_included: false,
  };
}

export async function persistGrowthIntelligenceReadinessAssessment({ pool, tenantId, reportId, assessedBy = null }) {
  return withTransaction(pool, async (connection) => {
    const record = await getGrowthIntelligenceReport({ pool: connection, tenantId, reportId });
    if (!record) {
      const error = new Error("Growth Intelligence report not found.");
      error.status = 404;
      error.code = "growth_intelligence_report_not_found";
      throw error;
    }
    const assessment = assessGrowthIntelligenceReadiness(record);
    const assessmentId = randomUUID();
    const assessmentHash = sha256(assessment);
    await connection.query(
      `INSERT INTO growth_intelligence_readiness_assessments
        (assessment_id, report_id, tenant_id, brand_key, assessment_status, blocking_gap_count,
         required_controls_json, satisfied_controls_json, blocking_gaps_json, quality_metrics_json,
         assessment_sha256, execution_allowed, provider_writes_allowed, external_sends_allowed,
         secrets_included, assessed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
      [
        assessmentId, reportId, tenantId, record.report.brand_key, assessment.assessment_status,
        assessment.blocking_gap_count, json(assessment.required_controls), json(assessment.satisfied_controls),
        json(assessment.blocking_gaps), json(assessment.quality_metrics), assessmentHash, assessedBy,
      ]
    );
    await connection.query(
      `UPDATE growth_intelligence_actions
          SET readiness_status = ?, readiness_assessment_id = ?
        WHERE tenant_id = ? AND report_id = ?`,
      [assessment.assessment_status, assessmentId, tenantId, reportId]
    );
    return { assessment_id: assessmentId, assessment_sha256: assessmentHash, ...assessment };
  });
}

export async function decideGrowthIntelligenceInsight({
  pool, tenantId, reportId, insightId, decision, decisionBy = null, decisionNote = null,
}) {
  if (!["accepted", "rejected", "stale"].includes(decision)) {
    const error = new Error("decision must be accepted, rejected, or stale.");
    error.status = 400;
    error.code = "growth_insight_decision_invalid";
    throw error;
  }
  const [result] = await pool.query(
    `UPDATE growth_intelligence_insights
        SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW()
      WHERE tenant_id = ? AND report_id = ? AND insight_id = ?
        AND status <> 'superseded'`,
    [decision, decisionBy, decisionNote, tenantId, reportId, insightId]
  );
  if (!result?.affectedRows) {
    const error = new Error("Growth Intelligence insight not found or superseded.");
    error.status = 404;
    error.code = "growth_insight_not_found";
    throw error;
  }
  return { report_id: reportId, insight_id: insightId, status: decision, execution_dispatched: false, secrets_included: false };
}

export async function decideGrowthIntelligenceAction({
  pool,
  tenantId,
  reportId,
  actionId,
  decision,
  decisionBy = null,
  decisionNote = null,
}) {
  if (!["approved", "rejected"].includes(decision)) {
    const error = new Error("decision must be approved or rejected.");
    error.status = 400;
    error.code = "growth_action_decision_invalid";
    throw error;
  }
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT a.action_record_id, a.action_id, a.approval_hold_id, a.workflow_run_id, a.approval_state, h.status AS hold_status
         FROM growth_intelligence_actions a
         LEFT JOIN approval_holds h
           ON CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
            = CONVERT(a.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
        WHERE a.tenant_id = ? AND a.report_id = ? AND a.action_id = ?
        LIMIT 1`,
      [tenantId, reportId, actionId]
    );
    const action = rows[0];
    if (!action) {
      const error = new Error("Growth Intelligence action not found.");
      error.status = 404;
      error.code = "growth_action_not_found";
      throw error;
    }
    if (!action.approval_hold_id || action.hold_status !== "open") {
      const error = new Error("Growth Intelligence action approval hold is not open.");
      error.status = 409;
      error.code = "growth_action_hold_not_open";
      throw error;
    }

    await connection.query(
      `UPDATE approval_holds
          SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW()
        WHERE hold_id = ? AND status = 'open'`,
      [decision, decisionBy, decisionNote, action.approval_hold_id]
    );
    await connection.query(
      `UPDATE growth_intelligence_actions
          SET approval_state = ?
        WHERE tenant_id = ? AND report_id = ? AND action_id = ?`,
      [decision, tenantId, reportId, actionId]
    );
    const [pendingRows] = await connection.query(
      `SELECT
         SUM(approval_state = 'held') AS held_count,
         SUM(approval_state = 'rejected') AS rejected_count
       FROM growth_intelligence_actions
       WHERE tenant_id = ? AND report_id = ?`,
      [tenantId, reportId]
    );
    const heldCount = Number(pendingRows[0]?.held_count || 0);
    const rejectedCount = Number(pendingRows[0]?.rejected_count || 0);
    const reportStatus = rejectedCount > 0 ? "rejected" : heldCount > 0 ? "approval_pending" : "approved";
    const workflowStatus = reportStatus === "rejected" ? "failed" : reportStatus === "approved" ? "awaiting_review" : "awaiting_approval";
    await connection.query(
      `UPDATE growth_intelligence_reports SET status = ? WHERE tenant_id = ? AND report_id = ?`,
      [reportStatus, tenantId, reportId]
    );
    await connection.query(
      `UPDATE workflow_runs SET status = ? WHERE run_id = ?`,
      [workflowStatus, action.workflow_run_id]
    );
    return {
      report_id: reportId,
      action_id: actionId,
      approval_hold_id: action.approval_hold_id,
      decision,
      report_status: reportStatus,
      workflow_status: workflowStatus,
      execution_dispatched: false,
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    };
  });
}

export async function listGrowthIntelligenceReports({ pool, tenantId, brandKey = "", limit = 50 }) {
  const params = [tenantId];
  const conditions = ["tenant_id = ?"];
  if (brandKey) {
    conditions.push("brand_key = ?");
    params.push(brandKey);
  }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
  const [rows] = await pool.query(
    `SELECT report_id, tenant_id, brand_key, workflow_run_id, report_type, schema_version, status,
            quality_status, quality_metrics_json, freshness_expires_at,
            provider_writes, external_sends, secrets_included, generated_at, created_at
       FROM growth_intelligence_reports
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?`,
    params
  );
  return rows;
}

export async function getGrowthIntelligenceReport({ pool, tenantId, reportId }) {
  const [reports] = await pool.query(
    `SELECT * FROM growth_intelligence_reports WHERE tenant_id = ? AND report_id = ? LIMIT 1`,
    [tenantId, reportId]
  );
  if (!reports[0]) return null;
  const [insights] = await pool.query(
    `SELECT * FROM growth_intelligence_insights WHERE tenant_id = ? AND report_id = ? ORDER BY score DESC`,
    [tenantId, reportId]
  );
  const [actions] = await pool.query(
    `SELECT * FROM growth_intelligence_actions WHERE tenant_id = ? AND report_id = ? ORDER BY priority_score DESC`,
    [tenantId, reportId]
  );
  const [readinessAssessments] = await pool.query(
    `SELECT * FROM growth_intelligence_readiness_assessments
      WHERE tenant_id = ? AND report_id = ?
      ORDER BY created_at DESC`,
    [tenantId, reportId]
  );
  return { report: reports[0], insights, actions, readiness_assessments: readinessAssessments };
}

export async function getGrowthIntelligenceMetrics({ pool, tenantId, brandKey = "" }) {
  const reportConditions = ["tenant_id = ?"];
  const reportParams = [tenantId];
  if (brandKey) {
    reportConditions.push("brand_key = ?");
    reportParams.push(brandKey);
  }
  const [reportRows] = await pool.query(
    `SELECT COUNT(*) AS report_count,
            SUM(status = 'approval_pending') AS approval_pending_report_count,
            SUM(status = 'approved') AS approved_report_count,
            MAX(created_at) AS latest_report_at
       FROM growth_intelligence_reports
      WHERE ${reportConditions.join(" AND ")}`,
    reportParams
  );
  const [insightRows] = await pool.query(
    `SELECT COUNT(*) AS insight_count,
            SUM(evidence_status = 'evidence_backed') AS evidence_backed_count,
            SUM(evidence_status = 'assumption') AS assumption_count,
            SUM(status = 'stale') AS stale_count,
            SUM(status = 'accepted') AS accepted_count,
            SUM(status = 'rejected') AS rejected_count,
            SUM(status = 'superseded') AS superseded_count
       FROM growth_intelligence_insights
      WHERE ${reportConditions.join(" AND ")}`,
    reportParams
  );
  const [actionRows] = await pool.query(
    `SELECT COUNT(*) AS action_count,
            SUM(approval_state = 'held') AS held_action_count,
            SUM(approval_state = 'approved') AS approved_action_count,
            SUM(approval_state = 'rejected') AS rejected_action_count,
            SUM(provider_write) AS provider_write_count,
            SUM(external_send) AS external_send_count,
            SUM(secrets_included) AS secrets_included_count
       FROM growth_intelligence_actions
      WHERE ${reportConditions.join(" AND ")}`,
    reportParams
  );
  const [readinessRows] = await pool.query(
    `SELECT COUNT(*) AS assessment_count,
            SUM(assessment_status = 'blocked') AS blocked_assessment_count,
            SUM(assessment_status = 'review_ready') AS review_ready_assessment_count,
            MAX(created_at) AS latest_assessment_at
       FROM growth_intelligence_readiness_assessments
      WHERE ${reportConditions.join(" AND ")}`,
    reportParams
  );
  const reports = reportRows[0] || {};
  const insights = insightRows[0] || {};
  const actions = actionRows[0] || {};
  const readiness = readinessRows[0] || {};
  return {
    tenant_id: tenantId,
    brand_key: brandKey || null,
    reports,
    insights,
    actions,
    readiness,
    quality: {
      evidence_coverage: ratio(Number(insights.evidence_backed_count || 0), Number(insights.insight_count || 0)),
      insight_acceptance_rate: ratio(Number(insights.accepted_count || 0), Number(insights.insight_count || 0)),
      action_approval_rate: ratio(Number(actions.approved_action_count || 0), Number(actions.action_count || 0)),
      report_approval_rate: ratio(Number(reports.approved_report_count || 0), Number(reports.report_count || 0)),
    },
    safety: {
      provider_write_count: Number(actions.provider_write_count || 0),
      external_send_count: Number(actions.external_send_count || 0),
      secrets_included_count: Number(actions.secrets_included_count || 0),
    },
  };
}
