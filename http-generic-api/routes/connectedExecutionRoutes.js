import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

const SESSION_MODES = new Set(["single_turn", "connected_rounds", "worker_driven"]);
const SESSION_STATUSES = new Set(["draft", "ready", "running", "paused", "awaiting_user", "awaiting_approval", "blocked", "completed", "failed", "cancelled"]);
const REPORT_STATUSES = new Set(["checkpoint", "progress", "blocked", "handoff", "resume_ready", "completed", "failed"]);
const ACTION_KINDS = new Set(["tool_call", "repo_operation", "db_operation", "provider_operation", "local_device_operation", "document_generation", "analysis_step", "approval_request", "user_prompt", "stop"]);

function nonEmptyString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function boundedInt(value, fallback, min = 1, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function jsonText(value, fallback = null) {
  return JSON.stringify(normalizeJson(value, fallback));
}

function validationError(message, code = "connected_execution_validation_error") {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: String(err.message || "Connected execution request failed.").slice(0, 300),
    },
    secrets_included: false,
  });
}

async function ensureConnectedSession(pool, connectedSessionId) {
  const [rows] = await pool.query(
    `SELECT connected_session_id, tenant_id, user_id, status
       FROM connected_execution_sessions
      WHERE connected_session_id = ?
      LIMIT 1`,
    [connectedSessionId]
  );
  if (!rows[0]) {
    const err = new Error("Connected execution session not found.");
    err.status = 404;
    err.code = "connected_execution_session_not_found";
    throw err;
  }
  return rows[0];
}

export function buildConnectedExecutionRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  if (requireBackendApiKey) router.use(requireBackendApiKey);
  if (requireAdminPrincipal) router.use(requireAdminPrincipal);

  router.post("/connected-execution/sessions", async (req, res) => {
    try {
      const body = req.body || {};
      const connectedSessionId = nonEmptyString(body.connected_session_id || body.connectedSessionId, randomUUID());
      const mode = nonEmptyString(body.mode, "connected_rounds");
      const status = nonEmptyString(body.status, "ready");
      if (!SESSION_MODES.has(mode)) throw validationError("Unsupported connected execution mode.", "connected_execution_mode_invalid");
      if (!SESSION_STATUSES.has(status)) throw validationError("Unsupported connected execution status.", "connected_execution_status_invalid");
      const tenantId = nonEmptyString(body.tenant_id || body.tenantId) || null;
      const userId = nonEmptyString(body.user_id || body.userId) || null;
      const rootPlanId = nonEmptyString(body.root_plan_id || body.rootPlanId) || null;
      const currentRunId = nonEmptyString(body.current_run_id || body.currentRunId) || null;
      const currentStepRunId = nonEmptyString(body.current_step_run_id || body.currentStepRunId) || null;
      const maxRounds = body.max_rounds === undefined && body.maxRounds === undefined ? null : boundedInt(body.max_rounds ?? body.maxRounds, 25, 1, 1000);
      const resumePolicyJson = jsonText(body.resume_policy_json || body.resumePolicyJson || body.resume_policy || body.resumePolicy, { mode: "manual_or_invocation_resume", executes_background_work: false });
      const budgetPolicyJson = jsonText(body.budget_policy_json || body.budgetPolicyJson || body.budget_policy || body.budgetPolicy, { max_rounds: maxRounds, requires_explicit_worker: true });
      const checkpointPolicyJson = jsonText(body.checkpoint_policy_json || body.checkpointPolicyJson || body.checkpoint_policy || body.checkpointPolicy, { evidence_report_required: true, secrets_included: false });
      const resumeCursorJson = jsonText(body.resume_cursor_json || body.resumeCursorJson || body.resume_cursor || body.resumeCursor, null);
      const lastCheckpointJson = jsonText(body.last_checkpoint_json || body.lastCheckpointJson || body.last_checkpoint || body.lastCheckpoint, null);
      const nextActionJson = jsonText(body.next_action_json || body.nextActionJson || body.next_action || body.nextAction, null);

      await getPool().query(
        `INSERT INTO connected_execution_sessions (
          connected_session_id, tenant_id, user_id, root_plan_id, current_run_id, current_step_run_id,
          mode, status, resume_policy_json, budget_policy_json, checkpoint_policy_json,
          resume_cursor_json, last_checkpoint_json, next_action_json, max_rounds,
          secrets_included, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
        ON DUPLICATE KEY UPDATE
          tenant_id = VALUES(tenant_id),
          user_id = VALUES(user_id),
          root_plan_id = VALUES(root_plan_id),
          current_run_id = VALUES(current_run_id),
          current_step_run_id = VALUES(current_step_run_id),
          mode = VALUES(mode),
          status = VALUES(status),
          resume_policy_json = VALUES(resume_policy_json),
          budget_policy_json = VALUES(budget_policy_json),
          checkpoint_policy_json = VALUES(checkpoint_policy_json),
          resume_cursor_json = VALUES(resume_cursor_json),
          last_checkpoint_json = VALUES(last_checkpoint_json),
          next_action_json = VALUES(next_action_json),
          max_rounds = VALUES(max_rounds),
          secrets_included = 0,
          last_activity_at = NOW()`,
        [connectedSessionId, tenantId, userId, rootPlanId, currentRunId, currentStepRunId, mode, status, resumePolicyJson, budgetPolicyJson, checkpointPolicyJson, resumeCursorJson, lastCheckpointJson, nextActionJson, maxRounds]
      );
      const [rows] = await getPool().query(
        `SELECT connected_session_id, tenant_id, user_id, root_plan_id, current_run_id, current_step_run_id,
                mode, status, round_count, max_rounds, last_evidence_report_id, last_activity_at, secrets_included
           FROM connected_execution_sessions
          WHERE connected_session_id = ?
          LIMIT 1`,
        [connectedSessionId]
      );
      return res.status(201).json({ ok: true, session: rows[0], secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "connected_execution_session_upsert_failed");
    }
  });

  router.get("/connected-execution/sessions/:connected_session_id/checkpoint", async (req, res) => {
    try {
      const connectedSessionId = nonEmptyString(req.params.connected_session_id);
      if (!connectedSessionId) throw validationError("connected_session_id is required.", "connected_execution_session_id_required");
      const [rows] = await getPool().query(
        `SELECT * FROM connected_execution_latest_checkpoint WHERE connected_session_id = ? LIMIT 1`,
        [connectedSessionId]
      );
      if (!rows[0]) {
        return res.status(404).json({ ok: false, error: { code: "connected_execution_checkpoint_not_found", message: "No connected execution checkpoint found." }, secrets_included: false });
      }
      return res.json({ ok: true, checkpoint: rows[0], secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "connected_execution_checkpoint_read_failed");
    }
  });

  router.post("/connected-execution/sessions/:connected_session_id/evidence-reports", async (req, res) => {
    try {
      const connectedSessionId = nonEmptyString(req.params.connected_session_id);
      if (!connectedSessionId) throw validationError("connected_session_id is required.", "connected_execution_session_id_required");
      const pool = getPool();
      const session = await ensureConnectedSession(pool, connectedSessionId);
      const body = req.body || {};
      const evidenceReportId = nonEmptyString(body.evidence_report_id || body.evidenceReportId, randomUUID());
      const stage = nonEmptyString(body.stage);
      if (!stage) throw validationError("stage is required.", "connected_execution_stage_required");
      const status = nonEmptyString(body.status, "checkpoint");
      if (!REPORT_STATUSES.has(status)) throw validationError("Unsupported evidence report status.", "connected_execution_report_status_invalid");
      const planId = nonEmptyString(body.plan_id || body.planId) || null;
      const runId = nonEmptyString(body.run_id || body.runId) || null;
      const stepRunId = nonEmptyString(body.step_run_id || body.stepRunId) || null;
      const nextActionJson = jsonText(body.next_action_json || body.nextActionJson || body.next_action || body.nextAction, null);
      const summaryJson = jsonText(body.summary_json || body.summaryJson || body.summary, {});
      const evidenceJson = jsonText(body.evidence_json || body.evidenceJson || body.evidence, {});
      const blockersJson = jsonText(body.blockers_json || body.blockersJson || body.blockers, []);
      const firstResumeInstruction = nonEmptyString(body.first_resume_instruction || body.firstResumeInstruction).slice(0, 512) || null;

      await pool.query(
        `INSERT INTO connected_execution_evidence_reports (
          evidence_report_id, connected_session_id, tenant_id, user_id, plan_id, run_id, step_run_id,
          stage, status, summary_json, evidence_json, ci_json, readiness_json, artifact_refs_json,
          blockers_json, next_action_json, first_resume_instruction, secrets_included
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          evidenceReportId,
          connectedSessionId,
          nonEmptyString(body.tenant_id || body.tenantId, session.tenant_id) || session.tenant_id || null,
          nonEmptyString(body.user_id || body.userId, session.user_id) || session.user_id || null,
          planId,
          runId,
          stepRunId,
          stage,
          status,
          summaryJson,
          evidenceJson,
          jsonText(body.ci_json || body.ciJson || body.ci, null),
          jsonText(body.readiness_json || body.readinessJson || body.readiness, null),
          jsonText(body.artifact_refs_json || body.artifactRefsJson || body.artifact_refs || body.artifactRefs, []),
          blockersJson,
          nextActionJson,
          firstResumeInstruction,
        ]
      );
      const newSessionStatus = status === "completed" ? "completed" : status === "failed" ? "failed" : status === "blocked" ? "blocked" : "paused";
      await pool.query(
        `UPDATE connected_execution_sessions
            SET last_evidence_report_id = ?,
                current_run_id = COALESCE(?, current_run_id),
                current_step_run_id = COALESCE(?, current_step_run_id),
                last_checkpoint_json = ?,
                next_action_json = ?,
                status = ?,
                round_count = round_count + 1,
                secrets_included = 0,
                last_activity_at = NOW(),
                completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END
          WHERE connected_session_id = ?`,
        [evidenceReportId, runId, stepRunId, summaryJson, nextActionJson, newSessionStatus, newSessionStatus, connectedSessionId]
      );
      return res.status(201).json({ ok: true, evidence_report_id: evidenceReportId, connected_session_id: connectedSessionId, status, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "connected_execution_evidence_report_create_failed");
    }
  });

  router.post("/connected-execution/sessions/:connected_session_id/resume-actions", async (req, res) => {
    try {
      const connectedSessionId = nonEmptyString(req.params.connected_session_id);
      if (!connectedSessionId) throw validationError("connected_session_id is required.", "connected_execution_session_id_required");
      const pool = getPool();
      const session = await ensureConnectedSession(pool, connectedSessionId);
      const body = req.body || {};
      const resumeActionId = nonEmptyString(body.resume_action_id || body.resumeActionId, randomUUID());
      const actionKind = nonEmptyString(body.action_kind || body.actionKind);
      if (!ACTION_KINDS.has(actionKind)) throw validationError("Unsupported resume action kind.", "connected_execution_action_kind_invalid");
      const actionOrder = boundedInt(body.action_order ?? body.actionOrder, 1, 1, 1000000);
      const actionKey = nonEmptyString(body.action_key || body.actionKey) || null;
      await pool.query(
        `INSERT INTO connected_execution_resume_actions (
          resume_action_id, connected_session_id, tenant_id, user_id, action_order, action_kind,
          action_key, action_payload_json, guardrails_json, status, secrets_included
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)
        ON DUPLICATE KEY UPDATE
          action_order = VALUES(action_order),
          action_kind = VALUES(action_kind),
          action_key = VALUES(action_key),
          action_payload_json = VALUES(action_payload_json),
          guardrails_json = VALUES(guardrails_json),
          status = 'pending',
          secrets_included = 0`,
        [
          resumeActionId,
          connectedSessionId,
          nonEmptyString(body.tenant_id || body.tenantId, session.tenant_id) || session.tenant_id || null,
          nonEmptyString(body.user_id || body.userId, session.user_id) || session.user_id || null,
          actionOrder,
          actionKind,
          actionKey,
          jsonText(body.action_payload_json || body.actionPayloadJson || body.action_payload || body.actionPayload, {}),
          jsonText(body.guardrails_json || body.guardrailsJson || body.guardrails, { executes_action: false, requires_claim_before_execution: true }),
        ]
      );
      await pool.query(
        `UPDATE connected_execution_sessions
            SET next_action_json = ?, status = CASE WHEN status IN ('completed','failed','cancelled') THEN status ELSE 'paused' END, last_activity_at = NOW()
          WHERE connected_session_id = ?`,
        [jsonText({ resume_action_id: resumeActionId, action_kind: actionKind, action_key: actionKey, action_order: actionOrder, status: "pending" }), connectedSessionId]
      );
      return res.status(201).json({ ok: true, resume_action_id: resumeActionId, connected_session_id: connectedSessionId, status: "pending", executes_action: false, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "connected_execution_resume_action_create_failed");
    }
  });

  return router;
}
