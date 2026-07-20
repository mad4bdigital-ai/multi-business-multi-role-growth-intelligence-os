import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 900;
const MAX_TTL_SECONDS = 3600;
const EXECUTABLE_STATUSES = new Set(["shadow_allow", "approval_required_shadow_only"]);
const TERMINAL_STATUSES = new Set(["executed", "cancelled", "expired", "superseded"]);

function safeText(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || Number(value || 0) === 1;
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function executionEnvelopeHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function toDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function failure(status, details = {}) {
  return { ok: false, status, ...details, secrets_included: false };
}

function ttlSeconds(value) {
  const parsed = Number(value || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(parsed), MAX_TTL_SECONDS);
}

function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function buildManifest(envelope) {
  return {
    envelope_version: envelope.envelope_version,
    envelope_id: envelope.envelope_id,
    capability_envelope_id: envelope.capability_envelope_id,
    boundary_key: envelope.boundary_key,
    enforcement_status: envelope.enforcement_status,
    issued_at: envelope.issued_at,
    expires_at: envelope.expires_at,
    revision_vector_hash: envelope.revision_vector_hash,
    policy_hash: envelope.policy_hash,
    obligations_hash: envelope.obligations_hash,
    mismatch_hash: envelope.mismatch_hash,
    nonce_hash: envelope.nonce_hash,
    idempotency_key_hash: envelope.idempotency_key_hash,
    replay_key: envelope.replay_key,
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
}

export function buildPlatformExecutionEnvelope({ enforcement = {}, capability_envelope_id = "", idempotency_key = "", nonce = "", issued_at = new Date(), ttl_seconds = DEFAULT_TTL_SECONDS } = {}) {
  if (enforcement.ok !== true) return failure("execution_envelope_enforcement_not_ok");
  if (!EXECUTABLE_STATUSES.has(safeText(enforcement.enforcement_status, 128))) {
    return failure("execution_envelope_enforcement_status_not_executable", { enforcement_status: enforcement.enforcement_status || null });
  }
  if (bool(enforcement.provider_apply_allowed) || bool(enforcement.mutations_executed) || bool(enforcement.enforcement_cutover)) return failure("execution_envelope_provider_apply_not_allowed");

  const issuedAt = toDate(issued_at, new Date());
  const ttl = ttlSeconds(ttl_seconds);
  const boundaryKey = safeText(enforcement.boundary?.boundary_key || enforcement.enforcement_policy?.boundary_key || enforcement.capability_key, 191);
  const capabilityEnvelopeId = safeText(capability_envelope_id || enforcement.capability_envelope_id, 64);
  const revisionVectorHash = executionEnvelopeHash(enforcement.revision_vector || {});
  const policyHash = executionEnvelopeHash(enforcement.enforcement_policy || enforcement.policy || {});
  const obligationsHash = executionEnvelopeHash(enforcement.obligations || []);
  const mismatchHash = executionEnvelopeHash(enforcement.mismatch || {});
  const nonceHash = hashText(nonce || crypto.randomUUID());
  const idempotencyHash = hashText(idempotency_key || `${boundaryKey}:${issuedAt.toISOString()}`);
  const replayKey = hashText([capabilityEnvelopeId, boundaryKey, nonceHash, idempotencyHash].join(":"));
  const envelope = {
    ok: true,
    envelope_version: "platform_execution_envelope_v1",
    envelope_id: crypto.randomUUID(),
    capability_envelope_id: capabilityEnvelopeId || null,
    boundary_key: boundaryKey || null,
    enforcement_status: enforcement.enforcement_status,
    issued_at: issuedAt.toISOString(),
    expires_at: addSeconds(issuedAt, ttl).toISOString(),
    ttl_seconds: ttl,
    execution_status: "not_executed",
    single_use: true,
    revision_vector_hash: revisionVectorHash,
    policy_hash: policyHash,
    obligations_hash: obligationsHash,
    mismatch_hash: mismatchHash,
    nonce_hash: nonceHash,
    idempotency_key_hash: idempotencyHash,
    replay_key: replayKey,
    provider_apply_allowed: false,
    mutation_allowed: false,
    enforcement_cutover: false,
    secrets_included: false,
  };
  envelope.manifest_hash = executionEnvelopeHash(buildManifest(envelope));
  return envelope;
}

export function validatePlatformExecutionEnvelope(envelope = {}, { enforcement = {}, now = new Date(), seen_replay_keys = [], consumed_replay_keys = [] } = {}) {
  if (envelope?.ok !== true || envelope.envelope_version !== "platform_execution_envelope_v1") return failure("execution_envelope_invalid");
  if (bool(envelope.secrets_included)) return failure("execution_envelope_secret_boundary_failed");
  if (TERMINAL_STATUSES.has(safeText(envelope.execution_status, 64))) return failure("execution_envelope_already_terminal", { execution_status: envelope.execution_status });
  if (toDate(envelope.expires_at).getTime() <= toDate(now).getTime()) return failure("execution_envelope_expired", { expires_at: envelope.expires_at });
  const replayKey = safeText(envelope.replay_key, 128);
  const seen = new Set([...(seen_replay_keys || []), ...(consumed_replay_keys || [])].map((item) => safeText(item, 128)).filter(Boolean));
  if (replayKey && seen.has(replayKey)) return failure("execution_envelope_replay_detected", { replay_key: replayKey });

  if (enforcement?.ok === true) {
    if (executionEnvelopeHash(enforcement.revision_vector || {}) !== envelope.revision_vector_hash) return failure("execution_envelope_revision_mismatch");
    if (executionEnvelopeHash(enforcement.enforcement_policy || enforcement.policy || {}) !== envelope.policy_hash) return failure("execution_envelope_policy_mismatch");
    if (executionEnvelopeHash(enforcement.obligations || []) !== envelope.obligations_hash) return failure("execution_envelope_obligations_mismatch");
    if (executionEnvelopeHash(enforcement.mismatch || {}) !== envelope.mismatch_hash) return failure("execution_envelope_mismatch_taxonomy_changed");
  }

  if (executionEnvelopeHash(buildManifest(envelope)) !== envelope.manifest_hash) return failure("execution_envelope_manifest_hash_mismatch");
  return { ok: true, status: "execution_envelope_ready", envelope_id: envelope.envelope_id, replay_key: envelope.replay_key, expires_at: envelope.expires_at, provider_apply_allowed: false, mutation_allowed: false, enforcement_cutover: false, secrets_included: false };
}

export function transitionPlatformExecutionEnvelope(envelope = {}, action = "") {
  const normalized = safeText(action, 32).toLowerCase();
  if (!envelope || envelope.envelope_version !== "platform_execution_envelope_v1") return failure("execution_envelope_invalid");
  if (!new Set(["execute", "cancel", "expire"]).has(normalized)) return failure("execution_envelope_lifecycle_action_invalid", { action: normalized || null });
  if (TERMINAL_STATUSES.has(safeText(envelope.execution_status, 64))) return failure("execution_envelope_already_terminal", { execution_status: envelope.execution_status });
  const next = { ...envelope };
  if (normalized === "execute") next.execution_status = "executed";
  if (normalized === "cancel") next.execution_status = "cancelled";
  if (normalized === "expire") next.execution_status = "expired";
  next.provider_apply_allowed = false;
  next.mutation_allowed = false;
  next.enforcement_cutover = false;
  next.secrets_included = false;
  next.manifest_hash = executionEnvelopeHash(buildManifest(next));
  return { ok: true, status: `execution_envelope_${normalized}d`, envelope: next, secrets_included: false };
}
