import { createHash, randomUUID } from "node:crypto";

const TASK_SOURCE_ROOT_FAMILY = "task_source_quality";
const TASK_SOURCE_PLAYBOOK_KEY = "task_source_repair_v1";
const PREVIEWABLE_STATUSES = new Set([
  "detected",
  "diagnosing",
  "needs_connection",
  "needs_approval",
  "ready_to_apply",
  "deferred_by_policy",
  "escalated",
  "blocked_missing_authority",
]);
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|payload_json|raw_prompt|system_prompt|activation_prompt)/i;

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

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 60)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)), "utf8")
    .digest("hex");
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
  };
}

function requireTenantSubject(sessionContext, explicitSubject) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id) {
    throw httpError(403, "TENANT_TASK_SOURCE_REPAIR_TENANT_SCOPE_REQUIRED", "Tenant scope is required for task source repair preview.");
  }
  return subject;
}

function referenceLookup(value) {
  const text = safeString(value, 512);
  if (!text) return null;
  const patterns = [
    [/^platform-pending-task:\/\/(.+)$/i, "task_id"],
    [/^platform_pending_tasks\/(.+)$/i, "task_id"],
    [/^task:\/\/(.+)$/i, "task_id"],
    [/^task-id:(.+)$/i, "task_id"],
    [/^task-key:\/\/(.+)$/i, "task_key"],
    [/^task-key:(.+)$/i, "task_key"],
  ];
  for (const [pattern, key] of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return { [key]: safeString(match[1], key === "task_id" ? 36 : 191) };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return { task_id: text };
  }
  return null;
}

function lookupFromCase(row = {}) {
  const direct = referenceLookup(row.resource_ref);
  if (direct) return direct;
  const refs = parseJsonValue(row.source_refs_json, []);
  for (const ref of Array.isArray(refs) ? refs : []) {
    const candidate = referenceLookup(typeof ref === "string" ? ref : ref?.ref || ref?.resource_ref);
    if (candidate) return candidate;
  }
  return null;
}

function normalizeLookup(input = {}, row = {}) {
  const lookupInput = input.lookup && typeof input.lookup === "object" ? input.lookup : {};
  const requested = {
    task_id: safeString(lookupInput.task_id || input.task_id, 36) || null,
    task_key: safeString(lookupInput.task_key || input.task_key, 191) || null,
  };
  const caseLookup = lookupFromCase(row);
  if (caseLookup?.task_id && requested.task_id && caseLookup.task_id !== requested.task_id) {
    throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_CASE_BINDING_MISMATCH", "Requested task_id does not match the case resource binding.", {
      case_task_id: caseLookup.task_id,
      requested_task_id: requested.task_id,
    });
  }
  if (caseLookup?.task_key && requested.task_key && caseLookup.task_key !== requested.task_key) {
    throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_CASE_BINDING_MISMATCH", "Requested task_key does not match the case resource binding.", {
      case_task_key: caseLookup.task_key,
      requested_task_key: requested.task_key,
    });
  }
  const resolved = {
    task_id: caseLookup?.task_id || requested.task_id,
    task_key: caseLookup?.task_key || requested.task_key,
  };
  if (!resolved.task_id && !resolved.task_key) {
    throw httpError(400, "TENANT_TASK_SOURCE_REPAIR_LOOKUP_REQUIRED", "A task_id or task_key binding is required for task source repair preview.");
  }
  return resolved;
}

function normalizeProposedValues(input = {}) {
  const values = input.proposed_values && typeof input.proposed_values === "object"
    ? input.proposed_values
    : {};
  const normalized = {};
  const definitions = {
    task_id: 36,
    task_key: 191,
    title: 255,
    source_surface: 191,
    source_ref: 500,
  };
  for (const [key, max] of Object.entries(definitions)) {
    if (values[key] === undefined || values[key] === null) continue;
    const value = safeString(values[key], max);
    if (!value) {
      throw httpError(400, "TENANT_TASK_SOURCE_REPAIR_PROPOSED_VALUE_INVALID", `proposed_values.${key} must be non-empty when supplied.`, {
        field: `proposed_values.${key}`,
      });
    }
    normalized[key] = value;
  }
  return normalized;
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
      issues.push({ field, issue: "missing_or_blank", severity: field === "source_ref" ? "medium" : "high" });
    }
  }
  if (task.owner_scope !== "tenant") {
    issues.push({ field: "owner_scope", issue: "must_equal_tenant", severity: "critical" });
  }
  if (!safeString(task.tenant_id, 64)) {
    issues.push({ field: "tenant_id", issue: "missing_or_blank", severity: "critical" });
  }
  const rawContext = task.context_json;
  if (rawContext !== null && rawContext !== undefined && typeof rawContext === "string") {
    try {
      JSON.parse(rawContext);
    } catch {
      issues.push({ field: "context_json", issue: "invalid_json", severity: "high" });
    }
  }
  return issues;
}

function taskProjection(task = {}) {
  const context = sanitizeValue(parseJsonValue(task.context_json, null));
  return {
    task_id: task.task_id || null,
    task_key: task.task_key || null,
    title: task.title || null,
    task_type: task.task_type || null,
    priority: task.priority || null,
    status: task.status || null,
    blocker_level: task.blocker_level || null,
    owner_scope: task.owner_scope || null,
    tenant_id: task.tenant_id || null,
    source_surface: task.source_surface || null,
    source_ref: task.source_ref || null,
    conversation_context_ref: task.conversation_context_ref || null,
    context_summary: context,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
    secrets_included: false,
  };
}

function buildProposal(task, issues, proposedValues, row, previewId, nowIso) {
  const proposedPatch = {};
  const unresolved = [];
  for (const issue of issues) {
    if (Object.prototype.hasOwnProperty.call(proposedValues, issue.field)) {
      proposedPatch[issue.field] = proposedValues[issue.field];
    } else if (["owner_scope", "tenant_id"].includes(issue.field)) {
      unresolved.push({ ...issue, reason: "scope_fields_are_not_repairable_by_preview" });
    } else {
      unresolved.push({ ...issue, reason: "explicit_proposed_value_required" });
    }
  }
  const changes = Object.entries(proposedPatch)
    .filter(([field, value]) => String(task[field] ?? "") !== String(value))
    .map(([field, value]) => ({
      field,
      from: safeString(task[field], 1000) || null,
      to: value,
    }));
  const deterministic = sanitizeValue({
    case_id: row.case_id,
    task_identity: {
      task_id: task.task_id || null,
      task_key: task.task_key || null,
    },
    issues,
    proposed_patch: proposedPatch,
    changes,
    unresolved_issues: unresolved,
    malformed_row_count_before: issues.length > 0 ? 1 : 0,
    expected_malformed_row_count_after_apply: unresolved.length === 0 ? 0 : 1,
    ready_for_apply_gate: issues.length > 0 && unresolved.length === 0 && changes.length > 0,
    required_capability_key: "tenant_task_source_repair",
    approval_required: true,
    readback_required: true,
    internal_registry_only: true,
    provider_call_allowed: false,
    external_write_allowed: false,
    task_registry_write_allowed: false,
    repair_apply_allowed: false,
    execution_dispatched: false,
    secrets_included: false,
  });
  return {
    preview_id: previewId,
    generated_at: nowIso,
    ...deterministic,
    preview_fingerprint_sha256: sha256Json(deterministic),
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
    last_preflight: sanitizeValue(parseJsonValue(row.last_preflight_json, null)),
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

async function withTransaction(pool, callback) {
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const shouldRelease = connection !== pool && typeof connection.release === "function";
  try {
    if (typeof connection.beginTransaction === "function") await connection.beginTransaction();
    const result = await callback(connection);
    if (typeof connection.commit === "function") await connection.commit();
    return result;
  } catch (error) {
    if (typeof connection.rollback === "function") await connection.rollback();
    throw error;
  } finally {
    if (shouldRelease) connection.release();
  }
}

async function readScopedCaseForUpdate(connection, subject, caseId, workspaceId) {
  const params = [caseId, subject.tenant_id];
  let workspaceClause = "";
  if (workspaceId) {
    workspaceClause = "AND c.workspace_id = ?";
    params.push(workspaceId);
  }
  const [rows] = await connection.query(
    `SELECT c.*,
            p.status AS playbook_status,
            p.tenant_visible AS playbook_tenant_visible,
            p.required_capability_key,
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
    throw httpError(404, "TENANT_TASK_SOURCE_REPAIR_CASE_NOT_FOUND", "Task source resolution case was not found within the caller scope.");
  }
  return rows[0];
}

function assertTaskSourceCase(row) {
  if (row.root_family !== TASK_SOURCE_ROOT_FAMILY || row.playbook_key !== TASK_SOURCE_PLAYBOOK_KEY) {
    throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_CASE_INCOMPATIBLE", "Resolution case is not bound to the Task Source Repair playbook.", {
      root_family: row.root_family,
      playbook_key: row.playbook_key,
      required_root_family: TASK_SOURCE_ROOT_FAMILY,
      required_playbook_key: TASK_SOURCE_PLAYBOOK_KEY,
    });
  }
  if (row.playbook_status !== "active" || Number(row.playbook_tenant_visible || 0) !== 1) {
    throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_PLAYBOOK_UNAVAILABLE", "Task Source Repair playbook is not active and tenant-visible.");
  }
  if (!PREVIEWABLE_STATUSES.has(row.status)) {
    throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_PREVIEW_NOT_ALLOWED", "Current case status does not allow task source repair preview.", {
      status: row.status,
      allowed_statuses: [...PREVIEWABLE_STATUSES],
    });
  }
}

async function readScopedTask(connection, subject, lookup) {
  const conditions = ["owner_scope = 'tenant'", "tenant_id = ?"];
  const params = [subject.tenant_id];
  if (lookup.task_id) {
    conditions.push("task_id = ?");
    params.push(lookup.task_id);
  } else {
    conditions.push("task_key = ?");
    params.push(lookup.task_key);
  }
  const [rows] = await connection.query(
    `SELECT task_id, task_key, title, task_type, priority, status, blocker_level,
            owner_scope, tenant_id, source_surface, source_ref,
            conversation_context_ref, context_json, created_at, updated_at
       FROM platform_pending_tasks
      WHERE ${conditions.join(" AND ")}
      LIMIT 1
      FOR UPDATE`,
    params
  );
  if (!rows[0]) {
    throw httpError(404, "TENANT_TASK_SOURCE_REPAIR_TASK_NOT_FOUND", "Pending task was not found within the caller tenant scope.");
  }
  return rows[0];
}

async function appendPreviewEvent(connection, { eventId, row, subject, preview, evidenceRef }) {
  await connection.query(
    `INSERT INTO tenant_resolution_case_events (
       event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
       evidence_ref, event_json, secrets_included
     ) VALUES (?, ?, 'task_source_repair_previewed', 'tenant_user', ?, ?, ?, ?, ?, 0)`,
    [
      eventId,
      row.case_id,
      subject.user_id || null,
      row.status,
      row.status,
      evidenceRef || null,
      JSON.stringify(sanitizeValue(preview)),
    ]
  );
}

export async function previewTenantTaskSourceRepair({
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
    throw httpError(400, "TENANT_TASK_SOURCE_REPAIR_CASE_ID_REQUIRED", "caseId is required.");
  }
  const normalizedWorkspaceId = safeString(workspaceId || input.workspace_id, 64) || null;
  const proposedValues = normalizeProposedValues(input);
  const evidenceRef = safeString(input.evidence_ref, 512) || null;
  const effectivePool = pool || await defaultPool();
  const nowIso = now().toISOString();

  return withTransaction(effectivePool, async (connection) => {
    const row = await readScopedCaseForUpdate(
      connection,
      subject,
      normalizedCaseId,
      normalizedWorkspaceId
    );
    assertTaskSourceCase(row);
    const lookup = normalizeLookup(input, row);
    const task = await readScopedTask(connection, subject, lookup);
    const issues = inspectTaskQuality(task);
    const preview = buildProposal(task, issues, proposedValues, row, uuid(), nowIso);
    const previousPreview = sanitizeValue(parseJsonValue(row.last_preflight_json, null));

    if (previousPreview?.preview_fingerprint_sha256 === preview.preview_fingerprint_sha256) {
      return {
        ok: true,
        activation_layer: "tenant_task_source_repair_preview",
        changed: false,
        case: caseProjection(row),
        task: taskProjection(task),
        preview: previousPreview,
        idempotency: { existing_preview_returned: true },
        policy: {
          tenant_scoped: true,
          internal_registry_read_only: true,
          provider_call_allowed: false,
          external_write_allowed: false,
          task_registry_write_allowed: false,
          repair_apply_allowed: false,
          execution_dispatched: false,
          secrets_included: false,
        },
        secrets_included: false,
      };
    }

    const [result] = await connection.query(
      `UPDATE tenant_resolution_cases
          SET current_step_key = 'task_source_repair_previewed',
              last_preflight_json = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE case_id = ?
          AND tenant_id = ?
          AND status = ?`,
      [JSON.stringify(preview), row.case_id, subject.tenant_id, row.status]
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      throw httpError(409, "TENANT_TASK_SOURCE_REPAIR_CASE_CONFLICT", "Resolution case changed during task source repair preview. Read the case and retry.", {
        case_id: row.case_id,
        expected_status: row.status,
      });
    }

    await appendPreviewEvent(connection, {
      eventId: uuid(),
      row,
      subject,
      preview,
      evidenceRef,
    });
    row.current_step_key = "task_source_repair_previewed";
    row.last_preflight_json = JSON.stringify(preview);

    return {
      ok: true,
      activation_layer: "tenant_task_source_repair_preview",
      changed: true,
      case: caseProjection(row),
      task: taskProjection(task),
      preview,
      policy: {
        tenant_scoped: true,
        workspace_scope_enforced_when_provided: true,
        internal_registry_read_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        task_registry_write_allowed: false,
        repair_apply_allowed: false,
        execution_dispatched: false,
        resolved_transition_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export const _testingTenantTaskSourceRepairPreviewService = {
  TASK_SOURCE_ROOT_FAMILY,
  TASK_SOURCE_PLAYBOOK_KEY,
  PREVIEWABLE_STATUSES,
  referenceLookup,
  lookupFromCase,
  normalizeLookup,
  normalizeProposedValues,
  inspectTaskQuality,
  taskProjection,
  buildProposal,
  sanitizeValue,
  sha256Json,
};
