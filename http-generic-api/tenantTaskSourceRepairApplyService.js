import { randomUUID } from "node:crypto";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";

const ROOT_FAMILY = "task_source_quality";
const PLAYBOOK_KEY = "task_source_repair_v1";
const CAPABILITY_KEY = "tenant_task_source_repair";
const OPERATION_INTENT = "tenant_resolution_apply";
const RUNTIME_SURFACE = "tenant_resolution_apply";
const APP_KEY = "platform_orchestration";
const ALLOWED_TASK_FIELDS = new Set(["task_key", "title", "source_surface", "source_ref"]);
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
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .slice(0, 80)
      .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]));
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
    throw httpError(403, "TENANT_TASK_SOURCE_APPLY_SUBJECT_REQUIRED", "Tenant and user scope are required for Task Source Repair Apply Gate.");
  }
  return subject;
}

function typedConfirmation(fingerprint) {
  return `APPLY_TASK_SOURCE_REPAIR_${String(fingerprint).slice(0, 12).toUpperCase()}`;
}

function normalizeInput(input = {}) {
  const fingerprint = safeString(input.preview_fingerprint_sha256, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw httpError(400, "TENANT_TASK_SOURCE_APPLY_FINGERPRINT_INVALID", "preview_fingerprint_sha256 must be a lowercase SHA-256 value.");
  }
  const envelopeId = safeString(input.capability_envelope_id, 64);
  const approvalHoldId = safeString(input.approval_hold_id, 64);
  const confirm = safeString(input.confirm, 80);
  if (!envelopeId || !approvalHoldId || !confirm) {
    throw httpError(400, "TENANT_TASK_SOURCE_APPLY_AUTHORITY_REQUIRED", "capability_envelope_id, approval_hold_id, and confirm are required.");
  }
  const expectedConfirm = typedConfirmation(fingerprint);
  if (confirm !== expectedConfirm) {
    throw httpError(400, "TENANT_TASK_SOURCE_APPLY_CONFIRMATION_MISMATCH", "Typed confirmation does not match the approved preview fingerprint.", {
      expected_confirmation: expectedConfirm,
    });
  }
  return {
    fingerprint,
    envelope_id: envelopeId,
    approval_hold_id: approvalHoldId,
    confirm,
    workspace_id: safeString(input.workspace_id, 64) || null,
  };
}

function validatePreflight(preflight, fingerprint) {
  if (!preflight || typeof preflight !== "object") {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_PREFLIGHT_MISSING", "The case does not contain a Task Source Repair preview.");
  }
  if (preflight.preview_fingerprint_sha256 !== fingerprint) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_PREFLIGHT_MISMATCH", "The supplied preview fingerprint does not match the case preflight.");
  }
  if (preflight.ready_for_apply_gate !== true) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_PREFLIGHT_NOT_READY", "The Task Source Repair preview is not ready for apply.");
  }
  if (Array.isArray(preflight.unresolved_issues) && preflight.unresolved_issues.length > 0) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_UNRESOLVED_ISSUES", "The Task Source Repair preview still contains unresolved issues.");
  }
  const changes = Array.isArray(preflight.changes) ? preflight.changes : [];
  if (changes.length === 0) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_NO_CHANGES", "The Task Source Repair preview contains no changes to apply.");
  }
  const normalizedChanges = changes.map((change) => {
    const field = safeString(change?.field, 64);
    if (!ALLOWED_TASK_FIELDS.has(field)) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_FIELD_FORBIDDEN", "The preview contains a field that cannot be changed by this gate.", { field });
    }
    const to = safeString(change?.to, field === "title" ? 255 : field === "source_ref" ? 500 : 191);
    if (!to) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_VALUE_INVALID", "The preview contains an empty target value.", { field });
    }
    return {
      field,
      from: change?.from === null || change?.from === undefined ? null : String(change.from),
      to,
    };
  });
  return { ...preflight, changes: normalizedChanges };
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
    if (error?.code === "ER_DUP_ENTRY") {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_UNIQUE_CONFLICT", "The proposed task key conflicts with an existing task.");
    }
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
            p.required_capability_key, p.approval_required, p.readback_required
       FROM tenant_resolution_cases c
       JOIN tenant_resolution_playbooks p ON p.playbook_key = c.playbook_key
      WHERE c.case_id = ? AND c.tenant_id = ? ${workspaceClause}
      LIMIT 1 FOR UPDATE`,
    params
  );
  if (!rows[0]) throw httpError(404, "TENANT_TASK_SOURCE_APPLY_CASE_NOT_FOUND", "Resolution case was not found within tenant scope.");
  return rows[0];
}

function validateCase(row) {
  if (row.root_family !== ROOT_FAMILY || row.playbook_key !== PLAYBOOK_KEY) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_CASE_INCOMPATIBLE", "Resolution case is not bound to Task Source Repair.");
  }
  if (row.status !== "ready_to_apply") {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_STATUS_INVALID", "Resolution case must be ready_to_apply before apply.", { status: row.status });
  }
  if (row.playbook_status !== "active" || Number(row.playbook_tenant_visible || 0) !== 1) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_PLAYBOOK_UNAVAILABLE", "Task Source Repair playbook is not active and tenant-visible.");
  }
  if (row.required_capability_key !== CAPABILITY_KEY || Number(row.approval_required || 0) !== 1 || Number(row.readback_required || 0) !== 1) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_PLAYBOOK_POLICY_MISMATCH", "Task Source Repair playbook authority requirements are incomplete.");
  }
}

async function loadApprovalHold(connection, subject, holdId, envelopeId) {
  const [rows] = await connection.query(
    `SELECT hold_id, tenant_id, user_id, run_id, request_id, hold_type, status,
            decision_by, decision_note, decided_at, expires_at, execution_context_json
       FROM approval_holds
      WHERE hold_id = ? AND tenant_id = ?
        AND run_id = ? AND request_id = ?
        AND hold_type = 'supervisor_approval'
        AND status = 'approved'
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1 FOR UPDATE`,
    [holdId, subject.tenant_id, envelopeId, envelopeId]
  );
  if (!rows[0]) {
    throw httpError(403, "TENANT_TASK_SOURCE_APPLY_APPROVAL_HOLD_INVALID", "An approved, unexpired hold bound to the capability envelope is required.");
  }
  const context = parseJson(rows[0].execution_context_json, {});
  if (context.capability_envelope_id && context.capability_envelope_id !== envelopeId) {
    throw httpError(403, "TENANT_TASK_SOURCE_APPLY_APPROVAL_HOLD_MISMATCH", "Approval hold context does not match the capability envelope.");
  }
  return rows[0];
}

async function loadTaskForUpdate(connection, tenantId, preflight) {
  const taskId = safeString(preflight?.task_identity?.task_id, 36);
  const taskKey = safeString(preflight?.task_identity?.task_key, 191);
  const params = [tenantId];
  let identityClause;
  if (taskId) {
    identityClause = "task_id = ?";
    params.push(taskId);
  } else if (taskKey) {
    identityClause = "task_key = ?";
    params.push(taskKey);
  } else {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_TASK_IDENTITY_MISSING", "Preview does not contain a task identity.");
  }
  const [rows] = await connection.query(
    `SELECT task_id, task_key, title, owner_scope, tenant_id, source_surface, source_ref, updated_at
       FROM platform_pending_tasks
      WHERE owner_scope = 'tenant' AND tenant_id = ? AND ${identityClause}
      LIMIT 1 FOR UPDATE`,
    params
  );
  if (!rows[0]) throw httpError(404, "TENANT_TASK_SOURCE_APPLY_TASK_NOT_FOUND", "Pending task was not found within tenant scope.");
  return rows[0];
}

function verifyNoDrift(task, changes) {
  for (const change of changes) {
    const current = task[change.field] === null || task[change.field] === undefined ? null : String(task[change.field]);
    if (current !== change.from) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_DRIFT_DETECTED", "Pending task changed after preview generation.", {
        field: change.field,
        preview_value: change.from,
        current_value: current,
      });
    }
  }
}

async function appendEvent(connection, { eventId, caseId, eventType, actorId, fromStatus, toStatus, evidenceRef, payload }) {
  await connection.query(
    `INSERT INTO tenant_resolution_case_events (
       event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
       evidence_ref, event_json, secrets_included
     ) VALUES (?, ?, ?, 'tenant_user', ?, ?, ?, ?, ?, 0)`,
    [eventId, caseId, eventType, actorId, fromStatus, toStatus, evidenceRef || null, JSON.stringify(sanitizeValue(payload))]
  );
}

async function updateTask(connection, task, changes) {
  const assignments = changes.map((change) => `\`${change.field}\` = ?`);
  const values = changes.map((change) => change.to);
  const [result] = await connection.query(
    `UPDATE platform_pending_tasks
        SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE task_id = ? AND tenant_id = ? AND owner_scope = 'tenant'`,
    [...values, task.task_id, task.tenant_id]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_TASK_CONFLICT", "Pending task changed while the repair was being applied.");
  }
  const [rows] = await connection.query(
    `SELECT task_id, task_key, title, owner_scope, tenant_id, source_surface, source_ref, updated_at
       FROM platform_pending_tasks
      WHERE task_id = ? AND tenant_id = ? AND owner_scope = 'tenant'
      LIMIT 1`,
    [task.task_id, task.tenant_id]
  );
  const current = rows[0];
  if (!current || changes.some((change) => String(current[change.field] ?? "") !== change.to)) {
    throw httpError(409, "TENANT_TASK_SOURCE_APPLY_MUTATION_READBACK_FAILED", "Task mutation did not pass same-cycle field readback.");
  }
  return current;
}

export async function applyTenantTaskSourceRepair({
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
  if (!normalizedCaseId) throw httpError(400, "TENANT_TASK_SOURCE_APPLY_CASE_ID_REQUIRED", "caseId is required.");
  const normalized = normalizeInput({ ...input, workspace_id: workspaceId || input.workspace_id });
  const effectivePool = pool || await defaultPool();

  return withTransaction(effectivePool, async (connection) => {
    const row = await loadCaseForUpdate(connection, subject, normalizedCaseId, normalized.workspace_id);
    validateCase(row);
    const preflight = validatePreflight(parseJson(row.last_preflight_json, null), normalized.fingerprint);

    const envelope = await resolveCapabilityExecutionEnvelope({
      pool: connection,
      envelopeId: normalized.envelope_id,
      acceptedAppKeys: [APP_KEY],
      acceptedIntents: [OPERATION_INTENT],
      acceptedCapabilityKeys: [CAPABILITY_KEY],
      expectedTenantId: subject.tenant_id,
      expectedUserId: subject.user_id,
      allowReferenced: true,
      requireReadyForDispatch: true,
      requireDispatchAllowed: true,
      requireNoApprovalRequired: true,
      requireNoBlockingGaps: true,
      requireNoSecrets: true,
    });
    if (!envelope.ok) throw capabilityEnvelopeError(envelope, "Capability envelope does not authorize Task Source Repair apply.");
    if (!envelope.apply_allowed || envelope.selected_runtime_surface !== RUNTIME_SURFACE || !envelope.readback_required) {
      throw httpError(403, "TENANT_TASK_SOURCE_APPLY_ENVELOPE_POLICY_MISMATCH", "Capability envelope is not apply-authorized for this runtime surface.");
    }

    const hold = await loadApprovalHold(connection, subject, normalized.approval_hold_id, normalized.envelope_id);
    const task = await loadTaskForUpdate(connection, subject.tenant_id, preflight);
    verifyNoDrift(task, preflight.changes);

    const applyingEventId = uuid();
    const verifyingEventId = uuid();
    const appliedAt = now().toISOString();
    const evidenceRef = `capability-envelope://${normalized.envelope_id}`;

    const [caseApply] = await connection.query(
      `UPDATE tenant_resolution_cases
          SET status = 'applying', current_step_key = 'task_source_repair_applying',
              last_result_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE case_id = ? AND tenant_id = ? AND status = 'ready_to_apply'`,
      [JSON.stringify({
        phase: "applying",
        preview_fingerprint_sha256: normalized.fingerprint,
        capability_envelope_id: normalized.envelope_id,
        approval_hold_id: normalized.approval_hold_id,
        secrets_included: false,
      }), row.case_id, subject.tenant_id]
    );
    if (Number(caseApply?.affectedRows || 0) !== 1) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_CASE_CONFLICT", "Resolution case changed before apply.");
    }

    await appendEvent(connection, {
      eventId: applyingEventId,
      caseId: row.case_id,
      eventType: "task_source_repair_applying",
      actorId: subject.user_id,
      fromStatus: "ready_to_apply",
      toStatus: "applying",
      evidenceRef,
      payload: { preview_fingerprint_sha256: normalized.fingerprint, approval_hold_id: hold.hold_id, secrets_included: false },
    });

    const updatedTask = await updateTask(connection, task, preflight.changes);
    const resultPayload = sanitizeValue({
      phase: "applied_pending_verification",
      applied_at: appliedAt,
      preview_fingerprint_sha256: normalized.fingerprint,
      capability_envelope_id: normalized.envelope_id,
      approval_hold_id: normalized.approval_hold_id,
      task_id: updatedTask.task_id,
      changed_fields: preflight.changes.map((change) => change.field),
      mutation_readback: { status: "passed", checked_fields: preflight.changes.map((change) => change.field) },
      lifecycle_readback_status: "not_run",
      provider_call_allowed: false,
      external_write_allowed: false,
      resolved_transition_allowed: false,
      secrets_included: false,
    });

    const [caseVerify] = await connection.query(
      `UPDATE tenant_resolution_cases
          SET status = 'verifying', current_step_key = 'task_source_repair_verifying',
              last_result_json = ?, readback_status = 'not_run', updated_at = CURRENT_TIMESTAMP
        WHERE case_id = ? AND tenant_id = ? AND status = 'applying'`,
      [JSON.stringify(resultPayload), row.case_id, subject.tenant_id]
    );
    if (Number(caseVerify?.affectedRows || 0) !== 1) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_VERIFY_TRANSITION_FAILED", "Resolution case could not enter verifying.");
    }

    await appendEvent(connection, {
      eventId: verifyingEventId,
      caseId: row.case_id,
      eventType: "task_source_repair_applied",
      actorId: subject.user_id,
      fromStatus: "applying",
      toStatus: "verifying",
      evidenceRef,
      payload: resultPayload,
    });

    const consumed = await transitionCapabilityEnvelopeLifecycle({
      pool: connection,
      envelopeId: normalized.envelope_id,
      action: "consume",
      executionRef: `tenant_resolution_case:${row.case_id}:task_source_repair_apply`,
    });
    if (!consumed.ok) {
      throw httpError(409, "TENANT_TASK_SOURCE_APPLY_ENVELOPE_CONSUME_FAILED", "Capability envelope could not be consumed after apply.", consumed);
    }

    return {
      ok: true,
      activation_layer: "tenant_task_source_repair_apply_gate",
      changed: true,
      case: {
        case_id: row.case_id,
        tenant_id: row.tenant_id,
        workspace_id: row.workspace_id || null,
        status: "verifying",
        current_step_key: "task_source_repair_verifying",
        readback_status: "not_run",
        secrets_included: false,
      },
      task: {
        task_id: updatedTask.task_id,
        task_key: updatedTask.task_key,
        title: updatedTask.title,
        source_surface: updatedTask.source_surface,
        source_ref: updatedTask.source_ref,
        secrets_included: false,
      },
      apply: resultPayload,
      envelope: {
        envelope_id: normalized.envelope_id,
        execution_status: "executed",
        consumed: true,
        secrets_included: false,
      },
      policy: {
        tenant_scoped: true,
        approval_hold_required: true,
        typed_confirmation_required: true,
        no_drift_required: true,
        internal_registry_write_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        resolved_transition_allowed: false,
        lifecycle_readback_required: true,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export const _testingTenantTaskSourceRepairApplyService = {
  ROOT_FAMILY,
  PLAYBOOK_KEY,
  CAPABILITY_KEY,
  OPERATION_INTENT,
  RUNTIME_SURFACE,
  APP_KEY,
  ALLOWED_TASK_FIELDS,
  typedConfirmation,
  normalizeInput,
  validatePreflight,
  verifyNoDrift,
  sanitizeValue,
};
