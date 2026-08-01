import { createHash } from 'node:crypto';
import {
  buildCanonicalHostingerStoragePlanEnvelope,
  buildHostingerStorageExecutionAuthorizationBundle as buildLegacyBundle,
  resolveHostingerStorageApprovalSet,
} from './hostingerStorageExecutionAuthorization.js';

export const HOSTINGER_STORAGE_EXECUTION_AUTHORIZATION_V2_VERSION = 'spec014-storage-execution-authorization-v2';

const SHA256_RE = /^[0-9a-f]{64}$/i;

function failure(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
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

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 256)).filter(Boolean))].sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function assertSecretFree(value, path = 'value', depth = 0) {
  if (depth > 16 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'secrets_included' && /(password|passwd|secret_value|private[_-]?key|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization_header|raw_authorization|cookie_header|session_cookie|raw_provider_payload|raw_environment|file_content)/i.test(key)) {
      throw failure(400, 'STORAGE_EXECUTION_SECRET_FIELD_REJECTED', 'Execution authorization inputs must not contain secret-bearing fields.', { path: `${path}.${key}` });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

function hash(value, field) {
  const normalized = text(value, 64).toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw failure(400, 'STORAGE_EXECUTION_HASH_INVALID', 'A lowercase SHA-256 binding is required.', { field });
  }
  return normalized;
}

function projectExecutionEnvelope(envelope = {}) {
  assertSecretFree(envelope, 'operation_envelope');
  const projected = {
    allowed: envelope.allowed === true,
    operation_id: text(envelope.operation_id, 256),
    operation_key: text(envelope.operation_key, 256),
    authority_context_hash: text(envelope.authority_context_hash, 64).toLowerCase(),
    target_binding: {
      target_id: text(envelope.target_binding?.target_id, 256),
    },
    request_binding: {
      plan_hash: text(envelope.request_binding?.plan_hash, 64).toLowerCase(),
      candidate_set_hash: text(envelope.request_binding?.candidate_set_hash, 64).toLowerCase(),
      execution_lease_id: text(envelope.request_binding?.execution_lease_id, 256),
    },
    provider_adapter: {
      adapter_key: text(envelope.provider_adapter?.adapter_key, 256),
    },
    governance_decision_digest: digest({
      decision: envelope.authorization?.decision ?? null,
      reason_codes: unique(envelope.authorization?.reason_codes),
      visibility: envelope.authorization?.visibility ?? null,
      required_workspace_approvals: unique(envelope.authorization?.required_workspace_approvals),
    }),
    secrets_included: false,
  };
  return deepFreeze(projected);
}

function validateCanonicalAttestationBinding(input = {}) {
  const plan = input.plan || {};
  const evidence = input.attestation_verification?.evidence;
  if (!evidence || typeof evidence !== 'object') {
    throw failure(409, 'STORAGE_ATTESTATION_PLAN_BINDING_REQUIRED', 'Canonical attestation evidence with immutable plan bindings is required.');
  }
  const required = [
    ['operation_id', text(plan.operation_id, 256)],
    ['plan_id', text(plan.plan_id, 256)],
    ['target_id', text(plan.target_id, 256)],
    ['plan_hash', hash(plan.plan_hash, 'plan.plan_hash')],
    ['candidate_set_hash', hash(plan.candidate_set_hash, 'plan.candidate_set_hash')],
    ['authority_context_hash', hash(plan.authority_context_hash, 'plan.authority_context_hash')],
  ];
  const missing = [];
  const mismatches = [];
  for (const [field, expected] of required) {
    const observed = field.endsWith('_hash') ? text(evidence[field], 64).toLowerCase() : text(evidence[field], 256);
    if (!observed) missing.push(field);
    else if (observed !== expected) mismatches.push(field);
  }
  if (missing.length) {
    throw failure(409, 'STORAGE_ATTESTATION_PLAN_BINDING_REQUIRED', 'Attestation evidence is missing immutable plan bindings.', { missing });
  }
  if (mismatches.length) {
    throw failure(409, 'STORAGE_ATTESTATION_PLAN_BINDING_MISMATCH', 'Attestation evidence belongs to a different operation, plan, target, candidate set, or authority context.', { mismatches });
  }
  const leaseId = text(input.lease?.lease_id ?? input.lease?.leaseId, 256);
  if (!text(evidence.execution_lease_id, 256) || text(evidence.execution_lease_id, 256) !== leaseId) {
    throw failure(409, 'STORAGE_ATTESTATION_LEASE_BINDING_MISMATCH', 'Attestation evidence must bind the current execution lease.', {
      expected_execution_lease_id: leaseId || null,
    });
  }
  return deepFreeze({
    operation_id: required[0][1],
    plan_id: required[1][1],
    target_id: required[2][1],
    plan_hash: required[3][1],
    candidate_set_hash: required[4][1],
    authority_context_hash: required[5][1],
    execution_lease_id: leaseId,
    evidence_digest: hash(input.attestation_verification?.evidence_digest, 'attestation.evidence_digest'),
    secrets_included: false,
  });
}

export { buildCanonicalHostingerStoragePlanEnvelope, resolveHostingerStorageApprovalSet };

export function buildHostingerStorageExecutionAuthorizationBundle(input = {}) {
  assertSecretFree(input, 'execution_bundle_input');
  const projectedEnvelope = projectExecutionEnvelope(input.operation_envelope);
  const canonicalAttestationBinding = validateCanonicalAttestationBinding(input);
  const legacy = buildLegacyBundle({ ...input, operation_envelope: projectedEnvelope });
  const bundle = {
    ...legacy.bundle,
    bundle_version: HOSTINGER_STORAGE_EXECUTION_AUTHORIZATION_V2_VERSION,
    governance_decision_digest: projectedEnvelope.governance_decision_digest,
    canonical_attestation_binding: canonicalAttestationBinding,
  };
  const bundleHash = digest(bundle);
  return deepFreeze({
    ...legacy,
    bundle,
    bundle_hash: bundleHash,
    authorization_ready: legacy.authorization_ready === true,
    dispatch_allowed: false,
    provider_dispatch_default_off: true,
    secrets_included: false,
  });
}

export function verifyHostingerStorageExecutionAuthorizationBundle({ authorization, current = {}, expected_bundle_hash } = {}) {
  if (!authorization?.bundle) {
    throw failure(400, 'STORAGE_EXECUTION_BUNDLE_REQUIRED', 'Execution authorization bundle is required.');
  }
  assertSecretFree({ execution_bundle: authorization, current }, 'bundle_verification');
  const blockers = [];
  const observedHash = digest(authorization.bundle);
  if (observedHash !== authorization.bundle_hash) blockers.push('STORAGE_EXECUTION_BUNDLE_TAMPERED');
  if (expected_bundle_hash && hash(expected_bundle_hash, 'expected_bundle_hash') !== observedHash) blockers.push('STORAGE_EXECUTION_BUNDLE_HASH_MISMATCH');
  const comparisons = [
    ['ownership_revision', 'STORAGE_OWNERSHIP_REVISION_CHANGED'],
    ['policy_revision', 'STORAGE_POLICY_REVISION_CHANGED'],
    ['plan_hash', 'STORAGE_PLAN_CHANGED'],
    ['candidate_set_hash', 'STORAGE_CANDIDATE_SET_CHANGED'],
    ['impact_set_hash', 'STORAGE_IMPACT_SET_CHANGED'],
    ['authority_context_hash', 'STORAGE_AUTHORITY_CONTEXT_CHANGED'],
    ['approval_set_hash', 'STORAGE_APPROVAL_SET_CHANGED'],
    ['toolchain_provenance_digest', 'STORAGE_TOOLCHAIN_PROVENANCE_CHANGED'],
    ['governance_decision_digest', 'STORAGE_GOVERNANCE_DECISION_CHANGED'],
  ];
  for (const [field, code] of comparisons) {
    if (current[field] && text(current[field], 256) !== text(authorization.bundle[field], 256)) blockers.push(code);
  }
  if (current.attestation_evidence_digest && current.attestation_evidence_digest !== authorization.bundle.canonical_attestation_binding?.evidence_digest) blockers.push('STORAGE_ATTESTATION_EVIDENCE_CHANGED');
  if (current.lease_generation && Number(current.lease_generation) !== Number(authorization.bundle.execution_lease?.generation)) blockers.push('STORAGE_EXECUTION_LEASE_GENERATION_CHANGED');
  if (current.host_key_revision && current.host_key_revision !== authorization.bundle.dispatch_certification?.host_key_revision) blockers.push('STORAGE_SSH_HOST_KEY_REVISION_CHANGED');
  return deepFreeze({
    ok: true,
    valid: blockers.length === 0 && authorization.authorization_ready === true,
    observed_bundle_hash: observedHash,
    dispatch_allowed: false,
    blockers: unique(blockers),
    secrets_included: false,
  });
}
