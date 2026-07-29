import { createHash, randomUUID } from "node:crypto";

export const ACTIVATION_EVIDENCE_MAX_BYTES = 32768;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const STATE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SECRET_KEY_PATTERN = /(authorization|cookie|credential|password|secret|token|api[_-]?key)/i;
const ACTIVATION_MODES = new Set(["managed", "dedicated", "hybrid"]);

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw fail("activation_projection_pool_required", "A database pool with query() is required.", 500);
  }
}

function normalizeText(value, field, max, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw fail(`activation_${field}_required`, `${field} is required.`);
    return null;
  }
  if (text.length > max) {
    throw fail(`activation_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return text;
}

function normalizeUuid(value, field, { required = true } = {}) {
  const normalized = normalizeText(value, field, 36, { required });
  if (normalized && !UUID_PATTERN.test(normalized)) {
    throw fail(`activation_${field}_invalid`, `${field} must be a UUID.`);
  }
  return normalized;
}

function normalizeHash(value, field, { required = true } = {}) {
  const normalized = normalizeText(value, field, 64, { required });
  if (normalized && !SHA256_PATTERN.test(normalized)) {
    throw fail(`activation_${field}_invalid`, `${field} must be a SHA-256 hex digest.`);
  }
  return normalized?.toLowerCase() || null;
}

function normalizeState(value, field, fallback = null) {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  if (!STATE_PATTERN.test(normalized)) {
    throw fail(`activation_${field}_invalid`, `${field} must use lowercase state-key syntax.`);
  }
  return normalized;
}

function normalizeInteger(value, field, { min = 1 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) {
    throw fail(
      `activation_${field}_invalid`,
      `${field} must be an integer greater than or equal to ${min}.`,
    );
  }
  return normalized;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function canonicalize(value, depth = 0) {
  if (depth > 12) return "[depth-limited]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => canonicalize(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key], depth + 1)]),
    );
  }
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 4000);
}

export function stableActivationJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sanitizeActivationEvidence(value, depth = 0) {
  if (depth > 10) return "[depth-limited]";
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeActivationEvidence(item, depth + 1));
  }
  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      sanitized[key] = sanitizeActivationEvidence(item, depth + 1);
    }
    return sanitized;
  }
  if (typeof value === "string") return value.slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 4000);
}

export function deriveActivationOperationFingerprint(input = {}) {
  return sha256Text(
    stableActivationJson({
      tenant_id: input.tenant_id || null,
      user_id: input.user_id || null,
      workspace_id: input.workspace_id || null,
      protected_resource: input.protected_resource || null,
      oauth_client_id: input.oauth_client_id || null,
      purpose: input.purpose || "tenant_activation",
      activation_mode: input.activation_mode || "managed",
      material: input.operation_fingerprint_material || null,
    }),
  );
}

export function normalizeActivationOperationInput(input = {}) {
  const operationId = normalizeUuid(input.operation_id || input.run_id, "operation_id");
  const tenantId = normalizeText(input.tenant_id, "tenant_id", 36, { required: true });
  const userId = normalizeText(input.user_id, "user_id", 128);
  const workspaceId = normalizeText(input.workspace_id, "workspace_id", 128);
  const protectedResource = normalizeText(
    input.protected_resource,
    "protected_resource",
    500,
    { required: true },
  );
  const oauthClientId = normalizeText(input.oauth_client_id, "oauth_client_id", 191);
  const purpose = normalizeText(
    input.purpose || "tenant_activation",
    "purpose",
    80,
    { required: true },
  );
  const activationMode = String(input.activation_mode || "managed").trim().toLowerCase();
  if (!ACTIVATION_MODES.has(activationMode)) {
    throw fail(
      "activation_mode_invalid",
      "activation_mode must be managed, dedicated, or hybrid.",
    );
  }

  const subjectFingerprintSha256 = sha256Text(
    [tenantId, userId || "", workspaceId || "", oauthClientId || "", protectedResource].join("|"),
  );
  const idempotencyKeySha256 = input.idempotency_key_sha256
    ? normalizeHash(input.idempotency_key_sha256, "idempotency_key_sha256")
    : input.idempotency_key
      ? sha256Text(
          normalizeText(input.idempotency_key, "idempotency_key", 500, { required: true }),
        )
      : null;
  const operationFingerprintSha256 = input.operation_fingerprint_sha256
    ? normalizeHash(input.operation_fingerprint_sha256, "operation_fingerprint_sha256")
    : deriveActivationOperationFingerprint({
        tenant_id: tenantId,
        user_id: userId,
        workspace_id: workspaceId,
        protected_resource: protectedResource,
        oauth_client_id: oauthClientId,
        purpose,
        activation_mode: activationMode,
        operation_fingerprint_material: input.operation_fingerprint_material,
      });

  return {
    operation_id: operationId,
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
    subject_fingerprint_sha256: subjectFingerprintSha256,
    operation_fingerprint_sha256: operationFingerprintSha256,
    idempotency_key_sha256: idempotencyKeySha256,
    protected_resource: protectedResource,
    oauth_client_id: oauthClientId,
    purpose,
    activation_mode: activationMode,
    current_stage: normalizeState(input.current_stage, "current_stage", "accepted"),
    operation_status: normalizeState(input.operation_status, "operation_status", "accepted"),
    workflow_run_id: normalizeUuid(input.workflow_run_id, "workflow_run_id", { required: false }),
    optimistic_version: 0,
  };
}

export function buildActivationOperationProjectionInsert(input = {}) {
  const row = normalizeActivationOperationInput(input);
  return {
    row,
    sql: `INSERT INTO activation_operation_projections
      (operation_id, tenant_id, user_id, workspace_id, subject_fingerprint_sha256,
       operation_fingerprint_sha256, idempotency_key_sha256, protected_resource,
       oauth_client_id, purpose, activation_mode, current_stage, operation_status,
       workflow_run_id, optimistic_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    params: [
      row.operation_id,
      row.tenant_id,
      row.user_id,
      row.workspace_id,
      row.subject_fingerprint_sha256,
      row.operation_fingerprint_sha256,
      row.idempotency_key_sha256,
      row.protected_resource,
      row.oauth_client_id,
      row.purpose,
      row.activation_mode,
      row.current_stage,
      row.operation_status,
      row.workflow_run_id,
    ],
  };
}

async function executeInsert(pool, sql, params, conflictCode, conflictMessage) {
  requirePool(pool);
  try {
    const [result] = await pool.query(sql, params);
    return Number(result?.affectedRows || 0);
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      throw fail(conflictCode, conflictMessage, 409);
    }
    throw error;
  }
}

export async function createActivationOperationProjection(pool, input = {}) {
  const built = buildActivationOperationProjectionInsert(input);
  const affectedRows = await executeInsert(
    pool,
    built.sql,
    built.params,
    "activation_operation_idempotency_conflict",
    "An operation already exists for the supplied fingerprint or idempotency key.",
  );
  return { ...built.row, affected_rows: affectedRows };
}

const MUTABLE_PROJECTION_FIELDS = Object.freeze({
  current_stage: (value) => normalizeState(value, "current_stage"),
  operation_status: (value) => normalizeState(value, "operation_status"),
  workflow_run_id: (value) => normalizeUuid(value, "workflow_run_id", { required: false }),
});

export function buildOptimisticActivationOperationUpdate({
  operation_id,
  tenant_id,
  user_id = null,
  is_admin = false,
  expected_version,
  patch = {},
} = {}) {
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36, { required: true });
  const userId = normalizeText(user_id, "user_id", 128, { required: !is_admin });
  const expectedVersion = normalizeInteger(expected_version, "expected_version", { min: 0 });
  const assignments = [];
  const params = [];

  for (const [field, normalize] of Object.entries(MUTABLE_PROJECTION_FIELDS)) {
    if (!Object.hasOwn(patch, field)) continue;
    assignments.push(`${field} = ?`);
    params.push(normalize(patch[field]));
  }
  if (!assignments.length) {
    throw fail(
      "activation_projection_patch_empty",
      "At least one mutable projection field is required.",
    );
  }

  let scopeSql = "operation_id = ? AND tenant_id = ?";
  params.push(operationId, tenantId);
  if (!is_admin) {
    scopeSql += " AND BINARY user_id = BINARY ?";
    params.push(userId);
  }
  scopeSql += " AND optimistic_version = ?";
  params.push(expectedVersion);

  return {
    sql: `UPDATE activation_operation_projections
             SET ${assignments.join(", ")},
                 optimistic_version = optimistic_version + 1,
                 updated_at = UTC_TIMESTAMP(3)
           WHERE ${scopeSql}`,
    params,
    expected_version: expectedVersion,
    next_version: expectedVersion + 1,
  };
}

export async function updateActivationOperationProjection(pool, input = {}) {
  requirePool(pool);
  const built = buildOptimisticActivationOperationUpdate(input);
  const [result] = await pool.query(built.sql, built.params);
  if (Number(result?.affectedRows || 0) !== 1) {
    throw fail(
      "activation_operation_version_conflict",
      "The operation projection changed or is outside the authorized subject scope.",
      409,
    );
  }
  return { updated: true, optimistic_version: built.next_version };
}

export async function readActivationOperationProjection(
  pool,
  { operation_id, tenant_id, user_id = null, is_admin = false } = {},
) {
  requirePool(pool);
  const operationId = normalizeUuid(operation_id, "operation_id");
  const tenantId = normalizeText(tenant_id, "tenant_id", 36, { required: true });
  const userId = normalizeText(user_id, "user_id", 128, { required: !is_admin });
  let scopeSql = "operation_id = ? AND tenant_id = ?";
  const params = [operationId, tenantId];
  if (!is_admin) {
    scopeSql += " AND BINARY user_id = BINARY ?";
    params.push(userId);
  }
  const [rows] = await pool.query(
    `SELECT operation_id, tenant_id, user_id, workspace_id,
            operation_fingerprint_sha256, idempotency_key_sha256,
            protected_resource, oauth_client_id, purpose, activation_mode,
            current_stage, operation_status, workflow_run_id,
            optimistic_version, created_at, updated_at
       FROM activation_operation_projections
      WHERE ${scopeSql}
      LIMIT 1`,
    params,
  );
  return rows?.[0] || null;
}

function normalizeAppendBase(input = {}) {
  return {
    operation_id: normalizeUuid(input.operation_id, "operation_id"),
    tenant_id: normalizeText(input.tenant_id, "tenant_id", 36, { required: true }),
  };
}

const DELIVERY_TRANSITIONS = Object.freeze({
  prepared: new Set(["sent", "failed", "expired"]),
});
const ACKNOWLEDGEMENT_TRANSITIONS = Object.freeze({
  not_requested: new Set(["pending"]),
  pending: new Set(["acknowledged", "rejected", "expired"]),
});
const RECONCILIATION_TRANSITIONS = Object.freeze({
  pending: new Set(["executed", "not_executed", "conflicting", "still_unknown", "failed"]),
});

function normalizeAllowedTransition({ from_status, to_status, transitions, field }) {
  const fromStatus = normalizeState(from_status, `${field}_from_status`);
  const toStatus = normalizeState(to_status, `${field}_to_status`);
  if (!transitions[fromStatus]?.has(toStatus)) {
    throw fail(
      `activation_${field}_transition_invalid`,
      `${field} cannot transition from ${fromStatus} to ${toStatus}.`,
      409,
    );
  }
  return { from_status: fromStatus, to_status: toStatus };
}

async function executeScopedActivationTransition(
  pool,
  {
    sql,
    params,
    read_sql,
    read_params,
    state_field,
    target_state,
    conflict_code,
    conflict_message,
  },
) {
  requirePool(pool);
  const [result] = await pool.query(sql, params);
  if (Number(result?.affectedRows || 0) === 1) {
    return { updated: true, idempotent: false, state: target_state };
  }

  const [rows] = await pool.query(read_sql, read_params);
  if (rows?.[0]?.[state_field] === target_state) {
    return { updated: false, idempotent: true, state: target_state };
  }

  throw fail(conflict_code, conflict_message, 409);
}

export async function appendActivationStageAttempt(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const attemptId = normalizeUuid(input.attempt_id || randomUUID(), "attempt_id");
  const sql = `INSERT INTO activation_stage_attempts
    (attempt_id, operation_id, tenant_id, stage_key, attempt_number,
     source_type, attempt_status, retryable, unknown_outcome,
     error_code, error_message, evidence_ref, started_at, completed_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`;
  const params = [
    attemptId,
    base.operation_id,
    base.tenant_id,
    normalizeState(input.stage_key, "stage_key"),
    normalizeInteger(input.attempt_number, "attempt_number"),
    normalizeState(input.source_type, "source_type", "platform_native"),
    normalizeState(input.attempt_status, "attempt_status", "started"),
    input.retryable === true ? 1 : 0,
    input.unknown_outcome === true ? 1 : 0,
    normalizeText(input.error_code, "error_code", 160),
    normalizeText(input.error_message, "error_message", 1000),
    normalizeText(input.evidence_ref, "evidence_ref", 500),
    input.completed_at || null,
  ];
  const affectedRows = await executeInsert(
    pool,
    sql,
    params,
    "activation_stage_attempt_conflict",
    "The stage attempt number already exists for this operation and stage.",
  );
  return { attempt_id: attemptId, affected_rows: affectedRows };
}

export function buildActivationEvidenceRecord(input = {}) {
  const base = normalizeAppendBase(input);
  const sanitized = sanitizeActivationEvidence(input.evidence || {});
  const serialized = stableActivationJson(sanitized);
  const summaryBytes = Buffer.byteLength(serialized, "utf8");
  if (summaryBytes > ACTIVATION_EVIDENCE_MAX_BYTES) {
    throw fail(
      "activation_evidence_too_large",
      `Sanitized evidence exceeds ${ACTIVATION_EVIDENCE_MAX_BYTES} bytes.`,
      413,
    );
  }
  return {
    evidence_id: normalizeUuid(input.evidence_id || randomUUID(), "evidence_id"),
    operation_id: base.operation_id,
    attempt_id: normalizeUuid(input.attempt_id, "attempt_id", { required: false }),
    tenant_id: base.tenant_id,
    evidence_type: normalizeState(input.evidence_type, "evidence_type"),
    source_type: normalizeState(input.source_type, "source_type", "platform_native"),
    source_ref: normalizeText(input.source_ref, "source_ref", 500),
    evidence_sha256: sha256Text(serialized),
    summary_json: sanitized,
    summary_bytes: summaryBytes,
    redaction_state:
      input.source_ref && Object.keys(sanitized || {}).length === 0
        ? "reference_only"
        : "sanitized",
    secrets_included: false,
  };
}

export async function appendActivationEvidenceItem(pool, input = {}) {
  const row = buildActivationEvidenceRecord(input);
  const sql = `INSERT INTO activation_evidence_items
    (evidence_id, operation_id, attempt_id, tenant_id, evidence_type,
     source_type, source_ref, evidence_sha256, summary_json, summary_bytes,
     redaction_state, secrets_included, captured_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
  const params = [
    row.evidence_id,
    row.operation_id,
    row.attempt_id,
    row.tenant_id,
    row.evidence_type,
    row.source_type,
    row.source_ref,
    row.evidence_sha256,
    JSON.stringify(row.summary_json),
    row.summary_bytes,
    row.redaction_state,
  ];
  const affectedRows = await executeInsert(
    pool,
    sql,
    params,
    "activation_evidence_conflict",
    "Equivalent evidence already exists for this operation.",
  );
  return { ...row, affected_rows: affectedRows };
}

export async function appendActivationDelivery(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const deliveryId = normalizeUuid(input.delivery_id || randomUUID(), "delivery_id");
  const sql = `INSERT INTO activation_deliveries
    (delivery_id, operation_id, tenant_id, channel_key,
     delivery_attempt_number, delivery_status, payload_sha256,
     response_status_code, error_code, error_message, delivered_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`;
  const params = [
    deliveryId,
    base.operation_id,
    base.tenant_id,
    normalizeState(input.channel_key, "channel_key"),
    normalizeInteger(input.delivery_attempt_number, "delivery_attempt_number"),
    normalizeState(input.delivery_status, "delivery_status", "prepared"),
    input.payload_sha256 ? normalizeHash(input.payload_sha256, "payload_sha256") : null,
    input.response_status_code == null ? null : Number(input.response_status_code),
    normalizeText(input.error_code, "error_code", 160),
    normalizeText(input.error_message, "error_message", 1000),
    input.delivered_at || null,
  ];
  const affectedRows = await executeInsert(
    pool,
    sql,
    params,
    "activation_delivery_attempt_conflict",
    "The delivery attempt number already exists for this operation and channel.",
  );
  return { delivery_id: deliveryId, affected_rows: affectedRows };
}

export async function appendActivationAcknowledgement(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const acknowledgementId = normalizeUuid(
    input.acknowledgement_id || randomUUID(),
    "acknowledgement_id",
  );
  const actorType = normalizeState(input.actor_type, "actor_type");
  const actorRef = normalizeText(input.actor_ref, "actor_ref", 500, { required: true });
  const actorRefSha256 = sha256Text(actorRef);
  const acknowledgementState = normalizeState(
    input.acknowledgement_state,
    "acknowledgement_state",
  );
  const acknowledgementKeySha256 = input.acknowledgement_key_sha256
    ? normalizeHash(input.acknowledgement_key_sha256, "acknowledgement_key_sha256")
    : sha256Text(
        [
          base.operation_id,
          actorType,
          actorRefSha256,
          acknowledgementState,
          input.client_event_id || "",
        ].join("|"),
      );
  const sql = `INSERT INTO activation_acknowledgements
    (acknowledgement_id, operation_id, delivery_id, tenant_id,
     actor_type, actor_ref_sha256, acknowledgement_key_sha256,
     acknowledgement_state, acknowledgement_reason,
     acknowledged_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
  const params = [
    acknowledgementId,
    base.operation_id,
    normalizeUuid(input.delivery_id, "delivery_id", { required: false }),
    base.tenant_id,
    actorType,
    actorRefSha256,
    acknowledgementKeySha256,
    acknowledgementState,
    normalizeText(input.acknowledgement_reason, "acknowledgement_reason", 1000),
  ];
  const affectedRows = await executeInsert(
    pool,
    sql,
    params,
    "activation_acknowledgement_conflict",
    "The acknowledgement key already exists for this operation.",
  );
  return {
    acknowledgement_id: acknowledgementId,
    acknowledgement_key_sha256: acknowledgementKeySha256,
    affected_rows: affectedRows,
  };
}

export async function appendActivationReconciliationAttempt(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const reconciliationId = normalizeUuid(
    input.reconciliation_id || randomUUID(),
    "reconciliation_id",
  );
  const sql = `INSERT INTO activation_reconciliation_attempts
    (reconciliation_id, operation_id, tenant_id, attempt_number,
     reason_code, source_type, reconciliation_status, outcome_code,
     evidence_ref, started_at, completed_at, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, UTC_TIMESTAMP(3))`;
  const params = [
    reconciliationId,
    base.operation_id,
    base.tenant_id,
    normalizeInteger(input.attempt_number, "attempt_number"),
    normalizeState(input.reason_code, "reason_code"),
    normalizeState(input.source_type, "source_type", "platform_native"),
    normalizeState(input.reconciliation_status, "reconciliation_status", "pending"),
    input.outcome_code ? normalizeState(input.outcome_code, "outcome_code") : null,
    normalizeText(input.evidence_ref, "evidence_ref", 500),
    input.completed_at || null,
  ];
  const affectedRows = await executeInsert(
    pool,
    sql,
    params,
    "activation_reconciliation_attempt_conflict",
    "The reconciliation attempt number already exists for this operation.",
  );
  return { reconciliation_id: reconciliationId, affected_rows: affectedRows };
}

export async function transitionActivationDelivery(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const deliveryId = normalizeUuid(input.delivery_id, "delivery_id");
  const transition = normalizeAllowedTransition({
    from_status: input.from_status,
    to_status: input.to_status,
    transitions: DELIVERY_TRANSITIONS,
    field: "delivery",
  });
  const responseStatusCode =
    input.response_status_code == null ? null : Number(input.response_status_code);
  if (
    responseStatusCode != null &&
    (!Number.isSafeInteger(responseStatusCode) ||
      responseStatusCode < 100 ||
      responseStatusCode > 599)
  ) {
    throw fail(
      "activation_response_status_code_invalid",
      "response_status_code must be an integer between 100 and 599.",
    );
  }
  const errorCode = normalizeText(input.error_code, "error_code", 160);
  const errorMessage = normalizeText(input.error_message, "error_message", 1000);
  const deliveredAt = input.delivered_at || null;
  return executeScopedActivationTransition(pool, {
    sql: `UPDATE activation_deliveries
             SET delivery_status = ?,
                 response_status_code = ?,
                 error_code = ?,
                 error_message = ?,
                 delivered_at = CASE
                   WHEN ? = 'sent' THEN COALESCE(?, UTC_TIMESTAMP(3))
                   ELSE delivered_at
                 END
           WHERE delivery_id = ?
             AND operation_id = ?
             AND tenant_id = ?
             AND delivery_status = ?`,
    params: [
      transition.to_status,
      responseStatusCode,
      errorCode,
      errorMessage,
      transition.to_status,
      deliveredAt,
      deliveryId,
      base.operation_id,
      base.tenant_id,
      transition.from_status,
    ],
    read_sql: `SELECT delivery_status
                 FROM activation_deliveries
                WHERE delivery_id = ?
                  AND operation_id = ?
                  AND tenant_id = ?
                LIMIT 1`,
    read_params: [deliveryId, base.operation_id, base.tenant_id],
    state_field: "delivery_status",
    target_state: transition.to_status,
    conflict_code: "activation_delivery_transition_conflict",
    conflict_message:
      "The delivery changed or is outside the authorized tenant and operation scope.",
  });
}

export async function transitionActivationAcknowledgement(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const acknowledgementId = normalizeUuid(
    input.acknowledgement_id,
    "acknowledgement_id",
  );
  const transition = normalizeAllowedTransition({
    from_status: input.from_status,
    to_status: input.to_status,
    transitions: ACKNOWLEDGEMENT_TRANSITIONS,
    field: "acknowledgement",
  });
  const acknowledgementReason = normalizeText(
    input.acknowledgement_reason,
    "acknowledgement_reason",
    1000,
  );
  const acknowledgedAt = input.acknowledged_at || null;
  return executeScopedActivationTransition(pool, {
    sql: `UPDATE activation_acknowledgements
             SET acknowledgement_state = ?,
                 acknowledgement_reason = COALESCE(?, acknowledgement_reason),
                 acknowledged_at = CASE
                   WHEN ? IN ('acknowledged', 'rejected', 'expired')
                     THEN COALESCE(?, UTC_TIMESTAMP(3))
                   ELSE acknowledged_at
                 END
           WHERE acknowledgement_id = ?
             AND operation_id = ?
             AND tenant_id = ?
             AND acknowledgement_state = ?`,
    params: [
      transition.to_status,
      acknowledgementReason,
      transition.to_status,
      acknowledgedAt,
      acknowledgementId,
      base.operation_id,
      base.tenant_id,
      transition.from_status,
    ],
    read_sql: `SELECT acknowledgement_state
                 FROM activation_acknowledgements
                WHERE acknowledgement_id = ?
                  AND operation_id = ?
                  AND tenant_id = ?
                LIMIT 1`,
    read_params: [acknowledgementId, base.operation_id, base.tenant_id],
    state_field: "acknowledgement_state",
    target_state: transition.to_status,
    conflict_code: "activation_acknowledgement_transition_conflict",
    conflict_message:
      "The acknowledgement changed or is outside the authorized tenant and operation scope.",
  });
}

export async function completeActivationReconciliationAttempt(pool, input = {}) {
  const base = normalizeAppendBase(input);
  const reconciliationId = normalizeUuid(
    input.reconciliation_id,
    "reconciliation_id",
  );
  const transition = normalizeAllowedTransition({
    from_status: input.from_status,
    to_status: input.to_status,
    transitions: RECONCILIATION_TRANSITIONS,
    field: "reconciliation",
  });
  const outcomeCode = input.outcome_code
    ? normalizeState(input.outcome_code, "outcome_code")
    : null;
  const evidenceRef = normalizeText(input.evidence_ref, "evidence_ref", 500);
  const completedAt = input.completed_at || null;
  return executeScopedActivationTransition(pool, {
    sql: `UPDATE activation_reconciliation_attempts
             SET reconciliation_status = ?,
                 outcome_code = ?,
                 evidence_ref = ?,
                 completed_at = COALESCE(?, UTC_TIMESTAMP(3))
           WHERE reconciliation_id = ?
             AND operation_id = ?
             AND tenant_id = ?
             AND reconciliation_status = ?`,
    params: [
      transition.to_status,
      outcomeCode,
      evidenceRef,
      completedAt,
      reconciliationId,
      base.operation_id,
      base.tenant_id,
      transition.from_status,
    ],
    read_sql: `SELECT reconciliation_status
                 FROM activation_reconciliation_attempts
                WHERE reconciliation_id = ?
                  AND operation_id = ?
                  AND tenant_id = ?
                LIMIT 1`,
    read_params: [reconciliationId, base.operation_id, base.tenant_id],
    state_field: "reconciliation_status",
    target_state: transition.to_status,
    conflict_code: "activation_reconciliation_transition_conflict",
    conflict_message:
      "The reconciliation attempt changed or is outside the authorized tenant and operation scope.",
  });
}
