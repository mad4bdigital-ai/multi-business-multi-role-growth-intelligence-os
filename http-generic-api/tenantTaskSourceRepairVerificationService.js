import { randomUUID } from "node:crypto";

const ROOT_FAMILY = "task_source_quality";
const PLAYBOOK_KEY = "task_source_repair_v1";
const VERIFYING_STEP = "task_source_repair_verifying";
const VERIFIED_STEP = "task_source_repair_verified";
const FAILED_STEP = "task_source_repair_verification_failed";
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|payload_json|raw_prompt|system_prompt)/i;

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

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 80)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
  };
}

function requireSubject(sessionContext, explicitSubject) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id || !subject.user_id) {
    throw httpError(
      403,
      "TENANT_TASK_SOURCE_VERIFY_SUBJECT_REQUIRED",
      "Tenant and user scope are required for Task Source Repair verification."
    );
  }
  return subject;
}

function normalizeInput(input = {}) {
  const fingerprint = safeString(
    input.expected_preview_fingerprint_sha256 || input.preview_fingerprint_sha256,
    64
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw httpError(
      400,
      "TENANT_TASK_SOURCE_VERIFY_FINGERPRINT_INVALID",
      "expected_preview_fingerprint_sha256 must be a lowercase SHA-256 value."
    );
  }
  return {
    fingerprint,
    workspace_id: safeString(input.workspace_id, 64) || null,
  };
}

function inspectTaskQuality(task = {}) {
  const issues = [];
  const checks = [
    ["task_id", task.task_id],
    ["task_key", task.task_key],
    ["title", task.title],
    ["source_surface", task.source_surface],
    ["source_ref", task.source_ref],
  ];
  for (const [field, value] of checks) {
    if (!safeString(value, 2000)) {
      issues.push({
        field,
        issue: "missing_or_blank",
        severity: field === "source_ref" ? "medium" : "high",
      });
    }
  }
  if (task.owner_scope !== "tenant") {
    issues.push({ field: "owner_scope", issue: "must_equal_tenant", severity: "critical" });
  }
  if (!safeString(task.tenant_id, 64)) {
    issues.push({ field: "tenant_id", issue: "missing_or_blank", severity: "critical" });
  }
  if (task.context_json !== null && task.context_json !== undefined && typeof task.context_json === "string") {
    try { JSON.parse(task.context_json); } catch {
      issues.push({ field: "context_json", issue: "invalid_json", severity: "high" });
    }
  }
  return issues;
}

function validateEvidence(row, fingerprint) {
  const preflight = parseJson(row.last_preflight_json, null);
  const apply = parseJson(row.last_result_json, null);
  if (!preflight || typeof preflight !== "object") {
    throw httpError(409, "TENANT_TASK_SOURCE_VERIFY_PREFLIGHT_MISSING", "Task Source Repair preview evidence is missing.");
  }
  if (!apply || typeof apply !== "object") {
    throw httpError(409, "TENANT_TASK_SOURCE_VERIFY_APPLY_EVIDENCE_MISSING", "Task Source Repair apply evidence is missing.");
  }
  if (
    preflight.preview_fingerprint_sha256 !== fingerprint ||
    apply.preview_fingerprint_sha256 !== fingerprint
  ) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_FINGERPRINT_MISMATCH",
      "Preview, apply, and request fingerprints must match."
    );
  }
  if (apply.mutation_readback?.status !== "passed") {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_MUTATION_READBACK_MISSING",
      "Apply evidence must include a passed same-cycle mutation readback."
    );
  }
  const taskId = safeString(apply.task_id || preflight?.task_identity?.task_id, 36);
  const envelopeId = safeString(apply.capability_envelope_id, 64);
  if (!taskId || !envelopeId) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_APPLY_EVIDENCE_INCOMPLETE",
      "Apply evidence must identify the task and consumed capability envelope."
    );
  }
  const changes = Array.isArray(preflight.changes) ? preflight.changes : [];
  if (changes.length === 0) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_EXPECTED_VALUES_MISSING",
      "Preview evidence does not contain expected repaired values."
    );
  }
  const expectedValues = {};
  for (const change of changes) {
    const field = safeString(change?.field, 64);
    if (!["task_key", "title", "source_surface", "source_ref"].includes(field)) {
      throw httpError(
        409,
        "TENANT_TASK_SOURCE_VERIFY_EXPECTED_FIELD_INVALID",
        "Preview evidence contains an unsupported repaired field.",
        { field }
      );
    }
    expectedValues[field] = safeString(change?.to, field === "source_ref" ? 500 : field === "title" ? 255 : 191);
  }
  return { preflight, apply, taskId, envelopeId, expectedValues };
}

function validateCase(row) {
  if (row.root_family !== ROOT_FAMILY || row.playbook_key !== PLAYBOOK_KEY) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_CASE_INCOMPATIBLE",
      "Resolution case is not bound to Task Source Repair."
    );
  }
  if (row.status !== "verifying") {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_STATUS_INVALID",
      "Resolution case must remain in verifying during lifecycle readback.",
      { status: row.status }
    );
  }
  if (![VERIFYING_STEP, VERIFIED_STEP, FAILED_STEP].includes(row.current_step_key)) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_STEP_INVALID",
      "Resolution case is not at a Task Source Repair verification step.",
      { current_step_key: row.current_step_key }
    );
  }
  if (row.playbook_status !== "active" || Number(row.playbook_tenant_visible || 0) !== 1) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_PLAYBOOK_UNAVAILABLE",
      "Task Source Repair playbook is not active and tenant-visible."
    );
  }
  if (Number(row.readback_required || 0) !== 1) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_PLAYBOOK_POLICY_MISMATCH",
      "Task Source Repair playbook does not require lifecycle readback."
    );
  }
}

async function withTransaction(pool, callback) {
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const release = connection !== pool && typeof connection.release === "function";
  try {
    if (typeof connection.beginTransaction === "function") await connection.beginTransaction();
    const result = await callback(connection);
    if (typeof connection.commit === "function") await connection.commit();
    return result;
  } catch (error) {
    if (typeof connection.rollback === "function") await connection.rollback();
    throw error;
  } finally {
    if (release) connection.release();
  }
}

async function loadCaseForUpdate(connection, subject, caseId, workspaceId) {
  const params = [caseId, subject.tenant_id];
  let workspaceClause = "";
  if (workspaceId) {
    workspaceClause = "AND c.workspace_id = ?";
    params.push(workspaceId);
  }
  const [rows] = await connection.query(
    `SELECT c.*, p.status AS playbook_status, p.tenant_visible AS playbook_tenant_visible,
            p.readback_required
       FROM tenant_resolution_cases c
       JOIN tenant_resolution_playbooks p ON p.playbook_key = c.playbook_key
      WHERE c.case_id = ? AND c.tenant_id = ? ${workspaceClause}
      LIMIT 1 FOR UPDATE`,
    params
  );
  if (!rows[0]) {
    throw httpError(
      404,
      "TENANT_TASK_SOURCE_VERIFY_CASE_NOT_FOUND",
      "Resolution case was not found within tenant scope."
    );
  }
  return rows[0];
}

async function loadExecutedEnvelope(connection, subject, envelopeId) {
  const [rows] = await connection.query(
    `SELECT envelope_id, tenant_id, user_id, execution_status, secrets_included
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ? AND tenant_id = ?
      LIMIT 1`,
    [envelopeId, subject.tenant_id]
  );
  const envelope = rows[0];
  if (
    !envelope ||
    envelope.execution_status !== "executed" ||
    Number(envelope.secrets_included || 0) !== 0
  ) {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_ENVELOPE_NOT_EXECUTED",
      "The capability envelope used by Apply must be executed and secret-free."
    );
  }
  return envelope;
}

async function loadLatestApplyEvents(connection, caseId) {
  const [rows] = await connection.query(
    `SELECT event_type, created_at
       FROM tenant_resolution_case_events
      WHERE case_id = ?
        AND event_type IN (
          'task_source_repair_applying',
          'task_source_repair_applied',
          'task_source_repair_apply_conflict'
        )
      ORDER BY created_at DESC
      LIMIT 5`,
    [caseId]
  );
  if (!rows[0] || rows[0].event_type !== "task_source_repair_applied") {
    throw httpError(
      409,
      "TENANT_TASK_SOURCE_VERIFY_APPLY_EVENT_MISSING",
      "The latest Task Source Repair apply lifecycle event is not a successful apply."
    );
  }
  return rows;
}

async function loadScopedTask(connection, tenantId, taskId) {
  const [rows] = await connection.query(
    `SELECT task_id, task_key, title, owner_scope, tenant_id, source_surface, source_ref,
            context_json, updated_at
       FROM platform_pending_tasks
      WHERE task_id = ? AND tenant_id = ?
      LIMIT 1 FOR SHARE`,
    [taskId, tenantId]
  );
  return rows[0] || null;
}

function buildVerification({
  task,
  tenantId,
  taskId,
  expectedValues,
  fingerprint,
  apply,
  checkedAt,
  previousVerification,
}) {
  const reasons = [];
  const mismatches = [];
  const qualityIssues = task ? inspectTaskQuality(task) : [];

  if (!task) {
    reasons.push({ code: "task_missing", field: "task_id" });
  } else {
    if (String(task.task_id) !== String(taskId)) {
      reasons.push({ code: "task_identity_changed", field: "task_id" });
    }
    if (task.owner_scope !== "tenant") {
      reasons.push({ code: "tenant_scope_mismatch", field: "owner_scope" });
    }
    if (String(task.tenant_id || "") !== String(tenantId)) {
      reasons.push({ code: "tenant_scope_mismatch", field: "tenant_id" });
    }
    for (const [field, expected] of Object.entries(expectedValues)) {
      const actual = task[field] === null || task[field] === undefined ? "" : String(task[field]);
      if (actual !== String(expected)) {
        mismatches.push({ field, expected, actual });
      }
    }
    if (mismatches.length > 0) {
      reasons.push({ code: "expected_value_mismatch", fields: mismatches.map((item) => item.field) });
    }
    if (qualityIssues.length > 0) {
      reasons.push({ code: "quality_issue_remaining", fields: qualityIssues.map((item) => item.field) });
    }
    const appliedAtMs = Date.parse(apply.applied_at || "");
    const taskUpdatedAtMs = Date.parse(task.updated_at || "");
    if (Number.isFinite(appliedAtMs) && Number.isFinite(taskUpdatedAtMs) && taskUpdatedAtMs < appliedAtMs) {
      reasons.push({ code: "new_drift_detected", field: "updated_at", issue: "task_update_precedes_apply" });
    }
    if (
      previousVerification?.status === "passed" &&
      previousVerification.task_updated_at &&
      String(previousVerification.task_updated_at) !== String(task.updated_at || "")
    ) {
      reasons.push({ code: "new_drift_detected", field: "updated_at", issue: "freshness_changed_after_pass" });
    }
  }

  const status = reasons.length === 0 ? "passed" : "failed";
  return sanitizeValue({
    status,
    checked_at: checkedAt,
    preview_fingerprint_sha256: fingerprint,
    task_id: taskId,
    task_updated_at: task?.updated_at || null,
    expected_values: expectedValues,
    mismatches,
    quality_issues: qualityIssues,
    failure_reasons: reasons,
    identity_readback: {
      task_id_matches: Boolean(task && String(task.task_id) === String(taskId)),
      owner_scope_matches: Boolean(task && task.owner_scope === "tenant"),
      tenant_id_matches: Boolean(task && String(task.tenant_id || "") === String(tenantId)),
    },
    no_side_effect_evidence: {
      provider_call_allowed: false,
      external_write_allowed: false,
      task_registry_write_allowed: false,
      repair_apply_allowed: false,
      resolved_transition_allowed: false,
      secrets_included: false,
    },
    secrets_included: false,
  });
}

function sameVerification(previous, current) {
  if (!previous || !current) return false;
  return (
    previous.status === current.status &&
    previous.preview_fingerprint_sha256 === current.preview_fingerprint_sha256 &&
    previous.task_id === current.task_id &&
    String(previous.task_updated_at || "") === String(current.task_updated_at || "") &&
    JSON.stringify(previous.failure_reasons || []) === JSON.stringify(current.failure_reasons || []) &&
    JSON.stringify(previous.mismatches || []) === JSON.stringify(current.mismatches || [])
  );
}

async function appendEvent(connection, { eventId, caseId, eventType, actorId, evidenceRef, payload }) {
  await connection.query(
    `INSERT INTO tenant_resolution_case_events (
       event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
       evidence_ref, event_json, secrets_included
     ) VALUES (?, ?, ?, 'tenant_user', ?, 'verifying', 'verifying', ?, ?, 0)`,
    [
      eventId,
      caseId,
      eventType,
      actorId,
      evidenceRef || null,
      JSON.stringify(sanitizeValue(payload)),
    ]
  );
}

export async function verifyTenantTaskSourceRepair({
  sessionContext = null,
  explicitSubject = {},
  caseId,
  workspaceId = null,
  input = {},
  pool = null,
  uuid = randomUUID,
  now = () => new Date(),
} = {}) {
  const subject = requireSubject(sessionContext, explicitSubject);
  const normalizedCaseId = safeString(caseId, 64);
  if (!normalizedCaseId) {
    throw httpError(400, "TENANT_TASK_SOURCE_VERIFY_CASE_ID_REQUIRED", "caseId is required.");
  }
  const normalized = normalizeInput({ ...input, workspace_id: workspaceId || input.workspace_id });
  const effectivePool = pool || await defaultPool();

  return withTransaction(effectivePool, async (connection) => {
    const row = await loadCaseForUpdate(
      connection,
      subject,
      normalizedCaseId,
      normalized.workspace_id
    );
    validateCase(row);
    const evidence = validateEvidence(row, normalized.fingerprint);
    await loadExecutedEnvelope(connection, subject, evidence.envelopeId);
    await loadLatestApplyEvents(connection, row.case_id);
    const task = await loadScopedTask(connection, subject.tenant_id, evidence.taskId);

    const previousResult = parseJson(row.last_result_json, {});
    const previousVerification = previousResult?.verification || null;
    const verification = buildVerification({
      task,
      tenantId: subject.tenant_id,
      taskId: evidence.taskId,
      expectedValues: evidence.expectedValues,
      fingerprint: normalized.fingerprint,
      apply: evidence.apply,
      checkedAt: now().toISOString(),
      previousVerification,
    });

    if (sameVerification(previousVerification, verification)) {
      return {
        ok: true,
        activation_layer: "tenant_task_source_repair_verification_readback",
        changed: false,
        existing_readback_returned: true,
        case: {
          case_id: row.case_id,
          tenant_id: row.tenant_id,
          workspace_id: row.workspace_id || null,
          status: "verifying",
          current_step_key: row.current_step_key,
          readback_status: row.readback_status,
          secrets_included: false,
        },
        verification: previousVerification,
        policy: {
          tenant_scoped: true,
          internal_registry_read_only: true,
          provider_call_allowed: false,
          external_write_allowed: false,
          task_registry_write_allowed: false,
          repair_apply_allowed: false,
          resolved_transition_allowed: false,
          secrets_included: false,
        },
        secrets_included: false,
      };
    }

    const passed = verification.status === "passed";
    const currentStepKey = passed ? VERIFIED_STEP : FAILED_STEP;
    const eventType = passed
      ? "task_source_repair_verification_passed"
      : "task_source_repair_verification_failed";
    const resultPayload = sanitizeValue({
      ...evidence.apply,
      lifecycle_readback_status: verification.status,
      verification,
      secrets_included: false,
    });

    const [update] = await connection.query(
      `UPDATE tenant_resolution_cases
          SET current_step_key = ?, readback_status = ?, last_result_json = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE case_id = ? AND tenant_id = ? AND status = 'verifying'
          AND current_step_key = ?`,
      [
        currentStepKey,
        verification.status,
        JSON.stringify(resultPayload),
        row.case_id,
        subject.tenant_id,
        row.current_step_key,
      ]
    );
    if (Number(update?.affectedRows || 0) !== 1) {
      throw httpError(
        409,
        "TENANT_TASK_SOURCE_VERIFY_CASE_CONFLICT",
        "Resolution case changed during lifecycle verification."
      );
    }

    const evidenceRef = `tenant-resolution-verification://${row.case_id}/${normalized.fingerprint}`;
    await appendEvent(connection, {
      eventId: uuid(),
      caseId: row.case_id,
      eventType,
      actorId: subject.user_id,
      evidenceRef,
      payload: verification,
    });

    return {
      ok: true,
      activation_layer: "tenant_task_source_repair_verification_readback",
      changed: true,
      existing_readback_returned: false,
      case: {
        case_id: row.case_id,
        tenant_id: row.tenant_id,
        workspace_id: row.workspace_id || null,
        status: "verifying",
        current_step_key: currentStepKey,
        readback_status: verification.status,
        secrets_included: false,
      },
      task: task ? {
        task_id: task.task_id,
        task_key: task.task_key,
        title: task.title,
        source_surface: task.source_surface,
        source_ref: task.source_ref,
        updated_at: task.updated_at || null,
        secrets_included: false,
      } : null,
      verification,
      policy: {
        tenant_scoped: true,
        workspace_scope_enforced_when_provided: true,
        internal_registry_read_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        task_registry_write_allowed: false,
        repair_apply_allowed: false,
        resolved_transition_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export const _testingTenantTaskSourceRepairVerificationService = {
  ROOT_FAMILY,
  PLAYBOOK_KEY,
  VERIFYING_STEP,
  VERIFIED_STEP,
  FAILED_STEP,
  normalizeInput,
  inspectTaskQuality,
  validateEvidence,
  validateCase,
  buildVerification,
  sameVerification,
  sanitizeValue,
};
