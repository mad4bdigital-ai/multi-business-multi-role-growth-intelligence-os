import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { dispatchToolForCaller } from "./routes/gptToolsRoutes.js";

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

const READ_ONLY_TOOL_CALL_ALLOWLIST_VERSION = "read_only_tool_call_allowlist_v2";

const READ_ONLY_TOOL_CALL_ALLOWLIST = new Set([
  "platform_data_source_census",
  "platform_graph_status",
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
      evidence: { tool_key: null, allowlist_version: READ_ONLY_TOOL_CALL_ALLOWLIST_VERSION },
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
      allowlist_version: READ_ONLY_TOOL_CALL_ALLOWLIST_VERSION,
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

const SENSITIVE_RESULT_KEYS = [
  "password", "secret", "token", "api_key", "apikey", "credential", "private_key",
  "client_secret", "refresh_token", "access_token", "authorization", "cookie", "set-cookie",
];
const SAFE_BOOLEAN_METADATA_KEYS = new Set([
  "secrets_included",
]);
const READ_ONLY_TOOL_OUTPUT_DEFAULT_MAX_CHARS = 6000;
const READ_ONLY_TOOL_OUTPUT_HARD_MAX_CHARS = 10000;

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function hasSensitiveKey(key = "", value = undefined) {
  const lower = String(key || "").toLowerCase();
  if (SAFE_BOOLEAN_METADATA_KEYS.has(lower) && typeof value === "boolean") return false;
  return SENSITIVE_RESULT_KEYS.some((part) => lower.includes(part));
}

function redactString(value = "") {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]");
}

function redactForEvidence(value, { depth = 0, maxDepth = 6, maxArray = 25, maxKeys = 80, maxString = 1200 } = {}) {
  if (depth > maxDepth) return "[redacted:depth_limit]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    const text = redactString(value);
    return text.length > maxString ? `${text.slice(0, maxString)}...[truncated]` : text;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map((item) => redactForEvidence(item, { depth: depth + 1, maxDepth, maxArray, maxKeys, maxString }));
    if (value.length > maxArray) items.push({ truncated_array_items: value.length - maxArray });
    return items;
  }
  const out = {};
  const entries = Object.entries(value).slice(0, maxKeys);
  for (const [key, child] of entries) {
    out[key] = hasSensitiveKey(key, child) ? "[redacted]" : redactForEvidence(child, { depth: depth + 1, maxDepth, maxArray, maxKeys, maxString });
  }
  if (Object.keys(value).length > maxKeys) out.truncated_object_keys = Object.keys(value).length - maxKeys;
  return out;
}

function truncateEvidencePayload(value, maxChars = READ_ONLY_TOOL_OUTPUT_DEFAULT_MAX_CHARS) {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    original_chars: serialized.length,
    max_chars: maxChars,
    preview: serialized.slice(0, maxChars),
  };
}

function shouldExecuteReadOnlyToolCall(actionPayload = {}, guardrails = {}) {
  return actionPayload.execute_read_only_tool_call === true
    && guardrails.allow_read_only_tool_execution === true;
}

function readOnlyToolArgs(actionPayload = {}, guardrails = {}) {
  const rawArgs = actionPayload.tool_args && typeof actionPayload.tool_args === "object"
    ? actionPayload.tool_args
    : actionPayload.args && typeof actionPayload.args === "object" ? actionPayload.args : {};
  const maxResponseChars = clampNumber(
    actionPayload.max_response_chars ?? guardrails.max_response_chars,
    READ_ONLY_TOOL_OUTPUT_DEFAULT_MAX_CHARS,
    500,
    READ_ONLY_TOOL_OUTPUT_HARD_MAX_CHARS
  );
  return {
    args: { ...rawArgs, _response: { max_chars: maxResponseChars } },
    budget: {
      max_tool_calls: 1,
      used_tool_calls: 1,
      max_response_chars: maxResponseChars,
      output_redaction: "key_and_string_pattern_redaction_v1",
    },
  };
}

async function executeReadOnlyToolCall({ session, action, actionPayload, guardrails, preflight }) {
  const toolKey = preflight.evidence.tool_key;
  const { args, budget } = readOnlyToolArgs(actionPayload, guardrails);
  const fakeReq = {
    auth: {
      mode: "backend_api_key",
      is_admin: true,
      tenant_id: action.tenant_id || session.tenant_id || null,
      user_id: action.user_id || session.user_id || null,
    },
    headers: {},
    ip: "connected-execution-worker",
  };
  const dispatched = await dispatchToolForCaller("admin", toolKey, args, fakeReq);
  const status = Number(dispatched?.status || 0);
  const rawBody = dispatched?.body ?? {};
  const redactedBody = truncateEvidencePayload(redactForEvidence(rawBody), budget.max_response_chars);
  const ok = status >= 200 && status < 300 && rawBody?.ok !== false;
  return {
    ok,
    status,
    body: redactedBody,
    budget,
    evidence: {
      tool_key: toolKey,
      dispatcher_status: status,
      dispatcher_ok: ok,
      body_redacted: true,
      result_truncated: Boolean(redactedBody?.truncated),
      tool_call_executed: true,
      internal_tool_dispatch_executed: true,
      mutating_call_executed: false,
      repo_mutation_executed: false,
      provider_calls_executed: false,
      local_device_calls_executed: false,
      apply_operation_executed: false,
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

  const toolShouldExecute = Boolean(toolPreflight && shouldExecuteReadOnlyToolCall(actionPayload, guardrails));
  const toolExecution = toolShouldExecute
    ? await executeReadOnlyToolCall({ session, action, actionPayload, guardrails, preflight: toolPreflight })
    : null;
  const finalActionStatus = toolExecution && !toolExecution.ok ? "failed" : "completed";

  const summary = actionKind === "tool_call"
    ? {
        ok: finalActionStatus !== "failed",
        status: finalActionStatus,
        action_kind: actionKind,
        action_key: cleanString(action.action_key) || "tool_call",
        executes_action: toolShouldExecute,
        tool_call_executed: Boolean(toolExecution),
        worker_bridge_phase: toolShouldExecute ? "read_only_tool_call_execution_v1" : "read_only_tool_call_preflight_only",
        tool_key: toolPreflight.evidence.tool_key,
        allowlist_version: toolPreflight.evidence.allowlist_version,
        tool_dispatch_status: toolExecution?.status || null,
        tool_dispatch_ok: toolExecution?.ok ?? null,
        tool_execution_budget: toolExecution?.budget || null,
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
        executes_tool_call: toolShouldExecute,
        preflight_only: !toolShouldExecute,
        tool_execution_budget: toolExecution?.budget || { max_tool_calls: 0, used_tool_calls: 0 },
        tool_result_redacted: toolExecution?.body || null,
        ...(toolExecution?.evidence || {}),
        tool_call_executed: Boolean(toolExecution),
        repo_mutation_executed: false,
        provider_calls_executed: false,
        local_device_calls_executed: false,
        apply_operation_executed: false,
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
    status: finalActionStatus === "failed" ? "failed" : "progress",
    stage: toolShouldExecute ? "connected_execution_worker_bridge_read_only_tool_execution" : "connected_execution_worker_bridge",
    summary,
    evidence,
    blockers: finalActionStatus === "failed" ? ["read_only_tool_call_dispatch_failed"] : [],
    nextAction: { resume_action_id: resumeActionId, status: finalActionStatus, action_kind: actionKind },
    firstResumeInstruction: cleanString(actionPayload.first_resume_instruction || "Load latest connected execution checkpoint and continue with the next pending resume action."),
  });

  const result = { ...summary, evidence_report_id: evidenceReportId };
  const errorJson = finalActionStatus === "failed"
    ? JSON.stringify({ ok: false, code: "read_only_tool_call_dispatch_failed", tool_key: toolPreflight?.evidence?.tool_key || null, status: toolExecution?.status || null, secrets_included: false })
    : null;
  await pool.query(
    `UPDATE connected_execution_resume_actions
        SET status = ?, completed_at = NOW(), result_json = ?, error_json = ?, updated_at = NOW(), secrets_included = 0
      WHERE connected_session_id = ? AND resume_action_id = ? AND claim_token = ?`,
    [finalActionStatus, JSON.stringify(result), errorJson, connectedSessionId, resumeActionId, claimToken]
  );

  return result;
}
