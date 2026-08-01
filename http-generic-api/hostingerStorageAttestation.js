import { createHash } from 'node:crypto';
import { assertHostingerStorageSecretFree } from './hostingerStorageAttestationSecretFree.js';

export const HOSTINGER_STORAGE_ATTESTATION_VERSION = 'spec014-hostinger-storage-attestation-v1';

const SUBJECT_TYPE = 'application/vnd.in-toto+json';
const PREDICATE_TYPE = 'https://mad4b.com/attestations/hostinger-storage-plan/v1';
const SUBJECT_KEY = 'hostinger_storage_plan_attestation_v1';
const SHA256_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,510}$/;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function assertSecretFree(value, at = 'value', { allow_authorization_envelope = true } = {}) {
  return assertHostingerStorageSecretFree(value, {
    at,
    allow_authorization_envelope,
    on_violation: ({ reason, path, key }) => fail(
      400,
      'STORAGE_ATTESTATION_SECRET_FIELD_REJECTED',
      'Attestation inputs must not contain sensitive fields.',
      { reason, path, key: key || null },
    ),
  });
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function safeId(value, field) {
  const result = text(value, 256);
  if (!SAFE_ID_RE.test(result)) throw fail(400, 'STORAGE_ATTESTATION_IDENTIFIER_INVALID', 'A safe bounded identifier is required.', { field });
  return result;
}

function safeRef(value, field) {
  const result = text(value, 512);
  if (!SAFE_REF_RE.test(result) || result.startsWith('/') || result.includes('..') || /[\0\r\n]/.test(result)) {
    throw fail(400, 'STORAGE_ATTESTATION_REFERENCE_INVALID', 'A bounded opaque reference is required.', { field });
  }
  return result;
}

function hash(value, field) {
  const result = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(result)) throw fail(400, 'STORAGE_ATTESTATION_HASH_INVALID', 'A SHA-256 binding is required.', { field });
  return result;
}

function iso(value, field) {
  const result = text(value, 64);
  if (!result || Number.isNaN(Date.parse(result))) throw fail(400, 'STORAGE_ATTESTATION_TIME_INVALID', 'A valid ISO timestamp is required.', { field });
  return new Date(result).toISOString();
}

function selectedTools(resolution = {}) {
  const result = {};
  for (const row of resolution.selections || []) {
    if (!row?.capability || !row?.selected_tool_id) continue;
    result[safeId(row.capability, `selection.${row.capability}.capability`)] = {
      tool_id: safeId(row.selected_tool_id, `selection.${row.capability}.tool_id`),
      version: text(row.selected?.observed_version, 64) || null,
      binary_sha256: row.selected?.binary_sha256 ? hash(row.selected.binary_sha256, `selection.${row.capability}.binary_sha256`) : null,
    };
  }
  return result;
}

function normalizeSelectedTools(value = {}) {
  const result = {};
  for (const [capability, tool] of Object.entries(value || {})) {
    const key = safeId(capability, `toolchain.selected_tools.${capability}`);
    result[key] = {
      tool_id: safeId(tool?.tool_id, `toolchain.selected_tools.${capability}.tool_id`),
      version: tool?.version ? safeId(tool.version, `toolchain.selected_tools.${capability}.version`) : null,
      binary_sha256: tool?.binary_sha256 ? hash(tool.binary_sha256, `toolchain.selected_tools.${capability}.binary_sha256`) : null,
    };
  }
  return result;
}

function normalizeToolchain(value = {}) {
  const selected = normalizeSelectedTools(value.selected_tools || {});
  return {
    resolution_fingerprint: hash(value.resolution_fingerprint, 'toolchain.resolution_fingerprint'),
    policy_fingerprint: hash(value.policy_fingerprint, 'toolchain.policy_fingerprint'),
    provenance_digest: hash(value.provenance_digest, 'toolchain.provenance_digest'),
    selected_tools: selected,
    selected_tools_digest: digest(selected),
  };
}

function normalizePlan(plan = {}) {
  return {
    plan_id: safeId(plan.plan_id, 'plan_id'),
    operation_id: safeId(plan.operation_id, 'operation_id'),
    target_id: safeId(plan.target_id, 'target_id'),
    plan_hash: hash(plan.plan_hash, 'plan_hash'),
    candidate_set_hash: hash(plan.candidate_set_hash, 'candidate_set_hash'),
    authority_context_hash: hash(plan.authority_context_hash, 'plan.authority_context_hash'),
    ownership_revision: safeId(plan.ownership_revision, 'ownership_revision'),
    policy_revision: safeId(plan.policy_revision, 'policy_revision'),
  };
}

function normalizeAuthorization(authorization = {}, plan) {
  const normalized = {
    authority_context_hash: hash(authorization.authority_context_hash, 'authorization.authority_context_hash'),
    approval_set_hash: hash(authorization.approval_set_hash, 'approval_set_hash'),
    capability_envelope_id: safeId(authorization.capability_envelope_id, 'capability_envelope_id'),
    execution_lease_id: safeId(authorization.execution_lease_id, 'execution_lease_id'),
  };
  if (normalized.authority_context_hash !== plan.authority_context_hash) {
    throw fail(409, 'STORAGE_ATTESTATION_AUTHORITY_CONTEXT_MISMATCH', 'Authorization authority context does not match the immutable plan.', {
      plan_id: plan.plan_id,
    });
  }
  return normalized;
}

function normalizeRecovery(recoveryProof, plan) {
  if (recoveryProof?.required !== true) {
    return {
      required: false,
      ready: true,
      proof_digest: recoveryProof?.proof_digest ? hash(recoveryProof.proof_digest, 'recovery_proof_digest') : null,
      requirement_binding_digest: null,
    };
  }
  if (recoveryProof.ready !== true) {
    throw fail(409, 'STORAGE_RECOVERY_CHECKPOINT_REQUIRED', 'Required recovery proof is not ready.');
  }
  const proof = recoveryProof.proof || {};
  const normalized = {
    required: true,
    ready: true,
    proof_digest: hash(recoveryProof.proof_digest, 'recovery_proof_digest'),
    requirement_binding_digest: hash(proof.requirement_binding_digest, 'recovery.requirement_binding_digest'),
    snapshot_id: safeId(proof.snapshot_id, 'recovery_snapshot_id'),
    operation_id: safeId(proof.operation_id, 'recovery.operation_id'),
    plan_id: safeId(proof.plan_id, 'recovery.plan_id'),
    target_id: safeId(proof.target_id, 'recovery.target_id'),
    plan_hash: hash(proof.plan_hash, 'recovery.plan_hash'),
    candidate_set_hash: hash(proof.candidate_set_hash, 'recovery.candidate_set_hash'),
  };
  const mismatches = [];
  if (normalized.operation_id !== plan.operation_id) mismatches.push('operation_id');
  if (normalized.plan_id !== plan.plan_id) mismatches.push('plan_id');
  if (normalized.target_id !== plan.target_id) mismatches.push('target_id');
  if (normalized.plan_hash !== plan.plan_hash) mismatches.push('plan_hash');
  if (normalized.candidate_set_hash !== plan.candidate_set_hash) mismatches.push('candidate_set_hash');
  if (mismatches.length) {
    throw fail(409, 'STORAGE_ATTESTATION_RECOVERY_PLAN_MISMATCH', 'Recovery proof is not bound to the attested plan.', { mismatches });
  }
  return normalized;
}

export function buildHostingerStorageAttestationSubject({
  plan,
  authorization,
  toolchain_resolution,
  toolchain_provenance_digest,
  recovery_proof = null,
  created_at,
} = {}) {
  assertSecretFree({ plan, authorization, toolchain_resolution, toolchain_provenance_digest, recovery_proof }, 'attestation_subject');
  const normalizedPlan = normalizePlan(plan);
  const normalizedAuthorization = normalizeAuthorization(authorization, normalizedPlan);
  const tools = selectedTools(toolchain_resolution);
  const payload = {
    schema_version: 1,
    subject_key: SUBJECT_KEY,
    attestation_version: HOSTINGER_STORAGE_ATTESTATION_VERSION,
    created_at: iso(created_at, 'created_at'),
    plan: normalizedPlan,
    authorization: normalizedAuthorization,
    toolchain: {
      resolution_fingerprint: hash(toolchain_resolution?.resolution_fingerprint, 'resolution_fingerprint'),
      policy_fingerprint: hash(toolchain_resolution?.policy_fingerprint, 'policy_fingerprint'),
      provenance_digest: hash(toolchain_provenance_digest, 'toolchain_provenance_digest'),
      selected_tools: tools,
    },
    recovery: normalizeRecovery(recovery_proof, normalizedPlan),
    secrets_included: false,
  };
  const subjectDigest = digest(payload);
  return Object.freeze({
    ok: true,
    subject_type: SUBJECT_TYPE,
    predicate_type: PREDICATE_TYPE,
    subject_name: `hostinger-storage-plan:${payload.plan.plan_id}`,
    subject_digest: subjectDigest,
    payload: Object.freeze(payload),
    signing_allowed: false,
    dispatch_allowed: false,
    blockers: ['STORAGE_DISPATCH_DISABLED'],
    secrets_included: false,
  });
}

function signerAllowed(identity, patterns = []) {
  return patterns.some((pattern) => {
    const normalized = text(pattern, 256);
    if (normalized.endsWith('*')) return identity.startsWith(normalized.slice(0, -1));
    return identity === normalized;
  });
}

function validateSubjectIdentity(subject) {
  if (subject?.subject_type !== SUBJECT_TYPE || subject?.predicate_type !== PREDICATE_TYPE) {
    throw fail(409, 'STORAGE_ATTESTATION_SUBJECT_TYPE_INVALID', 'Unexpected attestation subject or predicate type.');
  }
  const payload = subject?.payload;
  if (payload?.schema_version !== 1 || payload?.subject_key !== SUBJECT_KEY || payload?.attestation_version !== HOSTINGER_STORAGE_ATTESTATION_VERSION) {
    throw fail(409, 'STORAGE_ATTESTATION_SUBJECT_SCHEMA_INVALID', 'Unexpected attestation payload schema identity.');
  }
  const plan = normalizePlan(payload.plan);
  const authorization = normalizeAuthorization(payload.authorization, plan);
  const toolchain = normalizeToolchain(payload.toolchain);
  const recovery = payload.recovery?.required === true
    ? normalizeRecovery({ required: true, ready: payload.recovery.ready, proof_digest: payload.recovery.proof_digest, proof: payload.recovery }, plan)
    : normalizeRecovery(payload.recovery, plan);
  if (subject.subject_name !== `hostinger-storage-plan:${plan.plan_id}`) {
    throw fail(409, 'STORAGE_ATTESTATION_SUBJECT_NAME_INVALID', 'Attestation subject name does not match the bound plan.');
  }
  return { plan, authorization, recovery, toolchain };
}

export function verifyHostingerStorageAttestationEvidence({ subject, verification, policy, now } = {}) {
  assertSecretFree({ subject, verification, policy }, 'attestation_verification');
  const identity = validateSubjectIdentity(subject);
  if (!subject?.payload || digest(subject.payload) !== subject.subject_digest) {
    throw fail(409, 'STORAGE_PLAN_TAMPERED', 'Attestation subject digest does not match its payload.');
  }
  const blockers = [];
  if (verification?.verified !== true) blockers.push('STORAGE_ATTESTATION_SIGNATURE_INVALID');
  if (text(verification?.subject_digest, 64).toLowerCase() !== subject.subject_digest) blockers.push('STORAGE_ATTESTATION_SUBJECT_MISMATCH');
  const signerIdentity = text(verification?.signer_identity, 256);
  const issuer = text(verification?.issuer, 256);
  if (!signerAllowed(signerIdentity, policy?.allowed_signer_patterns || [])) blockers.push('STORAGE_ATTESTATION_SIGNER_FORBIDDEN');
  if (!(policy?.allowed_issuers || []).includes(issuer)) blockers.push('STORAGE_ATTESTATION_ISSUER_FORBIDDEN');
  if (policy?.transparency_log_required === true && verification?.transparency_log_verified !== true) blockers.push('STORAGE_ATTESTATION_TRANSPARENCY_LOG_REQUIRED');
  const verifiedAt = Date.parse(text(verification?.verified_at, 64));
  const nowAt = Date.parse(text(now, 64));
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(nowAt)) blockers.push('STORAGE_ATTESTATION_TIME_INVALID');
  if (Number.isFinite(verifiedAt) && Number.isFinite(nowAt) && verifiedAt > nowAt) blockers.push('STORAGE_ATTESTATION_TIME_IN_FUTURE');
  const ageMinutes = Number.isFinite(verifiedAt) && Number.isFinite(nowAt) ? (nowAt - verifiedAt) / 60000 : Number.POSITIVE_INFINITY;
  if (Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes > Number(policy?.max_age_minutes || 15)) blockers.push('STORAGE_ATTESTATION_STALE');
  const bundleRef = verification?.bundle_ref ? safeRef(verification.bundle_ref, 'bundle_ref') : null;
  if (!bundleRef) blockers.push('STORAGE_ATTESTATION_BUNDLE_REQUIRED');
  const evidence = {
    schema_version: 1,
    evidence_key: 'hostinger_storage_attestation_verification_v1',
    subject_type: subject.subject_type,
    predicate_type: subject.predicate_type,
    subject_name: subject.subject_name,
    subject_digest: subject.subject_digest,
    operation_id: identity.plan.operation_id,
    plan_id: identity.plan.plan_id,
    target_id: identity.plan.target_id,
    plan_hash: identity.plan.plan_hash,
    candidate_set_hash: identity.plan.candidate_set_hash,
    authority_context_hash: identity.plan.authority_context_hash,
    ownership_revision: identity.plan.ownership_revision,
    policy_revision: identity.plan.policy_revision,
    approval_set_hash: identity.authorization.approval_set_hash,
    capability_envelope_id: identity.authorization.capability_envelope_id,
    execution_lease_id: identity.authorization.execution_lease_id,
    recovery_required: identity.recovery.required,
    recovery_proof_digest: identity.recovery.proof_digest,
    recovery_requirement_binding_digest: identity.recovery.requirement_binding_digest,
    toolchain_resolution_fingerprint: identity.toolchain.resolution_fingerprint,
    toolchain_policy_fingerprint: identity.toolchain.policy_fingerprint,
    toolchain_provenance_digest: identity.toolchain.provenance_digest,
    toolchain_selected_tools_digest: identity.toolchain.selected_tools_digest,
    signer_identity: signerIdentity || null,
    issuer: issuer || null,
    bundle_ref: bundleRef,
    transparency_log_verified: verification?.transparency_log_verified === true,
    verified_at: Number.isFinite(verifiedAt) ? new Date(verifiedAt).toISOString() : null,
    age_minutes: Number.isFinite(ageMinutes) && ageMinutes >= 0 ? Number(ageMinutes.toFixed(3)) : null,
    blockers: [...new Set(blockers)].sort(),
    secrets_included: false,
  };
  return Object.freeze({
    ok: true,
    ready: evidence.blockers.length === 0,
    evidence: Object.freeze(evidence),
    evidence_digest: digest(evidence),
    blockers: evidence.blockers,
    authority_granted: false,
    dispatch_allowed: false,
    secrets_included: false,
  });
}

export function evaluateHostingerStoragePolicyParity({ native_decision, shadow_decision, policy_revision } = {}) {
  assertSecretFree({ native_decision, shadow_decision }, 'policy_parity');
  const normalizedNative = stable(native_decision || {});
  const normalizedShadow = stable(shadow_decision || {});
  const nativeDigest = digest(normalizedNative);
  const shadowDigest = digest(normalizedShadow);
  const parity = nativeDigest === shadowDigest;
  return Object.freeze({
    ok: true,
    policy_revision: safeId(policy_revision, 'policy_revision'),
    native_decision_digest: nativeDigest,
    shadow_decision_digest: shadowDigest,
    parity,
    activation_allowed: false,
    blockers: parity ? ['STORAGE_OPA_SHADOW_NOT_ACTIVATED'] : ['STORAGE_OPA_SHADOW_PARITY_MISMATCH'],
    secrets_included: false,
  });
}

export function buildHostingerStorageTelemetryEnvelope({ required_attributes = [], attributes = {}, event_name, observed_at } = {}) {
  assertSecretFree(attributes, 'telemetry.attributes', { allow_authorization_envelope: false });
  const safeAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    const normalizedKey = text(key, 128);
    if (!normalizedKey) continue;
    if (value !== null && typeof value === 'object') {
      throw fail(400, 'STORAGE_OUTPUT_REDACTION_FAILED', 'Telemetry attributes must be bounded scalar values.', { attribute: key, reason: 'non_scalar_attribute' });
    }
    safeAttributes[normalizedKey] = typeof value === 'number' || typeof value === 'boolean' ? value : text(value, 256);
  }
  const missing = required_attributes.filter((key) => !Object.hasOwn(safeAttributes, key));
  if (missing.length) throw fail(400, 'STORAGE_TELEMETRY_ATTRIBUTES_REQUIRED', 'Required telemetry attributes are missing.', { missing });
  const envelope = {
    schema_version: 1,
    event_name: safeId(event_name, 'event_name'),
    observed_at: iso(observed_at, 'observed_at'),
    attributes: stable(safeAttributes),
    secrets_included: false,
  };
  return Object.freeze({
    ok: true,
    envelope: Object.freeze(envelope),
    envelope_digest: digest(envelope),
    emit_allowed: false,
    runtime_wired: false,
    blockers: ['STORAGE_TELEMETRY_RUNTIME_NOT_WIRED'],
    secrets_included: false,
  });
}
