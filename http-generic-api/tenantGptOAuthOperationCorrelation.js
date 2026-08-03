import { createHash, randomUUID } from "node:crypto";
import { normalizeTenantGptOAuthResource } from "./tenantGptOAuthResourceProfile.js";

export const TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION = 1;
export const TENANT_GPT_OAUTH_CORRELATION_STAGES = Object.freeze([
  "oauth_authorize",
  "identity_verify",
  "oauth_code_issue",
  "oauth_token_exchange",
  "gateway_verify",
]);

const STAGE_INDEX = new Map(
  TENANT_GPT_OAUTH_CORRELATION_STAGES.map((stage, index) => [stage, index]),
);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const FORBIDDEN_KEY_PATTERN = /(^|_)(authorization|cookie|credential|password|secret|token|raw|email|display_name)(_|$)/i;
const ALLOWED_KEYS = new Set([
  "schema_version",
  "operation_id",
  "correlation_id",
  "parent_operation_id",
  "stage",
  "protected_resource",
  "client_id_sha256",
  "subject_user_sha256",
  "subject_tenant_sha256",
  "oauth_code_jti_sha256",
  "access_token_jti_sha256",
  "stage_request_id_sha256",
  "previous_envelope_sha256",
  "envelope_sha256",
  "issued_at",
  "updated_at",
  "secrets_included",
]);

function failure(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function text(value, field, max, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    if (required) failure(`oauth_correlation_${field}_required`, `${field} is required.`);
    return null;
  }
  if (normalized.length > max) {
    failure(`oauth_correlation_${field}_too_long`, `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function uuid(value, field, { required = true } = {}) {
  const normalized = text(value, field, 36, { required });
  if (normalized && !UUID_PATTERN.test(normalized)) {
    failure(`oauth_correlation_${field}_invalid`, `${field} must be a UUID.`);
  }
  return normalized?.toLowerCase() || null;
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function hashReference(value, field, { required = false } = {}) {
  const normalized = text(value, field, 1024, { required });
  return normalized ? sha256(normalized) : null;
}

function hashValue(value, field, { required = false } = {}) {
  const normalized = text(value, field, 64, { required });
  if (normalized && !SHA256_PATTERN.test(normalized)) {
    failure(`oauth_correlation_${field}_invalid`, `${field} must be a SHA-256 hex digest.`);
  }
  return normalized?.toLowerCase() || null;
}

function stage(value) {
  const normalized = text(value, "stage", 64, { required: true });
  if (!STAGE_INDEX.has(normalized)) {
    failure("oauth_correlation_stage_invalid", "stage is not part of the governed OAuth correlation lifecycle.");
  }
  return normalized;
}

function timestamp(value, field) {
  const normalized = text(value, field, 64, { required: true });
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) {
    failure(`oauth_correlation_${field}_invalid`, `${field} must be an ISO-8601 timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function stableObject(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(stableObject);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableObject(value[key])]),
    );
  }
  return value;
}

function envelopeDigest(input) {
  const material = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "envelope_sha256"),
  );
  return sha256(JSON.stringify(stableObject(material)));
}

function assertNoForbiddenShape(value, path = "correlation") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failure("oauth_correlation_shape_invalid", `${path} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      failure("oauth_correlation_field_not_allowed", `${path}.${key} is not an allowed correlation field.`);
    }
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      failure("oauth_correlation_sensitive_field_forbidden", `${path}.${key} is forbidden.`);
    }
  }
}

function normalizeEnvelope(input = {}, { verifyDigest = true } = {}) {
  assertNoForbiddenShape(input);
  if (Number(input.schema_version) !== TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION) {
    failure("oauth_correlation_schema_version_invalid", "Unsupported OAuth correlation schema version.");
  }
  const protectedResource = normalizeTenantGptOAuthResource(input.protected_resource);
  if (!protectedResource) {
    failure("oauth_correlation_resource_invalid", "protected_resource must be a registered Tenant GPT resource.");
  }
  const normalized = {
    schema_version: TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION,
    operation_id: uuid(input.operation_id, "operation_id"),
    correlation_id: uuid(input.correlation_id, "correlation_id"),
    parent_operation_id: uuid(input.parent_operation_id, "parent_operation_id", { required: false }),
    stage: stage(input.stage),
    protected_resource: protectedResource,
    client_id_sha256: hashValue(input.client_id_sha256, "client_id_sha256", { required: true }),
    subject_user_sha256: hashValue(input.subject_user_sha256, "subject_user_sha256"),
    subject_tenant_sha256: hashValue(input.subject_tenant_sha256, "subject_tenant_sha256"),
    oauth_code_jti_sha256: hashValue(input.oauth_code_jti_sha256, "oauth_code_jti_sha256"),
    access_token_jti_sha256: hashValue(input.access_token_jti_sha256, "access_token_jti_sha256"),
    stage_request_id_sha256: hashValue(input.stage_request_id_sha256, "stage_request_id_sha256"),
    previous_envelope_sha256: hashValue(input.previous_envelope_sha256, "previous_envelope_sha256"),
    envelope_sha256: hashValue(input.envelope_sha256, "envelope_sha256", { required: true }),
    issued_at: timestamp(input.issued_at, "issued_at"),
    updated_at: timestamp(input.updated_at, "updated_at"),
    secrets_included: input.secrets_included === false ? false : failure(
      "oauth_correlation_secret_declaration_invalid",
      "secrets_included must be false.",
    ),
  };
  if (Date.parse(normalized.updated_at) < Date.parse(normalized.issued_at)) {
    failure("oauth_correlation_timestamp_order_invalid", "updated_at cannot precede issued_at.");
  }
  if (verifyDigest && envelopeDigest(normalized) !== normalized.envelope_sha256) {
    failure("oauth_correlation_digest_mismatch", "OAuth correlation envelope digest does not match its content.", 409);
  }
  return Object.freeze(normalized);
}

export function createTenantGptOAuthOperationCorrelation(input = {}, {
  idFactory = randomUUID,
  nowMs = Date.now(),
} = {}) {
  if (typeof idFactory !== "function") {
    failure("oauth_correlation_id_factory_invalid", "idFactory must be a function.", 500);
  }
  const protectedResource = normalizeTenantGptOAuthResource(input.protected_resource);
  if (!protectedResource) {
    failure("oauth_correlation_resource_invalid", "protected_resource must be a registered Tenant GPT resource.");
  }
  const issuedAt = new Date(nowMs).toISOString();
  const envelope = {
    schema_version: TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION,
    operation_id: uuid(input.operation_id || idFactory(), "operation_id"),
    correlation_id: uuid(input.correlation_id || idFactory(), "correlation_id"),
    parent_operation_id: uuid(input.parent_operation_id, "parent_operation_id", { required: false }),
    stage: stage(input.stage || "oauth_authorize"),
    protected_resource: protectedResource,
    client_id_sha256: hashReference(input.client_id, "client_id", { required: true }),
    subject_user_sha256: null,
    subject_tenant_sha256: null,
    oauth_code_jti_sha256: null,
    access_token_jti_sha256: null,
    stage_request_id_sha256: hashReference(input.request_id, "request_id"),
    previous_envelope_sha256: null,
    envelope_sha256: null,
    issued_at: issuedAt,
    updated_at: issuedAt,
    secrets_included: false,
  };
  envelope.envelope_sha256 = envelopeDigest(envelope);
  return normalizeEnvelope(envelope);
}

export function advanceTenantGptOAuthOperationCorrelation(current, input = {}, {
  nowMs = Date.now(),
} = {}) {
  const previous = normalizeEnvelope(current);
  const nextStage = stage(input.stage);
  const currentIndex = STAGE_INDEX.get(previous.stage);
  const nextIndex = STAGE_INDEX.get(nextStage);
  if (nextIndex !== currentIndex + 1) {
    failure(
      "oauth_correlation_stage_transition_invalid",
      `OAuth correlation must advance exactly one stage from ${previous.stage}.`,
      409,
    );
  }
  const updatedAt = new Date(nowMs).toISOString();
  if (Date.parse(updatedAt) < Date.parse(previous.updated_at)) {
    failure("oauth_correlation_clock_regression", "Correlation time cannot move backwards.", 409);
  }
  const envelope = {
    ...previous,
    stage: nextStage,
    subject_user_sha256: input.user_id
      ? hashReference(input.user_id, "user_id", { required: true })
      : previous.subject_user_sha256,
    subject_tenant_sha256: input.tenant_id
      ? hashReference(input.tenant_id, "tenant_id", { required: true })
      : previous.subject_tenant_sha256,
    oauth_code_jti_sha256: input.oauth_code_jti
      ? hashReference(input.oauth_code_jti, "oauth_code_jti", { required: true })
      : previous.oauth_code_jti_sha256,
    access_token_jti_sha256: input.access_token_jti
      ? hashReference(input.access_token_jti, "access_token_jti", { required: true })
      : previous.access_token_jti_sha256,
    stage_request_id_sha256: input.request_id
      ? hashReference(input.request_id, "request_id", { required: true })
      : null,
    previous_envelope_sha256: previous.envelope_sha256,
    envelope_sha256: null,
    updated_at: updatedAt,
    secrets_included: false,
  };
  envelope.envelope_sha256 = envelopeDigest(envelope);
  return normalizeEnvelope(envelope);
}

export function verifyTenantGptOAuthOperationCorrelation(value, {
  expected_resource = null,
  expected_stage = null,
} = {}) {
  const envelope = normalizeEnvelope(value);
  if (expected_resource) {
    const resource = normalizeTenantGptOAuthResource(expected_resource);
    if (!resource || envelope.protected_resource !== resource) {
      failure("oauth_correlation_resource_mismatch", "OAuth correlation resource does not match.", 409);
    }
  }
  if (expected_stage && envelope.stage !== stage(expected_stage)) {
    failure("oauth_correlation_stage_mismatch", "OAuth correlation stage does not match.", 409);
  }
  return envelope;
}

export function tenantGptOAuthOperationCorrelationClaim(value) {
  return { ...verifyTenantGptOAuthOperationCorrelation(value) };
}

export function safeTenantGptOAuthOperationCorrelationEvidence(value) {
  const envelope = verifyTenantGptOAuthOperationCorrelation(value);
  return Object.freeze({
    schema_version: envelope.schema_version,
    operation_id: envelope.operation_id,
    correlation_id: envelope.correlation_id,
    parent_operation_id: envelope.parent_operation_id,
    stage: envelope.stage,
    protected_resource: envelope.protected_resource,
    client_id_sha256_prefix: envelope.client_id_sha256.slice(0, 12),
    subject_bound: Boolean(envelope.subject_user_sha256 && envelope.subject_tenant_sha256),
    oauth_code_bound: Boolean(envelope.oauth_code_jti_sha256),
    access_token_bound: Boolean(envelope.access_token_jti_sha256),
    envelope_sha256: envelope.envelope_sha256,
    issued_at: envelope.issued_at,
    updated_at: envelope.updated_at,
    secrets_included: false,
  });
}
