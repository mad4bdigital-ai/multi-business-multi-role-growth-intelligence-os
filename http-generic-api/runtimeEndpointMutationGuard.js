const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MUTATION_RISK_PATTERN = /(mutation|write|delete|infrastructure|state[_ -]?changing)/i;

function mutationGuardError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function requiredString(value, field, max = 191) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > max) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_invalid_input",
      `${field} is required and must contain at most ${max} characters.`,
      400,
      { field }
    );
  }
  return normalized;
}

function runtimeResponseBody(response = {}) {
  if (response?.body && typeof response.body === "object") return response.body;
  if (response?.result?.body && typeof response.result.body === "object") return response.result.body;
  return response && typeof response === "object" ? response : {};
}

function parseExpiryMillis(value) {
  if (value instanceof Date) return value.getTime();
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const timezoneAware = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return Date.parse(timezoneAware ? normalized : `${normalized}Z`);
}

function isMutationPreview(preview = {}) {
  const method = String(preview.method || "").trim().toUpperCase();
  const riskClass = String(preview.risk?.risk_class || "").trim();
  return !READ_ONLY_METHODS.has(method) || MUTATION_RISK_PATTERN.test(riskClass);
}

function validatePreviewResponse(previewResponse = {}, payload = {}) {
  const preview = runtimeResponseBody(previewResponse);
  const status = Number(previewResponse?.status || preview?.status || 0);
  if (status >= 400 || preview.ok !== true) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_preview_failed",
      "Runtime endpoint execution is blocked because the same-cycle preview failed.",
      status >= 400 ? status : 409,
      {
        parent_action_key: payload.parent_action_key || null,
        endpoint_key: payload.endpoint_key || null,
        preview_status: status || null,
        preview_error: preview?.error?.code || null,
      }
    );
  }
  if (preview.dry_run !== true || preview.outbound_request_executed !== false) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_preview_not_passive",
      "Runtime endpoint preview must prove that no outbound provider request was executed.",
      409,
      { endpoint_key: payload.endpoint_key || null }
    );
  }
  if (preview.runtime_readiness?.can_execute !== true) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_not_ready",
      "Runtime endpoint authority is not ready for execution.",
      409,
      {
        endpoint_key: payload.endpoint_key || null,
        readiness_status: preview.runtime_readiness?.status || null,
      }
    );
  }
  const method = String(preview.method || "").trim().toUpperCase();
  if (!method) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_preview_method_missing",
      "Runtime endpoint preview did not resolve an authoritative HTTP method.",
      409,
      { endpoint_key: payload.endpoint_key || null }
    );
  }
  return { preview, method, mutation: isMutationPreview(preview) };
}

async function defaultEnvelopeLoader(envelopeId) {
  const { getPool } = await import("./db.js");
  const [rows] = await getPool().query(
    `SELECT envelope_id,app_key,capability_key,operation_intent,envelope_status,
            dispatch_allowed,apply_allowed,secrets_included,execution_status,expires_at
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id=?
      LIMIT 1`,
    [envelopeId]
  );
  return rows?.[0] || null;
}

async function loadCapabilityEnvelope(envelopeId, deps = {}) {
  if (typeof deps.loadEnvelope === "function") return await deps.loadEnvelope(envelopeId);
  return await defaultEnvelopeLoader(envelopeId);
}

function validateEnvelope(envelope = null, approval = {}, deps = {}) {
  if (!envelope) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_envelope_not_found",
      "A valid capability resolution envelope is required before mutation dispatch.",
      403
    );
  }
  if (envelope.envelope_status !== "ready_for_dispatch" || Number(envelope.dispatch_allowed) !== 1) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_envelope_not_ready",
      "Capability resolution envelope is not ready for dispatch.",
      403,
      {
        envelope_id: envelope.envelope_id || null,
        envelope_status: envelope.envelope_status || null,
        dispatch_allowed: Boolean(envelope.dispatch_allowed),
      }
    );
  }
  if (Number(envelope.secrets_included) === 1 || envelope.secrets_included === true) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_envelope_secret_violation",
      "Capability resolution envelope contains an invalid secret marker.",
      403,
      { envelope_id: envelope.envelope_id || null }
    );
  }
  if (["failed", "cancelled"].includes(String(envelope.execution_status || "").toLowerCase())) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_envelope_terminal",
      "Capability resolution envelope is in a terminal execution state.",
      409,
      { envelope_id: envelope.envelope_id || null, execution_status: envelope.execution_status || null }
    );
  }
  const nowMillis = typeof deps.now === "function" ? Number(deps.now()) : Date.now();
  const expiryMillis = parseExpiryMillis(envelope.expires_at);
  if (!Number.isFinite(expiryMillis) || expiryMillis <= nowMillis) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_envelope_expired",
      "Capability resolution envelope has expired.",
      403,
      { envelope_id: envelope.envelope_id || null, expires_at: envelope.expires_at || null }
    );
  }
  for (const [approvalField, envelopeField] of [
    ["operation_intent", "operation_intent"],
    ["capability_key", "capability_key"],
    ["app_key", "app_key"],
  ]) {
    const expected = String(approval?.[approvalField] || "").trim();
    if (expected && expected !== String(envelope?.[envelopeField] || "").trim()) {
      throw mutationGuardError(
        "runtime_endpoint_mutation_envelope_scope_mismatch",
        "Capability resolution envelope does not match the approved mutation scope.",
        403,
        {
          envelope_id: envelope.envelope_id || null,
          field: approvalField,
          expected,
          actual: envelope?.[envelopeField] || null,
        }
      );
    }
  }
}

export function runtimeEndpointMutationConfirmation(endpointKey = "") {
  const normalized = requiredString(endpointKey, "endpoint_key")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `EXECUTE_RUNTIME_ENDPOINT_${normalized}`;
}

function validateMutationApproval(payload = {}) {
  const approval = payload.mutation_approval && typeof payload.mutation_approval === "object"
    ? payload.mutation_approval
    : {};
  const endpointKey = requiredString(payload.endpoint_key, "endpoint_key");
  const expectedConfirmation = runtimeEndpointMutationConfirmation(endpointKey);
  if (approval.approved !== true) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_approval_required",
      "Explicit mutation approval is required before live endpoint execution.",
      403,
      { endpoint_key: endpointKey }
    );
  }
  const envelopeId = requiredString(approval.capability_envelope_id, "mutation_approval.capability_envelope_id", 64);
  if (String(approval.typed_confirmation || "") !== expectedConfirmation) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_confirmation_required",
      `Mutation execution requires typed confirmation ${expectedConfirmation}.`,
      400,
      { endpoint_key: endpointKey, expected_confirmation: expectedConfirmation }
    );
  }
  for (const flag of [
    "dry_run_preflight_completed",
    "approved_preflight_dry_run_validated",
    "live_execution_approved",
  ]) {
    if (payload[flag] !== true) {
      throw mutationGuardError(
        "runtime_endpoint_mutation_preflight_evidence_required",
        `Mutation execution requires ${flag}=true.`,
        403,
        { endpoint_key: endpointKey, missing_flag: flag }
      );
    }
  }
  const readback = payload.readback && typeof payload.readback === "object" ? payload.readback : {};
  const readbackEvidenceKeys = Object.keys(readback).filter((key) => key !== "required");
  if (readback.required !== true || readbackEvidenceKeys.length === 0) {
    throw mutationGuardError(
      "runtime_endpoint_mutation_readback_contract_required",
      "Mutation execution requires a concrete same-cycle readback contract.",
      400,
      { endpoint_key: endpointKey }
    );
  }
  return { approval, envelopeId };
}

export async function dispatchRuntimeEndpointWithMutationGuard(payload = {}, deps = {}) {
  if (typeof deps.dispatch !== "function") {
    throw mutationGuardError(
      "runtime_endpoint_mutation_dispatch_missing",
      "Runtime endpoint mutation guard requires a governed dispatch function.",
      503
    );
  }
  requiredString(payload.parent_action_key, "parent_action_key");
  requiredString(payload.endpoint_key, "endpoint_key");

  const previewPayload = {
    ...payload,
    dry_run: true,
    preflight_only: true,
    live_execution_approved: false,
    timeout_seconds: Math.min(Number(payload.timeout_seconds) || 10, 10),
  };
  const previewResponse = await deps.dispatch(previewPayload);
  const previewEvidence = validatePreviewResponse(previewResponse, payload);

  if (payload.dry_run === true || payload.preflight_only === true) {
    return previewResponse;
  }

  const livePayload = { ...payload, dry_run: false, preflight_only: false };
  if (!previewEvidence.mutation) {
    return await deps.dispatch(livePayload);
  }

  const approvalEvidence = validateMutationApproval(payload);
  const envelope = await loadCapabilityEnvelope(approvalEvidence.envelopeId, deps);
  validateEnvelope(envelope, approvalEvidence.approval, deps);

  return await deps.dispatch(livePayload);
}
