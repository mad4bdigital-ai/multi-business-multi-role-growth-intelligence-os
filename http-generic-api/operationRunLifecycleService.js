import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { canonicalizeOperationValue, stableOperationHash } from "./operationRegistryContracts.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const COMMANDS = new Set(["initialize", "checkpoint", "approve", "reject", "callback", "cancel", "resume", "recover"]);
const WAITING_STATUSES = new Set(["awaiting_approval", "awaiting_callback", "awaiting_input", "interrupted"]);
const EXTERNAL_SIGNAL_STATUSES = new Set(["awaiting_approval", "awaiting_callback", "awaiting_input"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RESUMABLE_STATUSES = new Set(["resume_ready", "awaiting_input", "interrupted", "recovery_pending"]);
const COMPLETED_STEP_STATUSES = new Set(["completed", "succeeded", "success", "skipped"]);
const FORBIDDEN_EXACT_KEYS = new Set([
  "credential_payload",
  "credential_value",
  "provider_url",
  "endpoint_url",
  "base_url",
  "authorization",
  "cookie",
  "request_headers",
  "raw_secret",
]);
const SECRET_KEY_PATTERN = /(?:password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|secret_value|client_secret)/i;

export class OperationRunLifecycleError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRunLifecycleError";
    this.code = code;
    this.status = status;
    this.details = { ...details, secrets_included: false };
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRunLifecycleError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_run_lifecycle_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_run_lifecycle_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function optionalString(value, field, { max = 191, pattern = null } = {}) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, { max, pattern });
}

function requiredUuid(value, field) {
  const normalized = requiredString(value, field, { max: 36 }).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) fail("operation_run_lifecycle_invalid_uuid", `${field} must be a UUID.`, 400, { field });
  return normalized;
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_run_lifecycle_invalid_hash", `${field} must be SHA-256.`, 400, { field });
  return normalized;
}

function boundedInteger(value, field, min, max) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    fail("operation_run_lifecycle_invalid_integer", `${field} must be between ${min} and ${max}.`, 400, { field });
  }
  return normalized;
}

function validateSafePayload(value, field = "payload", depth = 0) {
  if (depth > 24) fail("operation_run_lifecycle_payload_depth_exceeded", `${field} exceeds the maximum depth.`, 400, { field });
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSafePayload(entry, `${field}[${index}]`, depth + 1));
    return;
  }
  if (!isObject(value)) fail("operation_run_lifecycle_payload_not_json", `${field} must be JSON-safe.`, 400, { field });
  for (const [key, nested] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (nested !== false) fail("operation_run_lifecycle_safety_marker_invalid", `${childField} must be false.`, 400, { field: childField });
      continue;
    }
    if (FORBIDDEN_EXACT_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) {
      fail("operation_run_lifecycle_sensitive_field_forbidden", `${childField} is not allowed.`, 400, { field: childField });
    }
    validateSafePayload(nested, childField, depth + 1);
  }
}

function normalizeCommandInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "run_id", "tenant_id", "workspace_id", "user_id", "command", "command_id",
    "expected_state_revision", "revision_bundle_hash", "resource_fingerprint", "actor_key", "payload",
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_run_lifecycle_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  const command = requiredString(root.command, "input.command", { max: 32 }).toLowerCase();
  if (!COMMANDS.has(command)) fail("operation_run_lifecycle_command_invalid", "input.command is unsupported.", 400, { command });
  const payload = root.payload === undefined ? {} : requiredObject(root.payload, "input.payload");
  validateSafePayload(payload, "input.payload");
  const canonicalPayload = canonicalizeOperationValue(payload);
  const normalized = {
    run_id: requiredUuid(root.run_id, "input.run_id"),
    tenant_id: requiredUuid(root.tenant_id, "input.tenant_id"),
    workspace_id: root.workspace_id ? requiredUuid(root.workspace_id, "input.workspace_id") : null,
    user_id: requiredUuid(root.user_id, "input.user_id"),
    command,
    command_id: requiredString(root.command_id, "input.command_id", { max: 150, pattern: KEY_PATTERN }).toLowerCase(),
    expected_state_revision: boundedInteger(root.expected_state_revision, "input.expected_state_revision", 0, Number.MAX_SAFE_INTEGER),
    revision_bundle_hash: requiredHash(root.revision_bundle_hash, "input.revision_bundle_hash"),
    resource_fingerprint: requiredHash(root.resource_fingerprint, "input.resource_fingerprint"),
    actor_key: requiredString(root.actor_key, "input.actor_key"),
    payload: canonicalPayload,
  };
  normalized.event_key = `${normalized.command}:${normalized.command_id}`;
  normalized.event_payload = canonicalizeOperationValue({
    schema_version: "operation-run-lifecycle-event-v1",
    command: normalized.command,
    command_id: normalized.command_id,
    actor_key: normalized.actor_key,
    expected_state_revision: normalized.expected_state_revision,
    revision_bundle_hash: normalized.revision_bundle_hash,
    resource_fingerprint: normalized.resource_fingerprint,
    payload: normalized.payload,
    secrets_included: false,
  });
  const serialized = JSON.stringify(normalized.event_payload);
  if (serialized.length > 50_000) fail("operation_run_lifecycle_payload_too_large", "Lifecycle event payload exceeds the bounded size.", 400);
  normalized.payload_sha256 = stableOperationHash(normalized.event_payload);
  normalized.payload_json = serialized;
  return normalized;
}

function normalizeStatusInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set(["run_id", "tenant_id", "workspace_id", "user_id", "cursor", "limit"]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_run_lifecycle_status_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  return {
    run_id: requiredUuid(root.run_id, "input.run_id"),
    tenant_id: requiredUuid(root.tenant_id, "input.tenant_id"),
    workspace_id: root.workspace_id ? requiredUuid(root.workspace_id, "input.workspace_id") : null,
    user_id: requiredUuid(root.user_id, "input.user_id"),
    cursor: root.cursor === undefined || root.cursor === null ? 0 : boundedInteger(root.cursor, "input.cursor", 0, Number.MAX_SAFE_INTEGER),
    limit: root.limit === undefined || root.limit === null ? 25 : boundedInteger(root.limit, "input.limit", 1, 100),
  };
}

function parseJson(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("operation_run_lifecycle_persisted_json_invalid", `${field} contains invalid JSON.`, 500, { field });
  }
}

function dependencies(overrides = {}) {
  return {
    pool: overrides.pool || getPool(),
    uuid: overrides.uuid || randomUUID,
    now: overrides.now || (() => new Date()),
  };
}

async function readRunContext(connection, runId, lock = false) {
  const [rows] = await connection.query(
    `SELECT o.run_id,o.tenant_id,o.workspace_id,o.user_id,o.operation_key,o.resource_uri,
            r.status AS run_status,r.stage,r.automation_key,r.mode,r.input_sha256,r.plan_sha256,
            r.secrets_included AS run_secrets_included,
            p.revision_bundle_hash,p.resource_fingerprint
       FROM operation_run_ownership o
       JOIN repository_automation_runs r ON r.run_id=o.run_id
       JOIN operation_run_revision_pins p ON p.run_id=o.run_id
      WHERE o.run_id=?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  return rows?.[0] || null;
}

function assertOwnership(context, input, { verifyRevisions = false } = {}) {
  if (!context) fail("operation_run_lifecycle_run_not_found", "The governed operation run does not exist.", 404, { run_id: input.run_id });
  if (context.tenant_id !== input.tenant_id || context.user_id !== input.user_id) {
    fail("operation_run_lifecycle_ownership_mismatch", "The operation run is not owned by the requested principal.", 403);
  }
  if (input.workspace_id && context.workspace_id !== input.workspace_id) {
    fail("operation_run_lifecycle_workspace_mismatch", "The operation run workspace does not match.", 403);
  }
  if (Number(context.run_secrets_included || 0) !== 0) {
    fail("operation_run_lifecycle_run_safety_invalid", "The operation run is not eligible for lifecycle projection.", 409);
  }
  if (verifyRevisions && (
    context.revision_bundle_hash !== input.revision_bundle_hash
    || context.resource_fingerprint !== input.resource_fingerprint
  )) {
    fail("operation_run_lifecycle_revision_context_mismatch", "The run revision bundle or resource fingerprint changed.", 409, {
      current_revision_bundle_hash: context.revision_bundle_hash,
      current_resource_fingerprint: context.resource_fingerprint,
    });
  }
}

function assertStateAuthority(state, context) {
  if (!state) return;
  if (
    state.revision_bundle_hash !== context.revision_bundle_hash
    || state.resource_fingerprint !== context.resource_fingerprint
  ) {
    fail("operation_run_lifecycle_state_authority_mismatch", "The stored lifecycle authority no longer matches the pinned run authority.", 409, {
      state_revision_bundle_hash: state.revision_bundle_hash,
      current_revision_bundle_hash: context.revision_bundle_hash,
    });
  }
}

async function readState(connection, runId, lock = false) {
  const [rows] = await connection.query(
    `SELECT lifecycle_id,run_id,state_revision,lifecycle_status,approval_status,resume_from_step_key,
            checkpoint_sha256,revision_bundle_hash,resource_fingerprint,callback_id,callback_payload_sha256,
            cancellation_requested_at,cancelled_at,recovery_classification,last_event_id,created_at,updated_at
       FROM operation_run_lifecycle_state
      WHERE run_id=?
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [runId],
  );
  const row = rows?.[0];
  if (!row) return null;
  return { ...row, state_revision: Number(row.state_revision) };
}

async function readSteps(connection, runId) {
  const [rows] = await connection.query(
    `SELECT step_key,step_order,status,attempt_count,request_sha256,completed_at
       FROM repository_automation_step_runs
      WHERE run_id=?
      ORDER BY step_order,step_key`,
    [runId],
  );
  return (rows || []).map((row) => ({
    ...row,
    step_order: Number(row.step_order),
    attempt_count: Number(row.attempt_count),
  }));
}

async function readEventByKey(connection, runId, eventKey) {
  const [rows] = await connection.query(
    `SELECT id,event_id,run_id,state_revision,event_type,event_key,actor_key,payload_sha256,payload_json,created_at
       FROM operation_run_lifecycle_events
      WHERE run_id=? AND event_key=?
      LIMIT 1`,
    [runId, eventKey],
  );
  const row = rows?.[0];
  return row ? { ...row, id: Number(row.id), state_revision: Number(row.state_revision), payload: parseJson(row.payload_json, "payload_json") } : null;
}

async function readEventById(connection, eventId) {
  const [rows] = await connection.query(
    `SELECT id,event_id,run_id,state_revision,event_type,event_key,actor_key,payload_sha256,payload_json,created_at
       FROM operation_run_lifecycle_events
      WHERE event_id=?
      LIMIT 1`,
    [eventId],
  );
  const row = rows?.[0];
  return row ? { ...row, id: Number(row.id), state_revision: Number(row.state_revision), payload: parseJson(row.payload_json, "payload_json") } : null;
}

function firstIncompleteStep(steps = []) {
  return steps.find((step) => !COMPLETED_STEP_STATUSES.has(String(step.status || "").toLowerCase())) || null;
}

function buildResumePlan(state, steps, context) {
  const first = firstIncompleteStep(steps);
  return {
    available: Boolean(first),
    from_step_key: first?.step_key || null,
    from_step_order: first?.step_order ?? null,
    completed_step_keys: steps.filter((step) => COMPLETED_STEP_STATUSES.has(String(step.status || "").toLowerCase())).map((step) => step.step_key),
    pending_step_keys: steps.filter((step) => !COMPLETED_STEP_STATUSES.has(String(step.status || "").toLowerCase())).map((step) => step.step_key),
    state_revision: state?.state_revision ?? null,
    revision_bundle_hash: context?.revision_bundle_hash || null,
    resource_fingerprint: context?.resource_fingerprint || null,
    dispatch_authorized: false,
    secrets_included: false,
  };
}

function initialStatus(runStatus) {
  const normalized = String(runStatus || "").toLowerCase();
  if (TERMINAL_STATUSES.has(normalized)) return normalized;
  if (normalized === "awaiting_input") return "awaiting_input";
  if (normalized === "blocked") return "blocked";
  return "running";
}

function recoveryClassification(state, context, steps) {
  if (["completed", "cancelled"].includes(state.lifecycle_status) || ["completed", "cancelled"].includes(String(context.run_status || "").toLowerCase())) {
    return "terminal_no_recovery";
  }
  if (EXTERNAL_SIGNAL_STATUSES.has(state.lifecycle_status)) return "waiting_external_signal";
  if (state.lifecycle_status === "failed" || String(context.run_status || "").toLowerCase() === "failed") {
    return "terminal_failure_review_required";
  }
  if (state.lifecycle_status === "interrupted" && firstIncompleteStep(steps)) return "interrupted_resumable";
  if (firstIncompleteStep(steps)) return "interrupted_resumable";
  return "no_incomplete_step";
}

function deriveTransition({ input, state, context, steps, now }) {
  const next = { ...state };
  let eventType = input.command;
  let resumePlan = null;
  if (input.command === "checkpoint") {
    const target = requiredString(input.payload.awaiting_status, "input.payload.awaiting_status", { max: 32 }).toLowerCase();
    if (!WAITING_STATUSES.has(target)) fail("operation_run_lifecycle_checkpoint_status_invalid", "Checkpoint status is unsupported.", 400, { target });
    const checkpoint = requiredObject(input.payload.checkpoint, "input.payload.checkpoint");
    next.lifecycle_status = target;
    next.approval_status = target === "awaiting_approval" ? "pending" : next.approval_status;
    next.checkpoint_sha256 = stableOperationHash(canonicalizeOperationValue(checkpoint));
    next.resume_from_step_key = optionalString(input.payload.resume_from_step_key, "input.payload.resume_from_step_key", { max: 96 }) || firstIncompleteStep(steps)?.step_key || null;
  } else if (input.command === "approve") {
    if (state.lifecycle_status !== "awaiting_approval") fail("operation_run_lifecycle_approval_state_invalid", "The run is not awaiting approval.", 409);
    next.lifecycle_status = "resume_ready";
    next.approval_status = "approved";
    eventType = "approval_granted";
  } else if (input.command === "reject") {
    if (state.lifecycle_status !== "awaiting_approval") fail("operation_run_lifecycle_approval_state_invalid", "The run is not awaiting approval.", 409);
    next.lifecycle_status = "blocked";
    next.approval_status = "rejected";
    eventType = "approval_rejected";
  } else if (input.command === "callback") {
    if (state.lifecycle_status !== "awaiting_callback") fail("operation_run_lifecycle_callback_state_invalid", "The run is not awaiting a callback.", 409);
    next.lifecycle_status = "resume_ready";
    next.callback_id = input.command_id;
    next.callback_payload_sha256 = stableOperationHash(input.payload);
    eventType = "callback_received";
  } else if (input.command === "cancel") {
    if (TERMINAL_STATUSES.has(state.lifecycle_status)) fail("operation_run_lifecycle_terminal_state", "A terminal run cannot be cancelled again.", 409);
    next.lifecycle_status = "cancellation_requested";
    next.cancellation_requested_at = now.toISOString();
    eventType = "cancellation_requested";
  } else if (input.command === "resume") {
    if (!RESUMABLE_STATUSES.has(state.lifecycle_status)) fail("operation_run_lifecycle_resume_state_invalid", "The lifecycle state is not resumable.", 409, { lifecycle_status: state.lifecycle_status });
    const first = firstIncompleteStep(steps);
    if (!first) fail("operation_run_lifecycle_resume_not_required", "No incomplete step remains.", 409);
    next.lifecycle_status = "resuming";
    next.resume_from_step_key = first.step_key;
    eventType = "resume_planned";
    resumePlan = buildResumePlan({ ...next, state_revision: state.state_revision + 1 }, steps, context);
  } else if (input.command === "recover") {
    const classification = recoveryClassification(state, context, steps);
    next.recovery_classification = classification;
    eventType = "recovery_classified";
    if (classification === "interrupted_resumable") {
      const first = firstIncompleteStep(steps);
      next.lifecycle_status = "recovery_pending";
      next.resume_from_step_key = first?.step_key || null;
      resumePlan = buildResumePlan({ ...next, state_revision: state.state_revision + 1 }, steps, context);
    } else if (classification === "waiting_external_signal") {
      next.lifecycle_status = state.lifecycle_status;
    } else {
      next.lifecycle_status = "blocked";
    }
  } else {
    fail("operation_run_lifecycle_transition_invalid", "The lifecycle command cannot be applied to an existing state.", 409, { command: input.command });
  }
  return { next, eventType, resumePlan };
}

function stateProjection(state, context, steps) {
  return {
    ...state,
    terminal: TERMINAL_STATUSES.has(state.lifecycle_status),
    dispatch_blocked: state.lifecycle_status !== "running",
    resume_plan: buildResumePlan(state, steps, context),
    dispatch_authorized: false,
    secrets_included: false,
  };
}

function verifyWriteReadback(state, event, expectedRevision, eventId, payloadSha256) {
  if (!state || state.state_revision !== expectedRevision || state.last_event_id !== eventId) {
    fail("operation_run_lifecycle_state_readback_mismatch", "Lifecycle state failed same-cycle readback.", 500);
  }
  if (!event || event.event_id !== eventId || event.state_revision !== expectedRevision || event.payload_sha256 !== payloadSha256) {
    fail("operation_run_lifecycle_event_readback_mismatch", "Lifecycle event failed same-cycle readback.", 500);
  }
}

export async function applyOperationRunLifecycleCommand(input, dependencyOverrides = {}) {
  const normalized = normalizeCommandInput(input);
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    await connection.beginTransaction();
    const context = await readRunContext(connection, normalized.run_id, true);
    assertOwnership(context, normalized, { verifyRevisions: true });
    let state = await readState(connection, normalized.run_id, true);
    assertStateAuthority(state, context);
    const existingEvent = state ? await readEventByKey(connection, normalized.run_id, normalized.event_key) : null;
    if (existingEvent) {
      if (existingEvent.payload_sha256 !== normalized.payload_sha256) {
        fail("operation_run_lifecycle_idempotency_conflict", "The lifecycle command ID was reused with a different payload.", 409, {
          event_key: normalized.event_key,
        });
      }
      const steps = await readSteps(connection, normalized.run_id);
      await connection.commit();
      return {
        ok: true,
        report_type: "operation_run_lifecycle_command",
        inserted: false,
        idempotent_replay: true,
        state: stateProjection(state, context, steps),
        event: existingEvent,
        database_writes_performed: false,
        internal_persistence_only: true,
        provider_calls_performed: false,
        external_writes_performed: false,
        runtime_activation_changed: false,
        secrets_included: false,
      };
    }

    const steps = await readSteps(connection, normalized.run_id);
    const eventId = resolved.uuid();
    let eventType;
    let nextState;
    let resumePlan = null;
    let nextRevision;

    if (!state) {
      if (normalized.command !== "initialize" || normalized.expected_state_revision !== 0) {
        fail("operation_run_lifecycle_not_initialized", "The lifecycle must be initialized at expected revision 0.", 409);
      }
      nextRevision = 1;
      eventType = "initialized";
      nextState = {
        lifecycle_id: resolved.uuid(),
        run_id: normalized.run_id,
        state_revision: nextRevision,
        lifecycle_status: initialStatus(context.run_status),
        approval_status: "not_required",
        resume_from_step_key: firstIncompleteStep(steps)?.step_key || null,
        checkpoint_sha256: null,
        revision_bundle_hash: normalized.revision_bundle_hash,
        resource_fingerprint: normalized.resource_fingerprint,
        callback_id: null,
        callback_payload_sha256: null,
        cancellation_requested_at: null,
        cancelled_at: null,
        recovery_classification: null,
        last_event_id: eventId,
      };
      await connection.query(
        `INSERT INTO operation_run_lifecycle_state
          (lifecycle_id,run_id,state_revision,lifecycle_status,approval_status,resume_from_step_key,
           checkpoint_sha256,revision_bundle_hash,resource_fingerprint,callback_id,callback_payload_sha256,
           cancellation_requested_at,cancelled_at,recovery_classification,last_event_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          nextState.lifecycle_id, nextState.run_id, nextState.state_revision, nextState.lifecycle_status,
          nextState.approval_status, nextState.resume_from_step_key, nextState.checkpoint_sha256,
          nextState.revision_bundle_hash, nextState.resource_fingerprint, nextState.callback_id,
          nextState.callback_payload_sha256, nextState.cancellation_requested_at, nextState.cancelled_at,
          nextState.recovery_classification, nextState.last_event_id,
        ],
      );
    } else {
      if (normalized.command === "initialize") fail("operation_run_lifecycle_already_initialized", "The lifecycle is already initialized.", 409);
      if (state.state_revision !== normalized.expected_state_revision) {
        fail("operation_run_lifecycle_revision_conflict", "The lifecycle state revision changed.", 409, {
          expected_state_revision: normalized.expected_state_revision,
          current_state_revision: state.state_revision,
        });
      }
      const transition = deriveTransition({ input: normalized, state, context, steps, now: resolved.now() });
      eventType = transition.eventType;
      resumePlan = transition.resumePlan;
      nextRevision = state.state_revision + 1;
      nextState = { ...transition.next, state_revision: nextRevision, last_event_id: eventId };
      const [updateResult] = await connection.query(
        `UPDATE operation_run_lifecycle_state
            SET state_revision=?,lifecycle_status=?,approval_status=?,resume_from_step_key=?,checkpoint_sha256=?,
                callback_id=?,callback_payload_sha256=?,cancellation_requested_at=?,cancelled_at=?,
                recovery_classification=?,last_event_id=?,updated_at=CURRENT_TIMESTAMP(6)
          WHERE run_id=? AND state_revision=?`,
        [
          nextState.state_revision, nextState.lifecycle_status, nextState.approval_status,
          nextState.resume_from_step_key, nextState.checkpoint_sha256, nextState.callback_id,
          nextState.callback_payload_sha256, nextState.cancellation_requested_at, nextState.cancelled_at,
          nextState.recovery_classification, nextState.last_event_id, normalized.run_id, state.state_revision,
        ],
      );
      if (Number(updateResult?.affectedRows || 0) !== 1) {
        fail("operation_run_lifecycle_revision_conflict", "The lifecycle state changed during the command.", 409);
      }
    }

    await connection.query(
      `INSERT INTO operation_run_lifecycle_events
        (event_id,run_id,state_revision,event_type,event_key,actor_key,payload_sha256,payload_json)
       VALUES (?,?,?,?,?,?,?,?)`,
      [eventId, normalized.run_id, nextRevision, eventType, normalized.event_key, normalized.actor_key, normalized.payload_sha256, normalized.payload_json],
    );
    state = await readState(connection, normalized.run_id, false);
    const event = await readEventById(connection, eventId);
    verifyWriteReadback(state, event, nextRevision, eventId, normalized.payload_sha256);
    await connection.commit();
    return {
      ok: true,
      report_type: "operation_run_lifecycle_command",
      inserted: true,
      idempotent_replay: false,
      state: { ...stateProjection(state, context, steps), ...(resumePlan ? { resume_plan: resumePlan } : {}) },
      event,
      database_writes_performed: true,
      internal_persistence_only: true,
      provider_calls_performed: false,
      external_writes_performed: false,
      runtime_activation_changed: false,
      secrets_included: false,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function getOperationRunLifecycleStatus(input, dependencyOverrides = {}) {
  const normalized = normalizeStatusInput(input);
  const resolved = dependencies(dependencyOverrides);
  const connection = await resolved.pool.getConnection();
  try {
    const context = await readRunContext(connection, normalized.run_id, false);
    assertOwnership(context, normalized);
    const state = await readState(connection, normalized.run_id, false);
    assertStateAuthority(state, context);
    if (!state) fail("operation_run_lifecycle_not_initialized", "No durable lifecycle state exists for the run.", 404);
    const steps = await readSteps(connection, normalized.run_id);
    const [rows] = await connection.query(
      `SELECT id,event_id,run_id,state_revision,event_type,event_key,actor_key,payload_sha256,payload_json,created_at
         FROM operation_run_lifecycle_events
        WHERE run_id=? AND id>?
        ORDER BY id
        LIMIT ?`,
      [normalized.run_id, normalized.cursor, normalized.limit + 1],
    );
    const hasMore = (rows || []).length > normalized.limit;
    const selected = (rows || []).slice(0, normalized.limit).map((row) => ({
      ...row,
      id: Number(row.id),
      state_revision: Number(row.state_revision),
      payload: parseJson(row.payload_json, "payload_json"),
    }));
    return {
      ok: true,
      report_type: "operation_run_lifecycle_status",
      run: {
        run_id: context.run_id,
        operation_key: context.operation_key,
        run_status: context.run_status,
        stage: context.stage,
        revision_bundle_hash: context.revision_bundle_hash,
        resource_fingerprint: context.resource_fingerprint,
        secrets_included: false,
      },
      state: stateProjection(state, context, steps),
      events: selected,
      page: {
        cursor: normalized.cursor,
        next_cursor: hasMore ? selected.at(-1)?.id || null : null,
        has_more: hasMore,
        limit: normalized.limit,
      },
      read_only: true,
      database_writes_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      runtime_activation_changed: false,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}

export function createOperationRunLifecycleService(dependencyOverrides = {}) {
  return Object.freeze({
    apply: (input) => applyOperationRunLifecycleCommand(input, dependencyOverrides),
    status: (input) => getOperationRunLifecycleStatus(input, dependencyOverrides),
  });
}

export const _testingOperationRunLifecycle = Object.freeze({
  normalizeCommandInput,
  initialStatus,
  recoveryClassification,
  deriveTransition,
  buildResumePlan,
});
