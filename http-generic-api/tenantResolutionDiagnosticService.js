import { randomUUID } from "node:crypto";

const DIAGNOSTIC_MODES = new Set(["diagnose", "plan_preview", "escalate"]);
const DIAGNOSTIC_RESTARTABLE_STATUSES = new Set([
  "detected",
  "diagnosing",
  "needs_connection",
  "needs_approval",
  "deferred_by_policy",
  "escalated",
  "blocked_missing_authority",
]);
const PLAN_PREVIEW_STATUSES = new Set([
  ...DIAGNOSTIC_RESTARTABLE_STATUSES,
  "ready_to_apply",
]);
const ESCALATION_STATUSES = new Set([
  "detected",
  "diagnosing",
  "needs_connection",
  "needs_approval",
  "ready_to_apply",
  "deferred_by_policy",
  "blocked_missing_authority",
  "escalated",
]);
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|payload_json|raw_prompt|system_prompt)/i;

async function defaultPool() {
  const { getPool } = await import("./db.js");
  return getPool();
}

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function safeString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function optionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return null;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 50)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function normalizeStringList(value, { maxItems = 20, maxLength = 512 } = {}) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values
    .map((item) => safeString(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
    is_admin: explicitSubject.is_admin === true || subject.is_admin === true || principal.is_admin === true,
  };
}

function requireTenantSubject(sessionContext, explicitSubject) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id) {
    throw httpError(403, "TENANT_RESOLUTION_TENANT_SCOPE_REQUIRED", "Tenant scope is required for diagnostic actions.");
  }
  return subject;
}

function normalizeDiagnosticInput(input = {}) {
  const mode = safeString(input.mode || "diagnose", 64).toLowerCase();
  if (!DIAGNOSTIC_MODES.has(mode)) {
    throw httpError(400, "TENANT_RESOLUTION_DIAGNOSTIC_MODE_INVALID", "Unsupported diagnostic action mode.", {
      allowed_modes: [...DIAGNOSTIC_MODES],
    });
  }
  const observations = input.observations && typeof input.observations === "object"
    ? input.observations
    : {};
  return {
    mode,
    workspace_id: safeString(input.workspace_id, 64) || null,
    observations: {
      capability_ready: optionalBoolean(observations.capability_ready ?? observations.connection_ready),
      approval_ready: optionalBoolean(observations.approval_ready),
      authority_ready: optionalBoolean(observations.authority_ready),
      policy_allows_next_step: optionalBoolean(observations.policy_allows_next_step),
      escalation_required: optionalBoolean(observations.escalation_required) === true,
      evidence_refs: normalizeStringList(observations.evidence_refs || input.evidence_refs),
      blocked_reasons: normalizeStringList(observations.blocked_reasons, { maxItems: 20, maxLength: 300 }),
      note: safeString(observations.note || input.note, 2000) || null,
      escalation_reason: safeString(observations.escalation_reason || input.escalation_reason, 1000) || null,
    },
    idempotency_key: safeString(input.idempotency_key, 191) || null,
  };
}

function playbookProjection(row = {}) {
  return {
    playbook_key: row.playbook_key,
    root_family: row.root_family,
    status: row.playbook_status,
    tenant_visible: Number(row.playbook_tenant_visible || 0) === 1,
    risk_level: row.playbook_risk_level || "medium",
    required_capability_key: row.required_capability_key || null,
    diagnostic_tool_key: row.diagnostic_tool_key || null,
    decision_tool_key: row.decision_tool_key || null,
    apply_tool_key: row.apply_tool_key || null,
    readback_tool_key: row.readback_tool_key || null,
    approval_required: Number(row.approval_required || 0) === 1,
    readback_required: Number(row.readback_required || 0) === 1,
    policy: sanitizeValue(parseJsonValue(row.playbook_policy_json, {})),
    secrets_included: false,
  };
}

function caseProjection(row = {}) {
  return {
    case_id: row.case_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id || null,
    resource_ref: row.resource_ref || null,
    root_family: row.root_family,
    playbook_key: row.playbook_key,
    status: row.status,
    severity: row.severity,
    current_step_key: row.current_step_key || null,
    last_diagnostic: sanitizeValue(parseJsonValue(row.last_diagnostic_json, null)),
    last_preflight: sanitizeValue(parseJsonValue(row.last_preflight_json, null)),
    escalation_ref: row.escalation_ref || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

function determineDiagnosticOutcome(row, playbook, observations) {
  const findings = [];
  const blockingReasons = [...observations.blocked_reasons];

  if (playbook.status !== "active" || !playbook.tenant_visible) {
    findings.push({ code: "PLAYBOOK_UNAVAILABLE", severity: "high" });
    blockingReasons.push("The configured playbook is not active and tenant-visible.");
    return { next_status: "escalated", findings, blocking_reasons: blockingReasons };
  }
  if (observations.escalation_required) {
    findings.push({ code: "ESCALATION_REQUESTED", severity: "high" });
    blockingReasons.push(observations.escalation_reason || "Escalation was explicitly requested.");
    return { next_status: "escalated", findings, blocking_reasons: blockingReasons };
  }
  if (playbook.required_capability_key && observations.capability_ready !== true) {
    findings.push({ code: "CAPABILITY_NOT_CONFIRMED", severity: "high", capability_key: playbook.required_capability_key });
    blockingReasons.push("Required capability readiness has not been confirmed.");
    return { next_status: "needs_connection", findings, blocking_reasons: blockingReasons };
  }
  if (playbook.approval_required && observations.approval_ready !== true) {
    findings.push({ code: "APPROVAL_NOT_CONFIRMED", severity: "high" });
    blockingReasons.push("Required tenant approval has not been confirmed.");
    return { next_status: "needs_approval", findings, blocking_reasons: blockingReasons };
  }
  if (observations.authority_ready !== true) {
    findings.push({ code: "AUTHORITY_NOT_CONFIRMED", severity: "high" });
    blockingReasons.push("Execution authority has not been confirmed.");
    return { next_status: "blocked_missing_authority", findings, blocking_reasons: blockingReasons };
  }
  if (observations.policy_allows_next_step === false) {
    findings.push({ code: "POLICY_BLOCKED", severity: "medium" });
    blockingReasons.push("Current policy does not allow the next step.");
    return { next_status: "deferred_by_policy", findings, blocking_reasons: blockingReasons };
  }

  findings.push({
    code: "DIAGNOSTIC_PREREQUISITES_CONFIRMED",
    severity: "info",
    apply_tool_registered: Boolean(playbook.apply_tool_key),
  });
  return { next_status: "ready_to_apply", findings, blocking_reasons: blockingReasons };
}

function buildDiagnosticArtifact(row, playbook, observations, outcome, diagnosticId, nowIso) {
  return sanitizeValue({
    diagnostic_id: diagnosticId,
    case_id: row.case_id,
    root_family: row.root_family,
    playbook_key: row.playbook_key,
    generated_at: nowIso,
    source: "tenant_bounded_observations_and_registry_policy",
    confidence: "bounded",
    observations,
    findings: outcome.findings,
    blocking_reasons: outcome.blocking_reasons,
    next_status: outcome.next_status,
    required_capability_key: playbook.required_capability_key,
    approval_required: playbook.approval_required,
    readback_required: playbook.readback_required,
    provider_call_allowed: false,
    external_write_allowed: false,
    repair_apply_allowed: false,
    secrets_included: false,
  });
}

function buildPlanPreviewArtifact(row, playbook, observations, diagnostic, previewId, nowIso) {
  const steps = [];
  if (playbook.required_capability_key) {
    steps.push({
      step_key: "confirm_capability_readiness",
      required: true,
      capability_key: playbook.required_capability_key,
      status: observations.capability_ready === true ? "ready" : "blocked",
    });
  }
  if (playbook.approval_required) {
    steps.push({
      step_key: "confirm_tenant_approval",
      required: true,
      status: observations.approval_ready === true ? "ready" : "blocked",
    });
  }
  steps.push({
    step_key: "confirm_execution_authority",
    required: true,
    status: observations.authority_ready === true ? "ready" : "blocked",
  });
  steps.push({
    step_key: "confirm_policy_allows_next_step",
    required: true,
    status: observations.policy_allows_next_step === false ? "blocked" : "pending_or_ready",
  });
  steps.push({
    step_key: "prepare_gated_apply_or_decision",
    required: true,
    status: diagnostic?.next_status === "ready_to_apply" || row.status === "ready_to_apply" ? "ready" : "blocked",
    apply_tool_registered: Boolean(playbook.apply_tool_key),
    decision_tool_registered: Boolean(playbook.decision_tool_key),
  });
  if (playbook.readback_required) {
    steps.push({
      step_key: "require_same_cycle_readback_before_closeout",
      required: true,
      status: "future_gate",
      readback_tool_registered: Boolean(playbook.readback_tool_key),
    });
  }

  return sanitizeValue({
    preview_id: previewId,
    case_id: row.case_id,
    generated_at: nowIso,
    source_diagnostic_id: diagnostic?.diagnostic_id || null,
    steps,
    blocked: steps.some((step) => step.status === "blocked"),
    provider_call_allowed: false,
    external_write_allowed: false,
    repair_apply_allowed: false,
    execution_dispatched: false,
    secrets_included: false,
  });
}

async function withTransaction(pool, callback) {
  const conn = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const shouldRelease = conn !== pool && typeof conn.release === "function";
  try {
    if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
    const result = await callback(conn);
    if (typeof conn.commit === "function") await conn.commit();
    return result;
  } catch (error) {
    if (typeof conn.rollback === "function") await conn.rollback();
    throw error;
  } finally {
    if (shouldRelease) conn.release();
  }
}

async function readScopedCaseForUpdate(conn, subject, caseId, workspaceId) {
  const params = [caseId, subject.tenant_id];
  let workspaceClause = "";
  if (workspaceId) {
    workspaceClause = "AND c.workspace_id = ?";
    params.push(workspaceId);
  }
  const [rows] = await conn.query(
    `SELECT c.*,
            p.status AS playbook_status,
            p.tenant_visible AS playbook_tenant_visible,
            p.risk_level AS playbook_risk_level,
            p.required_capability_key,
            p.diagnostic_tool_key,
            p.decision_tool_key,
            p.apply_tool_key,
            p.readback_tool_key,
            p.approval_required,
            p.readback_required,
            p.policy_json AS playbook_policy_json
       FROM tenant_resolution_cases c
       JOIN tenant_resolution_playbooks p ON p.playbook_key = c.playbook_key
      WHERE c.case_id = ?
        AND c.tenant_id = ?
        ${workspaceClause}
      LIMIT 1
      FOR UPDATE`,
    params
  );
  if (!rows[0]) {
    throw httpError(404, "TENANT_RESOLUTION_CASE_NOT_FOUND", "Resolution case was not found within the caller scope.");
  }
  return rows[0];
}

async function appendEvent(conn, {
  eventId,
  caseId,
  eventType,
  actorId,
  fromStatus,
  toStatus,
  evidenceRef = null,
  event,
}) {
  await conn.query(
    `INSERT INTO tenant_resolution_case_events (
       event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
       evidence_ref, event_json, secrets_included
     ) VALUES (?, ?, ?, 'tenant_user', ?, ?, ?, ?, ?, 0)`,
    [
      eventId,
      caseId,
      eventType,
      actorId || null,
      fromStatus || null,
      toStatus || null,
      evidenceRef || null,
      JSON.stringify(sanitizeValue(event || {})),
    ]
  );
}

async function updateStatus(conn, row, subject, nextStatus, currentStepKey) {
  const [result] = await conn.query(
    `UPDATE tenant_resolution_cases
        SET status = ?,
            current_step_key = ?,
            owner_user_id = COALESCE(owner_user_id, ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE case_id = ?
        AND tenant_id = ?
        AND status = ?`,
    [nextStatus, currentStepKey, subject.user_id || null, row.case_id, subject.tenant_id, row.status]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw httpError(409, "TENANT_RESOLUTION_CASE_CONFLICT", "Resolution case changed concurrently. Read the case and retry.", {
      case_id: row.case_id,
      expected_status: row.status,
    });
  }
  row.status = nextStatus;
  row.current_step_key = currentStepKey;
}

async function diagnoseCase(conn, row, playbook, subject, normalized, uuid, nowIso) {
  if (!DIAGNOSTIC_RESTARTABLE_STATUSES.has(row.status)) {
    throw httpError(409, "TENANT_RESOLUTION_DIAGNOSTIC_NOT_ALLOWED", "The current case status does not allow a diagnostic run.", {
      case_id: row.case_id,
      status: row.status,
      allowed_statuses: [...DIAGNOSTIC_RESTARTABLE_STATUSES],
    });
  }

  if (row.status !== "diagnosing") {
    const fromStatus = row.status;
    await updateStatus(conn, row, subject, "diagnosing", "diagnostic_started");
    await appendEvent(conn, {
      eventId: uuid(),
      caseId: row.case_id,
      eventType: "diagnostic_started",
      actorId: subject.user_id,
      fromStatus,
      toStatus: "diagnosing",
      evidenceRef: normalized.observations.evidence_refs[0] || null,
      event: {
        mode: "diagnose",
        idempotency_key: normalized.idempotency_key,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
      },
    });
  }

  const diagnosticId = uuid();
  const outcome = determineDiagnosticOutcome(row, playbook, normalized.observations);
  const diagnostic = buildDiagnosticArtifact(
    row,
    playbook,
    normalized.observations,
    outcome,
    diagnosticId,
    nowIso
  );
  const [updateResult] = await conn.query(
    `UPDATE tenant_resolution_cases
        SET status = ?,
            current_step_key = ?,
            last_diagnostic_json = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE case_id = ?
        AND tenant_id = ?
        AND status = 'diagnosing'`,
    [
      outcome.next_status,
      `diagnostic_${outcome.next_status}`,
      JSON.stringify(diagnostic),
      row.case_id,
      subject.tenant_id,
    ]
  );
  if (Number(updateResult?.affectedRows || 0) !== 1) {
    throw httpError(409, "TENANT_RESOLUTION_CASE_CONFLICT", "Resolution case changed during diagnosis. Read the case and retry.", {
      case_id: row.case_id,
      expected_status: "diagnosing",
    });
  }
  await appendEvent(conn, {
    eventId: uuid(),
    caseId: row.case_id,
    eventType: "diagnostic_completed",
    actorId: subject.user_id,
    fromStatus: "diagnosing",
    toStatus: outcome.next_status,
    evidenceRef: normalized.observations.evidence_refs[0] || null,
    event: diagnostic,
  });
  row.status = outcome.next_status;
  row.current_step_key = `diagnostic_${outcome.next_status}`;
  row.last_diagnostic_json = JSON.stringify(diagnostic);
  return {
    changed: true,
    mode: "diagnose",
    diagnostic,
    plan_preview: null,
    escalation: null,
  };
}

async function previewPlan(conn, row, playbook, subject, normalized, uuid, nowIso) {
  if (!PLAN_PREVIEW_STATUSES.has(row.status)) {
    throw httpError(409, "TENANT_RESOLUTION_PLAN_PREVIEW_NOT_ALLOWED", "The current case status does not allow a plan preview.", {
      case_id: row.case_id,
      status: row.status,
      allowed_statuses: [...PLAN_PREVIEW_STATUSES],
    });
  }
  const diagnostic = sanitizeValue(parseJsonValue(row.last_diagnostic_json, null));
  const previewId = uuid();
  const preview = buildPlanPreviewArtifact(
    row,
    playbook,
    normalized.observations,
    diagnostic,
    previewId,
    nowIso
  );
  const [result] = await conn.query(
    `UPDATE tenant_resolution_cases
        SET current_step_key = 'plan_previewed',
            last_preflight_json = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE case_id = ?
        AND tenant_id = ?
        AND status = ?`,
    [JSON.stringify(preview), row.case_id, subject.tenant_id, row.status]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw httpError(409, "TENANT_RESOLUTION_CASE_CONFLICT", "Resolution case changed during plan preview. Read the case and retry.", {
      case_id: row.case_id,
      expected_status: row.status,
    });
  }
  await appendEvent(conn, {
    eventId: uuid(),
    caseId: row.case_id,
    eventType: "plan_previewed",
    actorId: subject.user_id,
    fromStatus: row.status,
    toStatus: row.status,
    evidenceRef: normalized.observations.evidence_refs[0] || null,
    event: preview,
  });
  row.current_step_key = "plan_previewed";
  row.last_preflight_json = JSON.stringify(preview);
  return {
    changed: true,
    mode: "plan_preview",
    diagnostic,
    plan_preview: preview,
    escalation: null,
  };
}

async function escalateCase(conn, row, subject, normalized, uuid, nowIso) {
  if (!ESCALATION_STATUSES.has(row.status)) {
    throw httpError(409, "TENANT_RESOLUTION_ESCALATION_NOT_ALLOWED", "The current case status does not allow escalation.", {
      case_id: row.case_id,
      status: row.status,
      allowed_statuses: [...ESCALATION_STATUSES],
    });
  }
  if (row.status === "escalated") {
    return {
      changed: false,
      mode: "escalate",
      diagnostic: sanitizeValue(parseJsonValue(row.last_diagnostic_json, null)),
      plan_preview: sanitizeValue(parseJsonValue(row.last_preflight_json, null)),
      escalation: {
        escalation_ref: row.escalation_ref || null,
        already_escalated: true,
        secrets_included: false,
      },
    };
  }

  const eventId = uuid();
  const escalationRef = normalized.observations.evidence_refs[0]
    || `tenant-resolution://case/${row.case_id}/escalation/${eventId}`;
  const fromStatus = row.status;
  const [result] = await conn.query(
    `UPDATE tenant_resolution_cases
        SET status = 'escalated',
            current_step_key = 'escalated',
            escalation_ref = ?,
            owner_user_id = COALESCE(owner_user_id, ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE case_id = ?
        AND tenant_id = ?
        AND status = ?`,
    [escalationRef, subject.user_id || null, row.case_id, subject.tenant_id, fromStatus]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw httpError(409, "TENANT_RESOLUTION_CASE_CONFLICT", "Resolution case changed during escalation. Read the case and retry.", {
      case_id: row.case_id,
      expected_status: fromStatus,
    });
  }
  const escalation = sanitizeValue({
    escalation_ref: escalationRef,
    reason: normalized.observations.escalation_reason || normalized.observations.note || "Escalation requested.",
    generated_at: nowIso,
    evidence_refs: normalized.observations.evidence_refs,
    provider_call_allowed: false,
    external_write_allowed: false,
    repair_apply_allowed: false,
    secrets_included: false,
  });
  await appendEvent(conn, {
    eventId,
    caseId: row.case_id,
    eventType: "case_escalated",
    actorId: subject.user_id,
    fromStatus,
    toStatus: "escalated",
    evidenceRef: escalationRef,
    event: escalation,
  });
  row.status = "escalated";
  row.current_step_key = "escalated";
  row.escalation_ref = escalationRef;
  return {
    changed: true,
    mode: "escalate",
    diagnostic: sanitizeValue(parseJsonValue(row.last_diagnostic_json, null)),
    plan_preview: sanitizeValue(parseJsonValue(row.last_preflight_json, null)),
    escalation,
  };
}

export async function runTenantResolutionDiagnosticAction({
  sessionContext = null,
  explicitSubject = {},
  caseId,
  workspaceId = null,
  input = {},
  pool = null,
  uuid = randomUUID,
  now = () => new Date(),
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  const normalizedCaseId = safeString(caseId, 64);
  if (!normalizedCaseId) {
    throw httpError(400, "TENANT_RESOLUTION_CASE_ID_REQUIRED", "caseId is required.");
  }
  const normalized = normalizeDiagnosticInput({ ...input, workspace_id: workspaceId || input.workspace_id });
  const effectivePool = pool || await defaultPool();
  const nowIso = now().toISOString();

  return withTransaction(effectivePool, async (conn) => {
    const row = await readScopedCaseForUpdate(
      conn,
      subject,
      normalizedCaseId,
      normalized.workspace_id
    );
    const playbook = playbookProjection(row);
    let actionResult;
    if (normalized.mode === "diagnose") {
      actionResult = await diagnoseCase(conn, row, playbook, subject, normalized, uuid, nowIso);
    } else if (normalized.mode === "plan_preview") {
      actionResult = await previewPlan(conn, row, playbook, subject, normalized, uuid, nowIso);
    } else {
      actionResult = await escalateCase(conn, row, subject, normalized, uuid, nowIso);
    }

    return {
      ok: true,
      activation_layer: "tenant_resolution_diagnostic_core",
      mode: normalized.mode,
      changed: actionResult.changed,
      case: caseProjection(row),
      playbook,
      diagnostic: actionResult.diagnostic,
      plan_preview: actionResult.plan_preview,
      escalation: actionResult.escalation,
      policy: {
        tenant_scoped: true,
        workspace_scope_enforced_when_provided: true,
        bounded_observations_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        execution_dispatched: false,
        resolved_transition_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export const _testingTenantResolutionDiagnosticService = {
  DIAGNOSTIC_MODES,
  DIAGNOSTIC_RESTARTABLE_STATUSES,
  PLAN_PREVIEW_STATUSES,
  ESCALATION_STATUSES,
  normalizeDiagnosticInput,
  sanitizeValue,
  determineDiagnosticOutcome,
  buildDiagnosticArtifact,
  buildPlanPreviewArtifact,
  playbookProjection,
  caseProjection,
};
