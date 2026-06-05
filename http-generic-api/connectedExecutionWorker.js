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

const READ_ONLY_TOOL_CALL_ALLOWLIST = new Set([
  "platform_data_source_census",
  "connected_execution_latest_checkpoint_get",
  "schema_import_jobs_list",
  "schema_import_job_get",
]);

const MUTATING_TOOL_TAGS = new Set([
  "state_changing",
  "apply",
  "write",
  "mutation",
  "repo_mutation",
  "provider_call",
  "local_device_call",
  "tool_execution",
]);

function tagSet(value = "") {
  return new Set(String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean));
}

function hasMutatingTag(tags = new Set()) {
  for (const tag of tags) {
    if (MUTATING_TOOL_TAGS.has(tag)) return true;
  }
  return false;
}

async function buildReadOnlyToolCallPreflight(pool, actionPayload = {}) {
  const toolKey = cleanString(actionPayload.tool_key || actionPayload.toolKey || actionPayload.name);
  if (!toolKey) {
    return {
      allowed: false,
      blockers: ["tool_key_required"],
      evidence: { tool_key: null, allowlist_version: "read_only_tool_call_allowlist_v1" },
    };
  }

  const [toolRows] = await pool.query(
    `SELECT tool_key, is_enabled, http_method, http_path, tags
       FROM admin_platform_endpoint_tools
      WHERE tool_key = ?
      LIMIT 1`,
    [toolKey]
  );
  const tool = toolRows[0] || null;
  const tags = tagSet(tool?.tags || "");

  const [certRows] = await pool.query(
    `SELECT certification_key, risk_class, certification_status, dispatch_allowed, apply_allowed
       FROM runtime_dispatch_certification_registry
      WHERE tool_or_action_key = ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [toolKey]
  ).catch(() => [[]]);
  const certification = certRows?.[0] || null;

  const blockers = [];
  if (!READ_ONLY_TOOL_CALL_ALLOWLIST.has(toolKey)) blockers.push("tool_not_in_read_only_allowlist");
  if (!tool) blockers.push("tool_registry_row_not_found");
  if (tool && Number(tool.is_enabled || 0) !== 1) blockers.push("tool_not_enabled");
  if (tool && String(tool.http_method || "").toUpperCase() !== "GET") blockers.push("tool_method_not_get_read_only");
  if (hasMutatingTag(tags)) blockers.push("tool_has_mutating_tag");
  if (certification && Number(certification.apply_allowed || 0) !== 0) blockers.push("certification_allows_apply");

  return {
    allowed: blockers.length === 0,
    blockers,
    evidence: {
      tool_key: toolKey,
      allowlist_version: "read_only_tool_call_allowlist_v1",
      registry_present: Boolean(tool),
      registry_enabled: tool ? Number(tool.is_enabled || 0) === 1 : false,
      http_method: tool?.http_method || null,
      http_path: tool?.http_path || null,
      tags: [...tags],
      certification: certification ? {
        certification_key: certification.certification_key,
        risk_class: certification.risk_class,
        certification_status: certification.certification_status,
        dispatch_allowed: Number(certification.dispatch_allowed || 0) === 1,
        apply_allowed: Number(certification.apply_allowed || 0) === 1,
      } : null,
      executes_tool_call: false,
      preflight_only: true,
      secrets_included: false,
    },
  };
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

  if (!["analysis_step", "tool_call"].includes(actionKind)) {
    const blocked = {
      ok: true,
      status: "blocked",
      blocked_reason: "connected_execution_worker_allows_analysis_step_or_read_only_tool_call_preflight_only",
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
      evidence: { guardrails, worker_bridge: "analysis_step_or_read_only_tool_call_preflight_only" },
      blockers: ["unsupported_action_kind_for_worker_bridge"],
      nextAction: { resume_action_id: resumeActionId, status: "blocked", action_kind: actionKind },
      firstResumeInstruction: "Review action_kind and enqueue only analysis_step or read-only tool_call preflight actions for this worker bridge phase.",
    });
    await pool.query(
      `UPDATE connected_execution_resume_actions
          SET status = 'blocked', completed_at = NOW(), result_json = ?, error_json = NULL, updated_at = NOW(), secrets_included = 0
        WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?`,
      [JSON.stringify({ ...blocked, evidence_report_id: evidenceReportId }), connectedSessionId, resumeActionId, claimToken]
    );
    return { ...blocked, evidence_report_id: evidenceReportId };
  }

  const toolPreflight = actionKind === "tool_call" ? await buildReadOnlyToolCallPreflight(pool, actionPayload) : null;
  if (toolPreflight && !toolPreflight.allowed) {
    const blocked = {
      ok: true,
      status: "blocked",
      blocked_reason: "read_only_tool_call_preflight_blocked",
      action_kind: actionKind,
      action_key: cleanString(action.action_key) || "tool_call",
      executes_action: false,
      tool_call_executed: false,
      blockers: toolPreflight.blockers,
      secrets_included: false,
    };
    const evidenceReportId = await appendEvidenceReport(pool, {
      connectedSessionId,
      session,
      action,
      status: "blocked",
      stage: "connected_execution_worker_bridge_read_only_tool_call_preflight",
      summary: blocked,
      evidence: { action_payload: actionPayload, guardrails, ...toolPreflight.evidence },
      blockers: toolPreflight.blockers,
      nextAction: { resume_action_id: resumeActionId, status: "blocked", action_kind: actionKind },
      firstResumeInstruction: "Review read-only tool_call allowlist blockers before enqueueing another tool_call action.",
    });
    await pool.query(
      `UPDATE connected_execution_resume_actions
          SET status = 'blocked', completed_at = NOW(), result_json = ?, error_json = NULL, updated_at = NOW(), secrets_included = 0
        WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?`,
      [JSON.stringify({ ...blocked, evidence_report_id: evidenceReportId }), connectedSessionId, resumeActionId, claimToken]
    );
    return { ...blocked, evidence_report_id: evidenceReportId };
  }

  const summary = actionKind === "tool_call"
    ? {
        ok: true,
        status: "completed",
        action_kind: actionKind,
        action_key: cleanString(action.action_key) || "tool_call",
        executes_action: false,
        tool_call_executed: false,
        worker_bridge_phase: "read_only_tool_call_preflight_only",
        tool_key: toolPreflight.evidence.tool_key,
        allowlist_version: toolPreflight.evidence.allowlist_version,
        secrets_included: false,
      }
    : {
        ok: true,
        status: "completed",
        action_kind: actionKind,
        action_key: cleanString(action.action_key) || "analysis_step",
        executes_action: false,
        worker_bridge_phase: "analysis_step_metadata_only",
        objective: cleanString(actionPayload.objective || actionPayload.summary || actionPayload.note || "analysis_step completed by metadata-only worker bridge"),
        secrets_included: false,
      };
  const evidence = actionKind === "tool_call"
    ? {
        action_payload: actionPayload,
        guardrails,
        connected_session_id: connectedSessionId,
        resume_action_id: resumeActionId,
        claim_token_present: true,
        ...toolPreflight.evidence,
        external_tool_calls_executed: false,
        tool_call_executed: false,
        repo_mutation_executed: false,
        provider_calls_executed: false,
        local_device_calls_executed: false,
        secrets_included: false,
      }
    : {
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
