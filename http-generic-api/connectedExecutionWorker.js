import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const CONNECTED_EXECUTION_RESUME_ACTION_JOB_TYPE = "connected_execution_resume_action";

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function errorPayload(code, message, details = {}) {
  return { ok: false, error: { code, message, details }, secrets_included: false };
}

async function appendEvidenceReport(pool, {
  connectedSessionId,
  session,
  action,
  status,
  stage,
  summary,
  evidence,
  blockers,
  nextAction,
  firstResumeInstruction,
}) {
  const evidenceReportId = randomUUID();
  const summaryJson = JSON.stringify(summary || {});
  const evidenceJson = JSON.stringify(evidence || {});
  const blockersJson = JSON.stringify(Array.isArray(blockers) ? blockers : []);
  const nextActionJson = JSON.stringify(nextAction || null);

  await pool.query(
    `INSERT INTO connected_execution_evidence_reports (
      evidence_report_id, connected_session_id, tenant_id, user_id, plan_id, run_id, step_run_id,
      stage, status, summary_json, evidence_json, ci_json, readiness_json, artifact_refs_json,
      blockers_json, next_action_json, first_resume_instruction, secrets_included
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0)`,
    [
      evidenceReportId,
      connectedSessionId,
      action.tenant_id || session.tenant_id || null,
      action.user_id || session.user_id || null,
      session.root_plan_id || null,
      session.current_run_id || null,
      session.current_step_run_id || null,
      stage,
      status,
      summaryJson,
      evidenceJson,
      JSON.stringify([]),
      blockersJson,
      nextActionJson,
      cleanString(firstResumeInstruction).slice(0, 512) || null,
    ]
  );

  await pool.query(
    `UPDATE connected_execution_sessions
        SET last_evidence_report_id = ?,
            last_checkpoint_json = ?,
            next_action_json = ?,
            status = ?,
            round_count = round_count + 1,
            secrets_included = 0,
            last_activity_at = NOW(),
            completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END
      WHERE connected_session_id = ?`,
    [
      evidenceReportId,
      summaryJson,
      nextActionJson,
      status === "blocked" ? "blocked" : status === "failed" ? "failed" : "paused",
      status === "failed" ? "failed" : "paused",
      connectedSessionId,
    ]
  );

  return evidenceReportId;
}

export async function runConnectedExecutionResumeAction(jobPayload = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const connectedSessionId = cleanString(jobPayload.connected_session_id || jobPayload.connectedSessionId);
  const resumeActionId = cleanString(jobPayload.resume_action_id || jobPayload.resumeActionId);
  const claimToken = cleanString(jobPayload.claim_token || jobPayload.claimToken, randomUUID());

  if (!connectedSessionId || !resumeActionId) {
    return errorPayload("connected_execution_resume_job_invalid", "connected_session_id and resume_action_id are required.");
  }

  const [sessionRows] = await pool.query(
    `SELECT connected_session_id, tenant_id, user_id, root_plan_id, current_run_id, current_step_run_id,
            mode, status, round_count, max_rounds
       FROM connected_execution_sessions
      WHERE connected_session_id = ?
      LIMIT 1`,
    [connectedSessionId]
  );
  const session = sessionRows[0];
  if (!session) {
    return errorPayload("connected_execution_session_not_found", "Connected execution session not found.", { connected_session_id: connectedSessionId });
  }

  const [claimResult] = await pool.query(
    `UPDATE connected_execution_resume_actions
        SET status = 'claimed', claim_token = ?, claimed_at = NOW(), updated_at = NOW(), secrets_included = 0
      WHERE connected_session_id = ?
        AND resume_action_id = ?
        AND status = 'pending'`,
    [claimToken, connectedSessionId, resumeActionId]
  );

  if (!claimResult || Number(claimResult.affectedRows || 0) !== 1) {
    const [rows] = await pool.query(
      `SELECT resume_action_id, connected_session_id, action_kind, action_key, status, result_json, error_json
         FROM connected_execution_resume_actions
        WHERE connected_session_id = ? AND resume_action_id = ?
        LIMIT 1`,
      [connectedSessionId, resumeActionId]
    );
    const current = rows[0] || null;
    return {
      ok: false,
      error: {
        code: current ? "connected_execution_resume_action_not_pending" : "connected_execution_resume_action_not_found",
        message: current ? "Resume action is not pending and cannot be claimed." : "Resume action not found.",
        details: { connected_session_id: connectedSessionId, resume_action_id: resumeActionId, current_status: current?.status || null },
      },
      secrets_included: false,
    };
  }

  const [actionRows] = await pool.query(
    `SELECT resume_action_id, connected_session_id, tenant_id, user_id, action_order, action_kind, action_key,
            action_payload_json, guardrails_json, status, claim_token
       FROM connected_execution_resume_actions
      WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?
      LIMIT 1`,
    [connectedSessionId, resumeActionId, claimToken]
  );
  const action = actionRows[0];
  if (!action) {
    return errorPayload("connected_execution_resume_action_claim_lost", "Claimed resume action could not be reloaded.", { connected_session_id: connectedSessionId, resume_action_id: resumeActionId });
  }

  const actionPayload = parseJson(action.action_payload_json, {});
  const guardrails = parseJson(action.guardrails_json, {});
  const actionKind = cleanString(action.action_kind);

  if (actionKind !== "analysis_step") {
    const blocked = {
      ok: true,
      status: "blocked",
      blocked_reason: "connected_execution_worker_allows_analysis_step_only",
      action_kind: actionKind,
      executes_action: false,
      secrets_included: false,
    };
    const evidenceReportId = await appendEvidenceReport(pool, {
      connectedSessionId,
      session,
      action,
      status: "blocked",
      stage: "connected_execution_worker_bridge",
      summary: blocked,
      evidence: { guardrails, worker_bridge: "analysis_step_only" },
      blockers: ["unsupported_action_kind_for_worker_bridge"],
      nextAction: { resume_action_id: resumeActionId, status: "blocked", action_kind: actionKind },
      firstResumeInstruction: "Review action_kind and enqueue only analysis_step actions for this worker bridge phase.",
    });
    await pool.query(
      `UPDATE connected_execution_resume_actions
          SET status = 'blocked', completed_at = NOW(), result_json = ?, error_json = NULL, updated_at = NOW(), secrets_included = 0
        WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?`,
      [JSON.stringify({ ...blocked, evidence_report_id: evidenceReportId }), connectedSessionId, resumeActionId, claimToken]
    );
    return { ...blocked, evidence_report_id: evidenceReportId };
  }

  const summary = {
    ok: true,
    status: "completed",
    action_kind: actionKind,
    action_key: cleanString(action.action_key) || "analysis_step",
    executes_action: false,
    worker_bridge_phase: "analysis_step_metadata_only",
    objective: cleanString(actionPayload.objective || actionPayload.summary || actionPayload.note || "analysis_step completed by metadata-only worker bridge"),
    secrets_included: false,
  };
  const evidence = {
    action_payload: actionPayload,
    guardrails,
    connected_session_id: connectedSessionId,
    resume_action_id: resumeActionId,
    claim_token_present: true,
    external_tool_calls_executed: false,
    repo_mutation_executed: false,
    provider_calls_executed: false,
    local_device_calls_executed: false,
    secrets_included: false,
  };
  const evidenceReportId = await appendEvidenceReport(pool, {
    connectedSessionId,
    session,
    action,
    status: "progress",
    stage: "connected_execution_worker_bridge",
    summary,
    evidence,
    blockers: [],
    nextAction: { resume_action_id: resumeActionId, status: "completed", action_kind: actionKind },
    firstResumeInstruction: cleanString(actionPayload.first_resume_instruction || "Load latest connected execution checkpoint and continue with the next pending resume action."),
  });

  const result = { ...summary, evidence_report_id: evidenceReportId };
  await pool.query(
    `UPDATE connected_execution_resume_actions
        SET status = 'completed', completed_at = NOW(), result_json = ?, error_json = NULL, updated_at = NOW(), secrets_included = 0
      WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?`,
    [JSON.stringify(result), connectedSessionId, resumeActionId, claimToken]
  );

  return result;
}
