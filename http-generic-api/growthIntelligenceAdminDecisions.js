import { randomUUID } from "node:crypto";

import { getPool } from "./db.js";
import {
  decideGrowthIntelligenceAction,
  decideGrowthIntelligenceInsight,
  persistGrowthIntelligenceReadinessAssessment,
} from "./growthIntelligenceRegistry.js";

const V5_WORKFLOW_KEY = "tenant_repository_advisory_comment_v5";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function bounded(value, max) {
  return text(value).slice(0, max);
}

function fail(code, message, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
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

function requiredConfirmation(planId, holdId) {
  const plan = text(planId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
  const hold = text(holdId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
  return `APPROVE_V5_COMMENT_${plan}_${hold}`;
}

function requireScope(args = {}) {
  const tenantId = text(args.tenant_id);
  const reportId = text(args.report_id);
  if (!tenantId || !reportId) {
    throw fail(
      "growth_intelligence_decision_scope_required",
      "tenant_id and report_id are required."
    );
  }
  return { tenantId, reportId };
}

export async function decideGrowthIntelligenceInsightAdmin(args = {}, dependencies = {}) {
  const { tenantId, reportId } = requireScope(args);
  const insightId = text(args.insight_id);
  if (!insightId) throw fail("growth_intelligence_insight_id_required", "insight_id is required.");
  const decision = text(args.decision);
  const decide = dependencies.decideInsight || decideGrowthIntelligenceInsight;
  const result = await decide({
    pool: dependencies.pool || getPool(),
    tenantId,
    reportId,
    insightId,
    decision,
    decisionBy: bounded(args.decision_by, 36) || "gpt_admin",
    decisionNote: bounded(args.decision_note, 512) || null,
  });
  return {
    ok: true,
    tool: "growth_intelligence_insight_decide",
    classification: "growth_intelligence_insight_decision_recorded",
    ...result,
    provider_writes: 0,
    external_sends: 0,
    mutations_executed: true,
    execution_dispatched: false,
    secrets_included: false,
  };
}

export async function decideGrowthIntelligenceActionAdmin(args = {}, dependencies = {}) {
  const { tenantId, reportId } = requireScope(args);
  const actionId = text(args.action_id);
  if (!actionId) throw fail("growth_intelligence_action_id_required", "action_id is required.");
  const decision = text(args.decision);
  const decide = dependencies.decideAction || decideGrowthIntelligenceAction;
  const result = await decide({
    pool: dependencies.pool || getPool(),
    tenantId,
    reportId,
    actionId,
    decision,
    decisionBy: bounded(args.decision_by, 36) || "gpt_admin",
    decisionNote: bounded(args.decision_note, 512) || null,
  });
  return {
    ok: true,
    tool: "growth_intelligence_action_decide",
    classification: "growth_intelligence_action_decision_recorded_no_execution",
    ...result,
    provider_writes: 0,
    external_sends: 0,
    mutations_executed: true,
    execution_dispatched: false,
    secrets_included: false,
  };
}

export async function refreshGrowthIntelligenceReadinessAdmin(args = {}, dependencies = {}) {
  const { tenantId, reportId } = requireScope(args);
  const persist = dependencies.persistAssessment || persistGrowthIntelligenceReadinessAssessment;
  const result = await persist({
    pool: dependencies.pool || getPool(),
    tenantId,
    reportId,
    assessedBy: bounded(args.assessed_by, 128) || "gpt_admin_growth_intelligence_readiness",
  });
  return {
    ok: true,
    tool: "growth_intelligence_readiness_refresh",
    classification: result.assessment_status === "review_ready"
      ? "growth_intelligence_review_ready_no_execution"
      : "growth_intelligence_readiness_blocked",
    report_id: reportId,
    tenant_id: tenantId,
    readiness_assessment: result,
    apply_allowed: false,
    execution_allowed: false,
    provider_writes: 0,
    external_sends: 0,
    mutations_executed: true,
    secrets_included: false,
  };
}

export async function createRepositoryAdvisoryCommentApprovalHoldAdmin(args = {}, dependencies = {}) {
  const planId = text(args.plan_id);
  if (!planId) throw fail("repository_advisory_comment_plan_id_required", "plan_id is required.");
  const pool = dependencies.pool || getPool();
  return withTransaction(pool, async (connection) => {
    const [planRows] = await connection.query(
      `SELECT plan_id, tenant_id, workspace_id, user_id, owner_name, repo_name, pr_number,
              classification, planned_comment_type, approval_hold_id, status
         FROM repository_advisory_comment_plans
        WHERE plan_id = ?
        LIMIT 1
        FOR UPDATE`,
      [planId]
    );
    const plan = planRows[0];
    if (!plan) {
      throw fail(
        "repository_advisory_comment_plan_not_found",
        `Repository advisory comment plan not found: ${planId}`,
        404
      );
    }
    if (!plan.tenant_id) {
      throw fail(
        "repository_advisory_comment_tenant_scope_required",
        "The advisory plan must have tenant_id before approval can be requested.",
        409
      );
    }
    if (["posted", "readback_verified"].includes(plan.status)) {
      throw fail(
        "repository_advisory_comment_already_posted",
        "The advisory comment plan is already posted or readback-verified.",
        409
      );
    }

    if (plan.approval_hold_id) {
      const [holdRows] = await connection.query(
        `SELECT hold_id, run_id, status, expires_at
           FROM approval_holds
          WHERE hold_id = ?
          LIMIT 1`,
        [plan.approval_hold_id]
      );
      const existing = holdRows[0];
      if (existing && ["open", "approved"].includes(existing.status)) {
        return {
          ok: true,
          tool: "repository_advisory_comment_approval_hold_create",
          classification: existing.status === "approved"
            ? "repository_advisory_comment_approval_already_approved"
            : "repository_advisory_comment_approval_hold_reused",
          plan_id: planId,
          approval_hold_id: existing.hold_id,
          workflow_run_id: existing.run_id,
          approval_status: existing.status,
          required_confirmation: requiredConfirmation(planId, existing.hold_id),
          apply_allowed: false,
          provider_writes: 0,
          external_sends: 0,
          mutations_executed: false,
          secrets_included: false,
        };
      }
    }

    const runId = randomUUID();
    const holdId = randomUUID();
    const requestedBy = bounded(args.requested_by, 36) || "gpt_admin_v5_comment";
    const requiredRole = bounded(args.required_role, 64) || "platform_admin";
    const ttlMinutes = Math.max(5, Math.min(Number(args.ttl_minutes) || 60, 1440));
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const context = {
      source: "repository_advisory_comment_v5",
      plan_id: planId,
      owner: plan.owner_name,
      repo: plan.repo_name,
      pr_number: Number(plan.pr_number || 0),
      allowed_action: "post_advisory_comment_only",
      forbidden_mutations: ["close", "label", "merge", "patch", "force_push", "migration_apply"],
      provider_writes_before_approval: 0,
      external_sends: 0,
      secrets_included: false,
    };

    await connection.query(
      `INSERT INTO workflow_runs
        (run_id, tenant_id, workspace_id, user_id, correlation_id, execution_context_json,
         workflow_key, plan_id, service_mode, status, current_step, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'managed', 'awaiting_approval', 'approval_hold', ?, NOW())`,
      [
        runId,
        plan.tenant_id,
        plan.workspace_id || null,
        plan.user_id || null,
        planId,
        JSON.stringify(context),
        V5_WORKFLOW_KEY,
        planId,
        JSON.stringify({ plan_id: planId, approval_required: true, secrets_included: false }),
      ]
    );
    await connection.query(
      `INSERT INTO approval_holds
        (hold_id, run_id, tenant_id, workspace_id, user_id, correlation_id,
         execution_context_json, hold_type, requested_by, required_role, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'supervisor_approval', ?, ?, 'open', ?)`,
      [
        holdId,
        runId,
        plan.tenant_id,
        plan.workspace_id || null,
        plan.user_id || null,
        planId,
        JSON.stringify(context),
        requestedBy,
        requiredRole,
        ttlMinutes,
      ]
    );
    await connection.query(
      `UPDATE repository_advisory_comment_plans
          SET approval_hold_id = ?, status = 'approval_required', updated_at = CURRENT_TIMESTAMP
        WHERE plan_id = ?`,
      [holdId, planId]
    );

    const [readbackRows] = await connection.query(
      `SELECT p.plan_id, p.approval_hold_id, p.status AS plan_status,
              h.run_id, h.status AS approval_status, h.expires_at
         FROM repository_advisory_comment_plans p
         JOIN approval_holds h ON h.hold_id = p.approval_hold_id
        WHERE p.plan_id = ?
        LIMIT 1`,
      [planId]
    );
    const readback = readbackRows[0];
    if (!readback || readback.approval_hold_id !== holdId || readback.approval_status !== "open") {
      throw fail(
        "repository_advisory_comment_approval_hold_readback_failed",
        "Approval hold creation readback failed.",
        500
      );
    }
    return {
      ok: true,
      tool: "repository_advisory_comment_approval_hold_create",
      classification: "repository_advisory_comment_approval_hold_created",
      plan_id: planId,
      approval_hold_id: holdId,
      workflow_run_id: runId,
      approval_status: "open",
      expires_at: readback.expires_at,
      required_confirmation: requiredConfirmation(planId, holdId),
      apply_allowed: false,
      provider_writes: 0,
      external_sends: 0,
      mutations_executed: true,
      secrets_included: false,
    };
  });
}

export async function approveRepositoryAdvisoryCommentApprovalHoldAdmin(args = {}, dependencies = {}) {
  const planId = text(args.plan_id);
  const holdId = text(args.approval_hold_id);
  if (!planId || !holdId) {
    throw fail(
      "repository_advisory_comment_approval_scope_required",
      "plan_id and approval_hold_id are required."
    );
  }
  const expectedConfirmation = requiredConfirmation(planId, holdId);
  if (text(args.confirm) !== expectedConfirmation) {
    throw fail(
      "repository_advisory_comment_approval_confirmation_required",
      `Typed confirmation must equal ${expectedConfirmation}.`,
      400,
      { required_confirmation: expectedConfirmation }
    );
  }
  const pool = dependencies.pool || getPool();
  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT p.plan_id, p.approval_hold_id, p.status AS plan_status,
              h.run_id, h.status AS approval_status, h.expires_at
         FROM repository_advisory_comment_plans p
         JOIN approval_holds h ON h.hold_id = p.approval_hold_id
        WHERE p.plan_id = ? AND h.hold_id = ?
        LIMIT 1
        FOR UPDATE`,
      [planId, holdId]
    );
    const record = rows[0];
    if (!record) {
      throw fail(
        "repository_advisory_comment_approval_hold_not_found",
        "The approval hold is not linked to the requested advisory plan.",
        404
      );
    }
    if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
      throw fail(
        "repository_advisory_comment_approval_hold_expired",
        "The approval hold has expired.",
        409
      );
    }
    if (record.approval_status === "approved") {
      return {
        ok: true,
        tool: "repository_advisory_comment_approval_hold_approve",
        classification: "repository_advisory_comment_approval_already_approved",
        plan_id: planId,
        approval_hold_id: holdId,
        approval_status: "approved",
        apply_allowed: true,
        provider_writes: 0,
        external_sends: 0,
        mutations_executed: false,
        secrets_included: false,
      };
    }
    if (record.approval_status !== "open") {
      throw fail(
        "repository_advisory_comment_approval_hold_not_open",
        `Approval hold is not open: ${record.approval_status}`,
        409
      );
    }

    const decisionBy = bounded(args.decision_by, 36) || "gpt_admin";
    const decisionNote = bounded(args.decision_note, 512)
      || "Explicitly approved one V5 advisory comment only; all other repository mutations remain forbidden.";
    await connection.query(
      `UPDATE approval_holds
          SET status = 'approved', decision_by = ?, decision_note = ?, decided_at = NOW()
        WHERE hold_id = ? AND status = 'open'`,
      [decisionBy, decisionNote, holdId]
    );
    await connection.query(
      `UPDATE repository_advisory_comment_plans
          SET status = 'approved', updated_at = CURRENT_TIMESTAMP
        WHERE plan_id = ? AND approval_hold_id = ?`,
      [planId, holdId]
    );
    await connection.query(
      `UPDATE workflow_runs
          SET status = 'awaiting_review', current_step = 'approved_comment_apply', updated_at = CURRENT_TIMESTAMP
        WHERE run_id = ?`,
      [record.run_id]
    );

    const [readbackRows] = await connection.query(
      `SELECT p.status AS plan_status, h.status AS approval_status, w.status AS workflow_status
         FROM repository_advisory_comment_plans p
         JOIN approval_holds h ON h.hold_id = p.approval_hold_id
         JOIN workflow_runs w ON w.run_id = h.run_id
        WHERE p.plan_id = ? AND h.hold_id = ?
        LIMIT 1`,
      [planId, holdId]
    );
    const readback = readbackRows[0];
    if (
      !readback
      || readback.plan_status !== "approved"
      || readback.approval_status !== "approved"
      || readback.workflow_status !== "awaiting_review"
    ) {
      throw fail(
        "repository_advisory_comment_approval_readback_failed",
        "Approval decision readback failed.",
        500
      );
    }
    return {
      ok: true,
      tool: "repository_advisory_comment_approval_hold_approve",
      classification: "repository_advisory_comment_approval_recorded",
      plan_id: planId,
      approval_hold_id: holdId,
      approval_status: "approved",
      workflow_status: "awaiting_review",
      apply_allowed: true,
      allowed_mutation: "github_issue_comment_create_one",
      forbidden_mutations: ["close", "label", "merge", "patch", "force_push", "migration_apply"],
      provider_writes: 0,
      external_sends: 0,
      mutations_executed: true,
      secrets_included: false,
    };
  });
}
